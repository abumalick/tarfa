import { describe, it, expect } from 'vitest';
import { voicePlatform } from './voice-platform';

const chrome = 'Mozilla/5.0 (Linux; Android 16; SM-X135) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
const firefox = 'Mozilla/5.0 (Android 16; Mobile; rv:160.0) Gecko/160.0 Firefox/160.0';
const samsung = 'Mozilla/5.0 (Linux; Android 16; SM-X135) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/130.0.0.0 Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15';

describe('voicePlatform', () => {
  it('tells Chromium browsers on Android from Firefox', () => {
    expect(voicePlatform(chrome, 5)).toBe('android-chrome');
    expect(voicePlatform(samsung, 5)).toBe('android-chrome');
    expect(voicePlatform(firefox, 5)).toBe('android-firefox');
  });

  it('knows an iPhone and an iPad that reports as a Mac', () => {
    expect(voicePlatform(iphone, 5)).toBe('ios');
    expect(voicePlatform(ipad, 5)).toBe('ios');
  });

  it('treats a real Mac as a desktop', () => {
    expect(voicePlatform(ipad, 0)).toBe('desktop');
  });
});
