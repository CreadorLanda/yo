package reactions

import (
	"errors"
	"testing"
)

func TestNormalizeSupportsCurrentSequencesAndSkinTones(t *testing.T) {
	for _, emoji := range []string{"🫩", "👍🏽", "🧑🏿‍🚀", "🏳️‍⚧️"} {
		got, err := Normalize(emoji)
		if err != nil || got != emoji {
			t.Fatalf("Normalize(%q) = %q, %v", emoji, got, err)
		}
	}
	if got, err := Normalize("❤"); err != nil || got != "❤️" {
		t.Fatalf("legacy heart = %q, %v; want ❤️", got, err)
	}
}

func TestToggleCapsEveryContentItemAtTwo(t *testing.T) {
	got, err := Toggle([]string{"🔥", "❤️"}, "🎉")
	if !errors.Is(err, ErrTooMany) || got != nil {
		t.Fatalf("third reaction = %v, %v; want ErrTooMany and no set", got, err)
	}

	got, err = Toggle([]string{"🔥", "❤️"}, "🔥")
	if err != nil || len(got) != 1 || got[0] != "❤️" {
		t.Fatalf("existing reaction removal = %v, %v; want [❤️]", got, err)
	}
}

func TestNormalizeSetRejectsThirdBeforeMutation(t *testing.T) {
	got, err := NormalizeSet([]string{"🔥", "❤️", "🎉"})
	if !errors.Is(err, ErrTooMany) || got != nil {
		t.Fatalf("three reactions = %v, %v; want ErrTooMany and no set", got, err)
	}
}
