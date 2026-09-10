import { describe, expect, it } from 'vitest';
import { findMatches, replaceAll, replaceCurrent, selectMatch } from '../src/find-replace.js';

describe('find and replace', () => {
  it('selects Unicode matches cyclically and replaces one or all without regex semantics', () => {
    const initial = { content: '中文 a.b 中文 a.b', cursor: 0 };
    expect(findMatches(initial.content, 'a.b')).toHaveLength(2);
    const first = selectMatch(initial, '中文');
    expect(first).toMatchObject({ current: 1, total: 2 });
    const previous = selectMatch(first.state, '中文', -1);
    expect(previous).toMatchObject({ current: 2, total: 2 });
    const one = replaceCurrent(first.state, '中文', '汉字');
    expect(one.replaced).toBe(true);
    expect(one.state.content).toBe('汉字 a.b 中文 a.b');
    const all = replaceAll(one.state, 'a.b', 'dot');
    expect(all.replaced).toBe(2);
    expect(all.state.content).toBe('汉字 dot 中文 dot');
  });
});
