---
description: 'Dá a um assistente de programação o llms-full.txt e um prompt pronto, e verifica o bot com o teste de ponta a ponta.'
title: Criar com um LLM
sidebar_position: 5
---

# Criar um bot com um LLM

Este site publica-se também para modelos de linguagem, seguindo a convenção [llms.txt](https://llmstxt.org):

| Ficheiro | O que é |
|---|---|
| [`llms.txt`](pathname:///llms.txt) | o que é a plataforma, as regras que importam, e uma ligação para cada página em Markdown |
| [`llms-full.txt`](pathname:///llms-full.txt) | todas as páginas num só ficheiro, incluindo a referência da API |
| [`sdk/BOTS.md`](https://github.com/CreadorLanda/yo/blob/dev/sdk/BOTS.md) | uma receita para agentes de programação: passos, restrições, modelos e erros comuns |

Dá ao assistente o `llms-full.txt`, ou o `BOTS.md` se ele trabalhar dentro do repositório, e depois pede.

## Prompts para copiar

**Bot de lembretes**

```text
Usando o SDK de bots do ZwoSocial para TypeScript (@zwosocial/bot) e a documentação em llms-full.txt,
escreve um bot de lembretes. Comando /remind com uma opção datetime "when" e uma opção string "what".
À hora marcada, publica "⏰ Lembrete: <what>" na mesma conversa. Guarda os lembretes em bot.store para
sobreviverem a um reinício, junta um botão Cancelar, e usa respostas privadas para os erros. Lê
BOT_TOKEN e API_URL do ambiente.
```

**Bot de sondagens**

```text
Com @zwosocial/bot, escreve um bot de sondagens: /poll question:<texto> options:"a, b, c" publica um
cartão com um botão por opção. Cada pessoa tem um voto e pode mudá-lo; edita a mensagem da sondagem
para mostrar a contagem depois de cada voto. Só quem perguntou a pode fechar.
```

**Notificações de outro serviço**

```text
Com o SDK de Go github.com/CreadorLanda/yo/sdk/go, escreve um bot que recebe um webhook assinado de
<serviço> em /hook, verifica a assinatura, e publica um cartão com um botão de link em todas as
conversas que fizeram /subscribe. Junta /unsubscribe. Nunca registes os segredos em logs.
```

## Verificar o que escreveu

O teste de ponta a ponta que o CI corre nos exemplos dos SDKs também aceita o teu bot. Uma pessoa regista-se, fala com o bot, clica num botão e usa um comando num grupo:

```sh
cd sdk/typescript
E2E_API_URL=http://127.0.0.1:8080 bun test/e2e.ts ts caminho/para/bot.ts
```

O teste espera o comportamento de eco dos modelos do `BOTS.md`: `You said: …` com um botão `again`, e `/ping` respondido com `pong 🏓`. Usa-o para confirmar que o código gerado acerta na cifra, no encaminhamento e nas respostas, antes de juntares a tua lógica.

## O que vigiar no código gerado

- O token, o segredo do webhook ou o conteúdo das mensagens escritos em logs.
- Chamadas HTTP directas para enviar mensagens em vez do SDK, que a API recusa.
- Código que conta receber todas as mensagens do grupo quando o bot está em modo privado.
- O armazenamento guardado numa pasta temporária, o que faz o bot perder as chaves a cada reinício.
