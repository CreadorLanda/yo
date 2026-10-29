-- Channel games are an append-only event stream. The caption remains human
-- readable, while the validated payload is replayable after reloads and for
-- late joiners.
ALTER TABLE channel_posts ADD COLUMN IF NOT EXISTS game_payload JSONB;
