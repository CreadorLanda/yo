import { afterAll, expect, mock, test } from 'bun:test';

let encryptedBytes: Uint8Array | null = null;
let accessToken = 'expired-access-token';
let refreshToken = 'refresh-token';
const NativeFormData = globalThis.FormData;
class TestFormData extends NativeFormData {
  override append(name: string, value: string | Blob, filename?: string) {
    // React Native's FormData adapter receives a { uri, name, type } file
    // descriptor. The web test converts that descriptor to a real Blob so
    // the local HTTP server verifies the bytes that crossed the wire.
    if (name === 'file' && encryptedBytes && typeof value === 'object' && 'uri' in value) {
      const descriptor = value as Blob & { name?: string; type?: string };
      return super.append(
        name,
        new Blob([encryptedBytes], { type: descriptor.type ?? 'application/octet-stream' }),
        descriptor.name ?? filename ?? 'encrypted-camera.bin',
      );
    }
    return filename === undefined
      ? super.append(name, value)
      : super.append(name, value, filename);
  }
}
globalThis.FormData = TestFormData as typeof FormData;
mock.module('expo-crypto', () => ({
  getRandomBytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
}));
// Complete, not just the getter: bun shares module mocks across test files in
// one run, and a partial mock leaves other files without setItemAsync.
mock.module('expo-secure-store', () => ({
  getItemAsync: async (key: string) => key === 'auth.refresh' ? refreshToken : accessToken,
  setItemAsync: async (key: string, value: string) => {
    if (key === 'auth.access') accessToken = value;
    if (key === 'auth.refresh') refreshToken = value;
  },
  deleteItemAsync: async () => {},
}));
mock.module('../data/file-bytes', () => ({
  readFileBytes: async () => new TextEncoder().encode('private camera bytes'),
  writeTempFile: async (_name: string, bytes: Uint8Array) => {
    encryptedBytes = bytes;
    return 'file:///tmp/encrypted-camera.bin';
  },
  deleteTempFile: () => {},
}));

let uploadAttempts = 0;
let refreshRequests = 0;
let requestBody = '';
let receivedBytes: Uint8Array | null = null;
let firstRequestBytes: Uint8Array | null = null;
let requestMethod = '';
let requestPath = '';
let contentType: string | null = null;
let authorization: string | null = null;
let downloadAuthorization: string | null = null;
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    requestMethod = request.method;
    requestPath = new URL(request.url).pathname;
    authorization = request.headers.get('authorization');
    contentType = request.headers.get('content-type');
    if (requestPath === '/api/auth/refresh') {
      refreshRequests += 1;
      expect(request.method).toBe('POST');
      expect(await request.json()).toEqual({ refresh_token: 'refresh-token' });
      accessToken = 'fresh-access-token';
      refreshToken = 'rotated-refresh-token';
      return Response.json({ tokens: { access_token: accessToken, refresh_token: refreshToken } });
    }
    if (requestPath.endsWith('/file')) {
      downloadAuthorization = authorization;
      return new Response(receivedBytes, {
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    uploadAttempts += 1;
    if (authorization === 'Bearer expired-access-token') {
      // Consume the complete first multipart body before returning 401. This
      // proves the refresh replay is a new, equivalent request rather than a
      // happy-path mock that never exercised body replay.
      const firstForm = await request.formData();
      const firstFile = firstForm.get('file');
      if (!(firstFile instanceof Blob)) return Response.json({ error: 'file part missing' }, { status: 400 });
      firstRequestBytes = new Uint8Array(await firstFile.arrayBuffer());
      return Response.json({ error: 'expired' }, { status: 401 });
    }
    requestBody = await request.clone().text();
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) return Response.json({ error: 'file part missing' }, { status: 400 });
    receivedBytes = new Uint8Array(await file.arrayBuffer());
    expect(form.get('width')).toBe('1080');
    expect(form.get('height')).toBe('1920');
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
const { decryptMediaBytes } = await import('../data/crypto/media-crypto');

test('a captura cifrada atravessa o pedido HTTP como multipart opaco', async () => {
  const result = await uploadEncryptedMedia({
    uri: 'file:///tmp/camera.jpg',
    mimeType: 'image/jpeg',
    width: 1080,
    height: 1920,
  });

  expect(refreshRequests).toBe(1);
  expect(uploadAttempts).toBe(2);
  expect(requestMethod).toBe('POST');
  expect(requestPath).toBe('/api/media/upload');
  expect(authorization).toBe('Bearer fresh-access-token');
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(contentType).not.toContain('application/json');
  expect(requestBody).toContain('name="file"');
  expect(requestBody).toContain('name="width"');
  expect(requestBody).toContain('1080');
  expect(requestBody).toContain('name="height"');
  expect(requestBody).toContain('1920');
  expect(requestBody).not.toContain('private camera bytes');
  expect(encryptedBytes).not.toBeNull();
  expect(firstRequestBytes).toEqual(receivedBytes);
  expect(receivedBytes).toEqual(encryptedBytes);
  expect(result.object.mime_type).toBe('application/octet-stream');
  expect(result.key.key.length).toBeGreaterThan(40);
  expect(result.key.nonce.length).toBeGreaterThan(30);

  // The message envelope is what makes the ciphertext recoverable by a
  // second client: the server persists only the object path, while the E2EE
  // key and nonce travel inside the encrypted message.
  const envelope = { media_url: result.object.url, media_key: result.key };
  const downloaded = await fetch(`http://127.0.0.1:${server.port}${envelope.media_url}`, {
    headers: { Authorization: 'Bearer fresh-access-token' },
  });
  expect(downloaded.ok).toBe(true);
  expect(downloadAuthorization).toBe('Bearer fresh-access-token');
  const recovered = decryptMediaBytes(new Uint8Array(await downloaded.arrayBuffer()), envelope.media_key);
  expect(recovered).not.toBeNull();
  expect(new TextDecoder().decode(recovered!)).toBe('private camera bytes');
});

afterAll(() => server.stop());
