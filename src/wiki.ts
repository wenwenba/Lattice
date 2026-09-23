import type { Note } from './types.js';

export type WikiReference = { target: string; start: number; end: number; raw: string; suffix: string; line: string };

export function wikiReferences(content: string): WikiReference[] {
  const result: WikiReference[] = [];
  let offset = 0;
  let fence: string | undefined;
  for (const line of content.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    } else if (!fence && !/^ {4}|^\t/.test(line)) {
      const inlineCode = [...line.matchAll(/`+[^`]*?`+/g)].map(match => [match.index, match.index + match[0].length]);
      for (const match of line.matchAll(/\[\[([^\]|#]+)((?:#[^\]|]*)?(?:\|[^\]]*)?)\]\]/g)) {
        const start = match.index;
        if ((start > 0 && line[start - 1] === '\\') || inlineCode.some(([left, right]) => start >= left! && start < right!)) continue;
        result.push({ target: match[1]!.trim(), suffix: match[2] ?? '', start: offset + start, end: offset + start + match[0].length, raw: match[0], line: line.trim() });
      }
    }
    offset += line.length + 1;
  }
  return result;
}

export function noteAliases(content: string): string[] {
  if (!content.startsWith('---\n')) return [];
  const end = content.indexOf('\n---', 4);
  if (end < 0) return [];
  const block = content.slice(4, end);
  const inline = /^aliases:\s*\[([^\]]*)\]/m.exec(block)?.[1];
  if (inline !== undefined) return inline.split(',').map(value => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const scalar = /^aliases:[ \t]+([^\n\[]+)$/m.exec(block)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (scalar) return [scalar];
  const lines = /^aliases:\s*\n((?:\s+-\s+[^\n]+\n?)*)/m.exec(block)?.[1] ?? '';
  return [...lines.matchAll(/^\s+-\s+(.+)$/gm)].map(match => match[1]!.trim().replace(/^['"]|['"]$/g, ''));
}

export function resolveWikiNote(notes: Note[], target: string, source?: Note): Note | undefined {
  const name = target.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLocaleLowerCase();
  const parent = source?.id.split('/').slice(0, -1).join('/').toLocaleLowerCase();
  if (parent !== undefined && /^\.\.?\//.test(name)) {
    const segments: string[] = [];
    for (const segment of `${parent}/${name}`.split('/')) {
      if (segment === '..') {
        if (segments.length && segments.at(-1) !== '..') segments.pop();
        else segments.push('..');
      } else if (segment && segment !== '.') segments.push(segment);
    }
    const path = segments.join('/');
    return notes.find(note => note.id.toLocaleLowerCase() === path);
  }
  const exact = (parent && !name.includes('/') ? notes.find(note => note.id.toLocaleLowerCase() === `${parent}/${name}`) : undefined)
    ?? notes.find(note => note.id.toLocaleLowerCase() === name);
  if (exact) return exact;
  const candidates = notes.filter(note => note.id.split('/').at(-1)?.toLocaleLowerCase() === name
    || note.title.toLocaleLowerCase() === name || noteAliases(note.content).some(alias => alias.toLocaleLowerCase() === name));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function rewriteWikiTargets(content: string, replacements: ReadonlyMap<number, string>): string {
  let updated = content;
  for (const reference of wikiReferences(content).reverse()) {
    const target = replacements.get(reference.start);
    if (target) updated = updated.slice(0, reference.start) + `[[${target}${reference.suffix}]]` + updated.slice(reference.end);
  }
  return updated;
}
