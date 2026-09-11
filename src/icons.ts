export const icons = {
  selected: '›',
  expanded: '▾',
  collapsed: '▸',
  root: '⌂',
  folder: '▰',
  note: '▫',
  image: '⊡',
  file: '▯',
} as const;

export function treeEntryIcon(kind: 'folder' | 'note', expanded = false): string {
  return kind === 'folder'
    ? `${expanded ? icons.expanded : icons.collapsed} ${icons.folder}`
    : `  ${icons.note}`;
}

export function vaultFileIcon(path: string): string {
  if (/\.md$/iu.test(path)) return icons.note;
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/iu.test(path)) return icons.image;
  return icons.file;
}
