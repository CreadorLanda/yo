# 📍 Localização

> Partilhar onde estás numa conversa: uma vez, ou em direto durante o tempo que escolheres.

---

## O que se pode fazer

| | |
|---|---|
| **Enviar a localização atual** | Uma posição, como está agora. |
| **Partilhar em direto** | A posição vai-se atualizando durante 15 minutos, 1 hora, ou até ser desligada. |
| **Parar** | Quem partilha pode parar na própria bolha, a qualquer momento. A última posição fica, marcada como terminada. |
| **Abrir** | Tocar numa bolha abre a aplicação de mapas do telemóvel. |

Antes de enviar, a folha mostra um mapa da posição, por isso a pré-visualização é o que os outros recebem.

## Como viaja

Uma localização é uma mensagem do tipo `location`. O corpo é JSON, cifrado de ponta a ponta como qualquer outra mensagem, por isso **o servidor nunca vê uma coordenada em claro**.

```json
{ "kind": "location", "lat": -8.83833, "lng": 13.23444, "accuracy": 12,
  "live": true, "expiresAt": "2026-11-05T15:00:00Z", "updatedAt": "2026-11-05T14:00:00Z" }
```

Uma partilha em direto é **uma só mensagem que se edita**, e não uma sequência de mensagens novas: cada atualização é uma edição cifrada da mesma mensagem, por isso a conversa não se enche de posições e o servidor guarda só o último corpo cifrado.

- O fim está dentro da mensagem (`expiresAt`). Um telemóvel que morre a meio da partilha continua a ser lido como terminado por quem olha.
- Se não chegar nenhuma atualização durante 3 minutos, a bolha diz quando chegou a última, para uma partilha calada não ser confundida com uma viva.
- As atualizações saem quando quem partilha andou pelo menos 10 m e passaram 8 s, e pelo menos uma por minuto quando está parado.
- A definição de privacidade da conversa que bloqueia tipos de mensagem aplica-se: uma conversa que não permite localizações recusa as duas formas.

## Android e iOS

As atualizações em direto correm com `expo-location` e `expo-task-manager`. No Android é um serviço em primeiro plano, que é também a notificação que diz que a pessoa está a partilhar. Arranca com a app no ecrã, por isso **não se pede a permissão de localização em segundo plano**. Uma partilha que estava a correr quando a app fechou retoma no arranque seguinte, se a permissão ainda existir e o tempo não tiver acabado. Terminar a sessão pára todas as partilhas.

## O mapa e o que revela

A pré-visualização é feita com mosaicos do OpenStreetMap, pedidos pelo telemóvel. O servidor dos mosaicos fica a saber **que zona foi mostrada** (cerca de 600 m de largo), não quem olha nem em que conversa, e o servidor da app não fica a saber nada. É o único terceiro desta funcionalidade. Não se usa SDK de mapas nem chave de API, e não se procura nome de rua: a linha de morada são as coordenadas, porque a geocodificação inversa enviaria a posição exata a um serviço de geocodificação.

O servidor público de mosaicos é para uso leve. Em produção, aloja os mosaicos ou usa um fornecedor, e muda o `host` em `mapTiles` (`data/location-share.ts`).

## Onde está o código

| | |
|---|---|
| `data/location-share.ts` | Puro: distância, quando publicar, estado do direto, contas dos mosaicos, ligações de mapas |
| `data/live-location.ts` | A partilha a correr: permissão, envio, edição, paragem, retoma |
| `components/chat/location-map.tsx` | O mapa com o marcador |
| `components/chat/attachment-bubbles.tsx` | A bolha (`LocationCard`) |
| `components/chat/attachment-composer.tsx` | A folha de partilha |
