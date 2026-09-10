import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { languages, type Language } from './i18n.js';
export const themes = {
  lattice: { name: 'Lattice', background: '#111318', foreground: '#c6ccd6', muted: '#8993a4', border: '#343a46', accent: '#88c0d0' },
  nord: { name: 'Nord', background: '#2e3440', foreground: '#eceff4', muted: '#a5b1c2', border: '#4c566a', accent: '#88c0d0' },
  dracula: { name: 'Dracula', background: '#282a36', foreground: '#f8f8f2', muted: '#a5a8c5', border: '#44475a', accent: '#bd93f9' },
  light: { name: 'Paper', background: '#faf8f2', foreground: '#292d35', muted: '#596273', border: '#c6cbd3', accent: '#476b91' },
} as const;
export type Settings = { autoSave: boolean; theme: keyof typeof themes; language: Language };
export const defaultSettings: Settings = { autoSave: true, theme: 'lattice', language: 'en' };
export async function loadSettings(root: string): Promise<Settings> {
  try {
    const value = JSON.parse(await readFile(join(root, '.lattice', 'settings.json'), 'utf8'));
    return { autoSave: typeof value?.autoSave === 'boolean' ? value.autoSave : true,
      theme: value && Object.hasOwn(themes, value.theme) ? value.theme : 'lattice',
      language: value && Object.hasOwn(languages, value.language) ? value.language : 'en' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaultSettings };
    throw error;
  }
}
export async function storeSettings(root: string, settings: Settings): Promise<void> {
  const directory = join(root, '.lattice');
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `settings-${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, join(directory, 'settings.json'));
}
