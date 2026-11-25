import { expect, test } from 'bun:test';

import { normalizeUrl, officialHosts, officialLinkUrl, parseOfficialLink } from '@/data/link-policy';

const hosts = officialHosts({ linkHost: 'zwo.example', apiUrl: 'https://api.zwo.example' });

test('ordinary links are normalised and dangerous schemes refused', () => {
  expect(normalizeUrl('www.example.com/a')).toBe('https://www.example.com/a');
  expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  expect(normalizeUrl('file:///etc/passwd')).toBeNull();
  expect(normalizeUrl('intent://scan#Intent;end')).toBeNull();
  expect(normalizeUrl('ftp://example.com')).toBeNull();
  expect(normalizeUrl('two words')).toBeNull();
  expect(normalizeUrl('')).toBeNull();
});

test('every official link type is recognised on our hosts and in the app scheme', () => {
  const cases: [string, string, string][] = [
    ['https://zwo.example/i/Ab3_x9', 'invite', 'Ab3_x9'],
    ['https://zwo.example/c/news_ao', 'channel', 'news_ao'],
    ['https://api.zwo.example/u/ana', 'profile', 'ana'],
    ['https://zwo.example/b/dandarabot', 'bot', 'dandarabot'],
    ['https://zwo.example/l/5c1bc3eb-d2a3-47e4-b2ea-5aae1a265fde', 'live', '5c1bc3eb-d2a3-47e4-b2ea-5aae1a265fde'],
    ['zwo.example/p/post_1', 'post', 'post_1'],
    ['zwosocial://s/story_9', 'story', 'story_9'],
  ];
  for (const [url, type, id] of cases) {
    expect(parseOfficialLink(url, hosts)).toEqual({ type: type as never, id });
  }
});

test('lookalikes, other hosts and malformed paths are not official', () => {
  expect(parseOfficialLink('https://zwo.example.evil.com/i/abc', hosts)).toBeNull();
  expect(parseOfficialLink('https://evil.com/i/abc', hosts)).toBeNull();
  expect(parseOfficialLink('https://zwo.example/x/abc', hosts)).toBeNull();
  expect(parseOfficialLink('https://zwo.example/i/abc/extra', hosts)).toBeNull();
  expect(parseOfficialLink('https://zwo.example/i/a', hosts)).toBeNull();
  expect(parseOfficialLink('http://zwo.example/u/<script>', hosts)).toBeNull();
});

test('local development hosts never count as official', () => {
  expect(officialHosts({ apiUrl: 'http://192.168.240.1:8080' })).toEqual([]);
});

test('share URLs round-trip through the parser', () => {
  const url = officialLinkUrl({ type: 'invite', id: 'Ab3_x9' }, 'zwo.example');
  expect(url).toBe('https://zwo.example/i/Ab3_x9');
  expect(parseOfficialLink(url, hosts)).toEqual({ type: 'invite', id: 'Ab3_x9' });
});
