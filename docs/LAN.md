# Reaching an agent over the local network

Can a phone on the same Wi-Fi as an agent connect to it directly, without Tailscale? This note
answers that from the browsers' rules and the agent's own code. Sources were read on 2026-11-10.
Each claim says whether it is **documented** (a cited source), **in the code** (this repository),
**measured** (by this project, see `docs/PWA-HOSTING.md`) or **unmeasured**.

## Verdict: document only, build nothing

A LAN path already works with no code change: a reverse proxy on the agent's host, holding a
publicly trusted certificate for a name that resolves to the host's LAN address, published as one
more `TARFA_PHONE_ADDRESSES` entry ([below](#what-works-today-a-proxy-on-the-agents-host)).
Binding the agent itself to a LAN interface would buy nothing that proxy does not give: the phone
needs `wss://` with a public certificate on a DNS name either way, so the agent would have to take
on certificate issuance and renewal. Plain `ws://` would only work in Chromium. Tailscale connects
peers directly whenever it can ([Tailscale][ts-direct]; documented, not measured here), so the gain
is mostly for phones that run neither Tailscale nor Funnel, or that want more than Funnel's
throughput at home.

Open question: iOS opening `wss://` to a private LAN address from tarfa.app has not been
measured. Apple documents that Safari needs no local network permission, which suggests it works,
but nobody has tried it from a Home Screen app.

## What the browser allows

| | Safari / iOS | Chrome (desktop, Android) | Firefox |
|---|---|---|---|
| `ws://` to a LAN address from an https page | Blocked as mixed content ([WebKit 140624][wk-140624]; loopback still argued in [WebKit 173161][wk-173161]) | Allowed to a private IP literal or `.local` once the LNA permission is granted. A public name resolving to a private IP is still blocked ([Chrome LNA guide][chrome-lna-guide], [intent][chrome-lna-ws]) | No source found |
| Prompt before a public page reaches a private address | None: Safari and WKWebView traffic is exempt from iOS's Local Network privilege ([Apple TN3179][apple-tn3179]); WebKit has given no LNA signal ([intent][chrome-lna-ship]) | Once per site: fetch since Chrome 142, WebSockets from Chrome 147 (not WebView) ([Chrome blog][chrome-lna-blog], [intent][chrome-lna-ws]) | Once per site, on by default from Firefox 151 ([Mozilla][mozilla-lna], [policy][mozilla-lna-policy]); sources disagree on timing |

All documented. Tarfa refuses `ws://` to anything but loopback whatever the browser allows:
`isMachineUrl` (`packages/secure-channel/src/pairing-link.ts`), `tarfa setup --address` and the
PWA's CSP `connect-src` (`packages/pwa/src/core/csp.ts`). In the code. Allowing it would mean
changing all three plus the agent's bind, for Android Chrome alone, so it is not worth it. Android
Chrome already asks this prompt for tailnet addresses (`docs/PWA-HOSTING.md`; measured), and would ask it the
same way for a LAN address.

### `wss://`: which certificate
It must chain to a public CA. A WebSocket's TLS failure shows up only as a failed connection
(close 1006), with no prompt, and a Home Screen app has no address bar to accept an exception from.

| Option | Works? |
|---|---|
| Certificate for a private IP | No. Public CAs may not issue for reserved IPs ([CA/B Forum][cabf-internal]). Let's Encrypt IP certificates (generally available 2026-01-15) validate only by `http-01`/`tls-alpn-01`, so the address must be publicly reachable ([Let's Encrypt][le-ip]). |
| `.local` (mDNS) | No public CA ([CA/B Forum][cabf-internal]). It needs a private CA trusted on every phone. |
| Self-signed | No: fails with no prompt. |
| A public name you own, pointing at the LAN address, certificate by DNS-01 | Yes. This is how Plex's `*.plex.direct` works ([Plex][plex-rebind]). |

**Router rebinding protection can drop that last answer.** Many home resolvers (dnsmasq's
`stop-dns-rebind`, Fritz!Box, Unbound's `private-address`, Pi-hole) refuse a public name that
resolves to a private address ([Plex][plex-rebind], [Pi-hole][pihole-plex]). Fixes: allowlist the
name on the router, or answer it from the LAN's own DNS (split horizon) with no public record, in
which case it does not resolve away from home and the phone moves on at once. A phone using Private
DNS (Android) or iCloud Private Relay may not ask the router at all. Unmeasured.

## What works today: a proxy on the agent's host

Nothing in Tarfa limits where an address points. `TARFA_PHONE_ADDRESSES` takes up to four
`wss://host[:port][/slug]` entries, `tarfa pair` puts them all in the link, and the phone tries them
in order (`docs/CONNECTIONS.md`). In the code. A LAN address is one
more entry. For example, with Caddy (built with a DNS provider module for the DNS-01 challenge) on
the agent's own machine:

```caddy
lan.example.com:8443 {
	bind 192.168.1.20
	tls {
		dns <provider> {env.DNS_API_TOKEN}
	}
	reverse_proxy 127.0.0.1:8797 {
		header_up -Tailscale-Funnel-Request
	}
}
```

```sh
# lan.example.com: an A record to 192.168.1.20 only (public, or from the LAN's DNS), no AAAA
tarfa setup --tailscale funnel --slug me --address wss://lan.example.com:8443
tarfa pair
```

`tarfa setup` puts the address it derives from `--tailscale` first and the `--address` values
after it (`application/setup-machine.ts`). A run with `--address` but no `--tailscale` replaces
`TARFA_PHONE_ADDRESSES` with the `--address` values alone, so name every address you want. In the
code.

**Phones already paired** keep their old addresses until they prove the new link. For a key the
phone already knows, a new link's addresses are taken only after the phone has connected through
one of them (`pairingPlan`, `packages/pwa/src/core/pairing.ts`; in the code). So open the new
`tarfa pair` link on each existing phone while it is on the home Wi-Fi.

Rules that keep this safe (each in the code unless marked):
- **The proxy must run on the agent's host.** The agent binds 127.0.0.1 only and ignores
  `TARFA_HOST` (`infrastructure/config.ts`), so nothing else can reach the phone port.
- **The proxy must set `x-forwarded-for` to the peer it saw.** The agent counts the header's last
  hop from a loopback peer (`clientAddress`, `application/phone-admission.ts`), so overwriting or
  appending are both fine. Never pass a client's value through or trust one: a global
  `trusted_proxies` (set for Cloudflare, say) would let a LAN client name any address. Caddy
  ignores incoming `X-Forwarded-*` and sets its own unless `trusted_proxies` covers the peer
  ([Caddy reverse_proxy][caddy-rp]; documented). Never omit the header either: every client would
  then be one null address, counted only against the total of 32.
- **Bind the proxy to the IPv4 LAN address, and publish an A record only.** IPv6 clients are
  counted by their /64 (and /56), and every device on one home network shares a /64. Behind the
  proxy, all IPv6 LAN clients would count as one address: 8 unauthenticated sockets and 20 new a
  minute. When that cap is full the newcomer is refused, so one hostile IPv6 host on the LAN
  would keep the owner's phone out. Over IPv4 each device has its own address.
- **Handle `Tailscale-Funnel-Request`.** Caddy passes other client headers through unchanged
  ([Caddy reverse_proxy][caddy-rp]; documented), and the agent puts any socket carrying this header
  from a loopback peer in the public pool, whatever its value (`isFunnelRequest`). Either strip it
  (`header_up -Tailscale-Funnel-Request`, as above: LAN sockets share the 32-socket pool with tailnet
  phones), or, when Funnel is unused or the LAN is untrusted, set it on every LAN socket
  (`header_up Tailscale-Funnel-Request lan`). LAN sockets then wait in the public pool of 16 and can
  never evict a tailnet handshake, at the cost of sharing that pool with Funnel phones.
- **Don't forward the port on the router** unless you mean to publish the agent to the internet.
- **Order the addresses on purpose.** On the first connect of an app session the phone tries them
  in order, then starts with the one that last reached `online`. An address that cannot be reached
  fails silently and costs up to `ADDRESS_OPEN_MS` (6 s) before the next one
  (`packages/pwa/src/core/machine-connection.ts`). With split-horizon DNS the LAN name fails at once
  away from home.
- **A private address reused by another network is harmless.** At a café with the same
  `192.168.1.x`, the phone may reach a stranger's host, but IK pins the agent key, so that host can
  neither impersonate the agent nor read anything. The cost is that address's hand-over time.

## Exposure: what someone on the same LAN gains

Whether it comes through a proxy as above or through the agent bound to the LAN, a LAN peer can
open sockets to the phone port. So can any web page a LAN browser loads, subject to the prompts
above: a WebSocket is not bound by the same-origin policy, and the agent checks no `Origin`. That
costs nothing, because authentication is the Noise session, and a non-browser client can forge
`Origin` anyway. What the peer gets (in the code; `docs/CONNECTIONS.md` and
`docs/DEVICE-KEYS.md`):
- **Nothing readable or forgeable.** IK needs the agent's static key, and an unknown device key
  may send `auth` and nothing else. It is enrolled only with a live one-time `tarfa pair` code, and
  only while enrolment is `open`. Passive sniffing sees ciphertext.
- **A bounded nuisance.** Before authentication: 8 sockets per client address, 32 in all (the
  oldest evicted when full), 20 new a minute per address, 8 KiB messages, three `auth`s per socket.
  The roster and pairing-file read limiter is global (4 at once, 10 a minute;
  `application/disk-read-limiter.ts`), so a LAN flood can delay a new phone's pairing, which is
  answered busy and retried, never an enrolled phone's, which is answered from memory.
- **Eviction of tailnet handshakes, unless the LAN is sent to the public pool.** With the funnel
  header stripped, LAN sockets share the pool of 32 with tailnet phones (`Pool`), and a LAN host
  with many IPv4 addresses can keep it full and evict a tailnet phone's handshake before it
  finishes. That is a denial of service, not a way in. Setting the header (above) moves the LAN
  into the public pool instead.

**DNS rebinding.** There are two separate issues. (1) *Availability:* router rebinding protection
dropping the LAN name (above). (2) *Attack:* a hostile page rebinds its own name to the agent's
address. That gains nothing a direct WebSocket does not already give it, and the hooks port, the
only one with bearer-token routes, stays on loopback and is never proxied (`docs/AGENT-RUNTIME.md`).

## Sources (read 2026-11-10)
- [chrome-lna-guide]: Chrome, "Local Network Access" developer guide (undated).
- [chrome-lna-blog]: Chrome blog, "New permission prompt for Local Network Access", 2025-06-09, updated 2025-09-29 (Chrome 142).
- [chrome-lna-ws]: blink-dev, "Intent to Ship: Local network access restrictions for WebSockets", 2026-02-19 (Chrome 147, desktop and Android).
- [chrome-lna-ship]: blink-dev, "Intent to Ship: Local network access restrictions" (WebKit: no signal).
- [apple-tn3179]: Apple, TN3179 "Understanding local network privacy", revised 2026-10-06.
- [wk-140624]: WebKit bug 140624, insecure WebSockets from https pages (fixed 2015).
- [wk-173161]: WebKit bug 173161, requests to localhost from https pages (a duplicate of 171934).
- [mozilla-lna]: Mozilla support, "Control personal device and local network permissions in Firefox" (rollout from Firefox 151).
- [mozilla-lna-policy]: Firefox enterprise policy `LocalNetworkAccess` (Firefox 150).
- [le-ip]: Let's Encrypt, "We've Issued Our First IP Address Certificate", 2025-07-01, updated 2026-01-15.
- [cabf-internal]: CA/Browser Forum, internal names and reserved IP addresses.
- [plex-rebind]: Plex forums, "Adding plex.direct to DNS rebinding protection whitelist".
- [pihole-plex]: Pi-hole discourse, "Add plex.direct to DNS rebinding".
- [caddy-rp]: Caddy docs, `reverse_proxy` headers and `trusted_proxies`.
- [ts-direct]: Tailscale, "Connection types" (validated 2026-06-01).

[chrome-lna-guide]: https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access
[chrome-lna-blog]: https://developer.chrome.com/blog/local-network-access
[chrome-lna-ws]: https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups
[chrome-lna-ship]: https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY
[apple-tn3179]: https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
[wk-140624]: https://bugs.webkit.org/show_bug.cgi?id=140624
[wk-173161]: https://bugs.webkit.org/show_bug.cgi?id=173161
[mozilla-lna]: https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox
[mozilla-lna-policy]: https://firefox-admin-docs.mozilla.org/reference/policies/localnetworkaccess/
[le-ip]: https://letsencrypt.org/2025/07/01/issuing-our-first-ip-address-certificate.html
[cabf-internal]: https://cabforum.org/working-groups/server/internal-names
[plex-rebind]: https://forums.plex.tv/t/adding-plex-direct-to-dns-rebinding-protection-whitelist/754355
[pihole-plex]: https://discourse.pi-hole.net/t/add-plex-direct-to-dns-rebinding/74780
[caddy-rp]: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
[ts-direct]: https://tailscale.com/kb/1257/connection-types
