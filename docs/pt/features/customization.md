# 🎨 Customização

O que um tema pode mudar, e o que não pode. O conjunto de tokens e as razões
estão em [design-system.md](../../tech/design-system.md#21-themes-on-top-of-the-tokens);
esta página é a funcionalidade como alguém a usa.

Tudo o que está aqui fica guardado no dispositivo e sobrevive a fechar a app.
Nada vem ligado por omissão — quem não mexer em nada continua a ver
exactamente a app que tinha.

## Temas

Dezasseis packs incluídos, oito deles construídos à volta de algo que não é
só cor. Um pack define os tokens semânticos, o cromado da conversa (balões,
fundo, cabeçalho, caixa de escrita), ~55 opções de layout e os seus ícones.
Instala-se, aplica-se, ou faz-se um fork no editor e muda-se o que se quiser.

As personalizações pessoais ficam por cima do pack activo, por isso uma cor de
balão que escolheste sobrevive a experimentares outro tema.

## Tipo de letra

Seis escolhas: a letra do sistema, **Inter**, **Nunito**, **Lora**, **Space
Grotesk**, **JetBrains Mono**. As cinco famílias vêm com a app — quatro pesos
cada — por isso funcionam offline e não há nada a descarregar.

A letra do sistema é a omissão, e é a única que mantém os tamanhos dinâmicos
de acessibilidade do iOS: nomear uma fonte é precisamente o que lhes tira
essas métricas.

## Preto real (AMOLED)

Um interruptor, não uma paleta. Torna os fundos escuros em `#000000` por cima
do pack que estiver activo, mantendo as cores desse pack — num ecrã OLED um
pixel preto está desligado, portanto a poupança é real, e não há razão para
abdicares do tema que escolheste para a teres. Sem efeito no modo claro.

## Vidro fosco

O cabeçalho da conversa e a caixa de escrita desfocam o que está por trás. O
cabeçalho flutua sobre a conversa e as mensagens passam por baixo, que é o que
interessa — desfocar uma cor lisa dá a mesma cor lisa. A força é ajustável.

## Movimento do fundo

`Aurora`, `Deriva` ou `Pulsar`: movimento lento por trás da conversa, nas
cores do próprio tema, por cima de um fundo liso ou de uma foto. Desligado
quando o telemóvel está a reduzir movimento.

## Estilos de balões

`tail`, `rounded`, `pill` ou `square`, com raio, espaçamento, largura máxima,
sombra, bicos e o lado onde ficam as tuas mensagens, tudo ajustável em
separado.

## Ícones

Os ícones dentro da app seguem o tema: Ionicons outline, filled ou sharp,
MaterialIcons, ou uma imagem tua por slot. A lista de slots é fechada — as
superfícies que se olham o dia todo, não os ~50 sítios onde há um ícone.

## Ícone da app

Quatro alternativas para o ecrã principal, recoloridas a partir da mesma arte e
com o nome dos packs para que foram desenhadas. Não fazem parte de nenhum
pack: aplicar um tema não deve mexer no teu ecrã principal.

Precisa de um build nativo — o selector não aparece no Expo Go nem na web,
porque a troca ao nível do sistema de que depende não existe aí. No iOS o
sistema mostra uma confirmação que podes recusar.

## O que não existe

- **Temas dinâmicos** derivados do wallpaper (Material You). Não está feito.
- **Temas por conversa.** Um tema é para a app toda.
- **Um marketplace a sério.** Sete dos packs listados são entradas fictícias
  de terceiros com autores inventados; se o marketplace passa a ser real ou é
  removido continua em aberto — ver o issue #114.
