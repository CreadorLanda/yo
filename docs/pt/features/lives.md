# Lives

Uma Live é uma ou mais pessoas a transmitir vídeo para um público que assiste, comenta e envia corações. Não é uma chamada: os espectadores não podem transmitir a menos que um anfitrião os chame ao palco, e o SFU aplica isso no token de cada um.

As Lives **não são cifradas de ponta a ponta**. Um público não tem uma sessão partilhada de onde derivar uma chave, por isso o vídeo é cifrado até ao SFU e o SFU consegue lê-lo. O ecrã da Live diz isto.

## Onde começa uma Live

| Começa em | Anfitriões | Moderadores | Público por omissão |
|---|---|---|---|
| Stories | a pessoa | a pessoa e quem ela nomear | os seus contactos |
| Um chat a dois (**Live conjunta**) | as duas pessoas | as duas e quem nomearem | as duas |
| Um grupo | a pessoa | administradores e moderadores do grupo e nomeados | o grupo |
| Um canal | a pessoa | dono e administradores do canal e nomeados | os seguidores (qualquer pessoa, se for público) |

Numa **Live conjunta** a outra pessoa é convidada como numa chamada. Se aceitar, entra como anfitriã. Se recusar, é "agora não": mantém o lugar e pode entrar mais tarde com todos os direitos de anfitriã. Qualquer uma das duas pode terminar a Live.

## Escolher o público

Quem inicia escolhe quem pode assistir:

- **local**: os membros do chat, grupo ou canal (não existe a partir dos Stories).
- **contactos**: quem tem uma conversa a dois aceite com algum dos anfitriões.
- **selecionados**: só as pessoas escolhidas, e quem um moderador convidar depois.
- **pública**: qualquer pessoa com o link. É anunciada aos contactos dos anfitriões.

## Ferramentas

- **Comentários** ficam guardados, chegam em tempo real pelo websocket, e quem entra tarde vê os últimos 50. Máximo de 300 caracteres. O autor e os moderadores podem apagá-los. Os moderadores podem desligar os comentários e continuar a escrever, para explicar porquê.
- **Corações** animam pelo canal de dados do LiveKit; o total vai para a API em lotes de no máximo 50.
- **Palco**: um espectador pode pedir para falar. Se um moderador chamar quem pediu, entra logo; se chamar outra pessoa, ela recebe um convite que aceita ou recusa. O direito de transmitir é dado e tirado no SFU na hora, não só na próxima ligação.
- **Moderadores** podem banir, desbanir, convidar pessoas para assistir, gerir o palco e apagar comentários. Só os anfitriões nomeiam moderadores e só eles podem banir um moderador. Os anfitriões não podem ser banidos.
- **Banir** tira a pessoa da sala na hora e recusa-a se tentar voltar. Os comentários dela deixam de ser aceites.
- **Estatísticas** (anfitriões e moderadores, durante e depois): espectadores agora, pico, espectadores únicos, corações, comentários, duração.

## API e eventos

As rotas e os eventos de websocket estão em [`docs/features/lives.md`](../../features/lives.md#api).
