import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(join(__dirname, '../../../.github/workflows/release.yml'), 'utf8');
const code = workflow
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

describe('release workflow', () => {
  it('runs on version tags only', () => {
    expect(code).toMatch(/on:\s+push:\s+tags: \['v\*'\]/);
    expect(code).not.toMatch(/pull_request|branches:/);
  });

  it('authenticates with OIDC and holds no registry token', () => {
    expect(code).toMatch(/id-token: write/);
    expect(code).toMatch(/contents: read/);
    expect(code).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  });

  it('only stages: nothing can go live without the maintainer approving it', () => {
    expect(code).not.toMatch(/npm publish/);
    expect(code).toMatch(/npm stage publish "\$RUNNER_TEMP"\/tarball\/\*\.tgz --access public --provenance/);
  });

  it('pins npm to a version that has `stage`', () => {
    expect(code).toMatch(/npm install -g npm@\d+\.\d+\.\d+\n/);
  });

  it('pins every action by full commit SHA', () => {
    const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/);
  });
});
