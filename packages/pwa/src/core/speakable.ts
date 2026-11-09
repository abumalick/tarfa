// A reply's text as the chunks the phone's voice reads, one utterance each: every sentence of
// the content, with the markdown syntax around it dropped. Short utterances are what let the
// player pause and skip (it can only restart at a chunk) and keep iOS from cutting a long one.
export const MAX_CHUNK_CHARS = 300;

function speakableLine(line: string): string | null {
  const trimmed = line.trim();
  if (/^(```|~~~)/.test(trimmed)) return null;
  if (/^([-*_]\s*){3,}$/.test(trimmed)) return null;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(trimmed)) return null;
  let text = trimmed
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '');
  if (text.startsWith('|')) {
    text = text
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
      .join(', ');
  }
  return text.trim() || null;
}

function cut(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];
  const chunks: string[] = [];
  let current = '';
  for (const word of sentence.split(' ')) {
    if (current && current.length + 1 + word.length > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function speakableChunks(text: string): string[] {
  return text
    .split('\n')
    .map(speakableLine)
    .filter((line): line is string => line !== null)
    .flatMap((line) => line.replace(/([.!?])\s+/g, '$1\n').split('\n'))
    .flatMap(cut);
}
