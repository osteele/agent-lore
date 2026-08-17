/**
 * Canonicalize a talk topic: the note path with `.md` implied. Accepts the
 * note path with or without `.md`, and the talk page's own path, so
 * "weft/inputs", "weft/inputs.md", "weft/inputs.talk", and
 * "weft/inputs.talk.md" all name the same topic.
 */
export function normalizeTalkTopic(topic: string): string {
  let t = topic;
  if (t.endsWith(".md")) t = t.slice(0, -".md".length);
  if (t.endsWith(".talk")) t = t.slice(0, -".talk".length);
  return t;
}

/**
 * Return the H1 header for a newly-created talk page for `topic`.
 * `topic` is the note path without `.md`.
 */
export function formatTalkPage(topic: string): string {
  return `# Talk: ${topic}\n`;
}

/**
 * Return a signed talk entry ready to append to a talk page.
 */
export function formatTalkEntry(
  topic: string,
  sessionName: string,
  timestamp: string,
  message: string,
): string {
  const heading = `## ${timestamp} — [[sessions/${sessionName}]]`;
  const body = message.trimEnd();
  return `\n${heading}\n\n${body}\n`;
}
