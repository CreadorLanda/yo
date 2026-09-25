package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

var (
	ErrNotFound    = errors.New("media_not_found")
	ErrTooLarge    = errors.New("media_too_large")
	ErrUnsupported = errors.New("media_unsupported_type")
	ErrNotOwner    = errors.New("media_not_owner")
	ErrInvalidFile = errors.New("media_invalid_file")
)

// MaxUploadBytes default 25 MiB — override via config.
const DefaultMaxUploadBytes int64 = 25 << 20

type Service struct {
	repo    *Repository
	rootDir string
	maxSize int64
	ttl     time.Duration
}

func NewService(repo *Repository, rootDir string, maxSize int64, ttl time.Duration) *Service {
	if maxSize <= 0 {
		maxSize = DefaultMaxUploadBytes
	}
	if ttl <= 0 {
		ttl = DefaultMediaTTL
	}
	return &Service{repo: repo, rootDir: rootDir, maxSize: maxSize, ttl: ttl}
}

// MaxRequestBytes includes a small multipart envelope allowance. The HTTP
// layer must reject oversized bodies before multipart parsing allocates them.
func (s *Service) MaxRequestBytes() int64 { return s.maxSize + 1<<20 }

func (s *Service) toObject(row objectRow) Object {
	name := ""
	if row.OriginalName != nil {
		name = *row.OriginalName
	}
	return Object{
		ID:           row.ID,
		OwnerID:      row.OwnerID,
		Kind:         Kind(row.Kind),
		MimeType:     row.MimeType,
		SizeBytes:    row.SizeBytes,
		Width:        row.Width,
		Height:       row.Height,
		DurationMs:   row.DurationMs,
		OriginalName: name,
		URL:          "/api/media/" + row.ID.String() + "/file",
		CreatedAt:    row.CreatedAt,
	}
}

// Upload streams a file to disk and records metadata.
func (s *Service) Upload(
	ctx context.Context,
	ownerID uuid.UUID,
	filename string,
	contentType string,
	r io.Reader,
	sizeHint int64,
	width, height, durationMs *int,
) (Object, error) {
	if sizeHint > 0 && sizeHint > s.maxSize {
		return Object{}, ErrTooLarge
	}

	kind, mimeType, ext := classify(filename, contentType)
	if kind == "" {
		return Object{}, ErrUnsupported
	}

	if err := os.MkdirAll(s.userDir(ownerID), 0o750); err != nil {
		return Object{}, fmt.Errorf("mkdir: %w", err)
	}

	id := uuid.New()
	rel := filepath.ToSlash(filepath.Join(ownerID.String(), id.String()+ext))
	abs := filepath.Join(s.rootDir, filepath.FromSlash(rel))

	f, err := os.OpenFile(abs, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		return Object{}, fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	// Peek at the header to read real dimensions, then hand the same bytes
	// back to the copy so nothing is lost. Client-supplied width/height are
	// only a fallback for formats we cannot sniff (video, audio).
	head := make([]byte, sniffHeaderBytes)
	n, _ := io.ReadFull(r, head)
	head = head[:n]
	if sw, sh := sniffImageSize(head); sw != nil && sh != nil {
		width, height = sw, sh
	}
	r = io.MultiReader(bytes.NewReader(head), r)

	limited := io.LimitReader(r, s.maxSize+1)
	written, err := io.Copy(f, limited)
	if err != nil {
		_ = os.Remove(abs)
		return Object{}, fmt.Errorf("write: %w", err)
	}
	if written > s.maxSize {
		_ = os.Remove(abs)
		return Object{}, ErrTooLarge
	}
	if written == 0 {
		_ = os.Remove(abs)
		return Object{}, ErrInvalidFile
	}

	row, err := s.repo.Insert(ctx, ownerID, kind, mimeType, written, rel, filename, width, height, durationMs)
	if err != nil {
		_ = os.Remove(abs)
		return Object{}, err
	}
	// Everything uploaded is transient by default. Attaching it to a message
	// narrows this further by setting the recipient count.
	if err := s.repo.SetExpiry(ctx, row.ID, time.Now().Add(s.ttl), 0); err != nil {
		log.Warn().Err(err).Msg("media: set expiry")
	}
	return s.toObject(row), nil
}

// AttachToMessage tells the sweeper how many people still need these bytes.
// Once that many have fetched, the blob goes early instead of waiting out
// the full TTL.
func (s *Service) AttachToMessage(ctx context.Context, id uuid.UUID, recipients int) error {
	return s.repo.SetExpiry(ctx, id, time.Now().Add(s.ttl), recipients)
}

// NoteFetched records a recipient's download so the blob can be released.
func (s *Service) NoteFetched(ctx context.Context, id, userID uuid.UUID) error {
	return s.repo.MarkFetched(ctx, id, userID)
}

// SetKeepForever exempts a blob from the sweep for users with backup on.
func (s *Service) SetKeepForever(ctx context.Context, id uuid.UUID, keep bool) error {
	return s.repo.SetKeepForever(ctx, id, keep)
}

// Duplicate copies an existing object into another user's ownership.
//
// Saving a sticker someone else sent has to end up owned by the saver:
// referencing the sender's row would 404 the moment they delete their
// account (media_objects cascades on user delete), and cross-user reads
// are not something the rest of the API allows.
func (s *Service) Duplicate(ctx context.Context, srcID, newOwner uuid.UUID) (Object, error) {
	src, err := s.repo.Get(ctx, srcID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Object{}, ErrNotFound
		}
		return Object{}, err
	}
	// Already theirs — nothing to copy.
	if src.OwnerID == newOwner {
		return s.toObject(src), nil
	}

	srcAbs := filepath.Join(s.rootDir, filepath.FromSlash(src.StoragePath))
	if !strings.HasPrefix(filepath.Clean(srcAbs), filepath.Clean(s.rootDir)) {
		return Object{}, ErrNotFound
	}
	in, err := os.Open(srcAbs)
	if err != nil {
		return Object{}, ErrNotFound
	}
	defer in.Close()

	if err := os.MkdirAll(s.userDir(newOwner), 0o750); err != nil {
		return Object{}, fmt.Errorf("mkdir: %w", err)
	}
	ext := filepath.Ext(src.StoragePath)
	id := uuid.New()
	rel := filepath.ToSlash(filepath.Join(newOwner.String(), id.String()+ext))
	abs := filepath.Join(s.rootDir, filepath.FromSlash(rel))

	out, err := os.OpenFile(abs, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		return Object{}, fmt.Errorf("create copy: %w", err)
	}
	defer out.Close()

	written, err := io.Copy(out, in)
	if err != nil {
		_ = os.Remove(abs)
		return Object{}, fmt.Errorf("copy: %w", err)
	}

	name := ""
	if src.OriginalName != nil {
		name = *src.OriginalName
	}
	row, err := s.repo.Insert(ctx, newOwner, Kind(src.Kind), src.MimeType, written, rel,
		name, src.Width, src.Height, src.DurationMs)
	if err != nil {
		_ = os.Remove(abs)
		return Object{}, err
	}
	return s.toObject(row), nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Object, error) {
	row, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Object{}, ErrNotFound
		}
		return Object{}, err
	}
	return s.toObject(row), nil
}

// GetForUser is the authenticated metadata path. Until media grants are
// persisted at attachment time, only the uploader can retrieve an object by
// id. Returning not-found for another user avoids turning this endpoint into
// an object-existence oracle.
func (s *Service) GetForUser(ctx context.Context, id, userID uuid.UUID) (Object, error) {
	row, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Object{}, ErrNotFound
		}
		return Object{}, err
	}
	if row.OwnerID != userID {
		return Object{}, ErrNotFound
	}
	return s.toObject(row), nil
}

// ErrPurged means the bytes were swept after delivery; the row survives so
// the client can show "media no longer available" rather than an error.
var ErrPurged = errors.New("media_purged")

// Open returns a read handle + metadata for streaming the file.
func (s *Service) Open(ctx context.Context, id uuid.UUID) (Object, *os.File, error) {
	row, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Object{}, nil, ErrNotFound
		}
		return Object{}, nil, err
	}
	abs := filepath.Join(s.rootDir, filepath.FromSlash(row.StoragePath))
	// Prevent path escape.
	if !strings.HasPrefix(filepath.Clean(abs), filepath.Clean(s.rootDir)) {
		return Object{}, nil, ErrNotFound
	}
	f, err := os.Open(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return Object{}, nil, ErrNotFound
		}
		return Object{}, nil, err
	}
	return s.toObject(row), f, nil
}

// OpenForUser is the byte-stream equivalent of GetForUser. A future media
// grant table can widen this check for message/channel/story recipients
// without weakening the controller contract.
func (s *Service) OpenForUser(ctx context.Context, id, userID uuid.UUID) (Object, *os.File, error) {
	row, err := s.repo.Get(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Object{}, nil, ErrNotFound
		}
		return Object{}, nil, err
	}
	if row.OwnerID != userID {
		return Object{}, nil, ErrNotFound
	}
	abs := filepath.Join(s.rootDir, filepath.FromSlash(row.StoragePath))
	if !strings.HasPrefix(filepath.Clean(abs), filepath.Clean(s.rootDir)) {
		return Object{}, nil, ErrNotFound
	}
	f, err := os.Open(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return Object{}, nil, ErrNotFound
		}
		return Object{}, nil, err
	}
	return s.toObject(row), f, nil
}

func (s *Service) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	row, err := s.repo.Delete(ctx, id, ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	abs := filepath.Join(s.rootDir, filepath.FromSlash(row.StoragePath))
	_ = os.Remove(abs)
	return nil
}

func (s *Service) userDir(ownerID uuid.UUID) string {
	return filepath.Join(s.rootDir, ownerID.String())
}

func classify(filename, contentType string) (Kind, string, string) {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ct == "" || ct == "application/octet-stream" {
		if ext != "" {
			if t := mime.TypeByExtension(ext); t != "" {
				ct = t
			}
		}
	}
	if ct == "" {
		ct = "application/octet-stream"
	}

	switch {
	case strings.HasPrefix(ct, "image/"):
		return KindImage, ct, ensureExt(ext, ".jpg")
	case strings.HasPrefix(ct, "video/"):
		return KindVideo, ct, ensureExt(ext, ".mp4")
	case strings.HasPrefix(ct, "audio/"):
		return KindAudio, ct, ensureExt(ext, ".m4a")
	case ct == "application/pdf" ||
		strings.HasPrefix(ct, "text/") ||
		strings.Contains(ct, "document") ||
		strings.Contains(ct, "msword") ||
		strings.Contains(ct, "officedocument") ||
		ext == ".pdf" || ext == ".doc" || ext == ".docx" || ext == ".txt":
		return KindDocument, ct, ensureExt(ext, ".bin")
	default:
		// Allow common binary attachments as document.
		if ext != "" {
			return KindDocument, ct, ext
		}
		return "", "", ""
	}
}

func ensureExt(ext, fallback string) string {
	if ext == "" || len(ext) > 12 {
		return fallback
	}
	// Keep only safe chars.
	for _, c := range ext {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '.' {
			return fallback
		}
	}
	return ext
}
