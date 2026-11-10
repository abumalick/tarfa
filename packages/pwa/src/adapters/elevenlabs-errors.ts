// What an ElevenLabs error response means, for speech-to-text and text-to-speech alike. Out of
// credit comes back as a 401 whose body names a quota status, so the body is read before the
// status: a plain 401 is a bad key.
export type ElevenLabsFailure = 'key' | 'permission' | 'quota' | 'voice' | 'busy' | 'http';

export async function elevenLabsFailure(res: Response): Promise<ElevenLabsFailure> {
  const status = await detailStatus(res);
  if (res.status === 402 || /quota|credit|exceed/i.test(status)) return 'quota';
  if (/permission/i.test(status)) return 'permission';
  if (res.status === 404 || /voice_not_found/i.test(status)) return 'voice';
  if (res.status === 429 || /busy|concurrent|rate_limit/i.test(status)) return 'busy';
  if (res.status === 401) return 'key';
  return 'http';
}

async function detailStatus(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: { status?: unknown } };
    const status = body?.detail?.status;
    return typeof status === 'string' ? status : '';
  } catch {
    return '';
  }
}
