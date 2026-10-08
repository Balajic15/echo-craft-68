export type VisualSource = "camera" | "screen" | null;

const SCREEN = [
  /\b(my|the|this) screen\b/,
  /\bshare (my )?screen\b/,
  /\b(on|in) (my|the) (screen|display|monitor)\b/,
  /\blook at (my|the) (screen|display|monitor)\b/,
  /\b(this|the) (page|website|tab|window|document|code|error|email|slide)\b.*\b(see|look|read|check|explain|wrong)\b/,
  /\b(look|see|read|check) (at )?(my|the|this) (page|tab|window|code|error)\b/,
];

const CAMERA = [
  /\bwhat('?s| is| are) (this|that|these|those)\b(?!\s+(word|term|concept|mean|inheritance|difference))/,
  /\bwhat (object|thing|plant|animal|brand|food) am i (looking at|holding|seeing)\b/,
  /\bwhat am i (looking at|holding|seeing|wearing)\b/,
  /\bwhat('?s| is) in front of me\b/,
  /\b(describe|identify|recognize|read) (this|that|these|the view|what)\b/,
  /\bwhat colou?r is\b/,
  /\bwhat (object|thing|plant|animal|brand|food)s? (is|are) (this|that|these)\b/,
  /\b(can|do) you see\b/,
  /\blook at (this|that|these|me)\b/,
  /\bhow (do i|does) (this|it) look\b/,
  /\bhow many .* (here|in front of me|do you see)\b/,
  /\bcamera\b/,
];

const STOP = [/\b(turn off|close|stop|hide) (the )?(camera|screen ?share|sharing)\b/, /\bstop looking\b/];
const FOLLOW_UP = [/\b(it|that|this one|the (left|right|other) one|what about|and now|now)\b/];

export function isVisualFollowUp(text: string): boolean {
  const t = text.toLowerCase().trim();
  return t.split(/\s+/).length <= 12 && FOLLOW_UP.some((r) => r.test(t));
}

/**
 * Decide which visual source a message needs.
 * `current` keeps vision on for short follow-ups that reference what is visible.
 */
export function detectVisualIntent(text: string, current: VisualSource): VisualSource | "stop" {
  const t = text.toLowerCase().trim();
  if (STOP.some((r) => r.test(t))) return "stop";
  if (SCREEN.some((r) => r.test(t))) return "screen";
  if (CAMERA.some((r) => r.test(t))) return "camera";
  if (current && isVisualFollowUp(t)) return current;
  return null;
}
