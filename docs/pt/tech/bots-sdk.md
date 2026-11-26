# SDKs de bots

O guia público para quem desenvolve bots é o site em `developers/` (Docusaurus, EN e PT); esta página é a visão de engenharia. Os SDKs estão em `sdk/`: `@zwosocial/bot` para TypeScript e `github.com/CreadorLanda/yo/sdk/go` para Go. Com eles, um bot reduz-se a alguns handlers. O SDK trata das partes fáceis de errar: a cifra, a entrega e as novas tentativas.

## Como um bot vê uma conversa

Um bot é um dispositivo como outro qualquer ([ADR 0002](../../decisions/0002-bots-and-e2ee.md)). Tem chaves próprias, o servidor só transporta texto cifrado e o bot decifra na sua própria máquina.

| O que aconteceu | Como chega | Como o SDK abre |
|---|---|---|
| Uma mensagem numa conversa directa com o bot | `message.created` | sessão par a par |
| Um comando, menção ou resposta dirigido ao bot (modo privado) | `command.invoked` / `message.created` com `update_id` | um envelope cifrado só para o bot |
| Um clique num botão, menu ou formulário do bot | `interaction.created` | igual, com `component_id` e `values` |
| Autocompletar uma opção de comando | `command.autocomplete` | igual; o SDK responde em menos de 3 s |
| Qualquer mensagem do grupo, se o bot tiver leitura total | `message.created` | a chave de grupo que os membros deram ao bot |

Numa conversa directa, a resposta vai cifrada par a par. Num grupo, vai cifrada com a chave de envio do próprio bot, que o SDK entrega a cada membro da primeira vez em cada época de chaves. O SDK pergunta ao `GET /api/bot/v1/chats/:id` se a conversa é directa ou de grupo. Como uma conversa nunca muda de tipo, pergunta só uma vez por conversa.

## Chaves e armazenamento

No primeiro arranque, o SDK cria uma identidade X25519, uma pre-key assinada e 40 chaves de uso único, e publica-as com `PUT /keys`. Quando restam menos de 10, publica mais 40.

Chaves, sessões, chaves de grupo e o id do último evento tratado ficam num só armazenamento. Por omissão é o ficheiro `.zwosocial-bot.json`, escrito de forma atómica e com modo 0600. Os dois SDKs usam o mesmo formato.

Se o ficheiro se perder, o bot recomeça com outra identidade. Continua a ler conversas novas, mas perde as sessões que tinha. Mantém-no fora do controlo de versões e faz cópia de segurança, como qualquer segredo.

## Entrega

- **Gateway** (`/api/bot/v1/gateway`): o SDK identifica-se com as intents e com `resume_from`, envia heartbeats e volta a ligar com espera crescente, de 1 s até 30 s. Um fecho `4002` (intents recusadas) é definitivo e o SDK não volta a ligar.
- **Webhooks**: o SDK verifica `X-ZwoSocial-Signature` (HMAC `sha256=` sobre `timestamp.corpo`) e recusa timestamps com mais de 5 minutos de diferença.
- Em ambos os casos, os eventos são tratados por ordem e tudo o que for igual ou anterior ao último id tratado é ignorado. Assim, uma retoma ou um webhook repetido nunca corre nada duas vezes.

## Limites e erros

Um `429` espera o `Retry-After` e tenta de novo. Um `5xx` ou um erro de rede tenta de novo com espera de 0,5 s, 1 s, 2 s e 4 s. Um `503` quer dizer que os bots estão desligados (`BOTS_DISABLED`) e não se repete. Um `403` de um bot suspenso é devolvido a quem chamou.

## Testes

- `sdk/typescript`: o `bun test` cobre as idas e voltas da cifra, o encaminhamento e as assinaturas de webhook.
- `sdk/go`: o `go test ./...` cobre o mesmo. Também decifra `testdata/interop.json`, que o SDK TypeScript escreve com `bun test/make-interop-fixture.ts`, para que os dois SDKs não divirjam.
- O `.github/workflows/sdk.yml` arranca a API com Postgres e Redis e corre `sdk/typescript/test/e2e.ts` com o exemplo de eco de cada SDK. Uma pessoa regista-se, fala com o bot numa conversa directa, clica no botão e usa um comando num grupo onde o bot está em modo privado.

## Publicar

- **TypeScript:** sobe a `version` em `sdk/typescript/package.json` e envia a tag `sdk-ts-vX.Y.Z`. O CI publica no npm, o que precisa do segredo `NPM_TOKEN`.
- **Go:** envia a tag `sdk/go/vX.Y.Z`. Os módulos Go são obtidos directamente do repositório, por isso não há nada a publicar.
