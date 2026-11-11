import { expect, test } from 'bun:test';

import {
  buildMentionCaption,
  buildPollCaption,
  clampStoryPosition,
  parseStoryCaption,
  pollValidationError,
} from '@/data/story-composition';
import {
  nextVisibleCommentCount,
  visibleCommentBatch,
  visibleCommentCount,
} from '@/data/story-comment-pagination';

test('poll options require a question and two or three non-empty answers', () => {
  expect(pollValidationError('', ['Yes', 'No'])).toBe('question_required');
  expect(pollValidationError('Choose', ['Yes'])).toBe('poll_needs_two_options');
  expect(pollValidationError('Choose', ['Yes', ''])).toBe('poll_option_required');
  expect(pollValidationError('Choose', ['A', 'B'])).toBeUndefined();
  expect(pollValidationError('Choose', ['A', 'B', 'C'])).toBeUndefined();
  expect(pollValidationError('Choose', ['A', 'B', 'C', 'D'])).toBe('poll_needs_two_options');
});

test('interactive captions keep options, mentions and safe positions through reload', () => {
  const caption = buildPollCaption('Pick one', ['A', 'B', 'C'], { x: 1, y: -1 }, '@ana');
  expect(parseStoryCaption('poll', caption)).toEqual({
    displayCaption: 'Pick one',
    question: 'Pick one',
    options: ['A', 'B', 'C'],
    mention: 'ana',
    position: { x: 0.82, y: 0.2 },
  });
  expect(parseStoryCaption('poll', '{"q":"Legacy","a":"Yes","b":"No"}').options).toEqual([
    'Yes',
    'No',
  ]);
});

test('separate mention stickers persist their text and bounded position', () => {
  expect(parseStoryCaption('text', buildMentionCaption('Hello', 'ana', { x: 0, y: 1 }))).toEqual({
    displayCaption: 'Hello',
    mention: 'ana',
    position: { x: 0.18, y: 0.7 },
  });
  expect(clampStoryPosition({ x: 0.4, y: 0.6 })).toEqual({ x: 0.4, y: 0.6 });
});

test('comments show five at a time without skipping or duplicating rows', () => {
  const comments = Array.from({ length: 12 }, (_, index) => index + 1);
  expect(visibleCommentCount(comments.length, 0)).toBe(5);
  expect(visibleCommentBatch(comments, 5)).toEqual([1, 2, 3, 4, 5]);
  expect(nextVisibleCommentCount(comments.length, 5)).toBe(10);
  expect(visibleCommentBatch(comments, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(nextVisibleCommentCount(comments.length, 10)).toBe(12);
  expect(visibleCommentBatch(comments, 12)).toEqual(comments);
});
