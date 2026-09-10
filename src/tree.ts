import type { Note } from "./types.js";

export interface FolderTreeItem {
  kind: "folder";
  key: string;
  label: string;
  relativePath: string;
  depth: number;
  expanded: boolean;
}

export interface NoteTreeItem {
  kind: "note";
  key: string;
  label: string;
  relativePath: string;
  depth: number;
  note: Note;
}

export type TreeItem = FolderTreeItem | NoteTreeItem;

interface Branch {
  path: string;
  folders: Map<string, Branch>;
  notes: Note[];
}

export function buildVaultTree(notes: Note[], folders: string[], expandedFolders: ReadonlySet<string>): TreeItem[] {
  const root: Branch = { path: "", folders: new Map(), notes: [] };
  for (const folder of folders) ensureBranch(root, normalize(folder));
  for (const note of notes) {
    const parts = note.relativePath.split("/");
    parts.pop();
    ensureBranch(root, parts.join("/")).notes.push(note);
  }

  const result: TreeItem[] = [];
  flatten(root, -1, expandedFolders, result);
  return result;
}

export function buildSearchTree(notes: Note[]): TreeItem[] {
  return notes.map((note) => ({
    kind: "note",
    key: `note:${note.id}`,
    label: note.relativePath.replace(/\.md$/i, ""),
    relativePath: note.relativePath,
    depth: 0,
    note,
  }));
}

export function parentFolder(relativePath: string): string {
  const parts = normalize(relativePath).split("/");
  parts.pop();
  return parts.join("/");
}

function ensureBranch(root: Branch, folder: string): Branch {
  let current = root;
  if (!folder) return current;
  for (const name of folder.split("/")) {
    const path = current.path ? `${current.path}/${name}` : name;
    let child = current.folders.get(name);
    if (!child) {
      child = { path, folders: new Map(), notes: [] };
      current.folders.set(name, child);
    }
    current = child;
  }
  return current;
}

function flatten(branch: Branch, depth: number, expanded: ReadonlySet<string>, result: TreeItem[]): void {
  const childFolders = [...branch.folders.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [label, child] of childFolders) {
    const isExpanded = expanded.has(child.path);
    result.push({
      kind: "folder",
      key: `folder:${child.path}`,
      label,
      relativePath: child.path,
      depth: depth + 1,
      expanded: isExpanded,
    });
    if (isExpanded) flatten(child, depth + 1, expanded, result);
  }
  for (const note of [...branch.notes].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    result.push({
      kind: "note",
      key: `note:${note.id}`,
      label: note.relativePath.split("/").at(-1)!.replace(/\.md$/i, ""),
      relativePath: note.relativePath,
      depth: depth + 1,
      note,
    });
  }
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
