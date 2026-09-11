import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

type StartupOptions = {
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

type StartupState = {
  version: 1;
  lastVaultPath: string;
};

export function defaultVaultPath(home = homedir()): string {
  return join(home, 'Documents', 'Lattice');
}

export function startupStatePath(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Lattice', 'state.json');
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Lattice', 'state.json');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'lattice', 'state.json');
}

async function existingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readLastVault(path: string): Promise<string | undefined> {
  try {
    const state = JSON.parse(await readFile(path, 'utf8')) as Partial<StartupState>;
    return typeof state.lastVaultPath === 'string' && isAbsolute(state.lastVaultPath)
      ? state.lastVaultPath
      : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function rememberVault(path: string, statePath: string): Promise<void> {
  await mkdir(resolve(statePath, '..'), { recursive: true });
  const state: StartupState = { version: 1, lastVaultPath: path };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export async function resolveStartupVault(explicitPath?: string, options: StartupOptions = {}): Promise<string> {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const statePath = startupStatePath(platform, home, env);

  if (explicitPath) {
    const vaultPath = resolve(explicitPath);
    await mkdir(vaultPath, { recursive: true });
    await rememberVault(vaultPath, statePath);
    return vaultPath;
  }

  const remembered = await readLastVault(statePath);
  if (remembered && await existingDirectory(remembered)) return remembered;

  const vaultPath = defaultVaultPath(home);
  const isNew = !await existingDirectory(vaultPath);
  await mkdir(vaultPath, { recursive: true });
  if (isNew) {
    await writeFile(
      join(vaultPath, 'Welcome.md'),
      '# Welcome to Lattice\n\nYour notes are ordinary Markdown files. Press `e` to edit or type `/` to explore commands.\n',
      { encoding: 'utf8', flag: 'wx' },
    );
  }
  await rememberVault(vaultPath, statePath);
  return vaultPath;
}
