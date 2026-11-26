# Bot SDKs

The SDKs live in `sdk/`: `@zwosocial/bot` for TypeScript and `github.com/CreadorLanda/yo/sdk/go` for Go. Each one turns a bot into a few handlers and takes care of the parts that are easy to get wrong: encryption, delivery and retries.

## How a bot sees a conversation

A bot is a device like any other ([ADR 0002](../decisions/0002-bots-and-e2ee.md)). It has keys, the server only carries ciphertext, and the bot decrypts on its own machine.

| What happened | How it arrives | How the SDK opens it |
|---|---|---|
| A message in a direct chat with the bot | `message.created` | pairwise session |
| A command, mention or reply aimed at the bot (privacy mode) | `command.invoked` / `message.created` with `update_id` | an envelope sealed for the bot alone |
| A click on the bot's button, menu or form | `interaction.created` | the same, with `component_id` and `values` |
| Autocomplete for a command option | `command.autocomplete` | the same; the SDK answers within 3 s |
| Any group message, when the bot has full read | `message.created` | the group sender key the members gave the bot |

A reply in a direct chat is sealed pairwise. A reply in a group is sealed with the bot's own sender key, which the SDK hands to each member the first time in each key epoch. `GET /api/bot/v1/chats/:id` tells the SDK whether a chat is direct or a group; chats never change type, so the SDK asks once per chat.

## Keys and storage

When it first starts, the SDK creates an X25519 identity, a signed pre-key and 40 one-time keys, and uploads them with `PUT /keys`. It uploads another 40 when fewer than 10 are left.

Keys, sessions, group keys and the last handled event id are kept in one store. By default that is `.zwosocial-bot.json`, written atomically with mode 0600. The two SDKs use the same file format.

If the store is lost, the bot starts over with a new identity. It can still read new conversations, but not the sessions it had before. Keep the file out of version control and back it up as you would any other secret.

## Delivery

- **Gateway** (`/api/bot/v1/gateway`): the SDK identifies with its intents and `resume_from`, heartbeats, and reconnects with backoff from 1 s up to 30 s. A `4002` close (the intents were refused) is final, and the SDK does not reconnect.
- **Webhooks**: the SDK checks `X-ZwoSocial-Signature` (`sha256=` HMAC over `timestamp.body`) and rejects a timestamp more than 5 minutes off.
- With either delivery, events are handled in order and anything at or below the last handled id is skipped. A resume, or a webhook retried after a timeout, therefore runs nothing twice.

## Limits and errors

A `429` waits for `Retry-After` and tries again. A `5xx` or network error is retried with backoff of 0.5 s, 1 s, 2 s and 4 s. A `503` means bots are switched off (`BOTS_DISABLED`) and is not retried. A `403` from a suspended bot is returned to the caller.

## Testing

- `sdk/typescript`: `bun test` covers the crypto round trips, routing and webhook signatures.
- `sdk/go`: `go test ./...` covers the same. It also decrypts `testdata/interop.json`, which the TypeScript SDK writes with `bun test/make-interop-fixture.ts`, so the two SDKs cannot drift apart.
- `.github/workflows/sdk.yml` starts the API with Postgres and Redis and runs `sdk/typescript/test/e2e.ts` against each SDK's echo example. A person signs up, talks to the bot in a direct chat, clicks its button, and uses a command in a group where the bot is in privacy mode.

## Releasing

- **TypeScript:** bump `version` in `sdk/typescript/package.json` and push the tag `sdk-ts-vX.Y.Z`. CI publishes to npm, which needs the `NPM_TOKEN` secret.
- **Go:** push the tag `sdk/go/vX.Y.Z`. Go modules are fetched straight from the repository, so there is nothing to publish.
