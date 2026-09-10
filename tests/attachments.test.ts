import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { storeClipboardImage } from "../src/attachments.js";
import { Vault } from "../src/vault.js";
import { markdownVaultFileLink } from "../src/links.js";
import { testPng } from "./image-fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lattice-attachment-test-")); roots.push(root);
  const vault = new Vault(root);
  const note = await vault.create("中文 空格/文档 (1)");
  return { root, vault, note };
}

describe("document attachments", () => {
  it("stores validated PNGs beside each document and deduplicates repeated pastes", async () => {
    const { root, vault, note } = await setup();
    const first = await storeClipboardImage(root, note.path, testPng());
    expect(first).toMatch(/^中文 空格\/文档 \(1\)\.assets\/image-[a-f0-9]{20}\.png$/);
    expect(await storeClipboardImage(root, note.path, testPng())).toBe(first);
    expect(await readFile(join(root, first))).toEqual(testPng());
    const other = await vault.create("Other");
    expect(await storeClipboardImage(root, other.path, testPng())).toMatch(/^Other.assets\//);
    expect(await readdir(join(root, "中文 空格/文档 (1).assets"))).toHaveLength(1);
    await expect(storeClipboardImage(root, other.path, Buffer.from("not a PNG"))).rejects.toThrow();
  });

  it("migrates managed references on rename/move, preserves code and shared originals", async () => {
    const { root, vault, note } = await setup();
    const path = await storeClipboardImage(root, note.path, testPng());
    const image = markdownVaultFileLink(path, note.relativePath, true);
    await vault.save(note, `# Title\n${image}\n\`\`\`md\n${image}\n\`\`\`\n\`${image}\`\n`);
    await vault.renameEntry(note.relativePath, "Elsewhere/Renamed.md");
    const saved = await readFile(join(root, "Elsewhere/Renamed.md"), "utf8");
    expect(saved).toContain("](Renamed.assets/image-");
    expect(saved).toContain(`\`\`\`md\n${image}\n\`\`\``);
    expect(saved).toContain(`\`${image}\``);
    expect(await readFile(join(root, path))).toEqual(testPng());
    expect(await readdir(join(root, "Elsewhere/Renamed.assets"))).toHaveLength(1);
    await vault.renameEntry("Elsewhere", "Moved");
    expect(await readFile(join(root, "Moved/Renamed.md"), "utf8")).toBe(saved);
  });

  it("rejects symlink escapes and restores the note if attachment migration fails", async () => {
    const { root, vault, note } = await setup();
    const outside = await mkdtemp(join(tmpdir(), "lattice-outside-test-")); roots.push(outside);
    await symlink(outside, join(root, "中文 空格/文档 (1).assets"), process.platform === "win32" ? "junction" : "dir");
    await expect(storeClipboardImage(root, note.path, testPng())).rejects.toThrow("outside");
    expect(await readdir(outside)).toEqual([]);
    const original = await readFile(note.path, "utf8");
    await vault.save(note, original + "![missing](%E6%96%87%E6%A1%A3%20%281%29.assets/missing.png)");
    await expect(vault.renameEntry(note.relativePath, "New.md")).rejects.toThrow();
    expect(await readFile(note.path, "utf8")).toContain("![missing]");
    await expect(readFile(join(root, "New.md"))).rejects.toThrow();
  });
});
