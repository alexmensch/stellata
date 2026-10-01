/** Text made safe to embed in a `RegExp` source, every metacharacter and backslash included. */

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
