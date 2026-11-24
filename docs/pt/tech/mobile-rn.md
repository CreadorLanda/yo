# 📱 Mobile React Native

## Stack
- Expo SDK 52
- TypeScript
- React Navigation 6
- Zustand/Jotai: Estado
- Tamagui: UI
- Reanimated 3: Animações

---

## Chamadas

Uma chamada sobrevive ao seu ecrã. `data/active-call.ts` é a chamada, `components/call/call-runner.tsx` corre-a a partir do layout raiz (sala, sessão de áudio, keep-alive e as regras de ninguém atender e de todos saírem), e o ecrã da chamada e a barra verde são duas vistas dela. O ecrã chega à sala através do `RoomContext.Provider`.

- Voltar ou sair da app mantém a chamada. A barra volta a ela e pode terminá-la.
- O Android mantém-na viva com o serviço em primeiro plano de `modules/call-keepalive`, que precisa da permissão do microfone, por isso esta é pedida antes de a chamada começar.
- A câmara desliga-se ao sair do ecrã da chamada ou da app, e volta ao regressar. Uma câmara desligada pela pessoa fica desligada.
- O WebRTC só é carregado quando há uma chamada. A web mantém o seu próprio ecrã de chamada.
- Uma chamada com três ou mais pessoas, e qualquer chamada de grupo, usa `components/call/group-stage.tsx`: um cartão por pessoa, um anel em quem está a falar e toque para focar. A divisão do palco está em `data/call-grid.ts`. As chamadas a dois mantêm o seu layout.
