package media

import "testing"

func TestMediaPathStaysInsideRoot(t *testing.T) {
	root := "/srv/yo/media"
	cases := []struct {
		name string
		path string
		ok   bool
	}{
		{name: "owner object", path: "user/object.jpg", ok: true},
		{name: "parent escape", path: "../secrets.txt", ok: false},
		{name: "sibling prefix", path: "../media2/secrets.txt", ok: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, ok := mediaPath(root, tc.path)
			if ok != tc.ok {
				t.Fatalf("mediaPath(%q) ok=%v, want %v", tc.path, ok, tc.ok)
			}
		})
	}
}
