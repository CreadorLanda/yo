package users

import (
	"context"
	"errors"
	"regexp"

	"github.com/google/uuid"
)

var (
	ErrNotFound          = errors.New("user_not_found")
	ErrInvalidVisibility = errors.New("invalid_visibility")
	ErrUsernameInvalid   = errors.New("username_invalid")
	ErrUsernameTaken     = errors.New("username_taken")
)

// usernameRe — same rule the mobile client uses (3–20 chars, lowercase
// letters, digits, underscores). Validating server-side too keeps the
// invariant: every username row in the DB is well-formed.
var usernameRe = regexp.MustCompile(`^[a-z0-9_]{3,20}$`)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// Me returns the authenticated user's full profile.
func (s *Service) Me(ctx context.Context, userID uuid.UUID) (*User, error) {
	u, err := s.repo.ByID(ctx, userID)
	if IsNoRows(err) {
		return nil, ErrNotFound
	}
	return u, err
}

// ByUsername — public lookup. Honours username_public: if the target's
// username is private, only contacts can see it. Contact graph isn't here
// yet, so for now private = 404 unless it's the same user.
func (s *Service) ByUsername(ctx context.Context, callerID uuid.UUID, username string) (*User, error) {
	u, err := s.repo.ByUsername(ctx, username)
	if IsNoRows(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !u.UsernamePublic && u.ID != callerID {
		return nil, ErrNotFound
	}
	return u, nil
}

// CheckAvailability — strict username validation + uniqueness check.
func (s *Service) CheckAvailability(ctx context.Context, callerID uuid.UUID, username string) (AvailabilityResponse, error) {
	if !usernameRe.MatchString(username) {
		return AvailabilityResponse{Username: username, Available: false}, ErrUsernameInvalid
	}
	taken, err := s.repo.IsUsernameTaken(ctx, username, callerID)
	if err != nil {
		return AvailabilityResponse{}, err
	}
	return AvailabilityResponse{Username: username, Available: !taken}, nil
}

// Search finds users by username or display_name. Only returns users who
// have username_public = true. The caller is excluded from results.
//
// Returns PublicView, never User: the wide struct carries privacy settings,
// and a search that reports whether somebody has ghost mode on has handed
// over the very thing ghost mode is for.
func (s *Service) Search(ctx context.Context, callerID uuid.UUID, query string) ([]PublicView, error) {
	if len(query) < 2 {
		return nil, nil
	}
	found, err := s.repo.Search(ctx, query, callerID)
	if err != nil {
		return nil, err
	}
	return s.publicViews(ctx, callerID, found)
}

// ByUsernamePublic is the same narrowing for a single lookup.
//
// Goes through ByUsername rather than the repository, so the private-username
// rule and the not-found mapping stay in one place. Reaching past it here
// would have quietly re-exposed anybody with username_public = false.
func (s *Service) ByUsernamePublic(
	ctx context.Context,
	callerID uuid.UUID,
	username string,
) (*PublicView, error) {
	u, err := s.ByUsername(ctx, callerID, username)
	if err != nil {
		return nil, err
	}
	views, err := s.publicViews(ctx, callerID, []User{*u})
	if err != nil || len(views) == 0 {
		return nil, err
	}
	return &views[0], nil
}

// publicViews resolves "do we share a chat" once for the whole set, then
// renders each row through it — a search returns twenty people and asking per
// row is twenty round trips.
func (s *Service) publicViews(
	ctx context.Context,
	callerID uuid.UUID,
	found []User,
) ([]PublicView, error) {
	ids := make([]uuid.UUID, 0, len(found))
	for i := range found {
		ids = append(ids, found[i].ID)
	}
	shared, err := s.repo.SharedChatIDs(ctx, callerID, ids)
	if err != nil {
		// A failed lookup must not become "everyone is a contact". Falling
		// closed shows fewer photos than it could; falling open shows photos
		// somebody asked to keep for their contacts.
		shared = map[uuid.UUID]bool{}
	}
	views := make([]PublicView, 0, len(found))
	for i := range found {
		views = append(views, found[i].PublicViewFor(shared[found[i].ID]))
	}
	return views, nil
}

// Patch applies a profile patch. Validates the username (when supplied)
// and surfaces a precise error so the controller can map it to 409.
func (s *Service) Patch(ctx context.Context, userID uuid.UUID, p PatchRequest) (*User, error) {
	if p.Username != nil {
		if !usernameRe.MatchString(*p.Username) {
			return nil, ErrUsernameInvalid
		}
		taken, err := s.repo.IsUsernameTaken(ctx, *p.Username, userID)
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, ErrUsernameTaken
		}
	}
	// Reject an unknown visibility rather than letting the CHECK constraint
	// fail: a 400 naming the field is something a client can act on, a 500
	// from the database is not.
	for _, v := range []*Visibility{p.LastSeenVisibility, p.PhotoVisibility} {
		if v != nil && !v.valid() {
			return nil, ErrInvalidVisibility
		}
	}

	u, err := s.repo.Patch(ctx, userID, p)
	if IsNoRows(err) {
		return nil, ErrNotFound
	}
	return u, err
}

// Delete removes the account for good.
//
// No grace period and no soft flag: an account that is "deleted" but still
// there is a lie told to someone who asked to be gone. Everything that
// references the user cascades away with it.
func (s *Service) Delete(ctx context.Context, userID uuid.UUID) error {
	err := s.repo.Delete(ctx, userID)
	if IsNoRows(err) {
		return ErrNotFound
	}
	return err
}
