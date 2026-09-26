# 🔐 Encriptação

> Mensagens focadas em segurança significa **o servidor não consegue ler mensagens, mesmo se comprometido.** Três camadas — em trânsito, ponta-a-ponta, em repouso — funcionam juntas para que isto se sustente na prática, não só nos slides.

---

## Em trânsito

- Apenas TLS 1.3. TLS 1.2 desativado.
- Pinning de certificado nos clientes móveis (rotação via canal de atualização assinado).
- HSTS + Strict-Transport-Security com preload nas origens web.
- Tráfego interno entre API e workers da ponte usa mTLS.

---

## Ponta-a-ponta (X25519 / TweetNaCl próprio)

> **Isto não é o Signal Protocol.** Uma versão anterior deste documento dizia
> que era, e que o projeto usava `libsignal`. Nunca foi verdade — essa
> biblioteca não aparece em manifesto nenhum, nem no cliente nem no servidor. O
> que se segue descreve o que o código faz.

A cifra acontece no dispositivo com [TweetNaCl](https://tweetnacl.js.org/)
(`mobile/data/crypto/`). O servidor guarda o texto cifrado resultante e não
tem as chaves E2EE do cliente. Existe uma camada separada e opcional no
servidor, com `MESSAGE_KEY`, descrita em [Em repouso](#em-repouso); não é uma
chave E2EE.

### Chaves

| Tipo               | Duração                  | Para quê                                     |
|--------------------|--------------------------|----------------------------------------------|
| Identity key       | Longa, por dispositivo   | Fixa a identidade do dispositivo             |
| Signed pre-key     | Enviada por dispositivo  | Permite abrir sessão contigo offline         |
| One-time pre-keys  | Em lote, uso único       | Consumidas ao abrir sessão                   |
| Chave de grupo     | Por grupo e época        | Distribuição em leque após troca emparelhada |

### Envelopes

Dois formatos, ambos `prefixo.cabeçalho.corpo` em base64url:

- `soc1.` — direto. Cabeçalho com `v`, `ik` (identidade do remetente), `n`
  (contador), mais campos de aperto de mão nas primeiras mensagens.
- `soc1g.` — grupo. Cabeçalho com `v`, `s` (UUID do remetente), `e` (época), `n`.

O servidor valida **apenas a forma** — nunca abre o corpo, nunca deriva chave,
nunca verifica MAC.

### O que esta construção não te dá

Dito com todas as letras, porque a versão anterior desta página prometia as três:

- **Não há Double Ratchet.** Há um contador monotónico a que o código chama
  "simple ratchet". Ordena mensagens e deteta repetições. Não troca chave a
  cada mensagem.
- **Não há sigilo futuro** digno do nome. Comprometer a chave de longa duração
  de um dispositivo expõe as mensagens passadas que esse dispositivo ainda
  consegue decifrar.
- **Não há segurança pós-compromisso.** Não existe mecanismo que cure uma
  sessão depois de uma fuga de chave.

### Sem auditoria

Não houve revisão independente. A construção foi escrita para este projeto. Se
precisas das propriedades que o Signal dá, usa o Signal — isto é um messenger
honesto, não um equivalente.

Melhorar isto é [trabalho em aberto](https://github.com/CreadorLanda/yo/issues),
não um estado assente.

## Em repouso

### No servidor

- **Ficheiros de dados Postgres:** a encriptação de disco no host ou no fornecedor não foi verificada. Não assumas que está activa.
- **Tokens push:** `push_devices.token` é guardado em texto simples. A coluna antiga `devices.push_token_enc` não é usada pelo código de notificações.
- **Tokens de sessão:** os tokens de acesso e de atualização são guardados como hashes SHA-256 em `sessions.token_hash` e `sessions.refresh_hash`; os tokens bearer originais não ficam guardados nessas colunas.
- **Conteúdo das mensagens:** quando existe um `MESSAGE_KEY` válido de 32 bytes, o servidor acrescenta encriptação AES-256-GCM ao conteúdo. A chave é lida do ambiente do servidor; não está guardada em KMS ou Vault. Sem uma chave válida, o repositório guarda o conteúdo como o recebe. Esta camada no servidor é separada da encriptação ponta-a-ponta no cliente e não protege os dados contra o comprometimento do servidor.
- **Ficheiros de média:** o servidor não cifra uploads com chaves individuais por ficheiro. Ficheiros cifrados no cliente antes do upload continuam a ser texto cifrado; os restantes são guardados como recebidos.
- **Backups:** este repositório não configura backups automáticos nem um processo de cifragem de backups. Não assumas que existem backups cifrados.

### No dispositivo

- A SQLite é embrulhada por **SQLCipher** (AES-256-CBC, por página).
- A chave DB é gerada uma vez no primeiro arranque (256 bits), depois embrulhada pela keychain do SO:
  - iOS: Keychain com `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
  - Android: Keystore (StrongBox onde disponível), wrap AES-GCM.
  - macOS / Windows / Linux: Keychain / DPAPI / libsecret.
- O arranque da app desbloqueia o item da keychain (com porta biométrica opcional) e abre a DB.
- Schema detalhado e ciclo de vida em [local-storage.md](../tech/local-storage.md).

---

## Autenticação & sessões

- Baseada em número de telefone, com códigos one-time entregues por SMS.
- Códigos de 6 dígitos, rate-limited por telefone e por IP, expiram em 5 minutos, uso único.
- Sucesso: JWT access token (curto, e.g. 15 min) + refresh token opaco (rotacionado a cada uso, family-tracked para detetar roubo).
- Tokens de sessão guardados como hash no servidor (`SHA-256`); só o portador tem o original.
- Logout invalida toda a família de refresh.

---

## Pontes

Não há nenhuma, e não vai haver. Uma ponte tem de decifrar para traduzir, o que
põe um servidor em posição de ler mensagens — a única coisa que este documento
diz que nunca acontece.

A ponte do WhatsApp rejeitada e o raciocínio completo estão em
[decisions/0001](../../decisions/0001-no-whatsapp-bridge.md).

---

## Rotação de chaves

| Material                   | Rotação                            |
|----------------------------|------------------------------------|
| Identity key (dispositivo) | Vida do dispositivo                |
| Signed pre-key             | A cada 7 dias                      |
| One-time pre-keys          | Consumidas continuamente; cliente repõe quando baixo |
| Session keys               | Não rodam por mensagem — ver acima |
| Refresh tokens             | A cada uso                         |
| `MESSAGE_KEY` (camada de mensagens no servidor) | Não há rotação automática documentada; a rotação precisa de um plano de migração |
| Certificados TLS           | 90 dias (ACME automatizado)        |

---

## O que *não* está protegido

Dizemos em voz alta para ninguém ser apanhado de surpresa:

- **Metadados.** O servidor vê quem fala com quem e quando. Mitigações estilo sealed-sender estão no seguimento.
- **Um dispositivo comprometido enquanto desbloqueado.** Quem tem o telefone desbloqueado pode ler tudo; SQLCipher não defende disso.
- **Dados em repouso no servidor.** Tokens push estão em texto simples. O `MESSAGE_KEY` do servidor é um segredo de ambiente, não uma chave gerida por KMS/Vault, e o servidor consegue ler dados protegidos apenas por ela. A encriptação de disco do host e os backups cifrados não foram verificados.
- **Média fora de uploads de chat cifrados.** O servidor guarda os bytes recebidos; só ficheiros cifrados no cliente antes do upload ficam ilegíveis para o servidor.

Não deduzas uma protecção que não esteja descrita aqui. Se o estado de um fluxo de dados não for claro, considera-o desprotegido até a implementação ser verificada.
