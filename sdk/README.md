# ZwoSocial bot SDKs

Write a ZwoSocial bot in about 20 lines. The SDK handles the end-to-end encryption for you.

| | Package | Docs |
|---|---|---|
| TypeScript (Bun, Node 22+) | `@zwosocial/bot` | [typescript/](typescript/README.md) |
| Go 1.26+ | `github.com/CreadorLanda/yo/sdk/go` | [go/](go/README.md) |

Both SDKs speak the app's protocol byte for byte and share the same store format, so a bot can move from one SDK to the other.

The protocol, events and limits are described in [docs/tech/bots-sdk.md](../docs/tech/bots-sdk.md).
