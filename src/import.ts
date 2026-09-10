import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export function localImportPath(input: string): string {
  const value = input.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!value) throw new Error('Enter a local file or folder path');
  return resolve(value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
}
const inside = (parent: string, child: string) => child === parent || child.startsWith(parent + sep);
async function inspect(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('Symbolic links and special files cannot be imported');
  if (info.isDirectory()) for (const entry of await readdir(path)) await inspect(join(path, entry));
}
async function copyContents(source: string, target: string): Promise<void> {
  for (const entry of await readdir(source)) {
    const from = join(source, entry), to = join(target, entry), info = await lstat(from);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('Source contains a symbolic link or special file');
    if (info.isDirectory()) { await mkdir(to); await copyContents(from, to); }
    else await copyFile(from, to, constants.COPYFILE_EXCL);
  }
}
export async function importLocal(root: string, folder: string, input: string): Promise<string> {
  const source = localImportPath(input);
  await inspect(source);
  const vault = await realpath(root), parent = await realpath(resolve(root, folder));
  if (!inside(vault, parent)) throw new Error('Import destination must be inside the vault');
  const sourceReal = await realpath(source), info = await lstat(source);
  if (info.isDirectory() && inside(sourceReal, parent)) throw new Error('Cannot copy a folder into itself or its descendants');
  const name = basename(source), extension = info.isFile() ? extname(name) : '';
  let target = '';
  for (let suffix = 1; ; suffix++) {
    target = join(parent, suffix === 1 ? name : `${name.slice(0, name.length - extension.length)} ${suffix}${extension}`);
    try {
      if (info.isDirectory()) await mkdir(target);
      else await copyFile(source, target, constants.COPYFILE_EXCL);
      break;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  if (info.isDirectory()) {
    try { await copyContents(source, target); }
    catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  }
  return relative(vault, target).split(sep).join('/');
}
