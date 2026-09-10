import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { extractLinks, extractTags, noteTitle } from "./markdown.js";
import type { Note, VaultFile } from "./types.js";
import { attachmentDirectory, assertRealInside, storeClipboardImage, isAttachmentDirectory } from "./attachments.js";
import { markdownVaultFileLink, resolveLinkTarget } from "./links.js";
import { renderMarkdown } from "./markdown.js";
import { fileURLToPath } from "node:url";

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
    // Migrate only managed image references. Keep original attachments because
    // another note may still link to them; never silently delete shared assets.
    const content = sourceInfo.isFile() && /\.md$/i.test(source) ? await readFile(source, "utf8") : undefined;
    await rename(source, target);
    if (content !== undefined) {
      try {
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
      } catch (error) {
        // The note itself is restored; any newly copied images remain recoverable.
        await rename(target, source);
        throw error;
      }
    }
    return relative(this.root, target).split(sep).join("/");
  }

  async deleteEntry(relativePath: string, kind: "note" | "folder"): Promise<void> {
    const target = this.assertInside(resolve(this.root, relativePath));
    if (target === this.root) throw new Error("The vault root cannot be deleted");
    await assertRealInside(this.root, target);
    const info = await stat(target);
    if (kind === "folder" ? !info.isDirectory() : !info.isFile() || extname(target).toLocaleLowerCase() !== ".md") {
      throw new Error(`Selected path is not a ${kind === "folder" ? "folder" : "Markdown file"}`);
    }
    await rm(target, { recursive: kind === "folder" });
  }

  findLinkedNote(notes: Note[], target: string): Note | undefined {
    const normalized = target.replace(/\\/g, "/").replace(/\.md$/i, "").toLocaleLowerCase();
    return notes.find((note) => note.id.toLocaleLowerCase() === normalized)
      ?? notes.find((note) => note.id.split("/").at(-1)?.toLocaleLowerCase() === normalized)
      ?? notes.find((note) => note.title.toLocaleLowerCase() === normalized);
  }

  backlinks(notes: Note[], target: Note): Note[] {
    return notes.filter((note) => note.links.some((link) => this.findLinkedNote([target], link)?.id === target.id));
  }

  search(notes: Note[], query: string): Note[] {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return notes;
    return notes
      .map((note) => {
        const title = `${note.title} ${note.relativePath}`.toLocaleLowerCase();
        const content = note.content.toLocaleLowerCase();
        const score = terms.reduce((total, term) => total + (title.includes(term) ? 10 : 0) + (content.includes(term) ? 1 : 0), 0);
        return { note, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title))
      .map(({ note }) => note);
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
