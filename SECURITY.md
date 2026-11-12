# Security policy

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on
[abumalick/tarfa](https://github.com/abumalick/tarfa/security/advisories/new). Do not open a public
issue, pull request or discussion about it.

Include what an attacker can do, what they need first (a paired phone, a pairing code, access to
the machine, a position on the network), and the steps to reproduce it, with the versions of the
`@tarfa/cli` agent (`tarfa --version`) and of the app (its build id is in
`https://tarfa.app/version.json`).

Tarfa is maintained by one person in their spare time. You should get an answer within a week.
A confirmed flaw is fixed in the agent's next release and on tarfa.app, and published as a GitHub
security advisory once fixed, crediting you unless you prefer otherwise.

## Supported versions

Only the latest release of `@tarfa/cli` and the app currently served at tarfa.app get fixes.
Update the agent with `tarfa update`.

## Scope

In scope: the agent (`@tarfa/cli`), the app at tarfa.app, and the code in this repository.

Not a vulnerability, by design (see the Security section of the README):

- A paired device can run any command on the machine, as the user the agent runs as.
- Whoever serves the app can read what it shows and the device keys it holds. tarfa.app is served
  by the maintainer; you can serve your own copy instead.
- Anything that needs the agent's own Linux or macOS user account: one user's processes can reach
  each other.

Not covered: copies of the app served by someone else, and machines whose operators changed the
code or the configuration Tarfa sets up.
