import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineComponent, h, provide } from "vue";
import { render } from "@vue-tui/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/app.vue";
import { KITTY_GRAPHICS, KittyPlacementGraphics } from "../src/graphics.js";
import { ImagePreviewCache } from "../src/images.js";
import type { RenderLine } from "../src/types.js";
import { testPng } from "./image-fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "lattice-picker-test-")); roots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "One.md"), "# One\n\n");
  await writeFile(join(root, "assets", "01-first.png"), testPng());
  await writeFile(join(root, "assets", "02-second.png"), testPng(128));
  await writeFile(join(root, "assets", "03-bad.png"), "invalid");
  return root;
}

describe("image selection preview", () => {
  it("previews each candidate before inserting, resizes, clears empty results and cancels", async () => {
    const root = await fixture();
    const writes: string[] = [];
    const graphics = new KittyPlacementGraphics((data) => { writes.push(data); });
    const viewport = vi.spyOn(graphics, "setViewport");
    const wrapper = defineComponent({ setup() { provide(KITTY_GRAPHICS, graphics); return () => h(App, { vaultPath: root }); } });
    const result = await render(wrapper, { columns: 120, rows: 30, mode: "fullscreen", color: "truecolor" });
    const currentImage = () => viewport.mock.lastCall?.[0][0]?.graphic;
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain("▫ One"));
      await result.stdin.write("\r");
      await result.stdin.write("/image\r");
      await vi.waitFor(() => expect(currentImage()).toBeDefined());
      expect(result.lastFrame()).toContain("IMAGE PREVIEW · Kitty native");
      const firstId = currentImage()!.id;
      const wideX = viewport.mock.lastCall![1];
      expect(wideX).toBeGreaterThan(60);
      await result.stdin.write("\x1b[B");
      await vi.waitFor(() => { expect(currentImage()).toBeDefined(); expect(currentImage()!.id).not.toBe(firstId); });
      const secondId = currentImage()!.id;
      expect(await readFile(join(root, "One.md"), "utf8")).toBe("# One\n\n");
      await result.terminal.resize(70, 22);
      await vi.waitFor(() => {
        expect(currentImage()?.id).toBe(secondId);
        expect(viewport.mock.lastCall![1]).toBe(2);
        expect(viewport.mock.lastCall![2]).toBeGreaterThan(8);
        expect(currentImage()!.rows).toBeLessThanOrEqual(viewport.mock.lastCall![4]);
      });
      expect(result.lastFrame()).not.toContain("VAULT ·");
      await result.stdin.write("no-match");
      await vi.waitFor(() => expect(viewport.mock.lastCall?.[0]).toEqual([]));
      expect(result.lastFrame()).toContain("No image selected");
      graphics.repaint(); expect(writes.at(-1)).not.toContain("a=p");
      await result.stdin.write("\x15"); await result.stdin.write("02-second");
      await vi.waitFor(() => expect(currentImage()?.id).toBe(secondId));
      await result.stdin.write("\r");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8"))
        .toBe("# One\n\n![02-second.png](assets/02-second.png)\n"));
      await result.stdin.write("/"); await result.stdin.write("image"); await result.stdin.write("\r");
      await vi.waitFor(() => expect(currentImage()?.id).toBe(firstId));
      await result.stdin.write("\x1b");
      await vi.waitFor(() => expect(viewport.mock.lastCall?.[0].some((row) => row.graphic?.id === firstId)).toBe(false));
      expect(result.lastFrame()).toContain("EDIT · One");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8"))
        .toBe("# One\n\n![02-second.png](assets/02-second.png)\n"));
    } finally { result.dispose(); graphics.dispose(); }
  });

  it("discards stale asynchronous loads and shows errors without changing the draft", async () => {
    const root = await fixture();
    let finish!: (rows: RenderLine[]) => void;
    const slow = new Promise<RenderLine[]>((resolve) => { finish = resolve; });
    vi.spyOn(ImagePreviewCache.prototype, "load").mockImplementation(async (target) => {
      if (target.includes("01-first")) return slow;
      if (target.includes("03-bad")) throw new Error("Invalid test PNG");
      return [{ kind: "image", indent: 0, segments: [{ text: "SECOND PREVIEW" }] }];
    });
    const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain("▫ One"));
      await result.stdin.write("\r");
      await result.stdin.write("/"); await result.stdin.write("image"); await result.stdin.write("\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Loading image"));
      await result.stdin.write("\x1b[B");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("SECOND PREVIEW"));
      finish([{ kind: "image", indent: 0, segments: [{ text: "STALE FIRST" }] }]);
      await result.terminal.resize(122, 30);
      await vi.waitFor(() => expect(result.lastFrame()).toContain("SECOND PREVIEW"));
      expect(result.lastFrame()).not.toContain("STALE FIRST");
      await result.stdin.write("\x1b[B");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Image unavailable"));
      await result.stdin.write("\x1b");
      expect(result.lastFrame()).not.toContain("IMAGE PREVIEW");
      expect(await readFile(join(root, "One.md"), "utf8")).toBe("# One\n\n");
      // Ordinary /file selection remains a file list, not an image viewer.
      await result.stdin.write("/file\r");
      expect(result.lastFrame()).toContain("VAULT FILES");
      expect(result.lastFrame()).not.toContain("IMAGE PREVIEW");
    } finally { finish([]); result.dispose(); }
  });
});
