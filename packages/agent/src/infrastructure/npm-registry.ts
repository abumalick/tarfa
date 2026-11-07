const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

// The newest published @tarfa/cli: the registry's `latest` dist-tag.
export function npmRegistry(options: { fetch?: typeof fetch; registry?: string; timeoutMs?: number } = {}) {
  const doFetch = options.fetch ?? fetch;
  const base = (options.registry ?? DEFAULT_REGISTRY).replace(/\/+$/, '');
  return {
    async latest(): Promise<string> {
      let response: Response;
      try {
        response = await doFetch(`${base}/@tarfa/cli`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
      } catch (err) {
        const cause = (err as { cause?: { code?: string } }).cause?.code;
        throw new Error(cause ?? (err instanceof Error ? err.message : String(err)));
      }
      if (!response.ok) throw new Error(`${base} answered ${response.status}`);
      const latest = ((await response.json().catch(() => null)) as { 'dist-tags'?: { latest?: unknown } } | null)?.['dist-tags']?.latest;
      if (typeof latest !== 'string') throw new Error(`${base} names no latest version`);
      return latest;
    },
  };
}
