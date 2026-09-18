export const icons = {
  selected: '›',
  expanded: '\ueab4', // Nerd Font Codicons: paired chevrons share the same icon grid.
  collapsed: '\ueab6',
  root: '',
  folder: '',
  note: '',
  image: '',
  file: '',
} as const;

export type VaultIconKind = 'root' | 'folder' | 'note' | 'image' | 'file';

export function treeEntryIcon(kind: 'folder' | 'note', expanded = false): string {
  return kind === 'folder'
    ? `${expanded ? icons.expanded : icons.collapsed} ${icons.folder}`
    : `  ${icons.note}`;
}

export function vaultFileIcon(path: string): string {
  return icons[vaultFileKind(path)];
}

export function vaultFileKind(path: string): Exclude<VaultIconKind, 'root' | 'folder'> {
  if (/\.md$/iu.test(path)) return 'note';
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/iu.test(path)) return 'image';
  return 'file';
}
