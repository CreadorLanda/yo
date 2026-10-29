import { afterAll, expect, mock, test } from 'bun:test';

let encryptedBytes: Uint8Array | null = null;
mock.module('expo-crypto', () => ({
  getRandomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
}));
mock.module('expo-secure-store', () => ({
  getItemAsync: async () => 'access-token-for-test',
}));
mock.module('../data/file-bytes', () => ({
  readFileBytes: async () => new TextEncoder().encode('private camera bytes'),
  writeTempFile: async (_name: string, bytes: Uint8Array) => {
    encryptedBytes = bytes;
    return 'file:///tmp/encrypted-camera.bin';
  },
}));

let requestBody = '';
let authorization: string | null = null;
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    authorization = request.headers.get('authorization');
    requestBody = await request.text();
    return Response.json({
      id: '00000000-0000-0000-0000-000000000001',
      owner_id: '00000000-0000-0000-0000-000000000002',
      kind: 'other',
      mime_type: 'application/octet-stream',
      size_bytes: encryptedBytes?.length ?? 0,
      url: '/api/media/00000000-0000-0000-0000-000000000001/file',
      created_at: '2026-10-29T00:00:00Z',
    });
  },
});

process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${server.port}`;
const { uploadEncryptedMedia } = await import('../data/api/media');

test('a captura cifrada atravessa o pedido HTTP como multipart opaco', async () => {
  const result = await uploadEncryptedMedia({
    uri: 'file:///tmp/camera.jpg',
    mimeType: 'image/jpeg',
    width: 1080,
    height: 1920,
  });

  expect(authorization).toBe('Bearer access-token-for-test');
  expect(requestBody).toContain('name="file"');
  expect(requestBody).not.toContain('private camera bytes');
  expect(encryptedBytes).not.toBeNull();
  expect(result.object.mime_type).toBe('application/octet-stream');
  expect(result.key.key.length).toBeGreaterThan(40);
  expect(result.key.nonce.length).toBeGreaterThan(30);
});

afterAll(() => server.stop());
