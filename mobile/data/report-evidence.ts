import type { ReportEvidence, ReportReason } from '@/data/api/messages';

/**
 * What a report can carry, and how long the quiet period after it lasts.
 *
 * The limits match the server's (`messages/report.go`); the server enforces
 * them, these only keep the screen from offering what would be refused.
 */
export const MAX_EVIDENCE = 20;
export const MAX_EVIDENCE_BODY = 2000;
export const MAX_NOTE = 500;
/** How many recent messages the screen offers to choose from. */
export const SELECTABLE_RECENT = 30;

export const REPORT_REASONS: {
  id: ReportReason;
  icon: 'megaphone-outline' | 'hand-left-outline' | 'warning-outline' | 'person-outline' | 'ellipsis-horizontal';
}[] = [
  { id: 'abuse', icon: 'hand-left-outline' },
  { id: 'spam', icon: 'megaphone-outline' },
  { id: 'scam', icon: 'warning-outline' },
  { id: 'impersonation', icon: 'person-outline' },
  { id: 'other', icon: 'ellipsis-horizontal' },
];

/** A message the person can attach, already decrypted on this phone. */
export type EvidenceCandidate = {
  /** The server's message id. */
  id: number;
  text: string;
  fromMe: boolean;
  sentAt: string;
};

type RawMessage = {
  id: number | string;
  message_type?: string;
  deleted_at?: string | null;
  created_at: string;
  sender_id?: string | null;
};

/**
 * The recent text messages worth offering, oldest first.
 *
 * Only plain text: a photo or a voice note has no body to copy, and system
 * lines are the app talking. Deleted messages are skipped; the person cannot
 * see them, so they cannot be choosing them.
 */
export function evidenceCandidates(
  messages: RawMessage[],
  decrypted: Map<string, string>,
  meId: string | undefined,
): EvidenceCandidate[] {
  const out: EvidenceCandidate[] = [];
  for (const m of messages) {
    if (m.deleted_at) continue;
    if (m.message_type && m.message_type !== 'text' && m.message_type !== 'reply') continue;
    const text = (decrypted.get(String(m.id)) ?? '').trim();
    const id = Number(m.id);
    if (!text || !Number.isFinite(id) || id <= 0) continue;
    // A body that could not be decrypted is not evidence of anything.
    if (text === '[encrypted]' || text.startsWith('🔒')) continue;
    out.push({ id, text, fromMe: !!meId && m.sender_id === meId, sentAt: m.created_at });
  }
  return out
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .slice(-SELECTABLE_RECENT);
}

/** The copies to send for the chosen messages, within the server's limits. */
export function buildEvidence(candidates: EvidenceCandidate[], chosen: Set<number>): ReportEvidence[] {
  return candidates
    .filter((c) => chosen.has(c.id))
    .slice(0, MAX_EVIDENCE)
    .map((c) => ({ message_id: c.id, body: c.text.trim().slice(0, MAX_EVIDENCE_BODY) }));
}

/** Time left in a no-contact period, rounded up to whole minutes. */
export function noContactRemaining(until: string | null | undefined, now: number = Date.now()) {
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60000);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60, totalMinutes: minutes };
}
