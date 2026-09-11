import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from '@vue-tui/testing';
import { expect, it, vi } from 'vitest';
import App from '../src/app.vue';
import { loadSettings, storeSettings } from '../src/settings.js';

it.each(['macos', 'windows', 'linux'] as const)('routes application actions only through slash commands on %s', async keymap => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-slash-only-'));
  await writeFile(join(root, 'One.md'), '# One');
  await storeSettings(root, { autoSave: false, theme: 'lattice', language: 'en' });
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root, keymap } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('▫ One'));
    await result.stdin.write('\x10\x13\x07snp?d');
    expect(result.lastFrame()).not.toContain('SETTINGS');
    expect(result.lastFrame()).not.toContain('COMMANDS ·');
    expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('# One');
    await result.stdin.write('/settings\r');
    expect(result.lastFrame()).toContain('SETTINGS');
    await result.stdin.write('\x1b');
    await result.stdin.write('/keys\r');
    expect(result.lastFrame()).toContain('No matching command');
    expect(result.lastFrame()).not.toContain('KEYBOARD DIAGNOSTICS');
    await result.stdin.write('\x1b');
    await result.stdin.write('e');
    expect(result.lastFrame()).toContain('EDIT · One');
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('keeps q as the browse-mode quit shortcut', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-q-quit-'));
  await writeFile(join(root, 'One.md'), '# One');
  const result = await render(App, { columns: 80, rows: 20, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('▫ One'));
    await result.stdin.write('q');
    await result.waitUntilExit();
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('ignores removed shortcut fields from older settings files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-settings-migration-'));
  try {
    await storeSettings(root, { autoSave: true, theme: 'nord', language: 'en' });
    const path = join(root, '.lattice/settings.json');
    await writeFile(path, JSON.stringify({ autoSave: false, theme: 'dracula', leader: 'g', applicationKeys: true }));
    expect(await loadSettings(root)).toEqual({ autoSave: false, theme: 'dracula', language: 'en' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
