import { isIOSWebKit } from './terminal-link';
import { isAndroid } from './android-input';

// Which instructions turn the phone's voice on: they differ by system, and on Android by
// browser, since Chromium browsers speak only through Google's speech engine while Firefox uses
// whichever engine the phone has set.
export type VoicePlatform = 'android-chrome' | 'android-firefox' | 'ios' | 'desktop';

export function voicePlatform(ua: string, maxTouchPoints: number): VoicePlatform {
  if (isIOSWebKit(ua, maxTouchPoints)) return 'ios';
  if (isAndroid(ua)) return /Firefox\//.test(ua) ? 'android-firefox' : 'android-chrome';
  return 'desktop';
}

// Google's speech engine, which Chrome on Android needs.
export const GOOGLE_SPEECH_URL = 'https://play.google.com/store/apps/details?id=com.google.android.tts';
