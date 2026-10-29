import { expect, mock, test } from 'bun:test';
import nacl from 'tweetnacl';

const userId = '00000000-0000-4000-8000-000000000001';
const secureStore = new Map<string, string>();
secureStore.set('auth.access', 'access-token-for-test');
const encryptedSecrets = new Map<string, string>();
let randomCounter = 0;

const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const identity = nacl.box.keyPair();
const signedPreKey = nacl.box.keyPair();

mock.module('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { secureStore.set(key, value); },
  deleteItemAsync: async (key: string) => { secureStore.delete(key); },
}));
mock.module('expo-crypto', () => ({
  getRandomBytes: (size: number) => {
    const seed = ++randomCounter;
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      bytes[index] = (seed + index * 31) & 0xff;
    }
    return bytes;
  },
}));
mock.module('@/data/auth-store', () => ({
  getCurrentUser: () => ({ id: userId }),
}));
mock.module('@/data/db/secrets', () => ({
  getSecret: async (key: string) => encryptedSecrets.get(key) ?? null,
  setSecret: async (key: string, value: string) => { encryptedSecrets.set(key, value); },
  deleteSecret: async (key: string) => { encryptedSecrets.delete(key); },
}));
mock.module('@/data/api/keys', () => ({
  bundleForUsername: async () => { throw new Error('unexpected_bundle_fetch'); },
  identityForUsername: async () => { throw new Error('unexpected_identity_fetch'); },
  myKeyCount: async () => ({ one_time_remaining: 40 }),
  uploadKeys: async () => ({ one_time_remaining: 40 }),
}));
mock.module('@/data/api/client', () => ({
  ApiError: class ApiError extends Error {},
  ACCESS_KEY: 'auth.access',
  REFRESH_KEY: 'auth.refresh',
  BASE_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost',
  getBaseUrl: () => process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost',
}));

encryptedSecrets.set(
  `e2ee.device_keys.v1.${userId}`,
  JSON.stringify({
    identityPublic: toB64(identity.publicKey),
    identitySecret: toB64(identity.secretKey),
    signedPreKeyId: 1,
    signedPreKeyPublic: toB64(signedPreKey.publicKey),
    signedPreKeySecret: toB64(signedPreKey.secretKey),
    signedPreKeySignature: '',
    oneTimeSecrets: {},
    nextOtkId: 1,
  }),
);

const crypto = await import('@/data/crypto/session');

test('self-chat decrypts history after its cached session is removed', async () => {
  crypto.clearSessionCache();
  const envelope = await crypto.encryptForPeerOrFail(userId, 'saved note', {
    peerUsername: 'self',
  });

  await crypto.clearSession(userId);
  crypto.clearSessionCache();

  await expect(crypto.decryptFromPeer(userId, envelope)).resolves.toBe('saved note');
});
