import { describe, expect, it } from 'vitest';
import { normalizeNoteName, renderMarkdownPreview, wrapIndex } from '../website/demo-state';

describe('website interactive demo', () => {
  it('renders structured markdown rows and normalizes new note names', () => {
    const rows = renderMarkdownPreview('# 标题\n\n- [x] 完成\n\n| A | B |\n| --- | --- |', 20, 10);

    expect(rows).toContainEqual({ text: '█ 标题', kind: 'heading' });
    expect(rows).toContainEqual({ text: '✓ 完成', kind: 'list' });
    expect(rows).toContainEqual({ text: '│ A   │ B   │', kind: 'table' });
    expect(normalizeNoteName('产品/想法')).toBe('产品-想法.md');
  });

  it('wraps keyboard selection at both ends of a list', () => {
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(2, 1, 3)).toBe(0);
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });
});
