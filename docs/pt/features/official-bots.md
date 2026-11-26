# Bots oficiais

O ZwoSocial corre alguns bots próprios. São bots normais sobre o SDK público, com chaves próprias e em modo privado, a menos que um grupo lhes dê mais. Por isso não recebem nada que um bot de terceiros não receberia. O código e a operação estão em `official-bots/README.md`.

## Lembretes e agendamentos (#332)

- `/remind` lembra-te a ti, a alguém da conversa ou à conversa inteira, uma vez ou a repetir. O "quando" escreve-se em português ou inglês, por exemplo "amanhã às 9", "in 10 minutes", "todas as segundas às 10:00" ou "dias úteis às 8h30", ou escolhe-se na app.
- `/schedule` publica uma mensagem mais tarde, uma vez ou a repetir.
- `/reminders` mostra em privado o que está agendado, com um menu para cancelar.
- `/timezone` e `/quiet` definem o fuso horário e as horas de silêncio de cada pessoa.

O comportamento que importa:

- **Modo privado.** Só vê os seus comandos e botões.
- **Reinícios.** Os trabalhos sobrevivem a reinícios.
- **Execuções perdidas.** Um lembrete único perdido é entregue na mesma, marcado como atrasado. Uma execução recorrente perdida é saltada e nunca recuperada.
- **Horas de silêncio.** Um lembrete para uma pessoa espera que as horas de silêncio dela acabem. Uma mensagem para a conversa inteira não espera.
- **Fusos horários.** As horas seguem o fuso de cada pessoa, e as mudanças da hora de verão mantêm a hora local.
