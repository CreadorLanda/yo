-- Ghost mode: read without leaving a trace.
--
-- One switch over every outbound signal, rather than a setting per signal.
-- Read receipts already have their own (0029) and keep it — this is the wider
-- one, and it also covers typing and the recording indicator, which were
-- added later and were never part of that setting.
--
-- Reciprocal, for the same reason read_receipts is: with it on you neither
-- send these signals nor see anyone else's. A setting that only hides your
-- own is a way to take without giving.
--
-- Not included: presence. There is no presence in this server to suppress —
-- `online` is hardcoded false in the app and no last-seen value is stored for
-- a user anywhere. Promising "no presence" here would be describing a switch
-- over something that does not exist.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ghost_mode BOOLEAN NOT NULL DEFAULT FALSE;
