import { describe, expect, it } from 'vitest';
import { escapeHtml, readOperator, renderLegalPage, type Operator } from './legal-pages';

const op: Operator = { name: 'Jane Doe', email: 'privacy@example.org', law: 'Examplestan' };

describe('readOperator', () => {
  it('is null when nothing is set', () => {
    expect(readOperator({})).toBeNull();
    expect(readOperator({ TARFA_OPERATOR_NAME: '  ' })).toBeNull();
  });

  it('reads all three, trimmed', () => {
    expect(
      readOperator({ TARFA_OPERATOR_NAME: ' Jane Doe ', TARFA_OPERATOR_EMAIL: 'privacy@example.org', TARFA_OPERATOR_LAW: 'Examplestan' }),
    ).toEqual(op);
  });

  it('refuses a partial set, naming what is missing', () => {
    expect(() => readOperator({ TARFA_OPERATOR_NAME: 'Jane Doe' })).toThrow(/missing TARFA_OPERATOR_EMAIL, TARFA_OPERATOR_LAW/);
  });

  it('refuses an email that is not one', () => {
    expect(() =>
      readOperator({ TARFA_OPERATOR_NAME: 'Jane', TARFA_OPERATOR_EMAIL: 'nobody', TARFA_OPERATOR_LAW: 'Examplestan' }),
    ).toThrow(/not an email/);
  });
});

describe('renderLegalPage', () => {
  it.each(['terms', 'privacy'] as const)('%s names the operator, contact and links back to the app', (page) => {
    const html = renderLegalPage(page, op);
    expect(html).toContain('Jane Doe');
    expect(html).toContain('href="mailto:privacy@example.org"');
    expect(html).toContain('href="/"');
  });

  it('states the governing law in the terms', () => {
    expect(renderLegalPage('terms', op)).toContain('governed by the laws of Examplestan');
  });

  it.each(['terms', 'privacy'] as const)('%s says no operator is named when none is set', (page) => {
    const html = renderLegalPage(page, null);
    expect(html).toMatch(/does not name/);
    expect(html).not.toContain('mailto:');
  });

  it.each(['terms', 'privacy'] as const)('%s runs no script', (page) => {
    expect(renderLegalPage(page, op)).not.toMatch(/<script|\son\w+=|javascript:/i);
  });

  it('escapes what the operator settings carry', () => {
    const html = renderLegalPage('terms', { name: '<img src=x onerror=alert(1)>', email: 'a@b.co', law: 'A & "B"' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A &amp; &quot;B&quot;');
  });

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
