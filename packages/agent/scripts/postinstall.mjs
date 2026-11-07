import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// node-pty's prebuilt spawn-helper (macOS) can lose its executable bit in a tarball, and the
// first terminal then fails to start. Linux compiles node-pty and has no prebuilds. Never fails
// an install: a missing helper only shows when a terminal is opened.
try {
  const prebuilds = join(dirname(createRequire(import.meta.url).resolve('node-pty/package.json')), 'prebuilds');
  if (existsSync(prebuilds)) {
    for (const platform of readdirSync(prebuilds)) {
      const helper = join(prebuilds, platform, 'spawn-helper');
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  }
} catch {}
