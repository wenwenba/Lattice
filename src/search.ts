import type { Note } from './types.js';

export type SearchHit = { note: Note; score: number; snippet: string; match: string };

export function searchNotes(notes: Note[], query: string): SearchHit[] {
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const words: string[] = [];
  const filters: Array<(note: Note) => boolean> = [];
  let sort: 'relevance' | 'recent' | 'title' = 'relevance';
  for (const token of tokens) {
    const value = token.replace(/^"|"$/g, '').toLocaleLowerCase();
    const separator = value.indexOf(':');
    const field = separator > 0 ? value.slice(0, separator) : '';
    const term = value.slice(separator + 1);
    if (field === 'tag' && term) filters.push(note => note.tags.some(tag => tag.toLocaleLowerCase() === term.replace(/^#/, '')));
    else if (field === 'path' && term) filters.push(note => note.relativePath.toLocaleLowerCase().includes(term));
    else if (field === 'link' && term) filters.push(note => note.links.some(link => link.toLocaleLowerCase().includes(term)));
    else if ((field === 'before' || field === 'after') && /^\d{4}-\d{2}-\d{2}$/.test(term)) {
      const day = Date.parse(`${term}T00:00:00`);
      if (!Number.isNaN(day)) filters.push(note => field === 'before' ? note.modifiedAt < day : note.modifiedAt >= day);
    } else if (field === 'sort' && ['recent', 'title', 'relevance'].includes(term)) sort = term as typeof sort;
    else words.push(value);
  }
  const results = notes.flatMap(note => {
    if (!filters.every(filter => filter(note))) return [];
    const title = `${note.title} ${note.relativePath}`.toLocaleLowerCase();
    const content = note.content.toLocaleLowerCase();
    let score = 0;
    let first = -1;
    let match = '';
    for (const word of words) {
      const titleIndex = title.indexOf(word);
      const bodyIndex = content.indexOf(word);
      if (titleIndex < 0 && bodyIndex < 0) {
        // Title typos are common in a command palette; keep fuzzy matching title-only.
        if (!subsequence(word, title)) return [];
        score += 1;
      } else {
        score += (titleIndex >= 0 ? 10 : 0) + (bodyIndex >= 0 ? 2 : 0);
        if (first < 0 && bodyIndex >= 0) { first = bodyIndex; match = word; }
      }
    }
    const lineStart = first < 0 ? 0 : note.content.lastIndexOf('\n', first - 1) + 1;
    const lineEnd = note.content.indexOf('\n', first < 0 ? 0 : first);
    const start = first < 0 ? lineStart : Math.max(lineStart, first - 70);
    const snippet = `${start > lineStart ? '…' : ''}${note.content.slice(start, Math.min(lineEnd < 0 ? note.content.length : lineEnd, start + 220)).trim()}`;
    return [{ note, score, snippet, match }];
  });
  const order: string = sort;
  return results.sort((a, b) => order === 'recent' ? b.note.modifiedAt - a.note.modifiedAt || b.score - a.score
    : order === 'title' ? a.note.title.localeCompare(b.note.title)
      : b.score - a.score || b.note.modifiedAt - a.note.modifiedAt || a.note.title.localeCompare(b.note.title));
}

function subsequence(needle: string, haystack: string): boolean {
  if (needle.length < 2) return false;
  let index = 0;
  for (const character of haystack) if (character === needle[index]) index++;
  return index === needle.length;
}
