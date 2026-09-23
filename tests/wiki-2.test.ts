import { expect, it } from 'vitest';
import { noteAliases, resolveWikiNote, wikiReferences } from '../src/wiki.js';
import type { Note } from '../src/types.js';

it('ignores code links, resolves aliases, and refuses ambiguous titles', () => {
  const content = '[[Target]]\n`[[Code]]`\n```\n[[Fence]]\n```\n\\[[Escaped]]';
  expect(wikiReferences(content).map(link => link.target)).toEqual(['Target']);
  const a = { id: 'One/Target', title: 'Target', content: '---\naliases: [Shortcut]\n---\n# Target' } as Note;
  const b = { id: 'Two/Target', title: 'Target', content: '# Target' } as Note;
  expect(noteAliases(a.content)).toEqual(['Shortcut']);
  expect(noteAliases('---\naliases: "Another name"\n---\n# Target')).toEqual(['Another name']);
  expect(resolveWikiNote([a, b], 'Shortcut')).toBe(a);
  expect(resolveWikiNote([a, b], 'Target')).toBeUndefined();
  expect(resolveWikiNote([a, b], 'Target', { id: 'One/Source' } as Note)).toBe(a);
  expect(resolveWikiNote([a, b], '../Two/Target', { id: 'One/Source' } as Note)).toBe(b);
  expect(resolveWikiNote([a, b], '../../Two/Target', { id: 'One/Source' } as Note)).toBeUndefined();
});
