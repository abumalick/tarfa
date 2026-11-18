// What a workspace may ask the phone to open (BROWSER → tarfa-open.sh → the agent → a card).
// Any program in a workspace can ask, and the phone puts the string in a link it opens, so only
// a plain web page passes: `javascript:` or `data:` would run beside the device key, and a
// username (`https://claude.ai@evil.example/`) would make the card show the wrong host.
export const MAX_OPENABLE_URL_LENGTH = 8192;

export function isOpenableUrl(url: string): boolean {
  if (url.length === 0 || url.length > MAX_OPENABLE_URL_LENGTH) return false;
  if (/[\s\p{Cc}]/u.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.username === '' && parsed.password === '';
}
