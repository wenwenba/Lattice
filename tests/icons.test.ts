import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { icons, treeEntryIcon, vaultFileIcon, vaultFileKind } from '../src/icons.js';

describe('icon language', () => {
  it('uses one-cell non-emoji glyphs so labels stay aligned across terminals', () => {
    expect(Object.values(icons).map((icon) => stringWidth(icon))).toEqual(Object.values(icons).map(() => 1));
  });

  it('separates entry type from disclosure and selection state', () => {
    expect(treeEntryIcon('folder', false)).toBe('▸ ');
    expect(treeEntryIcon('folder', true)).toBe('▾ ');
    expect(treeEntryIcon('note')).toBe('  ');
    expect(vaultFileIcon('Notes/Idea.md')).toBe('');
    expect(vaultFileIcon('assets/cover.png')).toBe('');
    expect(vaultFileIcon('files/report.pdf')).toBe('');
    expect(vaultFileKind('Notes/Idea.md')).toBe('note');
    expect(vaultFileKind('assets/cover.webp')).toBe('image');
    expect(vaultFileKind('files/report.pdf')).toBe('file');
  });
});
