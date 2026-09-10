import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Vault } from "../src/vault.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Vault", () => {
  it("hides attachment directories from navigation but keeps their files selectable", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-test-")); temporaryRoots.push(root);
    const vault = new Vault(root);
    await vault.create("Work/One");
    await mkdir(join(root, "Work", "One.assets", "nested"), { recursive: true });
    await mkdir(join(root, "Old.ASSETS"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "Work", "One.assets", "nested", "metadata.md"), "# Internal");
    await writeFile(join(root, "Work", "One.assets", "image.png"), "png");
    await writeFile(join(root, "assets", "Visible.md"), "# Visible");
    expect(await vault.loadFolders()).toEqual(["assets", "Work"]);
    expect((await vault.loadNotes()).map((note) => note.relativePath)).toEqual(["assets/Visible.md", "Work/One.md"]);
    expect((await vault.loadFiles()).map((file) => file.relativePath)).toContain("Work/One.assets/image.png");
    await vault.renameEntry("Work", "Projects");
    expect(await vault.loadFolders()).toEqual(["assets", "Projects"]);
    expect((await vault.loadFiles()).map((file) => file.relativePath)).toContain("Projects/One.assets/image.png");
  });
  it("loads, searches and resolves backlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-test-"));
    temporaryRoots.push(root);
    await writeFile(join(root, "Alpha.md"), "# Alpha\nLinks to [[Beta]]. #one", "utf8");
    await writeFile(join(root, "Beta.md"), "# Beta\nA searchable phrase", "utf8");
    const vault = new Vault(root);
    const notes = await vault.loadNotes();

    expect(notes).toHaveLength(2);
    expect(vault.search(notes, "searchable")[0]?.title).toBe("Beta");
    expect(vault.backlinks(notes, notes[1]!)[0]?.title).toBe("Alpha");
  });

  it("indexes all visible files inside the vault", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-test-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "Note.md"), "# Note", "utf8");
    await writeFile(join(root, "assets", "manual.pdf"), "pdf", "utf8");
    await writeFile(join(root, ".secret"), "hidden", "utf8");
    await writeFile(join(root, "draft.lattice-tmp"), "temporary", "utf8");

    expect((await new Vault(root).loadFiles()).map((file) => file.relativePath))
      .toEqual(["assets/manual.pdf", "Note.md"]);
  });

  it("creates collision-safe notes and saves atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-test-"));
    temporaryRoots.push(root);
    const vault = new Vault(root);
    const first = await vault.create("Folder/Idea");
    const second = await vault.create("Folder/Idea");
    const saved = await vault.save(first, "# Updated\n");

    expect(first.relativePath).toBe("Folder/Idea.md");
    expect(second.relativePath).toBe("Folder/Idea 2.md");
    expect(saved.title).toBe("Updated");
  });

  it("creates filenames that remain valid on Windows", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-test-"));
    temporaryRoots.push(root);
    const vault = new Vault(root);

    const note = await vault.create("CON/Idea. ");
    const folder = await vault.createFolder("AUX/Archive. ");

    expect(note.relativePath).toBe("CON-note/Idea.md");
    expect(folder).toBe("AUX-note/Archive");
  });

  it("creates, lists, renames and deletes files and folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-test-"));
    temporaryRoots.push(root);
    const vault = new Vault(root);

    await vault.createFolder("Work/Ideas");
    expect(await vault.loadFolders()).toEqual(["Work", "Work/Ideas"]);
    expect(await vault.renameEntry("Work/Ideas", "Work/Archive")).toBe("Work/Archive");
    await vault.deleteEntry("Work/Archive", "folder");
    expect(await vault.loadFolders()).toEqual(["Work"]);
    const note = await vault.create("Work/Note");
    await vault.deleteEntry(note.relativePath, "note");
    expect(await vault.loadNotes()).toEqual([]);
  });

  it("deletes a non-empty folder recursively and validates type and root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-test-"));
    temporaryRoots.push(root);
    const vault = new Vault(root);
    await mkdir(join(root, "Keep"));
    await writeFile(join(root, "Keep", "Note.md"), "# Keep", "utf8");

    await vault.deleteEntry("Keep", "folder");
    expect(await vault.loadFolders()).toEqual([]);
    await writeFile(join(root, "One.md"), "# One", "utf8");
    await expect(vault.deleteEntry("One.md", "folder")).rejects.toThrow("not a folder");
    await expect(vault.deleteEntry("", "folder")).rejects.toThrow("root");
    await expect(vault.deleteEntry("../outside.md", "note")).rejects.toThrow("outside");
  });
});
