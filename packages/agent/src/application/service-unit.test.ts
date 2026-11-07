import { describe, expect, it } from 'vitest';
import { cloneOfUnit, renderService } from './service-unit';

const SYSTEMD = '[Service]\nExecStart=AGENT_COMMAND\nKillMode=process\n';
const LAUNCHD = '<array>\n    AGENT_ARGUMENTS\n</array>\n<string>LOG_DIR</string>';

describe('cloneOfUnit', () => {
  it('reads the checkout from every form unitRunsCheckout accepts', () => {
    expect(cloneOfUnit('systemd', renderService(SYSTEMD, { kind: 'clone', repo: '/home/u/perch' }))).toBe('/home/u/perch');
    expect(cloneOfUnit('systemd', '[Service]\nWorkingDirectory=/srv/tarfa\nExecStart=/usr/bin/mise exec -- bash deploy/run-agent.sh\n')).toBe('/srv/tarfa');
    expect(cloneOfUnit('systemd', '[Service]\nWorkingDirectory=/srv/tarfa\nExecStart=/usr/bin/mise exec -- bash ./deploy/run-agent.sh\n')).toBe('/srv/tarfa');
    expect(cloneOfUnit('launchd', renderService(LAUNCHD, { kind: 'clone', repo: '/Users/u/perch' }))).toBe('/Users/u/perch');
  });

  it('is null for the launcher, a relative script with no working directory, and nothing installed', () => {
    expect(cloneOfUnit('systemd', renderService(SYSTEMD, { kind: 'launcher', path: '/home/u/.tarfa/bin/tarfa-agent' }))).toBeNull();
    expect(cloneOfUnit('launchd', renderService(LAUNCHD, { kind: 'launcher', path: '/Users/u/.tarfa/bin/tarfa-agent' }))).toBeNull();
    expect(cloneOfUnit('systemd', '[Service]\nExecStart=bash deploy/run-agent.sh\n')).toBeNull();
    expect(cloneOfUnit('systemd', null)).toBeNull();
  });
});
