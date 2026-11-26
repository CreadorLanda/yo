import { expect, test } from 'bun:test';
import { appendLinked, linkReplies } from '../data/reply-link';
import type { Message } from '../data/mock';

const msg = (over: Partial<Message>): Message =>
  ({ id: 'x', text: '', fromMe: false, timestamp: '10:00', ...over }) as Message;

/**
 * The server returns only `reply_to_id` — it cannot return the quoted text,
 * because the text is encrypted and it never sees it. The quote has to be
 * rebuilt on the device, or a reply loses it the moment the optimistic bubble
 * is replaced by the confirmed one.
 */
test('constroi a citacao a partir do id', () => {
  const out = linkReplies([
    msg({ id: '10', text: 'a que horas?', senderName: 'Ana' }),
    msg({ id: '11', text: 'às oito', replyToId: 10, fromMe: true }),
  ]);
  expect(out[1].replyTo).toBeDefined();
  expect(out[1].replyTo!.text).toBe('a que horas?');
  expect(out[1].replyTo!.senderName).toBe('Ana');
  expect(out[1].replyTo!.fromMe).toBe(false);
});

test('nao toca numa citacao ja construida', () => {
  const existing = { id: '10', text: 'original', fromMe: false };
  const out = linkReplies([
    msg({ id: '10', text: 'mudou entretanto' }),
    msg({ id: '11', replyToId: 10, replyTo: existing }),
  ]);
  // A otimista ja tem a citacao certa; reconstrui-la seria trabalho a mais e
  // uma oportunidade de divergir.
  expect(out[1].replyTo).toBe(existing);
});

test('uma resposta a mensagem fora da pagina fica sem citacao, nao rebenta', () => {
  const out = linkReplies([msg({ id: '11', replyToId: 999 })]);
  expect(out[0].replyTo).toBeUndefined();
  expect(out[0].replyToId).toBe(999);
});

test('mensagens sem resposta passam intactas', () => {
  const input = [msg({ id: '1', text: 'olá' }), msg({ id: '2', text: 'adeus' })];
  const out = linkReplies(input);
  expect(out[0]).toBe(input[0]);
  expect(out[1]).toBe(input[1]);
});

test('uma resposta que chega ao vivo tambem leva a citacao (#367)', () => {
  const list = [msg({ id: '10', text: 'olá bot', fromMe: true })];
  const out = appendLinked(list, msg({ id: '11', text: 'You said: olá bot', replyToId: 10 }));
  expect(out).toHaveLength(2);
  expect(out[1].replyTo!.text).toBe('olá bot');
  expect(out[1].replyTo!.fromMe).toBe(true);
  // As anteriores ficam como estavam.
  expect(out[0]).toBe(list[0]);
});

test('ao vivo, uma resposta a algo fora da pagina fica sem citacao', () => {
  const out = appendLinked([msg({ id: '10' })], msg({ id: '12', replyToId: 3 }));
  expect(out[1].replyTo).toBeUndefined();
});
