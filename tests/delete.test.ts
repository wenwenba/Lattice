import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from '@vue-tui/testing';
import { expect, it, vi } from 'vitest';
import App from '../src/app.vue';
import { Vault } from '../src/vault.js';

it('moves a confirmed file or populated folder to recoverable Trash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-delete-'));
  await mkdir(join(root, 'Folder', 'nested'), { recursive: true });
  await writeFile(join(root, 'A.md'), '# A');
  await writeFile(join(root, 'Folder', 'B.md'), '# B');
  await writeFile(join(root, 'Folder', 'nested', 'data.txt'), 'data');
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain(' A'));
    await result.stdin.write('/delete\r');
    expect(result.lastFrame()).toContain('Move file A.md to Trash? y/N');
    await result.stdin.write('n');
    expect(await readFile(join(root, 'A.md'), 'utf8')).toBe('# A');
    await result.stdin.write('/delete\ry');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Moved note A.md to Trash'));
    await expect(readFile(join(root, 'A.md'))).rejects.toMatchObject({ code: 'ENOENT' });

    await result.stdin.write('\x1b[H'); // B.md -> Folder
    await result.stdin.write('/delete\r');
    expect(result.lastFrame()).toContain('Move folder Folder and');
    await result.stdin.write('y');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Moved folder Folder to Trash'));
    await expect(readFile(join(root, 'Folder/nested/data.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await result.stdin.write('/trash\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('TRASH · RESTORE'));
    expect(result.lastFrame()).toContain('Folder');
    await result.stdin.write('\r');
    await vi.waitFor(async () => expect(await readFile(join(root, 'Folder/nested/data.txt'), 'utf8')).toBe('data'));
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('refuses deletion while the current note has unsaved changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-delete-dirty-'));
  await writeFile(join(root, 'One.md'), '# One');
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
    await result.stdin.write('\r!');
    await result.stdin.write('\x1b');
    await result.stdin.write('/delete\r');
    expect(result.lastFrame()).toContain('Unsaved changes');
    expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('# One');
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('cleans expired Trash on launch and when retention is shortened in settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-trash-auto-'));
  const vault = new Vault(root);
  await writeFile(join(root, 'Old.md'), '# Old');
  await writeFile(join(root, 'Recent.md'), '# Recent');
  const old = await vault.deleteEntry('Old.md', 'note');
  const recent = await vault.deleteEntry('Recent.md', 'note');
  await writeFile(join(root, '.lattice', 'trash', old.id, 'meta.json'), JSON.stringify({ ...old, deletedAt: Date.now() - 31 * 86_400_000 }));
  await writeFile(join(root, '.lattice', 'trash', recent.id, 'meta.json'), JSON.stringify({ ...recent, deletedAt: Date.now() - 10 * 86_400_000 }));
  const result = await render(App, { columns: 100, rows: 30, props: { vaultPath: root } });
  try {
    await vi.waitFor(async () => expect((await vault.listTrash()).map(entry => entry.id)).toEqual([recent.id]));
    await result.stdin.write('/settings\r');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('TRASH RETENTION · 30 days'));
    await result.stdin.write('\x1b[B\x1b[B\x1b[B\x1b[D');
    await vi.waitFor(async () => expect(await vault.listTrash()).toEqual([]));
    expect(JSON.parse(await readFile(join(root, '.lattice', 'settings.json'), 'utf8')).trashRetentionDays).toBe(7);
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});
