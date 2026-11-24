package posts

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// fakeStore keeps posts in memory. `owned` is what OwnedMedia answers, which
// is the part every publishing rule turns on.
type fakeStore struct {
	owned    map[uuid.UUID]string
	posts    map[uuid.UUID]row
	slides   map[uuid.UUID][]uuid.UUID
	lastList ListQuery
}

func newFake() *fakeStore {
	return &fakeStore{
		owned:  map[uuid.UUID]string{},
		posts:  map[uuid.UUID]row{},
		slides: map[uuid.UUID][]uuid.UUID{},
	}
}

func (f *fakeStore) media(kind string) uuid.UUID {
	id := uuid.New()
	f.owned[id] = kind
	return id
}

func (f *fakeStore) OwnedMedia(_ context.Context, _ uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	for _, id := range ids {
		if kind, ok := f.owned[id]; ok {
			out[id] = kind
		}
	}
	return out, nil
}

func (f *fakeStore) Insert(_ context.Context, author uuid.UUID, kind Kind, caption string, vis Visibility, mediaIDs []uuid.UUID) (uuid.UUID, error) {
	id := uuid.New()
	f.posts[id] = row{ID: id, AuthorID: author, Kind: string(kind), Caption: caption, Visibility: string(vis)}
	f.slides[id] = mediaIDs
	return id, nil
}

func (f *fakeStore) Get(_ context.Context, id, _ uuid.UUID) (row, error) {
	x, ok := f.posts[id]
	if !ok {
		return row{}, pgx.ErrNoRows
	}
	return x, nil
}

func (f *fakeStore) ListByAuthor(_ context.Context, _ uuid.UUID, q ListQuery) ([]row, error) {
	f.lastList = q
	return nil, nil
}

func (f *fakeStore) MediaFor(_ context.Context, postIDs []uuid.UUID) (map[uuid.UUID][]Media, error) {
	out := map[uuid.UUID][]Media{}
	for _, id := range postIDs {
		for _, m := range f.slides[id] {
			out[id] = append(out[id], Media{ID: m, Kind: f.owned[m]})
		}
	}
	return out, nil
}

func (f *fakeStore) Delete(_ context.Context, id, author uuid.UUID) error {
	x, ok := f.posts[id]
	if !ok || x.AuthorID != author {
		return pgx.ErrNoRows
	}
	delete(f.posts, id)
	return nil
}

func TestCreateCarouselKeepsSlideOrder(t *testing.T) {
	f := newFake()
	svc := &Service{repo: f}
	author := uuid.New()
	ids := []uuid.UUID{f.media("image"), f.media("video"), f.media("image")}

	post, err := svc.Create(context.Background(), author, CreateRequest{
		Kind: KindPost, Caption: "  hello  ", MediaIDs: ids,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if post.Caption != "hello" {
		t.Errorf("caption = %q, want it trimmed", post.Caption)
	}
	if post.Visibility != VisContacts {
		t.Errorf("visibility = %q, want the contacts default", post.Visibility)
	}
	if !post.IsOwn {
		t.Error("the author's own post is not marked as theirs")
	}
	if len(post.Media) != len(ids) {
		t.Fatalf("got %d slides, want %d", len(post.Media), len(ids))
	}
	for i, m := range post.Media {
		if m.ID != ids[i] {
			t.Errorf("slide %d is %s, want %s", i, m.ID, ids[i])
		}
	}
}

func TestCreateRejects(t *testing.T) {
	f := newFake()
	svc := &Service{repo: f}
	image, video, doc := f.media("image"), f.media("video"), f.media("document")
	notMine := uuid.New()

	eleven := make([]uuid.UUID, MaxMedia+1)
	for i := range eleven {
		eleven[i] = f.media("image")
	}

	cases := []struct {
		name string
		req  CreateRequest
		want error
	}{
		{"unknown kind", CreateRequest{Kind: "story", MediaIDs: []uuid.UUID{image}}, ErrInvalidKind},
		// 'close' is a story audience with no list behind it; a permanent
		// post must not accept an audience that shows it to nobody.
		{"close audience", CreateRequest{Kind: KindPost, Visibility: "close", MediaIDs: []uuid.UUID{image}}, ErrInvalidVis},
		{"no media", CreateRequest{Kind: KindPost}, ErrNeedMedia},
		{"too many slides", CreateRequest{Kind: KindPost, MediaIDs: eleven}, ErrTooManyMedia},
		{"same slide twice", CreateRequest{Kind: KindPost, MediaIDs: []uuid.UUID{image, image}}, ErrDuplicateMedia},
		{"someone else's media", CreateRequest{Kind: KindPost, MediaIDs: []uuid.UUID{image, notMine}}, ErrMediaNotOwned},
		{"a document", CreateRequest{Kind: KindPost, MediaIDs: []uuid.UUID{doc}}, ErrUnsupportedType},
		{"reel from a photo", CreateRequest{Kind: KindReel, MediaIDs: []uuid.UUID{image}}, ErrReelNeedsVideo},
		{"reel with two videos", CreateRequest{Kind: KindReel, MediaIDs: []uuid.UUID{video, f.media("video")}}, ErrReelNeedsVideo},
		{"caption too long", CreateRequest{
			Kind: KindPost, MediaIDs: []uuid.UUID{image},
			Caption: strings.Repeat("á", MaxCaptionRunes+1),
		}, ErrCaptionTooLong},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.Create(context.Background(), uuid.New(), tc.req)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
	if len(f.posts) != 0 {
		t.Fatalf("%d rejected posts were stored", len(f.posts))
	}
}

func TestCaptionLimitCountsCharactersNotBytes(t *testing.T) {
	f := newFake()
	svc := &Service{repo: f}
	// 2200 two-byte characters: over the limit in bytes, exactly at it in
	// characters, which is what the column's char_length checks.
	_, err := svc.Create(context.Background(), uuid.New(), CreateRequest{
		Kind: KindReel, MediaIDs: []uuid.UUID{f.media("video")},
		Caption: strings.Repeat("á", MaxCaptionRunes),
	})
	if err != nil {
		t.Fatalf("a caption at the limit was refused: %v", err)
	}
}

func TestListClampsPageSize(t *testing.T) {
	f := newFake()
	svc := &Service{repo: f}
	for _, tc := range []struct{ in, want int }{
		{0, DefaultPageSize}, {-3, DefaultPageSize}, {12, 12}, {5000, MaxPageSize},
	} {
		if _, err := svc.ListByAuthor(context.Background(), uuid.New(), ListQuery{Limit: tc.in}); err != nil {
			t.Fatalf("list: %v", err)
		}
		if f.lastList.Limit != tc.want {
			t.Errorf("limit %d reached the store as %d, want %d", tc.in, f.lastList.Limit, tc.want)
		}
	}
	if _, err := svc.ListByAuthor(context.Background(), uuid.New(), ListQuery{Kind: "story"}); !errors.Is(err, ErrInvalidKind) {
		t.Errorf("unknown kind filter: err = %v, want %v", err, ErrInvalidKind)
	}
}

func TestDeleteSomeoneElsesPostReadsAsMissing(t *testing.T) {
	f := newFake()
	svc := &Service{repo: f}
	author := uuid.New()
	post, err := svc.Create(context.Background(), author, CreateRequest{
		Kind: KindPost, MediaIDs: []uuid.UUID{f.media("image")},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.Delete(context.Background(), post.ID, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger delete: err = %v, want %v", err, ErrNotFound)
	}
	if err := svc.Delete(context.Background(), post.ID, author); err != nil {
		t.Fatalf("author delete: %v", err)
	}
}
