import { beforeEach, expect, mock, test } from 'bun:test';

const hangups: string[] = [];
mock.module('@/data/api/calls', () => ({
  hangupCall: async (id: string) => {
    hangups.push(id);
  },
}));

const { beginCall, cameraStep, endCall, formatCallDuration, getActiveCall, patchCall } = await import(
  '@/data/active-call'
);

const start = (chatId = 'a', mode: 'voice' | 'video' = 'voice') =>
  beginCall({ chatId, mode, incoming: false });

beforeEach(() => {
  endCall();
  hangups.length = 0;
});

test('leaving the screen does not end the call', () => {
  start();
  patchCall('a', { onScreen: false });
  expect(getActiveCall()?.chatId).toBe('a');
  expect(hangups).toEqual([]);
});

test('returning to a call does not restart it', () => {
  start();
  patchCall('a', { connectedAt: 123, onScreen: false });
  start();
  expect(getActiveCall()?.connectedAt).toBe(123);
  expect(hangups).toEqual([]);
});

test('a call to another chat replaces the running one and hangs it up', () => {
  start('a');
  start('b');
  expect(getActiveCall()?.chatId).toBe('b');
  expect(hangups).toEqual(['a']);
});

test('ending reports to the server and closes the room, once', () => {
  let closed = 0;
  start();
  patchCall('a', { room: { disconnect: async () => { closed += 1; } } });
  endCall();
  endCall();
  expect(getActiveCall()).toBeNull();
  expect(hangups).toEqual(['a']);
  expect(closed).toBe(1);
});

test('a late answer for a finished call is dropped', () => {
  start('a');
  endCall();
  start('b');
  patchCall('a', { failure: 'late' });
  expect(getActiveCall()?.failure).toBeNull();
});

test('a video call starts on the speaker and a voice call at the ear', () => {
  start('a', 'video');
  expect(getActiveCall()?.speaker).toBe(true);
  endCall();
  start('a', 'voice');
  expect(getActiveCall()?.speaker).toBe(false);
});

test('duration reads like a phone timer', () => {
  expect(formatCallDuration(5)).toBe('00:05');
  expect(formatCallDuration(65)).toBe('01:05');
  expect(formatCallDuration(3725)).toBe('1:02:05');
});

test('leaving a video call turns the camera off', () => {
  expect(cameraStep({ away: true, enabled: true, pausedByUs: false })).toBe('pause');
});

test('returning brings back a camera the app turned off', () => {
  expect(cameraStep({ away: false, enabled: false, pausedByUs: true })).toBe('resume');
});

test('a camera the person turned off stays off', () => {
  expect(cameraStep({ away: false, enabled: false, pausedByUs: false })).toBeNull();
  expect(cameraStep({ away: true, enabled: false, pausedByUs: false })).toBeNull();
});
