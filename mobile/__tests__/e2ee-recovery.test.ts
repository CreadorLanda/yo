import { expect, test } from 'bun:test';
import nacl from 'tweetnacl';

import { b64urlToBytes, bytesToB64url, utf8Decode, utf8Encode } from '../data/crypto/encoding';
import { messageKey, nonceFromCounter } from '../data/crypto/primitives';
import type { SessionRecord } from '../data/crypto/session';

function encrypt(rootKey: string, n: number, plaintext: string): string {
  const boxed = nacl.secretbox(
    utf8Encode(plaintext),
    nonceFromCounter(n),
    messageKey(b64urlToBytes(rootKey), n),
  );
  return bytesToB64url(boxed);
}

function decrypt(session: SessionRecord, n: number, ciphertext: string): string | null {
  const opened = nacl.secretbox.open(
    b64urlToBytes(ciphertext),
    nonceFromCounter(n),
    messageKey(b64urlToBytes(session.rootKey), n),
  );
  return opened ? utf8Decode(opened) : null;
}

test('uma sessão E2EE recuperada do armazenamento abre mensagens antigas', () => {
  const rootKey = bytesToB64url(nacl.randomBytes(32));
  const beforeRestart: SessionRecord = {
    peerUserId: 'peer-1',
    peerIdentityPublic: 'peer-identity',
    rootKey,
    sendN: 4,
    recvN: 4,
    establishedAt: new Date().toISOString(),
    handshake: { ek: 'ephemeral-public', otkId: 17, spkId: 1 },
  };
  const ciphertext = encrypt(beforeRestart.rootKey, 3, 'mensagem antes do reload');

  // This is the boundary that was previously untested: the process cache is
  // gone, but the persisted SessionRecord is the same contract SecureStore
  // serializes and loadSession parses.
  const afterRestart = JSON.parse(JSON.stringify(beforeRestart)) as SessionRecord;
  expect(decrypt(afterRestart, 3, ciphertext)).toBe('mensagem antes do reload');
  expect(afterRestart.handshake?.otkId).toBe(17);
});

test('uma sessão recuperada não abre a mensagem com uma raiz diferente', () => {
  const persisted: SessionRecord = {
    peerUserId: 'peer-2',
    peerIdentityPublic: 'peer-identity',
    rootKey: bytesToB64url(nacl.randomBytes(32)),
    sendN: 1,
    recvN: 1,
    establishedAt: new Date().toISOString(),
  };
  const ciphertext = encrypt(persisted.rootKey, 0, 'somente para a sessão correta');
  const wrong = { ...persisted, rootKey: bytesToB64url(nacl.randomBytes(32)) };

  expect(decrypt(persisted, 0, ciphertext)).toBe('somente para a sessão correta');
  expect(decrypt(wrong, 0, ciphertext)).toBeNull();
});
