// The terms of use and privacy notice, emitted at build as static pages (vite.config.ts) and
// served at /terms and /privacy. Who operates a copy, how to reach them and which law governs
// are facts of whoever deploys it, so they come from the build's environment, never the repo:
// a self-hoster's copy names its own operator, and a build with none says so.
// The text stays English only: one authoritative wording, nothing to keep in sync.

export type Operator = { name: string; email: string; law: string };
export type LegalPage = 'terms' | 'privacy';

export const LEGAL_UPDATED = '12 November 2026';
export const LEGAL_FILES: Record<LegalPage, string> = { terms: 'terms.html', privacy: 'privacy.html' };
export const LEGAL_PATHS: Record<LegalPage, string> = { terms: '/terms', privacy: '/privacy' };
export const SOURCE_URL = 'https://github.com/abumalick/tarfa';

const OPERATOR_VARS = ['TARFA_OPERATOR_NAME', 'TARFA_OPERATOR_EMAIL', 'TARFA_OPERATOR_LAW'] as const;

// All three or none: a page naming an operator nobody can write to, or no governing law, is worse
// than one that names none.
export function readOperator(env: Record<string, string | undefined>): Operator | null {
  const [name, email, law] = OPERATOR_VARS.map((key) => env[key]?.trim() ?? '') as [string, string, string];
  if (!name && !email && !law) return null;
  const missing = OPERATOR_VARS.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`set all of ${OPERATOR_VARS.join(', ')} or none (missing ${missing.join(', ')})`);
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) throw new Error(`TARFA_OPERATOR_EMAIL is not an email address: ${email}`);
  return { name, email, law };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function contact(op: Operator): string {
  const email = escapeHtml(op.email);
  return `<a href="mailto:${email}">${email}</a>`;
}

function operatorLine(op: Operator | null): string {
  return op
    ? `<p>This copy of the app is operated by ${escapeHtml(op.name)} (“we”, “us”). Contact: ${contact(op)}.</p>`
    : '<p class="note">This copy of the app does not name its operator. Contact whoever gave you its address.</p>';
}

function terms(op: Operator | null): string {
  const law = op
    ? `<p>These terms are governed by the laws of ${escapeHtml(op.law)}, whose courts have jurisdiction over any dispute about them. This does not take away any protection that the mandatory law of your country of residence gives you.</p>`
    : '<p>The operator of this copy has not stated which law governs these terms.</p>';
  return `
<h1>Terms of use</h1>
<p class="updated">Last updated ${LEGAL_UPDATED}</p>
<p>These terms apply to the Tarfa web app served at this address (“the app”) and to the Tarfa software. By using the app you accept them. If you do not accept them, do not use the app.</p>
${operatorLine(op)}

<h2>1. What Tarfa is</h2>
<p>Tarfa is a free, open-source app for viewing and controlling terminal sessions on computers you run, from your phone. The app connects directly to the Tarfa agent you install on your own machines. We do not run those machines, and we cannot see the traffic between them and your device.</p>

<h2>2. Open source</h2>
<p>The source code is published under the MIT License at <a href="${SOURCE_URL}">${SOURCE_URL.replace('https://', '')}</a>. You may serve your own copy of the app instead of using this one.</p>

<h2>3. Your responsibilities</h2>
<p>A device paired with a machine can run any command on that machine, as the user the agent runs as. You are responsible for:</p>
<ul>
  <li>the machines you install the agent on, and how you make them reachable;</li>
  <li>who you give pairing codes to and which devices you pair, and revoking a device you lose (<code>tarfa devices revoke</code>);</li>
  <li>keeping your devices and accounts secure;</li>
  <li>the API keys you configure, and what third-party services charge for their use;</li>
  <li>complying with the law and with the terms of every service you use through Tarfa.</li>
</ul>

<h2>4. No warranty</h2>
<p>The app and the software are provided free of charge, “as is” and “as available”, without warranty of any kind, express or implied, including any warranty of security, availability, fitness for a particular purpose or non-infringement. We do not promise that they are free of errors or vulnerabilities, or that the app will remain available.</p>

<h2>5. Limitation of liability</h2>
<p>To the fullest extent permitted by applicable law, we are not liable for any loss or damage arising from the use of, or inability to use, the app or the software, whether direct or indirect, including unauthorised access to your machines or devices, loss of data, loss of profit, or charges from third-party services. Nothing in these terms limits liability that applicable law does not allow to be limited, such as liability for fraud or wilful misconduct.</p>

<h2>6. Third-party services</h2>
<p>Tarfa works with services we do not control, such as Cloudflare (which hosts this app), Tailscale, ElevenLabs, OpenRouter, Claude Code and Codex. Their own terms and privacy policies govern your use of them.</p>

<h2>7. Acceptable use</h2>
<p>Do not use the app to break the law, to reach machines you are not authorised to use, or to attack, overload or disrupt the app or its host.</p>

<h2>8. Changes</h2>
<p>We may change the app or these terms, or stop serving the app, at any time. Changes take effect when they are published here with a new date above. Using the app after a change means you accept it.</p>

<h2>9. Governing law</h2>
${law}

<h2>10. Privacy</h2>
<p>How this app handles data is described in the <a href="${LEGAL_PATHS.privacy}">privacy notice</a>.</p>
`;
}

function privacy(op: Operator | null): string {
  const controller = op
    ? `<p>${escapeHtml(op.name)} is responsible for the processing described here (the “controller”) and can be reached at ${contact(op)}.</p>`
    : '<p class="note">This copy of the app does not name who is responsible for it. Contact whoever gave you its address.</p>';
  const write = op ? `write to ${contact(op)}. We answer within 30 days.` : 'contact the operator of this copy.';
  return `
<h1>Privacy notice</h1>
<p class="updated">Last updated ${LEGAL_UPDATED}</p>
${controller}
<p><strong>In short:</strong> the app has no accounts, no cookies, no analytics and no advertising. We keep no data about you on a server. What you enter stays on your device and goes only to the machines you pair it with, and to the dictation or read-aloud provider you choose (section 4).</p>

<h2>1. What the host processes</h2>
<p>The app is a set of static files served by Cloudflare. To deliver them and protect the site, Cloudflare processes technical data about each request: your IP address, the address requested, your browser’s user agent and the time. Your browser may also send Cloudflare network error reports, which carry no content. We do not use this data to identify you or to build a profile. Cloudflare may process it outside your country, including in the United States, under its <a href="https://www.cloudflare.com/privacypolicy/">privacy policy</a>.</p>

<h2>2. What stays on your device</h2>
<p>The app keeps in your browser’s storage, on this device only: the machines you paired (their names, addresses and public keys), this device’s own keys, your settings, a log of connection events, and files shared to the app until you attach them. None of it is sent to us.</p>

<h2>3. What goes to your machines</h2>
<p>What you do in the app (terminal input and output, files you open or send, dictation audio for Claude voice, the connection log) travels end-to-end encrypted, directly between your device and the Tarfa agent on the machines you paired. Those machines are run by you, or by whoever gave you the pairing code, and that person is responsible for the data on them, not us. Whatever makes a machine reachable (Tailscale, including its public Funnel relay, or another proxy its operator chose) carries the encrypted connection and sees your IP address and connection times, not the content.</p>

<h2>4. Services you choose</h2>
<p>If you use dictation or read-aloud through ElevenLabs or OpenRouter, your device sends the audio or text directly to that provider, with the API key stored on your machine, and fetches voice samples from the addresses the provider names. We do not receive any of it. The provider’s privacy policy applies.</p>

<h2>5. The Tarfa agent</h2>
<p>The agent you install on your machines sends nothing to us. It contacts other services only for features you use: GitHub, to link your projects’ repositories, and the npm registry, when you run <code>tarfa update</code>.</p>

<h2>6. Why the data is processed</h2>
<p>The processing in section 1 is necessary to deliver the app you ask for, and serves our legitimate interest in keeping it secure and available.</p>

<h2>7. How long it is kept</h2>
<p>We store nothing. Cloudflare keeps its request logs for a limited time under its own policy. The data on your device stays until you remove a machine or clear the app’s storage; clearing it also deletes this device’s keys, and you will have to pair your machines again.</p>

<h2>8. Your rights</h2>
<p>Depending on where you live, for example under Saudi Arabia’s Personal Data Protection Law or the EU’s General Data Protection Regulation, you may have the right to be informed about, access, correct or delete your personal data, to object to its processing, and to complain to your data protection authority. To exercise them, or for any question, ${write}</p>

<h2>9. Children</h2>
<p>The app is not directed at children.</p>

<h2>10. Changes</h2>
<p>We may update this notice. Changes take effect when they are published here with a new date above.</p>

<p>See also the <a href="${LEGAL_PATHS.terms}">terms of use</a>.</p>
`;
}

const TITLES: Record<LegalPage, string> = { terms: 'Terms of use', privacy: 'Privacy notice' };

// No script: this origin holds every phone's device keys. The inline style is allowed by the CSP.
export function renderLegalPage(page: LegalPage, op: Operator | null): string {
  const body = page === 'terms' ? terms(op) : privacy(op);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tarfa · ${TITLES[page]}</title>
<style>
  :root { color-scheme: light dark; --bg: #ffffff; --text: #1b1b1b; --muted: #5d5d5d; --link: #0b62c4; --code: #f0f0f0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111111; --text: #e8e8e8; --muted: #a3a3a3; --link: #6cb4ff; --code: #222222; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 -apple-system, system-ui, sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: max(1rem, env(safe-area-inset-top)) 16px 3rem; }
  a { color: var(--link); }
  .back { display: inline-block; padding: 0.6rem 0; min-height: 44px; box-sizing: border-box; }
  h1 { font-size: 1.6rem; margin: 0.5rem 0 0.25rem; }
  h2 { font-size: 1.05rem; margin: 1.6rem 0 0.4rem; }
  .updated, .note { color: var(--muted); }
  code { background: var(--code); padding: 0.05rem 0.3rem; border-radius: 4px; font-size: 0.9em; }
  ul { padding-left: 1.3rem; }
</style>
</head>
<body>
<main>
<a class="back" href="/">‹ Back to Tarfa</a>
${body.trim()}
</main>
</body>
</html>
`;
}
