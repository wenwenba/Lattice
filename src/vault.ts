import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { randomUUID } from 'node:crypto';
import { extractLinks, extractTags, noteTitle } from "./markdown.js";
import type { Note, VaultFile } from "./types.js";
import { attachmentDirectory, assertRealInside, storeClipboardImage, isAttachmentDirectory } from "./attachments.js";
import { markdownVaultFileLink, resolveLinkTarget } from "./links.js";
import { renderMarkdown } from "./markdown.js";
import { fileURLToPath } from "node:url";
import { searchNotes, type SearchHit } from './search.js';
import { resolveWikiNote, rewriteWikiTargets, wikiReferences } from './wiki.js';

export type TrashEntry = { id: string; relativePath: string; kind: 'note' | 'folder'; deletedAt: number };

export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async loadNotes(): Promise<Note[]> {
    await this.initialize();
    const paths = await walkMarkdown(this.root);
    const notes = await Promise.all(paths.map((path) => this.readNote(path)));
    return notes.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  async loadFolders(): Promise<string[]> {
    await this.initialize();
    return walkFolders(this.root, this.root);
  }

  async loadFiles(): Promise<VaultFile[]> {
    await this.initialize();
    const paths = await walkFiles(this.root);
    return paths.map((path) => ({
      path,
      relativePath: relative(this.root, path).split(sep).join("/"),
      name: basename(path),
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  async readNote(path: string): Promise<Note> {
    const safePath = this.assertInside(path);
    const content = await readFile(safePath, "utf8");
    const info = await stat(safePath);
    const relativePath = relative(this.root, safePath).split(sep).join("/");
    return {
      id: relativePath.replace(/\.md$/i, ""),
      title: noteTitle(relativePath, content),
      path: safePath,
      relativePath,
      content,
      links: extractLinks(content),
      tags: extractTags(content),
      modifiedAt: info.mtimeMs,
    };
  }

  async save(note: Note, content: string): Promise<Note> {
    const safePath = this.assertInside(note.path);
    await mkdir(dirname(safePath), { recursive: true });
    const temporaryPath = `${safePath}.lattice-tmp`;
    await writeFile(temporaryPath, content, "utf8");
    try {
      await rename(temporaryPath, safePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES")) throw error;
      // Windows can reject rename-over-existing even when both files share a volume.
      await copyFile(temporaryPath, safePath);
      await unlink(temporaryPath);
    }
    return this.readNote(safePath);
  }

  async create(title: string): Promise<Note> {
    const normalized = normalizeNewNoteName(title);
    let candidate = resolve(this.root, `${normalized}.md`);
    let suffix = 2;
    while (await fileExists(candidate)) candidate = resolve(this.root, `${normalized} ${suffix++}.md`);
    this.assertInside(candidate);
    await mkdir(dirname(candidate), { recursive: true });
    await writeFile(candidate, `# ${basename(normalized)}\n\n`, { encoding: "utf8", flag: "wx" });
    return this.readNote(candidate);
  }

  async createFolder(name: string): Promise<string> {
    const relativePath = normalizeRelativePath(name);
    const candidate = this.assertInside(resolve(this.root, relativePath));
    if (candidate === this.root) throw new Error("Folder name cannot be empty");
    if (await fileExists(candidate)) throw new Error("A file or folder already exists at that path");
    await mkdir(candidate, { recursive: true });
    return relative(this.root, candidate).split(sep).join("/");
  }

  async renameEntry(sourceRelativePath: string, targetRelativePath: string): Promise<string> {
    const source = this.assertInside(resolve(this.root, sourceRelativePath));
    if (source === this.root) throw new Error("The vault root cannot be renamed");
    const sourceInfo = await stat(source);
    let normalizedTarget = normalizeRelativePath(targetRelativePath);
    if (sourceInfo.isFile() && extname(source).toLocaleLowerCase() === ".md" && !normalizedTarget.toLocaleLowerCase().endsWith(".md")) {
      normalizedTarget += ".md";
    }
    const target = this.assertInside(resolve(this.root, normalizedTarget));
    if (target === this.root) throw new Error("Target name cannot be empty");
    if (target !== source && await fileExists(target)) throw new Error("A file or folder already exists at that path");
    if (target === source) return relative(this.root, target).split(sep).join("/");
    if (sourceInfo.isDirectory() && target.startsWith(source + sep)) throw new Error('Cannot move a folder into itself or its descendants');
    await assertRealInside(this.root, source);
    let existingParent = dirname(target);
    while (!await fileExists(existingParent)) existingParent = dirname(existingParent);
    await assertRealInside(this.root, existingParent);
    await mkdir(dirname(target), { recursive: true });
    await assertRealInside(this.root, dirname(target));
    const oldNotes = await this.loadNotes();
    const sourceRelative = relative(this.root, source).split(sep).join('/');
    const targetRelative = relative(this.root, target).split(sep).join('/');
    const moved = new Map(oldNotes.filter(note => note.relativePath === sourceRelative || (sourceInfo.isDirectory() && note.relativePath.startsWith(`${sourceRelative}/`)))
      .map(note => [note.id, `${targetRelative}${note.relativePath.slice(sourceRelative.length)}`.replace(/\.md$/i, '')]));
    const changed = oldNotes.flatMap(note => {
      const targets = new Map<number, string>();
      for (const [index, link] of wikiReferences(note.content).entries()) {
        const linked = resolveWikiNote(oldNotes, link.target, note);
        if (linked && (moved.has(linked.id) || (moved.has(note.id) && /^\.\.?\//.test(link.target)))) targets.set(index, moved.get(linked.id) ?? linked.id);
      }
      return targets.size ? [{ note, targets }] : [];
    });
    // Migrate only managed image references. Keep original attachments because
    // another note may still link to them; never silently delete shared assets.
    const content = sourceInfo.isFile() && /\.md$/i.test(source) ? await readFile(source, "utf8") : undefined;
    await rename(source, target);
    try {
      if (content !== undefined) {
        const managed = attachmentDirectory(source);
        const replacements = new Map<string, string>();
        const targets = renderMarkdown(content).flatMap((line) => line.segments.flatMap((segment) => segment.image ? [segment.image.target] : []));
        for (const ref of new Set(targets)) {
          const href = resolveLinkTarget(ref, source);
          if (!href?.startsWith("file:")) continue;
          const path = fileURLToPath(href);
          if (!path.startsWith(`${managed}${sep}`)) continue;
          await assertRealInside(this.root, path);
          const destination = await storeClipboardImage(this.root, target, await readFile(path));
          const link = markdownVaultFileLink(destination, relative(this.root, target).split(sep).join("/"), true);
          replacements.set(ref, link.slice(link.indexOf("](") + 2, -1));
        }
        if (replacements.size) {
          const updated = rewriteManagedImages(content, replacements);
          await this.save(await this.readNote(target), updated);
        }
      }
      for (const item of changed) {
        const path = moved.has(item.note.id)
          ? resolve(this.root, `${targetRelative}${item.note.relativePath.slice(sourceRelative.length)}`) : item.note.path;
        const current = await this.readNote(path);
        const references = wikiReferences(current.content);
        const replacements = new Map([...item.targets].flatMap(([index, target]) => references[index] ? [[references[index]!.start, target] as const] : []));
        await this.save(current, rewriteWikiTargets(current.content, replacements));
      }
    } catch (error) {
      await rename(target, source);
      for (const note of oldNotes) {
        const currentPath = note.path;
        if (changed.some(item => item.note.id === note.id) || (content !== undefined && note.path === source)) {
          await this.save({ ...note, path: currentPath }, note.content);
        }
      }
      throw error;
    }
    return targetRelative;
  }

  async deleteEntry(relativePath: string, kind: "note" | "folder"): Promise<TrashEntry> {
    const target = this.assertInside(resolve(this.root, relativePath));
    if (target === this.root) throw new Error("The vault root cannot be deleted");
    if (target === resolve(this.root, '.lattice') || target.startsWith(`${resolve(this.root, '.lattice')}${sep}`)) throw new Error('Lattice metadata cannot be deleted');
    await assertRealInside(this.root, target);
    const info = await stat(target);
    if (kind === "folder" ? !info.isDirectory() : !info.isFile() || extname(target).toLocaleLowerCase() !== ".md") {
      throw new Error(`Selected path is not a ${kind === "folder" ? "folder" : "Markdown file"}`);
    }
    const entry: TrashEntry = { id: randomUUID(), relativePath: relative(this.root, target).split(sep).join('/'), kind, deletedAt: Date.now() };
    const location = resolve(this.root, '.lattice', 'trash', entry.id);
    await mkdir(location, { recursive: true });
    await writeFile(resolve(location, 'meta.json'), JSON.stringify(entry), { flag: 'wx' });
    await rename(target, resolve(location, 'payload'));
    return entry;
  }

  async listTrash(): Promise<TrashEntry[]> {
    const folder = resolve(this.root, '.lattice', 'trash');
    let ids: string[];
    try { ids = await readdir(folder); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const entries = await Promise.all(ids.map(async id => {
      try {
        const entry = JSON.parse(await readFile(resolve(folder, id, 'meta.json'), 'utf8')) as TrashEntry;
        await stat(resolve(folder, id, 'payload'));
        return entry.id === id && /^[\da-f-]{36}$/i.test(id) && Number.isFinite(entry.deletedAt)
          && (entry.kind === 'note' || entry.kind === 'folder') && typeof entry.relativePath === 'string' ? entry : undefined;
      } catch { return undefined; }
    }));
    return entries.filter((entry): entry is TrashEntry => !!entry).sort((a, b) => b.deletedAt - a.deletedAt);
  }

  async purgeExpiredTrash(retentionDays: number, now = Date.now()): Promise<TrashEntry[]> {
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('Trash retention must be at least one day');
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const expired = (await this.listTrash()).filter(entry => entry.deletedAt <= cutoff);
    const removed: TrashEntry[] = [];
    for (const entry of expired) {
      const location = resolve(this.root, '.lattice', 'trash', entry.id);
      const info = await lstat(location);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      await rm(location, { recursive: true });
      removed.push(entry);
    }
    return removed;
  }

  async restoreEntry(id: string): Promise<string> {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('Invalid trash entry');
    const location = resolve(this.root, '.lattice', 'trash', id);
    const entry = JSON.parse(await readFile(resolve(location, 'meta.json'), 'utf8')) as TrashEntry;
    if (entry.id !== id) throw new Error('Invalid trash entry');
    let destination = this.assertInside(resolve(this.root, entry.relativePath));
    let suffix = 2;
    while (await fileExists(destination)) {
      const extension = entry.kind === 'note' ? '.md' : '';
      const stem = entry.relativePath.slice(0, entry.relativePath.length - extension.length);
      destination = this.assertInside(resolve(this.root, `${stem} (restored ${suffix++})${extension}`));
    }
    await mkdir(dirname(destination), { recursive: true });
    await assertRealInside(this.root, dirname(destination));
    await rename(resolve(location, 'payload'), destination);
    await unlink(resolve(location, 'meta.json'));
    return relative(this.root, destination).split(sep).join('/');
  }

  findLinkedNote(notes: Note[], target: string, source?: Note): Note | undefined {
    return resolveWikiNote(notes, target, source);
  }

  backlinks(notes: Note[], target: Note): Note[] {
    return notes.filter((note) => note.links.some((link) => this.findLinkedNote(notes, link, note)?.id === target.id));
  }

  search(notes: Note[], query: string): Note[] {
    return this.searchHits(notes, query).map(hit => hit.note);
  }

  searchHits(notes: Note[], query: string): SearchHit[] {
    return searchNotes(notes, query);
  }

  private assertInside(path: string): string {
    const resolved = resolve(path);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${sep}`)) {
      throw new Error("Refusing to access a path outside the vault");
    }
    return resolved;
  }
}

function rewriteManagedImages(content: string, replacements: Map<string, string>): string {
  let fence: string | undefined;
  return content.split("\n").map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return line;
    }
    if (fence || /^ {4}|^\t/.test(line)) return line;
    return line.replace(/(`+)[\s\S]*?\1|(!\[(?:\\.|[^\]\\])*\]\()([^\n)]+)(\))/g,
      (whole, code: string | undefined, prefix: string, target: string, suffix: string) =>
        code || !replacements.has(target) ? whole : prefix + replacements.get(target)! + suffix);
  }).join("\n");
}

async function walkMarkdown(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".lattice-tmp")) continue;
    if (entry.isDirectory() && isAttachmentDirectory(entry.name)) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...await walkMarkdown(path));
    else if (entry.isFile() && extname(entry.name).toLocaleLowerCase() === ".md") result.push(path);
  }
  return result;
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name.endsWith(".lattice-tmp")) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function walkFolders(root: string, current: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory() || isAttachmentDirectory(entry.name)) continue;
    const path = resolve(current, entry.name);
    result.push(relative(root, path).split(sep).join("/"));
    result.push(...await walkFolders(root, path));
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function normalizeNewNoteName(input: string): string {
  const cleaned = normalizeRelativePath(input)
    .trim()
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return cleaned || "Untitled";
}

function normalizeRelativePath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, "/")
    .replace(/[<>:"|?*\x00-\x1f]/g, "-")
    .split("/")
    .filter(Boolean)
    .map(sanitizePathPart)
    .join("/");
}

function sanitizePathPart(part: string): string {
  if (part === "." || part === "..") return "untitled";
  const portable = part.replace(/[. ]+$/g, "") || "untitled";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(portable)) return `${portable}-note`;
  return portable;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
