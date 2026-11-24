-- Profile posts and reels.
--
-- Stories expire; these do not. A post is one to ten photos or videos shown
-- as a carousel, a reel is a single short video. Both hang off the author's
-- profile grid, which is why they share a table: the grid reads them together
-- and only the viewer cares which is which.

CREATE TABLE IF NOT EXISTS posts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('post', 'reel')),
    caption     TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 2200),
    -- No 'close' here. Stories accept it and then show it to nobody, because
    -- there is no close-friends list yet; a permanent post nobody can see is
    -- not worth offering.
    visibility  TEXT NOT NULL DEFAULT 'contacts'
                    CHECK (visibility IN ('public', 'contacts')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The profile grid: one author, newest first.
CREATE INDEX IF NOT EXISTS idx_posts_author_created
    ON posts (author_id, created_at DESC, id DESC);

-- The slides of a post, in the order the author arranged them.
--
-- By media id rather than by URL: the stories table stores a URL and the
-- media module has to parse it back out to decide who may read the bytes.
CREATE TABLE IF NOT EXISTS post_media (
    post_id   UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    position  SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 9),
    media_id  UUID NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, position)
);

-- The media module asks "which posts show this blob" on every fetch.
CREATE INDEX IF NOT EXISTS idx_post_media_media ON post_media (media_id);

COMMENT ON TABLE posts IS 'Permanent profile posts (carousel) and reels';
