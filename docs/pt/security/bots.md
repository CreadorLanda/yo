# Bots: abuso, limites e dados

Os bots não podem ser a maneira mais fácil de encher um grupo de spam ou de expor o que as pessoas escrevem. É assim que a plataforma os mantém honestos (#343). Como os bots encaixam na cifra de ponta a ponta está no [ADR 0002](../../decisions/0002-bots-and-e2ee.md).

## Limites

- **600 pedidos por minuto** por bot, em toda a API.
- **30 escritas por minuto** por bot em cada conversa (mensagens, edições, reações, respostas efémeras).
- Acima do limite: `429 rate_limited` com `retry_after` e o cabeçalho `Retry-After`. Os limites vivem no Redis e valem entre instâncias; se o Redis não responder, os pedidos passam em vez de parar todos os bots.

## Suspensão automática

O servidor não lê o que um bot envia, por isso julga o comportamento e não o conteúdo. Um bot que excede o limite de escrita por conversa **5 vezes em 10 minutos** é suspenso:

- o token deixa de funcionar (`403 bot_suspended`) e não pode ser adicionado a conversas;
- cada grupo onde está regista `bot.suspended` na actividade dos bots;
- o dono é avisado em direto (`bot.suspended`) e vê-o em Os meus bots.

O dono pode levantar uma suspensão automática (`POST /bots/:id/reactivate`) depois de corrigir a causa. As suspensões feitas pelos operadores (qualquer outro motivo) não são do dono para levantar.

## Interruptor geral

`BOTS_DISABLED=true` pára todos os bots de uma vez: a Bot API responde `503 bots_disabled` e nenhum bot pode ser adicionado. As conversas das pessoas continuam a funcionar.

## Actividade dos bots no grupo

Os admins vêem o que aconteceu com os bots do grupo (`GET /chats/:id/bots/audit`, Informação do grupo → Bots → Actividade dos bots): bots adicionados e removidos, leitura total dada ou retirada, outras mudanças de permissões, suspensões e comandos usados por admins. Guarda quem e quando, nunca o que alguém escreveu, durante **um ano**.

## Os dados das pessoas

- Quem partilha uma conversa com um bot pode pedir-lhe que apague o que guarda sobre si (`POST /bots/:id/forget-me`, ou Informação do grupo → Bots → o bot). O bot recebe `user.data_deletion` com `reason: "requested"`.
- Apagar uma conta envia `user.data_deletion` com `reason: "account_deleted"` a todos os bots com quem a pessoa partilhava conversas, antes de a conta desaparecer.

## Regras para quem desenvolve bots

São condições para ter um bot no ZwoSocial, verificadas quando um bot pede verificação:

1. **Cumprir `user.data_deletion` em 30 dias**: apagar as mensagens, identificadores e tudo o que derive deles, incluindo cópias de segurança quando forem renovadas.
2. **Guardar só o que o bot precisa** para fazer o que a descrição diz, e dizer na descrição o que guarda.
3. **Não guardar conteúdo de mensagens mais de 90 dias**, salvo se a pessoa pediu ao bot que o guardasse (uma nota, um lembrete para o próximo ano).
4. **Nunca vender nem partilhar** o que as pessoas enviam a um bot, nem usá-lo para treinar modelos sem consentimento explícito.
5. **Pedir leitura total só quando o bot não funciona sem ela**; o grupo é avisado quando é dada.
6. **Proteger o token e o segredo do webhook** como palavras-passe e rodá-los se forem expostos.

Um bot que não cumpra estas regras é suspenso pelos operadores.
