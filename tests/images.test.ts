import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
import { decodePng, ImagePreviewCache } from "../src/images.js";
import { markdownVaultFileLink } from "../src/links.js";
import { renderMarkdown } from "../src/markdown.js";
import { testPng } from "./image-fixture.js";

describe("image previews", () => {
  it.runIf(process.platform === "darwin")("previews a JPEG using the installed macOS converter", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-jpeg-test-"));
    try {
      const png = join(root, "sample.png"), jpg = join(root, "sample.jpg");
      await writeFile(png, testPng());
      await promisify(execFile)("/usr/bin/sips", ["-s", "format", "jpeg", png, "--out", jpg]);
      const rows = await new ImagePreviewCache().load("sample.jpg", join(root, "note.md"), root, 20);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.segments[0]?.text).toBe("▀");
      expect(rows.flatMap((line) => line.segments).every((segment) => /^#[0-9a-f]{6}$/.test(segment.color ?? ""))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("decodes PNG pixels and rejects truncated content", () => {
    const result = decodePng(testPng());
    expect([result.width, result.height]).toEqual([8, 4]);
    expect([...result.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...result.rgba.subarray(16, 20)]).toEqual([0, 0, 255, 255]);
    expect(() => decodePng(testPng().subarray(0, 40))).toThrow();
  });

  it("round-trips special filenames and excludes images in code fences", () => {
    const md = markdownVaultFileLink("assets/a [1](图).png", "guides/one.md", true);
    const segment = renderMarkdown(md).flatMap((line) => line.segments).find((part) => part.image);
    expect(segment?.image?.alt).toBe("a [1](图).png");
    expect(segment?.image?.target).toBe("../assets/a%20%5B1%5D%28%E5%9B%BE%29.png");
    expect(renderMarkdown(`\`\`\`md\n${md}\n\`\`\``).flatMap((line) => line.segments).some((part) => part.image)).toBe(false);
  });

  it("renders bounded colour thumbnails and refuses files outside the vault", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lattice-image-test-"));
    try {
      const root = join(directory, "vault"); await mkdir(root);
      await writeFile(join(root, "sample.png"), testPng());
      await writeFile(join(directory, "outside.png"), testPng());
      const cache = new ImagePreviewCache();
      const rows = await cache.load("sample.png", join(root, "note.md"), root, 8);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.segments).toHaveLength(8);
      expect(rows[0]?.segments[0]).toMatchObject({ text: "▀", color: "#ff0000", backgroundColor: "#ff0000" });
      expect(rows[0]?.segments[7]?.color).toBe("#0000ff");
      const shortPreview = await cache.load("sample.png", join(root, "note.md"), root, 8, 1);
      expect(shortPreview).toHaveLength(1);
      expect(shortPreview[0]?.segments).toHaveLength(4);
      await writeFile(join(root, "transparent.png"), testPng(0));
      const transparent = await cache.load("transparent.png", join(root, "note.md"), root, 8);
      expect(transparent[0]?.segments[0]).toMatchObject({ color: "#111318", backgroundColor: "#111318" });
      await expect(cache.load("../outside.png", join(root, "note.md"), root, 8)).rejects.toThrow("outside");
      await expect(cache.load("https://example.com/a.png", join(root, "note.md"), root, 8)).rejects.toThrow("Remote");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
