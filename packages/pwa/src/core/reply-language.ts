// The language a reply is written in, for the voice that reads it: a French voice reading English
// (or the reverse) is barely understandable, and Claude often answers in another language than
// the app's. Arabic is told by its script, English from French by their commonest words; anything
// else, or a reply with too few words to tell, keeps the fallback.
const ENGLISH = new Set(['the', 'and', 'is', 'are', 'to', 'of', 'it', 'that', 'this', 'with', 'for', 'was', 'be', 'not', 'you', 'on', 'in']);
const FRENCH = new Set(['le', 'la', 'les', 'et', 'est', 'sont', 'des', 'du', 'de', 'un', 'une', 'que', 'qui', 'pour', 'pas', 'dans', 'il', 'ne', 'à', 'avec']);

export function replyLanguage(text: string, fallback: string): string {
  const sample = text.slice(0, 2000);
  const arabic = sample.match(/[؀-ۿ]/g)?.length ?? 0;
  const latin = sample.match(/[a-zà-ÿ]/gi)?.length ?? 0;
  if (arabic > latin) return 'ar';
  let en = 0;
  let fr = 0;
  for (const word of sample.toLowerCase().match(/[a-zà-ÿ]+/g) ?? []) {
    if (ENGLISH.has(word)) en++;
    if (FRENCH.has(word)) fr++;
  }
  if (en + fr < 2 || en === fr) return fallback;
  return en > fr ? 'en' : 'fr';
}
