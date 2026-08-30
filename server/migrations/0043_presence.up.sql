-- Presence and last seen.
--
-- `users.last_seen_visibility` has existed since 0029 and governed nothing:
-- no last-seen value was ever stored for a user. The column named
-- `last_seen_at` lives on `devices` and picks which device answers in key
-- routing — a different thing entirely. Meanwhile `online` was hardcoded
-- `false` in the app, so the dot never lit.
--
-- Online is not stored: the realtime hub already knows who holds a socket
-- (`Hub.Online`). What is missing is the *last* time they did, which is what
-- this column is, stamped when a user's final connection closes.
--
-- NULL means never seen, which a fresh account genuinely is. It is not the
-- same as hidden, and the API distinguishes them.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Freeze: you stay visible, pinned at the moment you switched it on.
--
-- Enforced at the write rather than the read — `TouchLastSeen` declines to
-- update a frozen row — so the stored value simply stops moving. That is
-- literally "frozen at a chosen moment", and it means no read path can
-- forget to apply it.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen_frozen BOOLEAN NOT NULL DEFAULT FALSE;

-- Reciprocity is the default here, as it is for read receipts (0029) and
-- ghost mode (0042): freeze yours and you stop seeing everyone else's.
--
-- `is_premium` buys the exception — freezing yours while still seeing
-- theirs. Deliberately NOT patchable through PATCH /users/me: an entitlement
-- the client can grant itself is not an entitlement. Nothing sets it yet;
-- there is no billing in this app, and this column is where it will land
-- when there is (#132).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;
