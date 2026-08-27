package stories

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// single builds the request an older, one-emoji-at-a-time client sends.
func single(emoji string) ReactRequest {
	return ReactRequest{Emoji: emoji}
}

// many builds the request the reaction bar sends.
func many(emojis ...string) ReactRequest {
	return ReactRequest{Reactions: &emojis}
}

func TestCanonicalReactionFolds(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		want  string
		valid bool
	}{
		{"canonical", "🔥", "🔥", true},
		{"missing variation selector", "❤", "❤️", true},
		{"with variation selector", "❤️", "❤️", true},
		{"multi-codepoint", "❤️‍🔥", "❤️‍🔥", true},
		{"skin tone folded to base", "👍🏽", "👍", true},
		{"darkest skin tone", "👏🏿", "👏", true},
		{"surrounding space", "  🎉  ", "🎉", true},
		{"extended set", "🥳", "🥳", true},
		{"emoji outside the set", "🤡", "", false},
		{"plain text", "not an emoji", "", false},
		{"empty", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := CanonicalReaction(tc.in)
			if ok != tc.valid {
				t.Fatalf("CanonicalReaction(%q) accepted = %v, want %v", tc.in, ok, tc.valid)
			}
			if ok && got != tc.want {
				t.Fatalf("CanonicalReaction(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestNormalizeReactionsKeepsOrderAndDropsDuplicates(t *testing.T) {
	got, err := normalizeReactions([]string{"🎉", "❤", "🎉", "👍🏽", "👍"})
	if err != nil {
		t.Fatalf("normalizeReactions: %v", err)
	}
	want := []string{"🎉", "❤️", "👍"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestNormalizeReactionsRefusesUnknown(t *testing.T) {
	// One bad entry fails the whole call rather than being dropped quietly:
	// silently storing four of the five emoji someone tapped is worse than
	// telling the client its set is wrong.
	if _, err := normalizeReactions([]string{"🔥", "🤡"}); !errors.Is(err, ErrInvalidEmoji) {
		t.Fatalf("got %v, want ErrInvalidEmoji", err)
	}
}

func TestRequestedReactions(t *testing.T) {
	empty := []string{}

	t.Run("array form", func(t *testing.T) {
		got, err := requestedReactions(many("🔥", "❤️", "🎉"))
		if err != nil || len(got) != 3 {
			t.Fatalf("got %v, %v; want three emoji", got, err)
		}
	})

	t.Run("array wins over single", func(t *testing.T) {
		got, err := requestedReactions(ReactRequest{Emoji: "😂", Reactions: &[]string{"🔥"}})
		if err != nil {
			t.Fatalf("requestedReactions: %v", err)
		}
		if len(got) != 1 || got[0] != "🔥" {
			t.Fatalf("got %v, want [🔥]", got)
		}
	})

	t.Run("single form", func(t *testing.T) {
		got, err := requestedReactions(single("🔥"))
		if err != nil {
			t.Fatalf("requestedReactions: %v", err)
		}
		if len(got) != 1 || got[0] != "🔥" {
			t.Fatalf("got %v, want [🔥]", got)
		}
	})

	t.Run("empty array clears", func(t *testing.T) {
		got, err := requestedReactions(ReactRequest{Reactions: &empty})
		if err != nil {
			t.Fatalf("requestedReactions: %v", err)
		}
		// Non-nil so the repository sends `{}` to Postgres rather than NULL,
		// which would match nothing and delete nothing.
		if got == nil || len(got) != 0 {
			t.Fatalf("got %#v, want a non-nil empty slice", got)
		}
	})

	t.Run("neither field is a malformed request, not a clear", func(t *testing.T) {
		if _, err := requestedReactions(ReactRequest{}); !errors.Is(err, ErrInvalidEmoji) {
			t.Fatalf("got %v, want ErrInvalidEmoji", err)
		}
	})
}

// TestReactionCatalogueIsDistinct guards the two lists against the copy-paste
// duplicate that is easy to add and invisible in the app: a repeated emoji
// draws the same chip twice.
func TestReactionCatalogueIsDistinct(t *testing.T) {
	seen := map[string]string{}
	for _, group := range []struct {
		name  string
		items []string
	}{
		{"standard", StandardReactions},
		{"extended", ExtendedReactions},
	} {
		for _, e := range group.items {
			key := reactionKey(e)
			if where, dup := seen[key]; dup {
				t.Errorf("%s emoji %q already listed in %s", group.name, e, where)
			}
			seen[key] = group.name
		}
	}
}

// TestReactionCountsAndReplacement is an integration test: it needs a
// database and self-skips without TEST_POSTGRES_URL (see make docker-up-local).
func TestReactionCountsAndReplacement(t *testing.T) {
	pool := testDB(t)
	ctx := context.Background()
	svc := NewService(NewRepository(pool), nil)

	author := createUser(t, pool, "author_"+uuid.NewString()[:8])
	alice := createUser(t, pool, "alice_"+uuid.NewString()[:8])
	bob := createUser(t, pool, "bob_"+uuid.NewString()[:8])

	story, err := svc.Create(ctx, author, CreateRequest{Kind: KindText, Caption: "olá"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if len(story.Reactions) != 0 || len(story.MyReactions) != 0 {
		t.Fatalf("a fresh story has reactions: %+v", story)
	}

	// One person, three emoji at once — the thing the old single-emoji key
	// could not hold.
	st, err := svc.React(ctx, story.ID, alice, many("🔥", "❤️", "🎉"))
	if err != nil {
		t.Fatalf("React (alice): %v", err)
	}
	if len(st.MyReactions) != 3 {
		t.Fatalf("alice's own reactions: got %v, want three", st.MyReactions)
	}
	if total := countOf(st.Reactions); total != 3 {
		t.Fatalf("counts total %d, want 3: %+v", total, st.Reactions)
	}

	// A second person overlapping on one emoji: 🔥 is now two, the rest one.
	st, err = svc.React(ctx, story.ID, bob, many("🔥", "😂"))
	if err != nil {
		t.Fatalf("React (bob): %v", err)
	}
	if got := reactionCount(st.Reactions, "🔥"); got != 2 {
		t.Fatalf("🔥 count = %d, want 2: %+v", got, st.Reactions)
	}
	// Busiest first, so the shared one leads.
	if len(st.Reactions) == 0 || st.Reactions[0].Emoji != "🔥" {
		t.Fatalf("counts not ordered busiest first: %+v", st.Reactions)
	}
	// Counts are everyone's; my_reactions is only mine.
	if len(st.MyReactions) != 2 {
		t.Fatalf("bob's own reactions: got %v, want two", st.MyReactions)
	}

	// Reacting again replaces the caller's set and leaves everyone else's
	// alone: alice drops to ❤️, bob's 🔥 survives.
	st, err = svc.React(ctx, story.ID, alice, many("❤️"))
	if err != nil {
		t.Fatalf("React (alice, replacing): %v", err)
	}
	if got := reactionCount(st.Reactions, "🔥"); got != 1 {
		t.Fatalf("🔥 count after alice replaced = %d, want 1 (bob's): %+v", got, st.Reactions)
	}
	if got := reactionCount(st.Reactions, "🎉"); got != 0 {
		t.Fatalf("🎉 survived alice replacing her set: %+v", st.Reactions)
	}

	// An empty array takes them all back, and only the caller's.
	st, err = svc.React(ctx, story.ID, alice, ReactRequest{Reactions: &[]string{}})
	if err != nil {
		t.Fatalf("React (alice, clearing): %v", err)
	}
	if len(st.MyReactions) != 0 {
		t.Fatalf("clearing left reactions behind: %v", st.MyReactions)
	}
	if got := countOf(st.Reactions); got != 2 {
		t.Fatalf("clearing alice's set changed bob's: total %d, want 2 (%+v)", got, st.Reactions)
	}

	// An emoji outside the catalogue is refused, and changes nothing.
	if _, err := svc.React(ctx, story.ID, bob, many("🔥", "🤡")); !errors.Is(err, ErrInvalidEmoji) {
		t.Fatalf("react with an unlisted emoji: got %v, want ErrInvalidEmoji", err)
	}
	st, err = svc.Get(ctx, story.ID, bob)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(st.MyReactions) != 2 {
		t.Fatalf("a refused react changed bob's set: %v", st.MyReactions)
	}
}

func countOf(list []Reaction) int {
	total := 0
	for _, x := range list {
		total += x.Count
	}
	return total
}

func reactionCount(list []Reaction, emoji string) int {
	for _, x := range list {
		if x.Emoji == emoji {
			return x.Count
		}
	}
	return 0
}
