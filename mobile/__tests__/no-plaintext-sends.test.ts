import { expect, test } from 'bun:test';

/**
 * Guards the property the whole encryption effort rests on: nothing reaches
 * apiSendMessage that did not come out of an encryption function.
 *
 * Written because the earlier version of this check only looked for a
 * variable named `payload` nearby, and passed while group text messages were
 * going out in the clear — the branch read `type !== 'group'`, so the most
 * common message in the app was the one left unencrypted.
 */
const FILES = ['app/chat/[id].tsx', 'app/channel/[id].tsx', 'data/outbox.ts'];
const ENCRYPTORS = /encryptBody\(|encryptForChat\(|encryptForGroup\(|encryptForPeerOrFail\(/;

test('nenhum envio parte de texto simples', async () => {
  const offenders: string[] = [];

  for (const f of FILES) {
    const src = await Bun.file(f).text();

    // Any assignment that puts a bare value into the variable later handed
    // to apiSendMessage. `let payload: string;` is fine — it has no value
    // until an encryptor gives it one.
    for (const m of src.matchAll(/^\s*(?:let |const )?payload\s*=\s*(.+)$/gm)) {
      const rhs = m[1].trim();
      // A websocket event's own `payload` field is unrelated to the send
      // path and never reaches apiSendMessage.
      if (rhs.startsWith('ev.payload')) continue;
      if (!ENCRYPTORS.test(rhs)) {
        offenders.push(`${f}: payload = ${rhs}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test('cada apiSendMessage recebe um corpo cifrado', async () => {
  const bad: string[] = [];

  for (const f of FILES) {
    const lines = (await Bun.file(f).text()).split('\n');
    lines.forEach((line, i) => {
      if (!/apiSendMessage\(/.test(line)) return;
      const window = lines.slice(i, i + 4).join(' ');
      // Either the pre-encrypted variable, or an inline call to an encryptor.
      if (!/\bpayload\b/.test(window) && !ENCRYPTORS.test(window)) {
        bad.push(`${f}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  expect(bad).toEqual([]);
});

test('nenhum ramo trata grupos como isentos', async () => {
  const exempt: string[] = [];

  for (const f of FILES) {
    const src = await Bun.file(f).text();
    // The exact shape of the bug: a guard that skips the encryption block
    // when the chat is a group.
    for (const m of src.matchAll(/if\s*\([^)]*type\s*!==\s*'group'\s*\)/g)) {
      exempt.push(`${f}: ${m[0]}`);
    }
  }

  expect(exempt).toEqual([]);
});
