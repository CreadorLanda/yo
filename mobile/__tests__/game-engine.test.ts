import { expect, test } from 'bun:test';

import {
  MAX_ROUNDS,
  newSeed,
  parseGamePayload,
  pickPlayer,
  replayGame,
  sortedMemberIds,
  type GameMessagePayload,
} from '../data/game';

const MEMBERS = sortedMemberIds(['ana', 'bia', 'leo', 'duda']);
const START: GameMessagePayload = {
  kind: 'game',
  game: 'truth-or-dare',
  action: 'start',
  seed: 'aabbccddeeff00112233445566778899',
  maxRounds: MAX_ROUNDS,
};

test('pickPlayer is deterministic across devices', () => {
  const a = pickPlayer('seed-1', 2, MEMBERS);
  const b = pickPlayer('seed-1', 2, MEMBERS);
  expect(a).toBe(b);
});

test('pickPlayer depends on seed and round', () => {
  const r1s1 = pickPlayer('seed-1', 1, MEMBERS);
  const r1s2 = pickPlayer('seed-2', 1, MEMBERS);
  const r2s1 = pickPlayer('seed-1', 2, MEMBERS);
  expect(r1s1).toBeGreaterThanOrEqual(0);
  expect(r1s1).toBeLessThan(MEMBERS.length);
  // Same round, different seed -> can differ; different round too. These are
  // not guaranteed distinct in general, but with these inputs they are —
  // which proves the hash actually mixes the inputs.
  expect(r1s1).not.toBe(r1s2);
  expect(r1s1).not.toBe(r2s1);
});

test('pickPlayer is stable under member ordering', () => {
  const reordered = sortedMemberIds(['leo', 'ana', 'duda', 'bia']);
  expect(reordered).toEqual(MEMBERS);
  expect(pickPlayer('seed-1', 1, reordered)).toBe(pickPlayer('seed-1', 1, MEMBERS));
});

test('newSeed produces distinct hex seeds', () => {
  const s1 = newSeed();
  const s2 = newSeed();
  expect(s1).toHaveLength(32);
  expect(s1).toMatch(/^[0-9a-f]+$/);
  expect(s1).not.toBe(s2);
});

test('replay: start activates the game and picks round 1 player', () => {
  const state = replayGame([START], MEMBERS);
  expect(state.active).toBe(true);
  expect(state.round).toBe(1);
  expect(state.currentPlayerId).toBe(MEMBERS[pickPlayer(START.seed, 1, MEMBERS)]);
  expect(state.choice).toBeNull();
  expect(state.doneIds).toEqual([]);
});

test('replay: choose then challenge then done advances to next round', () => {
  const p1 = MEMBERS[pickPlayer(START.seed, 1, MEMBERS)];
  const others = MEMBERS.filter((m) => m !== p1);
  const writer = others[0];

  const events: GameMessagePayload[] = [
    START,
    { kind: 'game', game: 'truth-or-dare', action: 'choose', playerId: p1, choice: 'dare' },
    { kind: 'game', game: 'truth-or-dare', action: 'challenge', playerId: writer, text: '10 push-ups' },
  ];
  const mid = replayGame(events, MEMBERS);
  expect(mid.choice).toBe('dare');
  expect(mid.challenge).toBe('10 push-ups');
  expect(mid.challengeBy).toBe(writer);

  const done = replayGame(
    [...events, { kind: 'game', game: 'truth-or-dare', action: 'done', playerId: p1 }],
    MEMBERS,
  );
  expect(done.doneIds).toContain(p1);
});

/**
 * This used to assert that a round ends once *every* member marks done, with
 * the others "passing". The room never offered them the button — it is gated
 * on isMyTurn — so no real session could produce those events, and the game
 * stopped dead after the first player's turn.
 *
 * A round now belongs to one player and ends when that player is done.
 */
test('replay: the round ends on the current player alone', () => {
  const p1 = MEMBERS[pickPlayer(START.seed, 1, MEMBERS)];
  const state = replayGame(
    [START, { kind: 'game', game: 'truth-or-dare', action: 'done', playerId: p1 }],
    MEMBERS,
  );
  expect(state.round).toBe(2);
  expect(state.doneIds).toEqual([p1]);
  expect(state.currentPlayerId).not.toBe(p1);
});

test('replay: max rounds ends the game with a winner', () => {
  let events: GameMessagePayload[] = [START];
  // Simulate full completion of every round.
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const m of MEMBERS) {
      events.push({ kind: 'game', game: 'truth-or-dare', action: 'done', playerId: m });
    }
  }
  const state = replayGame(events, MEMBERS);
  expect(state.ended).toBe(true);
  expect(state.winnerId).toBeTruthy();
  expect(state.currentPlayerId).toBeNull();
});

test('replay: explicit end wins even before rounds finish', () => {
  const events: GameMessagePayload[] = [
    START,
    { kind: 'game', game: 'truth-or-dare', action: 'end', winnerId: 'ana' },
  ];
  const state = replayGame(events, MEMBERS);
  expect(state.ended).toBe(true);
  expect(state.winnerId).toBe('ana');
});

test('replay: a channel can persist a lobby and a late joiner closes it', () => {
  const starter = '00000000-0000-0000-0000-000000000001';
  const joiner = '00000000-0000-0000-0000-000000000002';
  const stream: GameMessagePayload[] = [
    {
      kind: 'game', game: 'truth-or-dare', action: 'start', seed: 'channel-seed',
      maxRounds: MAX_ROUNDS, playerId: starter, playerIds: [starter],
    },
    { kind: 'game', game: 'truth-or-dare', action: 'join', playerId: joiner },
  ];
  const state = replayGame(stream, [starter, joiner]);
  expect(state.playerIds).toEqual([starter, joiner]);
  expect(state.currentPlayerId).not.toBeNull();

  const otherDevice = replayGame(stream, [joiner, starter]);
  expect(otherDevice.currentPlayerId).toBe(state.currentPlayerId);
});

test('channel payload parser drops malformed persisted data', () => {
  expect(parseGamePayload({ kind: 'game', game: 'truth-or-dare', action: 'choose' })).toBeNull();
  expect(parseGamePayload({ kind: 'game', game: 'truth-or-dare', action: 'join', playerId: 'u1' })).toEqual({
    kind: 'game', game: 'truth-or-dare', action: 'join', playerId: 'u1',
  });
});
