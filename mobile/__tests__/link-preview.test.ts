import { expect, test } from 'bun:test';

import {
  decodeTextBody,
  encodeTextBody,
  firstLink,
  MAX_IMAGE_CHARS,
  parsePageMeta,
  sanitizePreview,
  textOfBody,
} from '@/data/link-preview';

const preview = {
  url: 'https://example.com/a',
  title: 'Example',
  site: 'Example Site',
  description: 'A page',
  image: 'data:image/jpeg;base64,AAAA',
};

test('a body without a preview is the text itself', () => {
  expect(encodeTextBody('hello https://example.com')).toBe('hello https://example.com');
  expect(decodeTextBody('hello')).toEqual({ text: 'hello' });
  expect(decodeTextBody('{"not":"ours"}')).toEqual({ text: '{"not":"ours"}' });
});

test('a preview round-trips through the body', () => {
  const body = encodeTextBody('see https://example.com/a', preview);
  expect(body.startsWith('{"zl1"')).toBe(true);
  expect(decodeTextBody(body)).toEqual({ text: 'see https://example.com/a', preview });
  expect(textOfBody(body)).toBe('see https://example.com/a');
});

test('a preview from another device is checked before it is shown', () => {
  expect(sanitizePreview({ ...preview, url: 'javascript:alert(1)' })).toBeNull();
  expect(sanitizePreview({ ...preview, title: '   ' })).toBeNull();
  expect(sanitizePreview({ ...preview, image: 'https://tracker.example/pixel.png' })?.image).toBeUndefined();
  const big = `data:image/jpeg;base64,${'A'.repeat(MAX_IMAGE_CHARS)}`;
  expect(sanitizePreview({ ...preview, image: big })?.image).toBeUndefined();
  expect(sanitizePreview({ url: 'https://www.example.org/x', title: 'T' })?.site).toBe('example.org');
  expect(sanitizePreview({ ...preview, title: 'x'.repeat(500) })!.title.length).toBe(200);
  // A broken preview leaves the text readable.
  expect(decodeTextBody('{"zl1":{"text":"hi","preview":{"url":"file:///x","title":"t"}}}')).toEqual({ text: 'hi' });
});

test('the first web link in a draft, without trailing punctuation', () => {
  expect(firstLink('look at https://example.com/a?b=1.')).toBe('https://example.com/a?b=1');
  expect(firstLink('(www.example.org)')).toBe('https://www.example.org/');
  expect(firstLink('no links here')).toBeNull();
  expect(firstLink('javascript:alert(1)')).toBeNull();
});

test('page metadata prefers Open Graph and resolves relative images', () => {
  const html = `<!doctype html><html><head>
    <title>Plain title</title>
    <meta property="og:title" content="OG &amp; title">
    <meta name="description" content='Plain description'>
    <meta property="og:site_name" content="Site">
    <meta content="/img/card.jpg" property="og:image">
  </head><body><meta property="og:title" content="ignored"></body></html>`;
  expect(parsePageMeta(html, 'https://example.com/post/1')).toEqual({
    title: 'OG & title',
    description: 'Plain description',
    site: 'Site',
    imageUrl: 'https://example.com/img/card.jpg',
  });
  expect(parsePageMeta('<head><title>Only &#233;</title></head>', 'https://x.test')).toEqual({ title: 'Only é' });
  expect(parsePageMeta('<head></head><body>no title</body>', 'https://x.test')).toBeNull();
  expect(
    parsePageMeta('<head><title>t</title><meta property="og:image" content="javascript:x"></head>', 'https://x.test'),
  ).toEqual({ title: 't' });
});
