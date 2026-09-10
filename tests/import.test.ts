import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { it, expect } from 'vitest';
import { importLocal } from '../src/import.js';

it('copies files and nested folders into the chosen vault directory without replacing existing content', async () => {
  const base = await mkdtemp(join(tmpdir(), 'lattice-import-'));
  try {
    const root = join(base, 'vault'), source = join(base, 'source');
    await mkdir(join(root, 'Projects'), { recursive: true });
    await mkdir(join(source, 'nested'), { recursive: true });
    await writeFile(join(source, 'nested', 'Note.md'), '# Note');
    await writeFile(join(source, 'image.png'), Buffer.from([1, 2, 3]));
    expect(await importLocal(root, 'Projects', source)).toBe('Projects/source');
    expect(await readFile(join(root, 'Projects/source/nested/Note.md'), 'utf8')).toBe('# Note');
    expect(await importLocal(root, 'Projects', source)).toBe('Projects/source 2');
    expect(await importLocal(root, 'Projects', join(source, 'image.png'))).toBe('Projects/image.png');
    expect(await importLocal(root, 'Projects', join(source, 'image.png'))).toBe('Projects/image 2.png');
    expect(await readFile(join(source, 'image.png'))).toEqual(Buffer.from([1, 2, 3]));
    await expect(importLocal(root, '..', join(source, 'image.png'))).rejects.toThrow('inside the vault');
    await expect(importLocal(root, 'Projects', root)).rejects.toThrow('itself');
    await symlink(join(source, 'image.png'), join(source, 'link'));
    await expect(importLocal(root, '', source)).rejects.toThrow('Symbolic links');
  } finally { await rm(base, { recursive: true, force: true }); }
});
