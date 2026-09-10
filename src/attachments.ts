import { createHash } from "node:crypto";
import { mkdir, realpath, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep, isAbsolute } from "node:path";
import { decodePng } from "./images.js";

export function attachmentDirectory(notePath: string): string {
  return notePath.replace(/\.md$/i, "") + ".assets";
}

/** Reserved document-attachment suffix; plain assets/ remains a normal folder. */
export function isAttachmentDirectory(name: string): boolean {
  return name.toLocaleLowerCase().endsWith(".assets");
}

export async function assertRealInside(root: string, path: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(path)]);
  const rel = relative(realRoot, realTarget);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Attachment path is outside this vault");
}

/** Document-local, content-addressed PNGs: repeated pastes reuse a file without overwriting it. */
export async function storeClipboardImage(root: string, notePath: string, image: Buffer): Promise<string> {
  if (image.length > 20 * 1024 * 1024) throw new Error("Clipboard image exceeds 20 MB");
  // Validate before making directories or writing any attachment.
  decodePng(image);
  await assertRealInside(root, notePath);
  const directory = attachmentDirectory(notePath);
  await assertRealInside(root, dirname(directory));
  await mkdir(directory, { recursive: true });
  await assertRealInside(root, directory);
  const filename = `image-${createHash("sha256").update(image).digest("hex").slice(0, 20)}.png`;
  const path = resolve(directory, filename);
  try { await writeFile(path, image, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await assertRealInside(root, path);
    if (!(await readFile(path)).equals(image)) throw new Error("An attachment with this name has different content");
  }
  return relative(root, path).split(sep).join("/");
}
