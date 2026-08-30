# 🔒 Privacidade

> Documentação completa dos recursos de privacidade do Yo.

---

## 1. Modo Ghost

Um interruptor sobre todos os sinais de saída, em **Definições → Privacidade →
Modo ghost**.

| Sinal | Com o modo ghost ligado |
|---|---|
| Confirmações de leitura | Não são enviadas. As tuas leituras ficam como *entregue* |
| Indicador de escrita | Não é enviado |
| Indicador de gravação | Não é enviado |

**Recíproco**, nos mesmos termos das confirmações de leitura (migration 0029):
com ele ligado não envias estes sinais nem vês os dos outros. Um interruptor
que só esconde o teu é uma forma de tirar sem dar.

É o interruptor *mais largo*. As confirmações de leitura mantêm a sua própria
definição, mas o modo ghost sobrepõe-se — ligá-lo cala as confirmações mesmo a
quem nunca mexeu nessa definição, e cobre ainda a escrita e a gravação, que
foram acrescentadas depois e nunca fizeram parte dela.

### Aplicado no servidor

Não é pedir ao cliente que esconda. A tua escrita é recusada em
`POST /chats/:id/typing`; quem está em ghost fica fora da lista de destinatários
da escrita dos outros; uma confirmação de `read` é baixada para `delivered`
antes de ser guardada. Um cliente modificado não consegue voltar a entrar, que
é a única forma de isto significar alguma coisa.

### O que não cobre

**Presença e visto por último.** Não por estarem excluídos — por não existirem.
Não há nenhum valor de "visto por último" guardado para um utilizador em lado
nenhum deste servidor, nenhum endpoint o serve, e `online` está fixo a `false`
na app. Não há ali sinal nenhum para calar, e dizer o contrário seria o género
de promessa que esta página costumava fazer.

Construir a presença, e depois congelá-la, é o
[#151](https://github.com/CreadorLanda/yo/issues/151).



## 2. Bloqueio de App

Um código para abrir o Yo de todo, por cima do bloqueio por conversa da §3.

**Há um código, não dois.** O bloqueio da app verifica o mesmo segredo que o
bloqueio de conversa guarda — `data/chat-lock.ts` — porque dois códigos para
decorar é como se acaba a escolher `0000` para ambos.

| Definição | Valores | Omissão |
|---|---|---|
| Bloquear a app | ligado / desligado | desligado |
| Bloquear ao fim de | imediatamente, 1, 5, 15 ou 60 minutos em segundo plano | 1 minuto |
| Face ID / impressão digital | ligado / desligado, só onde o aparelho tem uma registada | desligado |

**Desligar** o bloqueio pede o código, tal como ligar. Sem isso, quem tiver o
telemóvel desbloqueado na mão contorna-o abrindo as definições e mexendo no
interruptor.

### O que protege, e o que não protege

O código controla o *chegar* à app. O conteúdo das mensagens já está cifrado em
repouso pelo SQLCipher; isto é sobre quem pega no teu telemóvel desbloqueado,
que é a ameaça de que um bloqueio realmente trata.

- A tolerância conta-se **em segundo plano**, não desde que a app abriu.
- Um relógio do aparelho que ande para trás tranca em vez de abrir — um
  bloqueio que se contorna a mexer na hora não é um bloqueio.
- Ao terminar sessão o bloqueio volta a armar-se. O código é do aparelho, não
  da conta.
- **Não há recuperação.** O código é guardado como hash com sal e iterações;
  esquecê-lo significa reinstalar.

### Capturas de ecrã e o alternador de apps

São dois buracos diferentes, e não têm uma solução comum:

- **Android** — o `expo-screen-capture` põe `FLAG_SECURE`, que bloqueia
  capturas e gravação de ecrã e apaga a miniatura no alternador.
- **iOS** — o sistema não deixa deliberadamente uma app bloquear uma captura,
  por isso essa metade não existe. O instantâneo do alternador é tratado
  cobrindo o ecrã no estado `inactive`, por onde o iOS passa *antes* de tirar
  a fotografia.

Ambos só se aplicam com o bloqueio da app ligado.


## 3. Bloqueio de Chat

### Bloquear um Chat

1. Abra a conversa
2. Toque no nome da conversa
3. Toque no ícone de lock 🔒
4. Confirme

---

## 4. Anti-Delete de Mensagens

### O Que Faz

Quando ativado, mensagens são preservadas mesmo quando o remetente tenta excluir.

---

## 5. Controle de Visto pela Última Vez

| Opção | Quem Pode Ver |
|--------|------------|
| **Todos** | Todos os usuários Yo |
| **Meus contatos** | Apenas contatos salvos |
| **Ninguém** | Completamente oculto |
| **Personalizado** | Selecione contatos específicos |

---

## 6. Autenticação Biométrica

Através do `expo-local-authentication`, por cima do código — nunca em vez dele.

| Plataforma | O que o sistema oferece |
|----------|---------|
| **iOS** | Face ID, Touch ID |
| **Android** | O que o `BiometricPrompt` expuser: digital, desbloqueio facial, íris |

A app só recebe um sim ou não. Nenhum dado facial ou de impressão digital chega
a este processo, e o Yo não guarda nenhum — o template vive no Secure Enclave
ou no TEE do Android e nunca sai de lá. **É exactamente por isso que este
trabalho é do sistema operativo e não nosso:** uma verificação facial feita por
nós com a câmara frontal veria uma imagem RGB plana, seria enganada por uma
fotografia impressa, e obrigar-nos-ia a guardar dados biométricos que não temos
nada que ter.

O código do aparelho é deliberadamente **não** aceite como alternativa
(`disableDeviceFallback`). O PIN do telemóvel não é o código desta app, e
aceitá-lo significaria que desbloquear o telemóvel desbloqueia o Yo. A saída
para uma digital falhada é o código da própria app.

O interruptor só aparece onde o aparelho tem mesmo uma biometria registada;
caso contrário a linha di-lo, em vez de mostrar um botão que não faz nada.


## 7. Criptografia E2E (，端到端加密 )

### Como Funciona

```
Alice envia: "Olá Bob!"
         ↓
Cliente criptografa com chave pública do Bob
         ↓
Servidor recebe: [blob criptografado]
         ↓
Bob recebe: "Olá Bob!" (descriptografado com chave privada)
```

---

## 8. Painel de Privacidade

### Ver Sua Privacidade

1. Configurações → Privacidade → Painel de Privacidade
2. Veja:
   - Dispositivos conectados
   - Dados compartilhados
   - Histórico de login
   - Sessões ativas

---

## 9. Exportar Dados

### Exportar Seus Dados

1. Configurações → Privacidade → Baixar meus dados
2. Escolha o formato:
   - JSON (estruturado)
   - HTML (legível)
   - PDF (imprimível)

---

## 10. Excluir Conta

### Excluir Conta

1. Configurações → Privacidade → Excluir Conta
2. Leia o aviso
3. Confirme com senha
4. Período de 30 dias
5. Todos os dados excluídos permanentemente
