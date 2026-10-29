import { expect, mock, test } from 'bun:test';

// Expo Crypto is native-only. Keep the test on the shipped media-crypto module
// while supplying the same secure random contract in Bun.
mock.module('expo-crypto', () => ({
  getRandomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
}));

const {
  decryptMediaBytes,
  encryptMediaBytes,
  generateMediaKey,
  hasMediaKey,
} = await import('../data/crypto/media-crypto');

test('a media cifrada recupera a captura com a mesma chave', () => {
  const plain = new TextEncoder().encode('captura de camera recuperavel');
  const mediaKey = generateMediaKey();
  const cipher = encryptMediaBytes(plain, mediaKey);

  expect(cipher).not.toEqual(plain);
  expect(decryptMediaBytes(cipher, mediaKey)).toEqual(plain);
  expect(hasMediaKey(mediaKey)).toBe(true);
});

test('uma media cifrada rejeita chave errada e bytes adulterados', () => {
  const plain = new TextEncoder().encode('nao expor o anexo');
  const mediaKey = generateMediaKey();
  const cipher = encryptMediaBytes(plain, mediaKey);
  const wrongKey = generateMediaKey();
  const tampered = new Uint8Array(cipher);
  tampered[0] ^= 1;

  expect(decryptMediaBytes(cipher, wrongKey)).toBeNull();
  expect(decryptMediaBytes(tampered, mediaKey)).toBeNull();
});
