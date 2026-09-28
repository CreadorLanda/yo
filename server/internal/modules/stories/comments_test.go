package stories

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestAnonymousCommentHidesItsAuthor is the guarantee that matters here.
//
// Checked on the serialised JSON, like the blind channel: the leak that
// counts is the one that reaches the wire, and a field added later would
// slip past a field-by-field assertion.
func TestAnonymousCommentHidesItsAuthor(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	commenter := createUser(t, pool, "shy_"+uuid.NewString()[:8])
	bystander := createUser(t, pool, "other_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if _, err := svc.AddComment(ctx, story.ID, commenter, nil, "às escondidas", true); err != nil {
		t.Fatalf("AddComment(anon): %v", err)
	}

	// Neither the story's author nor a bystander may learn who wrote it.
	for _, viewer := range []uuid.UUID{author, bystander} {
		list, err := svc.Comments(ctx, story.ID, viewer)
		if err != nil {
			t.Fatalf("Comments: %v", err)
		}
		if len(list) != 1 {
			t.Fatalf("expected one comment, got %d", len(list))
		}
		payload := mustJSON(t, list)
		if strings.Contains(payload, commenter.String()) {
			t.Fatalf("anonymous commenter id reached the response:\n%s", payload)
		}
		if list[0].AuthorName != "" || list[0].AuthorUser != "" || list[0].AuthorAvatar != "" {
			t.Fatalf("identity fields populated on an anonymous comment: %+v", list[0])
		}
		if list[0].IsMine {
			t.Fatalf("someone else's comment came back as mine for %s", viewer)
		}
	}

	// The person who wrote it still knows it is theirs, so they can delete it.
	own, err := svc.Comments(ctx, story.ID, commenter)
	if err != nil {
		t.Fatalf("Comments(commenter): %v", err)
	}
	if !own[0].IsMine {
		t.Fatal("the commenter cannot tell their own anonymous comment apart")
	}
	if own[0].AuthorID != "" {
		t.Fatalf("id present even for the commenter: %q", own[0].AuthorID)
	}
}

// TestCommentPolicyIsTheAuthors: both switches are the story author's to set,
// and the server must enforce what the publish screen offered.
func TestCommentPolicyIsTheAuthors(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	commenter := createUser(t, pool, "user_"+uuid.NewString()[:8])
	no := false

	closed, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "x", Visibility: VisPublic, AllowComments: &no,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.AddComment(ctx, closed.ID, commenter, nil, "olá", false); !errors.Is(err, ErrCommentsDisabled) {
		t.Fatalf("commenting where it is off: got %v, want ErrCommentsDisabled", err)
	}

	noAnon, err := svc.Create(ctx, author, CreateRequest{
		Kind: KindText, Caption: "x", Visibility: VisPublic, AllowAnonymousReplies: &no,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.AddComment(ctx, noAnon.ID, commenter, nil, "olá", true); !errors.Is(err, ErrAnonNotAllowed) {
		t.Fatalf("anonymous where it is off: got %v, want ErrAnonNotAllowed", err)
	}
	// A named comment on the same story is fine.
	if _, err := svc.AddComment(ctx, noAnon.ID, commenter, nil, "olá", false); err != nil {
		t.Fatalf("named comment refused: %v", err)
	}

	// Omitting the fields must leave both on, or an older client would
	// publish every story with comments disabled.
	def, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if !def.AllowComments || !def.AllowAnonymousReplies {
		t.Fatalf("defaults are off: %+v", def)
	}
}

// TestCommentRepliesStayOneLevel: a reply to a reply joins its sibling
// instead of opening a third level the sheet cannot render.
func TestCommentRepliesStayOneLevel(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	a := createUser(t, pool, "a_"+uuid.NewString()[:8])
	b := createUser(t, pool, "b_"+uuid.NewString()[:8])

	story, _ := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})

	top, err := svc.AddComment(ctx, story.ID, a, nil, "primeiro", false)
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	reply, err := svc.AddComment(ctx, story.ID, b, &top.ID, "resposta", false)
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	if reply.ParentID == nil || *reply.ParentID != top.ID {
		t.Fatalf("reply not attached to the top comment: %+v", reply)
	}

	deep, err := svc.AddComment(ctx, story.ID, a, &reply.ID, "resposta da resposta", false)
	if err != nil {
		t.Fatalf("nested reply: %v", err)
	}
	if deep.ParentID == nil || *deep.ParentID != top.ID {
		t.Fatalf("a third level was created: parent=%v, want %d", deep.ParentID, top.ID)
	}
}

// TestCommentDeletion: the writer may delete their own, the story's author
// may delete any, and nobody else may do either.
func TestCommentDeletion(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	writer := createUser(t, pool, "writer_"+uuid.NewString()[:8])
	stranger := createUser(t, pool, "stranger_"+uuid.NewString()[:8])

	story, _ := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "x", Visibility: VisPublic})
	c1, _ := svc.AddComment(ctx, story.ID, writer, nil, "um", false)
	c2, _ := svc.AddComment(ctx, story.ID, writer, nil, "dois", false)

	if err := svc.DeleteComment(ctx, c1.ID, stranger); !errors.Is(err, ErrCommentNotFound) {
		t.Fatalf("stranger deleting: got %v, want ErrCommentNotFound", err)
	}
	if err := svc.DeleteComment(ctx, c1.ID, writer); err != nil {
		t.Fatalf("writer deleting own: %v", err)
	}
	if err := svc.DeleteComment(ctx, c2.ID, author); err != nil {
		t.Fatalf("story author deleting: %v", err)
	}

	left, _ := svc.Comments(ctx, story.ID, author)
	if len(left) != 0 {
		t.Fatalf("expected none left, got %d", len(left))
	}
}
