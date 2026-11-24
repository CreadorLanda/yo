import { expect, test } from 'bun:test';

import { avatarSeed, defaultAvatarSvg } from '@/data/default-avatar';

// react-native-svg drew an empty circle for the <mask> DiceBear wraps every picture in.
test('the generated face has nothing that hides it on Android', () => {
  const svg = defaultAvatarSvg(avatarSeed({ id: 'f008fa60-09fd-48e1-97bb-0d4fd6ca0c41' }), 48);
  expect(svg).not.toContain('<mask');
  expect(svg).not.toContain('mask="');
  expect(svg).not.toContain('<metadata');
});

test('a face still has its drawing', () => {
  const svg = defaultAvatarSvg('someone', 48);
  expect(svg).toContain('<path');
  expect(svg.startsWith('<svg')).toBe(true);
});

test('a person keeps the same face, and two people differ', () => {
  expect(defaultAvatarSvg('a', 48)).toBe(defaultAvatarSvg('a', 48));
  expect(defaultAvatarSvg('a', 48)).not.toBe(defaultAvatarSvg('b', 48));
});
