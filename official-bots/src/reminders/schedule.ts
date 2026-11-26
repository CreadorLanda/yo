import { inQuiet, nextOccurrence, quietEnd, type Quiet } from '../lib/time';
import type { Job } from './store';

/** A one-off more than this late says so when it is delivered. */
export const LATE_AFTER_MS = 5 * 60_000;
/** A recurring run missed by more than this is skipped, not delivered. */
export const SKIP_RECURRING_AFTER_MS = 60 * 60_000;

export type Step =
  | { act: 'send'; late: boolean; then: { remove: true } | { nextAt: number } }
  | { act: 'postpone'; until: number }
  | { act: 'skip'; nextAt: number };

/**
 * What to do with a due job. The missed-run policy (a restart, an outage):
 * - a one-off reminder is always delivered once, marked late past 5 minutes;
 * - a recurring job missed by more than an hour is skipped, never backfilled,
 *   and moves to its next time — nobody wants seven "standup!" at once.
 * Quiet hours: a reminder for a person waits until their quiet hours end
 * (once per occurrence); a message to the whole chat is not held back.
 */
export function step(job: Job, now: number, quiet: Quiet | null, recipientTz: string): Step {
  const lateBy = now - job.nextAt;
  if (job.kind === 'reminder' && job.target.kind !== 'here' && quiet && !job.postponed) {
    const at = new Date(now);
    if (inQuiet(at, recipientTz, quiet)) return { act: 'postpone', until: quietEnd(at, recipientTz, quiet).getTime() };
  }
  if (!job.rule) return { act: 'send', late: lateBy > LATE_AFTER_MS && !job.postponed, then: { remove: true } };
  const nextAt = nextOccurrence(job.rule, new Date(Math.max(now, job.nextAt)), job.tz).getTime();
  if (lateBy > SKIP_RECURRING_AFTER_MS && !job.postponed) return { act: 'skip', nextAt };
  return { act: 'send', late: false, then: { nextAt } };
}
