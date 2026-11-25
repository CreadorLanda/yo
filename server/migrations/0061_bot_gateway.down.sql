DROP TABLE IF EXISTS bot_deliveries;
DROP TABLE IF EXISTS bot_events;
ALTER TABLE bots
    DROP COLUMN IF EXISTS intents,
    DROP COLUMN IF EXISTS webhook_secret,
    DROP COLUMN IF EXISTS webhook_url;
