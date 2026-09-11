import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultVaultPath, resolveStartupVault, startupStatePath } from '../src/startup.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lattice-startup-'));
  roots.push(root);
  return root;
}

describe('startup vault', () => {
  it('creates a ready-to-use default vault on first launch', async () => {
    const home = await temporaryHome();
    const vault = await resolveStartupVault(undefined, { home, platform: 'linux', env: {} });

    expect(vault).toBe(defaultVaultPath(home));
    expect(await readFile(join(vault, 'Welcome.md'), 'utf8')).toContain('# Welcome to Lattice');
  });

  it('remembers an explicit vault and reopens it from any working directory', async () => {
    const home = await temporaryHome();
    const selected = join(home, 'Notes', 'Work');
    const options = { home, platform: 'darwin' as const, env: {} };

    expect(await resolveStartupVault(selected, options)).toBe(selected);
    expect(await resolveStartupVault(undefined, options)).toBe(selected);
    expect(JSON.parse(await readFile(startupStatePath('darwin', home, {}), 'utf8')).lastVaultPath).toBe(selected);
  });

  it('falls back to the default vault when the remembered directory is gone', async () => {
    const home = await temporaryHome();
    const selected = join(home, 'Temporary');
    const options = { home, platform: 'win32' as const, env: { APPDATA: join(home, 'AppData') } };

    await resolveStartupVault(selected, options);
    await rm(selected, { recursive: true });
    await mkdir(join(home, 'Documents'), { recursive: true });

    expect(await resolveStartupVault(undefined, options)).toBe(defaultVaultPath(home));
  });
});
