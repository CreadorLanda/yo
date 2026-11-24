export type StoryPosition = { x: number; y: number };

export type ParsedStoryCaption = {
  displayCaption: string;
  question?: string;
  options?: string[];
  position?: StoryPosition;
  mention?: string;
};

/** Keep interactive elements inside the story's safe canvas. */
export function clampStoryPosition(
  position: StoryPosition,
  bounds: { minX?: number; maxX?: number; minY?: number; maxY?: number } = {},
): StoryPosition {
  const minX = bounds.minX ?? 0.18;
  const maxX = bounds.maxX ?? 0.82;
  const minY = bounds.minY ?? 0.2;
  const maxY = bounds.maxY ?? 0.7;
  return {
    x: Math.min(maxX, Math.max(minX, Number.isFinite(position.x) ? position.x : 0.5)),
    y: Math.min(maxY, Math.max(minY, Number.isFinite(position.y) ? position.y : 0.4)),
  };
}

export function normalizePollOptions(options: readonly string[]): string[] {
  return options.slice(0, 3).map((option) => option.trim());
}

export function pollValidationError(question: string, options: readonly string[]):
  | 'question_required'
  | 'poll_needs_two_options'
  | 'poll_option_required'
  | undefined {
  if (!question.trim()) return 'question_required';
  if (options.length < 2 || options.length > 3) return 'poll_needs_two_options';
  if (options.some((option) => !option.trim())) return 'poll_option_required';
  return undefined;
}

export function buildPollCaption(
  question: string,
  options: readonly string[],
  position: StoryPosition,
  mention?: string,
): string {
  return JSON.stringify({
    q: question.trim(),
    options: normalizePollOptions(options),
    position: clampStoryPosition(position),
    ...(mention?.trim() ? { mention: mention.trim().replace(/^@/, '') } : {}),
  });
}

export function buildQuestionCaption(
  question: string,
  position: StoryPosition,
  mention?: string,
): string {
  return JSON.stringify({
    q: question.trim(),
    position: clampStoryPosition(position),
    ...(mention?.trim() ? { mention: mention.trim().replace(/^@/, '') } : {}),
  });
}

export function buildMentionCaption(text: string, mention: string, position: StoryPosition): string {
  return JSON.stringify({
    v: 1,
    text: text.trim(),
    mention: mention.trim().replace(/^@/, ''),
    position: clampStoryPosition(position),
  });
}

/** Reads current poll captions and older `{q,a,b}` stories. */
export function parseStoryCaption(kind: string, caption: string): ParsedStoryCaption {
  const raw = (caption || '').trim();
  if (!raw.startsWith('{')) return { displayCaption: raw };
  try {
    const value = JSON.parse(raw) as {
      v?: number;
      q?: string;
      a?: string;
      b?: string;
      text?: string;
      options?: unknown;
      mention?: string;
      position?: { x?: unknown; y?: unknown };
    };
    const position =
      typeof value.position?.x === 'number' && typeof value.position?.y === 'number'
        ? clampStoryPosition({ x: value.position.x, y: value.position.y })
        : undefined;
    const mention = typeof value.mention === 'string' ? value.mention.replace(/^@/, '') : undefined;
    const question = typeof value.q === 'string' ? value.q : undefined;
    const options = Array.isArray(value.options)
      ? value.options.filter((option): option is string => typeof option === 'string')
      : [value.a, value.b].filter((option): option is string => typeof option === 'string');

    if (value.v === 1 && typeof value.text === 'string') {
      return { displayCaption: value.text, mention, position };
    }
    if (kind === 'poll' || kind === 'question') {
      return {
        displayCaption: question || raw,
        question,
        ...(kind === 'poll' ? { options } : {}),
        mention,
        position,
      };
    }
  } catch {
    // Malformed historical content stays readable as plain text.
  }
  return { displayCaption: raw };
}
