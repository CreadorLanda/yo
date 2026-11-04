# 🚩 Denúncias e período sem contacto

> Como uma denúncia leva provas, quem é avisado e como funciona o período de 24 horas sem contacto.

---

## Resumo

| Passo | O que acontece |
|-------|----------------|
| Denúncia | Motivo, nota opcional e mensagens opcionais escolhidas por quem denuncia |
| Consentimento | As mensagens só seguem depois de um acordo explícito |
| Pausa | Começa um período de 24 horas sem contacto para as duas pessoas |
| Aviso | As duas pessoas recebem o mesmo aviso neutro |
| Revisão | Um moderador revê a denúncia e as provas |

---

## 1. Provas com consentimento

As conversas têm cifragem de ponta a ponta, por isso o servidor não as consegue ler. As provas
são então uma **cópia enviada por quem denuncia**: a app decifra no telemóvel as mensagens
escolhidas e envia-as com a denúncia.

- Nada é enviado sem escolher mensagens **e** ligar o acordo.
- Até 20 mensagens por denúncia, nenhuma escolhida em nome de quem denuncia.
- O servidor não consegue verificar uma cópia. Os moderadores tratam-na como o relato de quem denuncia.
- As provas ficam numa tabela própria, nunca são devolvidas por nenhum endpoint de utilizador e são apagadas ao fim de **90 dias**.
- Sem consentimento, o servidor rejeita uma denúncia com mensagens (`consent_required`).

## 2. O período sem contacto

Quando uma conversa direta é denunciada, o servidor regista um período de 24 horas para o par.

- Aplica-se **nos dois sentidos**: mensagens, novas conversas e chamadas são recusadas com `no_contact_period`.
- É **independente do bloqueio**. Desbloquear não o levanta.
- Uma **denúncia repetida nunca prolonga** um período ativo, para que denunciar não sirva para silenciar alguém.
- Termina sozinho. A app volta a ativar a caixa de texto no instante exato em que expira.
- Os grupos não têm período. Uma denúncia num grupo só chega à moderação.

## 3. O que cada pessoa vê

As duas pessoas veem o mesmo aviso, **Conversa em pausa**, com o tempo que falta. Não diz quem
denunciou nem porquê. Quem denuncia recebe ainda uma confirmação com o que foi enviado.

## API

| Endpoint | Função |
|----------|--------|
| `POST /api/chats/:id/report` | Enviar uma denúncia (motivo, nota, `block`, `consent`, `evidence`) |
| `GET /api/chats/:id/no-contact` | `{ "until": <RFC 3339 ou null> }` para quem pergunta |

Tempo real: `chat.no_contact` com `{ chat_id, until }` chega às duas pessoas quando um período começa.
