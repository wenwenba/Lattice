import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from '@vue-tui/testing';
import { expect, it, vi } from 'vitest';
import App from '../src/app.vue';

it('uses one confirmed slash command to delete a file or a populated folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-delete-'));
  await mkdir(join(root, 'Folder', 'nested'), { recursive: true });
  await writeFile(join(root, 'A.md'), '# A');
  await writeFile(join(root, 'Folder', 'B.md'), '# B');
  await writeFile(join(root, 'Folder', 'nested', 'data.txt'), 'data');
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('▫ A'));
    await result.stdin.write('/delete\r');
    expect(result.lastFrame()).toContain('Permanently delete file A.md? y/N');
    await result.stdin.write('n');
    expect(await readFile(join(root, 'A.md'), 'utf8')).toBe('# A');
    await result.stdin.write('/delete\ry');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Deleted note A.md'));
    await expect(readFile(join(root, 'A.md'))).rejects.toMatchObject({ code: 'ENOENT' });

    await result.stdin.write('\x1b[H'); // B.md -> Folder
    await result.stdin.write('/delete\r');
    expect(result.lastFrame()).toContain('Permanently delete folder Folder and');
    await result.stdin.write('y');
    await vi.waitFor(() => expect(result.lastFrame()).toContain('Deleted folder Folder'));
    await expect(readFile(join(root, 'Folder/nested/data.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});

it('refuses deletion while the current note has unsaved changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lattice-delete-dirty-'));
  await writeFile(join(root, 'One.md'), '# One');
  const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
  try {
    await vi.waitFor(() => expect(result.lastFrame()).toContain('▫ One'));
    await result.stdin.write('\r!');
    await result.stdin.write('\x1b');
    await result.stdin.write('/delete\r');
    expect(result.lastFrame()).toContain('Unsaved changes');
    expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('# One');
  } finally { result.dispose(); await rm(root, { recursive: true, force: true }); }
});
