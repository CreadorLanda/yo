import { useActiveCall } from '@/data/active-call';

/**
 * Keeps the running call alive above every screen.
 *
 * The runner is required only once there is a call: it pulls in WebRTC, which
 * has no business being loaded on every launch of the app.
 */
export function CallHost() {
  const call = useActiveCall();
  if (!call) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CallRunner } = require('./call-runner') as typeof import('./call-runner');
  return <CallRunner key={call.chatId} call={call} />;
}
