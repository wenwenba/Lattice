const names: Record<string, string> = {
  'Quick note': 'jot', 'Organize saved note with AI': 'summarize', 'AI model configuration': 'model',
  'Move file or folder': 'move', 'Import local file or folder': 'import', Settings: 'settings',
  'New note': 'new', 'New folder': 'folder', 'Rename selected': 'rename',
  'Delete selected file or folder': 'delete', 'Edit / preview': 'edit', 'Search vault': 'search',
  'Trash and restore': 'trash', 'Link health': 'links', 'Backlinks': 'backlinks',
  'Reload vault': 'reload', 'Keyboard help': 'help', Quit: 'quit',
};
export function commandName(label: string): string { return names[label] ?? label.toLowerCase().replaceAll(' ', '-'); }
export function filterCommands<T extends { label: string; title?: string }>(commands: T[], query: string): T[] {
  const needle = query.replace(/^\//, '').trim().toLowerCase();
  return commands.filter(command => `${commandName(command.label)} ${command.label} ${command.title ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(commandName(b.label) === needle) - Number(commandName(a.label) === needle));
}
