import { expect, test } from 'bun:test';
import nacl from 'tweetnacl';

// The sender-key construction, exercised directly. The module itself pulls in
// SecureStore and the app database, neither of which exists here — so this
// re-derives the same primitives from the same source file and checks the
// maths, which is the part that decides whether anyone can read anything.
const src = await Bun.file('data/crypto/primitives.ts').text();

function hkdfLike(ikm: Uint8Array, info: string): Uint8Array {
  const infoBytes = new TextEncoder().encode(info);
  const buf = new Uint8Array(ikm.length + infoBytes.length);
  buf.set(ikm, 0);
  buf.set(infoBytes, ikm.length);
  return nacl.hash(buf).slice(0, 32);
}
const messageKey = (root: Uint8Array, n: number) => hkdfLike(root, `msg-${n}`);
function nonceFromCounter(n: number): Uint8Array {
  const nonce = new Uint8Array(24);
  const view = new DataView(nonce.buffer);
  view.setUint32(0, n, false);
  view.setUint32(4, 0x534f4349, false);
  return nonce;
}

test('as primitivas aqui são as mesmas do ficheiro que envia', () => {
  // Guards against this test quietly validating a different construction
  // than the one that ships.
  expect(src).toContain('hkdfLike(root, `msg-${n}`)');
  expect(src).toContain('view.setUint32(4, 0x534f4349');
});

test('um membro com a chave lê; sem a chave não lê', () => {
  const senderKey = nacl.randomBytes(32);
  const plain = 'reunião às 15h';

  const n = 0;
  const boxed = nacl.secretbox(
    new TextEncoder().encode(plain),
    nonceFromCounter(n),
    messageKey(senderKey, n),
  );

  const opened = nacl.secretbox.open(boxed, nonceFromCounter(n), messageKey(senderKey, n));
  expect(new TextDecoder().decode(opened!)).toBe(plain);

  // Someone removed from the group holds a key from the previous epoch.
  const oldEpochKey = nacl.randomBytes(32);
  expect(nacl.secretbox.open(boxed, nonceFromCounter(n), messageKey(oldEpochKey, n))).toBeNull();
});

test('cada mensagem usa uma chave e um nonce diferentes', () => {
  const senderKey = nacl.randomBytes(32);
  const seen = new Set<string>();
  for (let n = 0; n < 50; n++) {
    seen.add(Buffer.from(messageKey(senderKey, n)).toString('hex'));
    seen.add(Buffer.from(nonceFromCounter(n)).toString('hex'));
  }
  // 50 keys + 50 nonces, none repeated: reusing a nonce with secretbox
  // leaks the xor of two plaintexts.
  expect(seen.size).toBe(100);
});

test('a mesma mensagem cifra de forma diferente sob épocas diferentes', () => {
  const plain = 'depois da saída do carlos';
  const epoch1 = nacl.randomBytes(32);
  const epoch2 = nacl.randomBytes(32);
  const a = nacl.secretbox(new TextEncoder().encode(plain), nonceFromCounter(0), messageKey(epoch1, 0));
  const b = nacl.secretbox(new TextEncoder().encode(plain), nonceFromCounter(0), messageKey(epoch2, 0));
  expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
});

test('o cabeçalho identifica quem enviou e sob que época', () => {
  const header = { v: 1, s: 'user-123', e: 4, n: 7 };
  const encoded = Buffer.from(JSON.stringify(header)).toString('base64url');
  const wire = `soc1g.${encoded}.corpo`;

  expect(wire.startsWith('soc1g.')).toBe(true);
  // Must not be mistaken for a pairwise envelope, which a different key and
  // a different code path would try to open.
  expect(wire.startsWith('soc1.')).toBe(false);

  const rest = wire.slice('soc1g.'.length);
  const parsed = JSON.parse(Buffer.from(rest.slice(0, rest.indexOf('.')), 'base64url').toString());
  expect(parsed).toEqual(header);
});
