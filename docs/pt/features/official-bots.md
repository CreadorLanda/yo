# Bots oficiais

O ZwoSocial corre alguns bots próprios. São bots normais sobre o SDK público, com chaves próprias e em modo privado, a menos que um grupo lhes dê mais. Por isso não recebem nada que um bot de terceiros não receberia. O código e a operação estão em `official-bots/README.md`.

## Moderação (#333)

- **Boas-vindas e regras.** Dá as boas-vindas aos novos membros e pode mantê-los silenciados até aceitarem as regras.
- **Comandos de admin.** `/warn`, `/mute`, `/kick` e `/ban`, com avisos que sobem de um aviso para silêncios e depois remoção.
- **Filtros de conteúdo.** Com leitura total, filtra links, palavras proibidas, flood, mensagens repetidas e modo lento.

Só faz o que os admins do grupo permitem, e cada permissão é anunciada:

- **"Deixar moderar membros"** deixa-o silenciar, remover, banir e apagar mensagens. Nunca age sobre admins nem moderadores, e é o servidor que o garante.
- **"Deixar ler todas as mensagens"** é precisa para os filtros de conteúdo. Sem ela os filtros nunca correm, e o `/mod` di-lo.

Cada acção fica como aviso no grupo e na actividade de bots do grupo, e pode também ir para um registo de moderação noutra conversa. O conteúdo das mensagens nunca é guardado.

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
