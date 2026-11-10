# Reaching an agent over the local network

Can a phone on the same Wi-Fi as an agent connect to it directly, without Tailscale? This note
answers that from the browsers' rules and the agent's own code. Sources were read on 2026-11-10.
Each claim says whether it is **documented** (a cited source), **in the code** (this repository),
**measured** (by this project, see CLAUDE.md) or **unmeasured**.

## Verdict: document only, build nothing

A LAN path already works with no code change: a reverse proxy on the agent's host, holding a
publicly trusted certificate for a name that resolves to the host's LAN address, published as one
more `TARFA_PHONE_ADDRESSES` entry ([below](#what-works-today-a-proxy-on-the-agents-host)).
Binding the agent itself to a LAN interface would buy nothing that proxy does not give: the phone
needs `wss://` with a public certificate on a DNS name either way, so the agent would have to take
on certificate issuance and renewal. Plain `ws://` would only work in Chromium. With Tailscale on,
the phone already takes a direct path across the LAN, so the gain is limited to phones that run
neither Tailscale nor Funnel, or that want more than Funnel's throughput at home.

Open question: iOS opening `wss://` to a private LAN address from tarfa.app has not been
measured. Apple documents that Safari needs no local network permission, which suggests it works,
but nobody has tried it from a Home Screen app.

## What the browser allows

### Mixed content: `ws://` from an https page
- **Safari / WebKit:** an https page may not open `ws://`. WebKit treats a WebSocket as active
  mixed content ([WebKit bug 140624][wk-140624]), and loopback exemptions were still being argued
  in [bug 171934][wk-171934]. Documented.
- **Chrome:** since Local Network Access (below), `ws://` to a **private IP literal or a `.local`
  name** is exempt from mixed content once the user grants the local-network permission. A public
  name that resolves to a private address is not exempt, because mixed content is checked before DNS
  ([Chrome LNA guide][chrome-lna-guide], [WebSocket intent to ship][chrome-lna-ws]). Documented.
- **Firefox:** no source found on whether its Local Network Access relaxes mixed content.
- **Tarfa itself refuses `ws://` to anything but loopback** regardless of the browser: pairing
  links and stored addresses go through `isMachineUrl` (`packages/secure-channel/src/pairing-link.ts`),
  `tarfa setup --address` takes `wss://` only, and the PWA's CSP `connect-src` allows `wss:` plus
  `ws://127.0.0.1:*`/`ws://localhost:*` (`packages/pwa/src/core/csp.ts`). In the code.

So `ws://` would mean changing the link format, the CSP and the agent's bind, all for Android Chrome
alone. The Noise session would keep such a socket confidential, but iOS is the main client and
WebKit blocks it. Not worth it.

### `wss://`: which certificate
The certificate must chain to a public CA. A WebSocket's TLS failure is reported only as a failed
connection (close 1006), with no certificate prompt. That is especially so in a Home Screen app,
which has no address bar to accept an exception from.

| Option | Works? |
|---|---|
| Certificate for a private IP (`192.168.x.x`) | No. Public CAs may not issue for reserved IPs ([CA/B Forum][cabf-internal]). Let's Encrypt's IP certificates (generally available since 2026-01-15) validate only by `http-01`/`tls-alpn-01`, so the address must be reachable publicly ([Let's Encrypt][le-ip]). |
| `.local` (mDNS) name | No public CA issues for it ([CA/B Forum][cabf-internal]). It needs a private CA installed and trusted on every phone. Possible, but heavy for each owner. |
| Self-signed | No. Fails with no prompt (see above). |
| A public DNS name you own, with an A/AAAA record pointing at the LAN address, and a certificate issued by DNS-01 | Yes. This is how Plex's `*.plex.direct` works ([Plex forums][plex-rebind]). It needs a domain whose DNS the operator can automate. |

**Router rebinding protection can drop that last answer.** Many home resolvers (dnsmasq's
`stop-dns-rebind`, Fritz!Box, Unbound's `private-address`, Pi-hole) refuse a public name that
resolves to a private address, which is the usual "Plex works remotely but not at home" report
([Plex forums][plex-rebind], [Pi-hole][pihole-plex]). Fixes: allowlist the name on the router, or
answer it from the LAN's own DNS (split horizon) and keep no public record. With split horizon, the
name does not resolve away from home, so the phone fails fast and moves to its next address. A phone
with Private DNS (Android) or iCloud Private Relay may not ask the router at all. Unmeasured.

### Local network permission prompts
- **Chrome (desktop and Android, not WebView):** Local Network Access asks once per site before a
  public page reaches a private or `.local` address. Fetch has been gated since Chrome 142, and
  WebSockets from Chrome 147 ([Chrome LNA blog][chrome-lna-blog], [WebSocket intent to
  ship][chrome-lna-ws]). Documented. Tarfa already lives with this prompt for tailnet addresses
  (CLAUDE.md, "Android Chrome asks once"), and it would ask the same way for a LAN address.
  Measured for the tailnet only.
- **Safari / iOS:** iOS's Local Network privilege does not apply to traffic from Safari, WKWebView
  or SFSafariViewController ([Apple TN3179][apple-tn3179]), so a web page gets no prompt.
  Documented. WebKit has given no signal on the LNA spec ([LNA intent to ship][chrome-lna-ship]).
  A Home Screen app was not tested.
- **Firefox:** Local Network Access restrictions with a per-site prompt are on by default, rolling
  out from Firefox 151 ([Mozilla support][mozilla-lna], [enterprise policy][mozilla-lna-policy]).
  The sources disagree on the exact release timing.

## What works today: a proxy on the agent's host

Nothing in Tarfa limits where an address points. `TARFA_PHONE_ADDRESSES` takes up to four
`wss://host[:port][/slug]` entries, `tarfa pair` puts them all in the link, and the phone tries them
in order (CLAUDE.md, "The PWA connects to each agent directly"). In the code. A LAN address is one
more entry. For example, with Caddy (built with a DNS provider module for the DNS-01 challenge) on
the agent's own machine:

```caddy
lan.example.com:8443 {
	tls {
		dns <provider> {env.DNS_API_TOKEN}
	}
	reverse_proxy 127.0.0.1:8797 {
		header_up -Tailscale-Funnel-Request
	}
}
```

```sh
# lan.example.com -> 192.168.1.20 (a public record, or the LAN's DNS only)
tarfa setup --address wss://lan.example.com:8443 --address wss://<node>.<tailnet>.ts.net:10000/me
tarfa pair
```

Rules that keep this safe:
- **The proxy must run on the agent's host.** The agent binds 127.0.0.1 only and ignores
  `TARFA_HOST` (`infrastructure/config.ts`), so nothing else can reach the phone port. In the code.
- **The proxy must overwrite `x-forwarded-for`, not pass the client's through.** The agent believes
  that header's last hop from a loopback peer (`clientAddress`, `application/phone-admission.ts`).
  Caddy ignores incoming `X-Forwarded-*` and sets its own unless `trusted_proxies` is configured
  ([Caddy reverse_proxy][caddy-rp]). Documented. Another proxy needs the same behaviour, or the
  per-address caps count whatever a client claims.
- **Strip `Tailscale-Funnel-Request`.** Caddy passes other client headers through unchanged
  ([Caddy reverse_proxy][caddy-rp]), and the agent believes this one from a loopback peer
  (`isFunnelRequest`). A LAN client sending it would land in the public pool, which harms only
  Funnel handshakes, but there is no reason to allow it.
- **Don't forward the port on the router** unless you mean to publish the agent to the internet;
  that is Funnel's exposure without Funnel's separate pool.
- **Order the addresses on purpose.** On the first connect of an app session the phone tries the
  addresses in order, then starts with the one that last reached `online`. A LAN address that
  cannot be reached fails silently and costs up to `ADDRESS_OPEN_MS` (6 s) before the next one is
  tried (`packages/pwa/src/core/machine-connection.ts`). With split-horizon DNS it fails at once
  away from home. Listed after a tailnet address, it is used only when the tailnet one fails.
- **A private address reused by another network is harmless.** At a café using the same
  `192.168.1.x`, the phone may reach a stranger's host, but IK pins the agent key, so that host
  can neither impersonate the agent nor read anything (`wrong agent key` or a failed handshake). In
  the code. The cost is that address's hand-over time.

## Exposure: what someone on the same LAN gains

Whether it comes through a proxy as above or through the agent bound to the LAN, a LAN peer can
open sockets to the phone port. The same holds for any web page a LAN browser loads: a WebSocket
is not bound by the same-origin policy, and the agent checks no `Origin`. That costs nothing,
because authentication is the Noise session, and a non-browser client can forge `Origin` anyway.
What the peer gets (in the code; see CLAUDE.md, "The phone port" and "Device keys, enrolment and
pairing"):
- **Nothing readable or forgeable.** IK needs the agent's static key, and an unknown device key
  may send `auth` and nothing else. It is enrolled only with a live one-time `tarfa pair` code, and
  only while enrolment is `open`. Passive sniffing sees ciphertext.
- **A bounded nuisance.** Before authentication: 8 sockets per client address, 32 in all, 20 new a
  minute per address, 8 KiB messages, three `auth`s per socket, and limited roster and pairing-file
  reads. When full, the oldest socket is evicted, never the newcomer.
- **A weaker point than Funnel's.** Proxied LAN sockets share the non-Funnel pool with tailnet
  phones (`Pool`, `phone-admission.ts`). A LAN host with many IPv4 addresses can keep that pool
  full and evict a tailnet phone's handshake before it finishes. That is a denial of service, not a
  way in, and an IPv6 host is counted by its /64 and /56. A dedicated `lan` pool would fix it if
  this is ever used widely. Not built.

**DNS rebinding.** There are two separate issues. (1) *Availability:* router rebinding protection
dropping the LAN name (above). (2) *Attack:* a hostile page rebinds its own name to the agent's
address. That gains nothing a direct WebSocket does not already give it, and the hooks port, the
only one with bearer-token routes, stays on loopback and is never proxied (CLAUDE.md, "The phone
port"). Chrome's and Firefox's local-network prompts now stand in front of both cases for a public
page.

## Sources (read 2026-11-10)
- [chrome-lna-guide]: Chrome, "Local Network Access" developer guide (undated). https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access
- [chrome-lna-blog]: Chrome blog, "New permission prompt for Local Network Access", 2025-06-09, updated 2025-09-29 (Chrome 142). https://developer.chrome.com/blog/local-network-access
- [chrome-lna-ws]: blink-dev, "Intent to Ship: Local network access restrictions for WebSockets", 2026-02-19 (Chrome 147, desktop and Android). https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups
- [chrome-lna-ship]: blink-dev, "Intent to Ship: Local network access restrictions" (WebKit: no signal). https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY
- [apple-tn3179]: Apple, TN3179 "Understanding local network privacy", revised 2026-10-06. https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
- [wk-140624]: WebKit bug 140624, insecure WebSockets from https pages (fixed 2015). https://bugs.webkit.org/show_bug.cgi?id=140624
- [wk-171934]: WebKit bug 171934, loopback and mixed content (via duplicate 173161). https://bugs.webkit.org/show_bug.cgi?id=173161
- [mozilla-lna]: Mozilla support, "Control personal device and local network permissions in Firefox" (rollout from Firefox 151). https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox
- [mozilla-lna-policy]: Firefox enterprise policy `LocalNetworkAccess` (Firefox 150). https://firefox-admin-docs.mozilla.org/reference/policies/localnetworkaccess/
- [le-ip]: Let's Encrypt, "We've Issued Our First IP Address Certificate", 2025-07-01, updated 2026-01-15. https://letsencrypt.org/2025/07/01/issuing-our-first-ip-address-certificate.html
- [cabf-internal]: CA/Browser Forum, internal names and reserved IP addresses. https://cabforum.org/working-groups/server/internal-names
- [plex-rebind]: Plex forums, "Adding plex.direct to DNS rebinding protection whitelist". https://forums.plex.tv/t/adding-plex-direct-to-dns-rebinding-protection-whitelist/754355
- [pihole-plex]: Pi-hole discourse, "Add plex.direct to DNS rebinding". https://discourse.pi-hole.net/t/add-plex-direct-to-dns-rebinding/74780
- [caddy-rp]: Caddy docs, `reverse_proxy` headers and `trusted_proxies`. https://caddyserver.com/docs/caddyfile/directives/reverse_proxy

[chrome-lna-guide]: https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access
[chrome-lna-blog]: https://developer.chrome.com/blog/local-network-access
[chrome-lna-ws]: https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups
[chrome-lna-ship]: https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY
[apple-tn3179]: https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
[wk-140624]: https://bugs.webkit.org/show_bug.cgi?id=140624
[wk-171934]: https://bugs.webkit.org/show_bug.cgi?id=173161
[mozilla-lna]: https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox
[mozilla-lna-policy]: https://firefox-admin-docs.mozilla.org/reference/policies/localnetworkaccess/
[le-ip]: https://letsencrypt.org/2025/07/01/issuing-our-first-ip-address-certificate.html
[cabf-internal]: https://cabforum.org/working-groups/server/internal-names
[plex-rebind]: https://forums.plex.tv/t/adding-plex-direct-to-dns-rebinding-protection-whitelist/754355
[pihole-plex]: https://discourse.pi-hole.net/t/add-plex-direct-to-dns-rebinding/74780
[caddy-rp]: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
