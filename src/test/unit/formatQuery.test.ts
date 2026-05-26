import { describe, it, expect, vi } from 'vitest';

// Mock webview dependencies before the formatter module loads
vi.mock('../../../media/webview/query-executor', () => ({ setEditorContent: vi.fn() }));
vi.mock('../../../media/webview/ui-helpers',     () => ({ showToast: vi.fn() }));

import { formatQuery } from '../../../media/webview/formatter';

describe('formatQuery', () => {
  it('returns empty string unchanged', () => {
    expect(formatQuery('')).toBe('');
  });

  it('uppercases SQL keywords', () => {
    const result = formatQuery('select * from users');
    expect(result).toContain('SELECT');
    expect(result).toContain('FROM');
  });

  it('breaks major clauses onto new lines', () => {
    const result = formatQuery('select id from orders where id = 1');
    expect(result).toMatch(/SELECT/);
    expect(result).toMatch(/\nFROM/);
    expect(result).toMatch(/\nWHERE/);
  });

  it('indents AND / OR conditions', () => {
    const result = formatQuery('select * from t where a = 1 and b = 2 or c = 3');
    expect(result).toMatch(/\n {2}AND/);
    expect(result).toMatch(/\n {2}OR/);
  });

  it('collapses redundant whitespace', () => {
    const result = formatQuery('select   *    from   users');
    expect(result).not.toMatch(/  /); // no double spaces
  });

  it('handles JOIN keywords', () => {
    const result = formatQuery('select * from a inner join b on a.id = b.id');
    expect(result).toMatch(/\nINNER JOIN/);
  });

  it('does not add a leading newline', () => {
    const result = formatQuery('select 1');
    expect(result.startsWith('\n')).toBe(false);
  });
});
