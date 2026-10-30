package channels

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestCommentParentValidation(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool))

	owner := createUser(t, pool, "owner_"+uuid.NewString()[:8])
	ch, err := svc.Create(ctx, owner, CreateChannelRequest{
		Name: "Replies", Handle: "replies_" + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	post, err := svc.CreatePost(ctx, ch.ID, owner, CreatePostRequest{Text: "post"})
	if err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	otherPost, err := svc.CreatePost(ctx, ch.ID, owner, CreatePostRequest{Text: "other"})
	if err != nil {
		t.Fatalf("CreatePost2: %v", err)
	}

	top, err := svc.Comment(ctx, post.ID, owner, CommentRequest{Text: "top"})
	if err != nil {
		t.Fatalf("Comment top: %v", err)
	}
	reply, err := svc.Comment(ctx, post.ID, owner, CommentRequest{Text: "reply", ParentID: &top.ID})
	if err != nil {
		t.Fatalf("Comment reply: %v", err)
	}

	// unknown parent
	unknown := uuid.New()
	if _, err := svc.Comment(ctx, post.ID, owner, CommentRequest{Text: "x", ParentID: &unknown}); !errors.Is(err, ErrInvalidParent) {
		t.Fatalf("unknown parent: got %v", err)
	}
	// parent from another post
	if _, err := svc.Comment(ctx, otherPost.ID, owner, CommentRequest{Text: "x", ParentID: &top.ID}); !errors.Is(err, ErrInvalidParent) {
		t.Fatalf("cross-post parent: got %v", err)
	}
	// reply to a reply (second level) rejected
	if _, err := svc.Comment(ctx, post.ID, owner, CommentRequest{Text: "deep", ParentID: &reply.ID}); !errors.Is(err, ErrInvalidParent) {
		t.Fatalf("nested reply: got %v", err)
	}
	// valid top-level stays ok
	if _, err := svc.Comment(ctx, post.ID, owner, CommentRequest{Text: "another"}); err != nil {
		t.Fatalf("plain comment: %v", err)
	}
}
