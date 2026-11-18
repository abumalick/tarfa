import { describe, expect, it } from 'vitest';
import { OpenRequests } from './open-requests';

describe('OpenRequests', () => {
  it('keeps the latest request of each workspace', () => {
    const requests = new OpenRequests();
    const first = requests.set('w1', 'https://a.example/');
    const second = requests.set('w1', 'https://b.example/');
    requests.set('w2', 'https://c.example/');
    expect(second).not.toEqual(first);
    expect(requests.get('w1')).toEqual(second);
    expect(requests.get('w2')?.url).toBe('https://c.example/');
  });

  it('answers null for the same URL again, so a loop does not push it over and over', () => {
    const requests = new OpenRequests();
    const first = requests.set('w1', 'https://a.example/');
    expect(requests.set('w1', 'https://a.example/')).toBeNull();
    expect(requests.get('w1')).toEqual(first);
  });

  it('clears a request only for an answer naming it', () => {
    const requests = new OpenRequests();
    const first = requests.set('w1', 'https://a.example/')!;
    const second = requests.set('w1', 'https://b.example/')!;
    expect(requests.done('w1', first.id)).toBe(false);
    expect(requests.get('w1')).toEqual(second);
    expect(requests.done('w1', second.id)).toBe(true);
    expect(requests.get('w1')).toBeUndefined();
  });

  it('forgets a closed workspace', () => {
    const requests = new OpenRequests();
    requests.set('w1', 'https://a.example/');
    requests.forget('w1');
    expect(requests.get('w1')).toBeUndefined();
  });
});
