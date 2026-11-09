import { deviceFingerprint } from '@tarfa/secure-channel';

// A phone's keys, as its IK handshake presented them. `x25519` is its Noise static key, the one
// the agent checks; `ed25519` is the key its hello names, which relays once admitted it by and
// nothing checks now. It stays in the file format.
export interface Device {
  id: string;
  x25519: string;
  ed25519: string;
  name: string;
  enrolledAt: string;
}

interface RevokedDevice extends Device {
  revokedAt: string;
}

export interface DeviceRoster {
  // Whether an unknown key may enrol at all. False is `tarfa devices enrolment closed`: only
  // listed devices get in. Its meaning predates the modes, so an older agent reading this file
  // still refuses every enrolment when the operator closed it.
  enrolment: boolean;
  // Always written false and never read: an agent from before token enrolment was removed reads
  // an absent field as "the token enrols", so a rollback must find it off.
  tokenEnrolment?: boolean;
  devices: Device[];
  // Kept rather than dropped, so `tarfa devices` still names a revoked phone; `forget` drops one.
  revoked: RevokedDevice[];
}

export const EMPTY_ROSTER: DeviceRoster = { enrolment: true, tokenEnrolment: false, devices: [], revoked: [] };

export type DeviceStanding = 'enrolled' | 'revoked' | 'unknown';

// `open`: a `tarfa pair` code enrols a phone. `closed`: nothing does.
export type EnrolmentMode = 'open' | 'closed';

export function enrolmentMode(roster: DeviceRoster): EnrolmentMode {
  return roster.enrolment ? 'open' : 'closed';
}

export function withEnrolmentMode(roster: DeviceRoster, mode: EnrolmentMode): DeviceRoster {
  return { ...roster, enrolment: mode === 'open', tokenEnrolment: false };
}

export function standingOf(roster: DeviceRoster, x25519: string): DeviceStanding {
  if (roster.revoked.some((d) => d.x25519 === x25519)) return 'revoked';
  if (roster.devices.some((d) => d.x25519 === x25519)) return 'enrolled';
  return 'unknown';
}

export function enrolDevice(
  roster: DeviceRoster,
  keys: { x25519: string; ed25519: string; name: string },
  at: Date,
): DeviceRoster {
  if (standingOf(roster, keys.x25519) !== 'unknown') return roster;
  // An id is 48 bits, so two keys sharing one can be searched out; the second is refused, or
  // `tarfa devices` could no longer tell them apart by id.
  const id = deviceFingerprint(keys.x25519);
  if ([...roster.devices, ...roster.revoked].some((d) => d.id === id)) return roster;
  const device: Device = { id, ...keys, enrolledAt: at.toISOString() };
  return { ...roster, devices: [...roster.devices, device] };
}

// A device by its full X25519 key, its id, or an unambiguous prefix of the id.
function findDevice<T extends Device>(list: T[], id: string): T | null {
  const byKey = list.find((d) => d.x25519 === id);
  if (byKey) return byKey;
  const matches = list.filter((d) => d.id === id || (id.length >= 4 && d.id.startsWith(id)));
  return matches.length === 1 ? matches[0]! : null;
}

export function revokeDevice(roster: DeviceRoster, id: string, at: Date): { roster: DeviceRoster; device: Device | null } {
  const device = findDevice(roster.devices, id);
  if (!device) return { roster, device: null };
  return {
    roster: {
      ...roster,
      devices: roster.devices.filter((d) => d !== device),
      revoked: [...roster.revoked, { ...device, revokedAt: at.toISOString() }],
    },
    device,
  };
}

// Drops a device from both lists, so its key is unknown again and can pair again.
export function forgetDevice(roster: DeviceRoster, id: string): { roster: DeviceRoster; device: Device | null } {
  const device = findDevice([...roster.devices, ...roster.revoked], id);
  if (!device) return { roster, device: null };
  return {
    roster: {
      ...roster,
      devices: roster.devices.filter((d) => d.x25519 !== device.x25519),
      revoked: roster.revoked.filter((d) => d.x25519 !== device.x25519),
    },
    device,
  };
}
