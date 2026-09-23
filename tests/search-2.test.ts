import { describe, expect, it } from 'vitest';
import { searchNotes } from '../src/search.js';
import type { Note } from '../src/types.js';

const note = (id: string, content: string, tags: string[] = [], modifiedAt = 0): Note => ({
  id, title: id, path: `${id}.md`, relativePath: `${id}.md`, content, links: [], tags, modifiedAt,
});

describe('search 2.0', () => {
  const notes = [note('Alpha', 'A searchable phrase\nSecond line', ['work'], 100), note('Beta', 'Other words', ['home'], 200)];
  it('returns a matching context line and supports phrase and field filters', () => {
    expect(searchNotes(notes, '"searchable phrase" tag:work')).toMatchObject([{ note: { id: 'Alpha' }, snippet: 'A searchable phrase', match: 'searchable phrase' }]);
    expect(searchNotes(notes, 'path:beta sort:recent').map(hit => hit.note.id)).toEqual(['Beta']);
    expect(searchNotes(notes, 'tag:home searchable')).toEqual([]);
  });
  it('tolerates title typos and sorts recent notes', () => {
    expect(searchNotes(notes, 'Apha').map(hit => hit.note.id)).toEqual(['Alpha']);
    expect(searchNotes(notes, 'sort:recent').map(hit => hit.note.id)).toEqual(['Beta', 'Alpha']);
  });
  it('finds Chinese text and filters by modification date and link', () => {
    const linked = { ...note('中文笔记', '这是一段中文检索内容', ['资料'], new Date('2026-09-20').getTime()), links: ['Daily/Today'] };
    expect(searchNotes([linked], '中文检索 after:2026-09-19 link:today').map(hit => hit.note.id)).toEqual(['中文笔记']);
    expect(searchNotes([linked], '中文检索 before:2026-09-19')).toEqual([]);
  });
});
