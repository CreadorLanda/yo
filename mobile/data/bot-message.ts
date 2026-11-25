/**
 * Interactive bot messages (#325): cards, buttons, menus and forms.
 *
 * They travel inside the end-to-end encrypted body, tagged like a link card
 * (#353), so the server never sees them and cannot check them. This module is
 * that check: whatever a bot sent is cut to size and stripped of anything the
 * app does not draw before it reaches the screen. Plain text, never HTML or
 * markdown; links only https, and only behind the chat's link rules.
 */

export type ButtonStyle = 'primary' | 'secondary' | 'danger' | 'link';
export type CardColor = 'primary' | 'success' | 'warning' | 'danger' | 'info';

export type BotButton = {
  type: 'button';
  id: string;
  label: string;
  style: ButtonStyle;
  url?: string;
  disabled?: boolean;
};

export type BotSelectOption = { label: string; value: string; description?: string };

export type BotSelect = {
  type: 'select';
  id: string;
  placeholder?: string;
  options: BotSelectOption[];
  min: number;
  max: number;
  disabled?: boolean;
};

export type BotUserSelect = { type: 'user_select'; id: string; placeholder?: string; max: number; disabled?: boolean };

export type BotFormField = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'choice';
  required?: boolean;
  placeholder?: string;
  choices?: { label: string; value: string }[];
};

export type BotForm = {
  type: 'form';
  id: string;
  title?: string;
  submitLabel?: string;
  fields: BotFormField[];
  disabled?: boolean;
};

export type BotComponent = BotButton | BotSelect | BotUserSelect | BotForm;

export type BotCard = {
  title?: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  /** A small inline image (data URI), so drawing it fetches nothing. */
  thumbnail?: string;
  footer?: string;
  color?: CardColor;
};

export type BotInteractive = {
  card?: BotCard;
  /** Rows of components. */
  rows: BotComponent[][];
  /** After this, every component is shown disabled. */
  expiresAt?: string;
};

const TAG = 'zi1';
const ID = /^[A-Za-z0-9_:.-]{1,64}$/;
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const COLORS: CardColor[] = ['primary', 'success', 'warning', 'danger', 'info'];
const STYLES: ButtonStyle[] = ['primary', 'secondary', 'danger', 'link'];

export const LIMITS = {
  text: 4000,
  title: 256,
  description: 2000,
  label: 80,
  rows: 5,
  perRow: 5,
  options: 25,
  formFields: 5,
  cardFields: 10,
  thumbnailChars: 48 * 1024,
} as const;

function str(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function id(v: unknown): string | null {
  return typeof v === 'string' && ID.test(v) ? v : null;
}

function bool(v: unknown): boolean | undefined {
  return v === true ? true : undefined;
}

function sanitizeComponent(raw: unknown): BotComponent | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const cid = id(c.id);
  switch (c.type) {
    case 'button': {
      const label = str(c.label, LIMITS.label);
      const style = STYLES.includes(c.style as ButtonStyle) ? (c.style as ButtonStyle) : 'secondary';
      const url = style === 'link' ? httpsUrl(c.url) : undefined;
      // A link button needs a link; any other button needs an id to report.
      if (!label || (style === 'link' ? !url : !cid)) return null;
      return { type: 'button', id: cid ?? `link:${label}`, label, style, ...(url ? { url } : {}), ...(bool(c.disabled) ? { disabled: true } : {}) };
    }
    case 'select': {
      if (!cid || !Array.isArray(c.options)) return null;
      const options = c.options
        .slice(0, LIMITS.options)
        .map((o) => {
          const r = (o ?? {}) as Record<string, unknown>;
          const label = str(r.label, LIMITS.label);
          const value = str(r.value, 100);
          const description = str(r.description, 100);
          return label && value ? { label, value, ...(description ? { description } : {}) } : null;
        })
        .filter((o): o is BotSelectOption => !!o);
      if (options.length === 0) return null;
      const max = Math.max(1, Math.min(options.length, Number(c.max) || 1));
      const min = Math.max(0, Math.min(max, Number(c.min) || (max === 1 ? 1 : 0)));
      return { type: 'select', id: cid, placeholder: str(c.placeholder, LIMITS.label) || undefined, options, min, max, ...(bool(c.disabled) ? { disabled: true } : {}) };
    }
    case 'user_select': {
      if (!cid) return null;
      const max = Math.max(1, Math.min(25, Number(c.max) || 1));
      return { type: 'user_select', id: cid, placeholder: str(c.placeholder, LIMITS.label) || undefined, max, ...(bool(c.disabled) ? { disabled: true } : {}) };
    }
    case 'form': {
      if (!cid || !Array.isArray(c.fields)) return null;
      const fields = c.fields
        .slice(0, LIMITS.formFields)
        .map((f): BotFormField | null => {
          const r = (f ?? {}) as Record<string, unknown>;
          const fid = id(r.id);
          const label = str(r.label, LIMITS.label);
          const type = ['text', 'number', 'date', 'choice'].includes(r.type as string) ? (r.type as BotFormField['type']) : null;
          if (!fid || !label || !type) return null;
          const choices =
            type === 'choice' && Array.isArray(r.choices)
              ? r.choices
                  .slice(0, LIMITS.options)
                  .map((ch) => {
                    const x = (ch ?? {}) as Record<string, unknown>;
                    const l = str(x.label, LIMITS.label);
                    const v = str(x.value, 100);
                    return l && v ? { label: l, value: v } : null;
                  })
                  .filter((x): x is { label: string; value: string } => !!x)
              : undefined;
          if (type === 'choice' && !choices?.length) return null;
          const placeholder = str(r.placeholder, LIMITS.label);
          return { id: fid, label, type, ...(bool(r.required) ? { required: true } : {}), ...(placeholder ? { placeholder } : {}), ...(choices ? { choices } : {}) };
        })
        .filter((f): f is BotFormField => !!f);
      if (fields.length === 0) return null;
      const title = str(c.title, LIMITS.title);
      const submitLabel = str(c.submit_label ?? c.submitLabel, LIMITS.label);
      return { type: 'form', id: cid, fields, ...(title ? { title } : {}), ...(submitLabel ? { submitLabel } : {}), ...(bool(c.disabled) ? { disabled: true } : {}) };
    }
  }
  return null;
}

function sanitizeCard(raw: unknown): BotCard | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const title = str(c.title, LIMITS.title);
  const description = str(c.description, LIMITS.description);
  const footer = str(c.footer, LIMITS.label * 2);
  const fields = Array.isArray(c.fields)
    ? c.fields
        .slice(0, LIMITS.cardFields)
        .map((f) => {
          const r = (f ?? {}) as Record<string, unknown>;
          const name = str(r.name, LIMITS.label);
          const value = str(r.value, 1024);
          return name && value ? { name, value, ...(bool(r.inline) ? { inline: true } : {}) } : null;
        })
        .filter((f): f is { name: string; value: string; inline?: boolean } => !!f)
    : [];
  const thumbnail =
    typeof c.thumbnail === 'string' && c.thumbnail.length <= LIMITS.thumbnailChars && DATA_IMAGE.test(c.thumbnail)
      ? c.thumbnail
      : undefined;
  const color = COLORS.includes(c.color as CardColor) ? (c.color as CardColor) : undefined;
  if (!title && !description && fields.length === 0) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(fields.length ? { fields } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(footer ? { footer } : {}),
    ...(color ? { color } : {}),
  };
}

/** What a bot sent, made safe to draw; null when nothing in it is usable. */
export function sanitizeInteractive(raw: unknown): BotInteractive | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const card = sanitizeCard(o.card);
  const seen = new Set<string>();
  // Read a bounded amount, drop what is invalid, then keep the first rows.
  const rows = (Array.isArray(o.components) ? o.components : [])
    .slice(0, LIMITS.rows * 4)
    .map((row) =>
      (Array.isArray(row) ? row : [row])
        .slice(0, LIMITS.perRow)
        .map(sanitizeComponent)
        .filter((c): c is BotComponent => {
          // Ids must be unique, or a click could not say which was clicked.
          if (!c || seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        }),
    )
    // A form or a menu takes its row alone.
    .flatMap((row) => (row.some((c) => c.type !== 'button') ? row.map((c) => [c]) : [row]))
    .filter((row) => row.length > 0)
    .slice(0, LIMITS.rows);
  const expiresAt = typeof o.expires_at === 'string' && !Number.isNaN(Date.parse(o.expires_at)) ? o.expires_at : undefined;
  if (!card && rows.length === 0) return null;
  return { ...(card ? { card } : {}), rows, ...(expiresAt ? { expiresAt } : {}) };
}

/** Whether a body is an interactive bot message. */
export function isInteractiveBody(body: string): boolean {
  return body.startsWith(`{"${TAG}"`);
}

/** The text and the interactive part of a body; anything else is plain text. */
export function decodeBotBody(body: string): { text: string; interactive?: BotInteractive } {
  if (!isInteractiveBody(body)) return { text: body };
  try {
    const o = (JSON.parse(body) as Record<string, unknown>)[TAG] as Record<string, unknown> | undefined;
    if (!o) return { text: body };
    const text = str(o.text, LIMITS.text);
    const interactive = sanitizeInteractive(o);
    return interactive ? { text, interactive } : { text };
  } catch {
    return { text: body };
  }
}

/** Build a body (the SDK's job; here for tests and the dev gallery). */
export function encodeBotBody(text: string, interactive: Record<string, unknown>): string {
  return JSON.stringify({ [TAG]: { text, ...interactive } });
}

/** Whether a message's components may still be used. */
export function isExpired(interactive: BotInteractive, now: Date): boolean {
  return !!interactive.expiresAt && Date.parse(interactive.expiresAt) <= now.getTime();
}

/** What a click sends the bot, inside the pairwise envelope. */
export function interactionPayload(input: {
  messageId: number | string;
  componentId: string;
  values?: string[] | Record<string, string>;
}): string {
  return JSON.stringify({
    v: 1,
    kind: 'interaction',
    message_id: input.messageId,
    component_id: input.componentId,
    ...(input.values ? { values: input.values } : {}),
  });
}
