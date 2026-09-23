import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { render } from "@vue-tui/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/app.vue";
import { testPng } from "./image-fixture.js";
import * as clipboard from "../src/clipboard.js";
import { defineComponent, h, provide } from "vue";
import { KITTY_GRAPHICS, KittyGraphics, KittyPlacementGraphics, IMAGE_PLACEHOLDER } from "../src/graphics.js";
import { Vault } from "../src/vault.js";
import { MOUSE_INPUT, MouseParser, type MouseEvent } from "../src/mouse.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("editing workspace", () => {
  it("shows a non-blocking update notice when a newer version is available", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-update-notice-")); temporaryRoots.push(root);
    await writeFile(join(root, "A.md"), "# A");
    const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root, updateCheck: Promise.resolve("9.0.0") } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Update available: v9.0.0"));
      expect(result.lastFrame()).toContain("↑ v9.0.0");
      expect(result.lastFrame()).toContain("npm install -g lattice-tui@latest");
    } finally { result.dispose(); }
  });

  it("returns focus to the vault after leaving edit mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-edit-focus-")); temporaryRoots.push(root);
    await writeFile(join(root, "A.md"), "# A");
    await writeFile(join(root, "B.md"), "# B");
    const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain("SELECTED · A.md"));
      await result.stdin.write("\r");
      expect(result.lastFrame()).toContain("EDIT · A");
      await result.stdin.write("\x1b");
      await result.stdin.write("\x1b[B");
      expect(result.lastFrame()).toContain("SELECTED · B.md");
    } finally { result.dispose(); }
  });

  it('wraps list selection from first to last and back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-list-wrap-')); temporaryRoots.push(root);
    await writeFile(join(root, 'A.md'), '# A');
    await writeFile(join(root, 'B.md'), '# B');
    await writeFile(join(root, 'C.md'), '# C');
    const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain('SELECTED · A.md'));
      await result.stdin.write('\x1b[A');
      expect(result.lastFrame()).toContain('SELECTED · C.md');
      await result.stdin.write('\x1b[B');
      expect(result.lastFrame()).toContain('SELECTED · A.md');
      await result.stdin.write('/');
      await result.stdin.write('\x1b[A');
      expect(result.lastFrame()).toContain('/quit · Quit');
      await result.stdin.write('\x1b[B');
      expect(result.lastFrame()).toContain('/jot · Quick note');
      await result.stdin.write('\x1b');
      await result.stdin.write('e');
      await result.stdin.write('/');
      await result.stdin.write('\x1b[A');
      expect(result.lastFrame()).toContain('› Save note');
      await result.stdin.write('\x1b[B');
      expect(result.lastFrame()).toContain('› Heading 1');
    } finally { result.dispose(); }
  });

  it('switches to Chinese UI and persists the vault language', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-language-')); temporaryRoots.push(root);
    await writeFile(join(root, 'One.md'), '# One');
    let result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain('SELECTED · One.md'));
      await result.stdin.write('/settings\r\x1b[A');
      expect(result.lastFrame()).toContain('› AI MODEL');
      await result.stdin.write('\x1b[B\x1b[B\x1b[B\x1b[C');
      await vi.waitFor(() => expect(result.lastFrame()).toContain('语言 · 简体中文'));
      expect(result.lastFrame()).toContain('设置已保存');
      await result.stdin.write('\x1b');
      await result.stdin.write('/');
      expect(result.lastFrame()).toContain('◆ 命令');
      expect(result.lastFrame()).toContain('/jot · 随记');
      const selectedCommand = result.lastFrame({ raw: true }).split('\n').find(line => line.includes('/jot'))!;
      const selectedTail = selectedCommand.slice(selectedCommand.indexOf('随记') + '随记'.length);
      const backgroundEnd = selectedTail.search(/\x1b\[(?:49|48;)/);
      expect(backgroundEnd).toBeGreaterThan(0);
      expect(selectedTail.slice(0, backgroundEnd).replaceAll(/\x1b\[[\d;]*m/g, '')).toMatch(/^ {20,}$/);
      await result.stdin.write('\x1b/model\r\x1b[A');
      expect(result.lastFrame()).toContain('AI 模型配置');
      expect(result.lastFrame()).toContain('› API 密钥');
      result.dispose();
      result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
      await vi.waitFor(() => expect(result.lastFrame()).toContain('已选择 · One.md'));
      await result.stdin.write('/settings\r');
      expect(result.lastFrame()).toContain('◆ 设置');
      expect(result.lastFrame()).toContain('语言 · 简体中文');
    } finally { result.dispose(); }
  });

  it("shows the complete selected file or folder path outside the narrow tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-selected-path-")); temporaryRoots.push(root);
    const folder = `Folder-${"f".repeat(52)}`;
    const note = `Note-${"n".repeat(55)}.md`;
    await mkdir(join(root, folder));
    await writeFile(join(root, note), "# Long name");
    const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(`SELECTED · ${note}`));
      await result.stdin.write("\x1b[H");
      expect(result.lastFrame()).toContain(`SELECTED · ${folder}`);
    } finally { result.dispose(); }
  });

  it("fills the selected vault row without shifting a CJK filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-cjk-filename-")); temporaryRoots.push(root);
    await writeFile(join(root, "中文文件.md"), "# 中文");
    const result = await render(App, { columns: 80, rows: 24, color: "truecolor", props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain("SELECTED · 中文文件.md"));
      const row = result.lastFrame({ raw: true }).split("\n").find((line) => line.includes(" 中文文件"));
      expect(row).not.toContain("\x1b[7m");
      expect(row).not.toContain("›");
      expect(row).toMatch(/\x1b\[48;2;136;192;208m(?:\x1b\[[\d;]+m)*   中文文件 +/);
    } finally { result.dispose(); }
  });

  it.each(['macos', 'windows', 'linux'] as const)('routes application actions through slash commands on %s', async keymap => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-chords-')); temporaryRoots.push(root);
    await writeFile(join(root, 'One.md'), '# One');
    const result = await render(App, { columns: 100, rows: 24, props: { vaultPath: root, keymap } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
      await result.stdin.write('\r');
      await result.stdin.write('\x1b');
      await result.stdin.write('/');
      expect(result.lastFrame()).toContain('/jot');
      await result.stdin.write('\x1b');
      expect(result.lastFrame()).toContain('One · thumbnail');
      await result.stdin.write('\x1bOP\x1bOQ\x1bOR\x1bOS\x1b[18~\x1b[19~\x1b[20~\x1b[21~\x1b[23~');
      expect(result.lastFrame()).toContain('One · thumbnail');
      await result.stdin.write('\x1b');
      await result.stdin.write('/settings\r');
      expect(result.lastFrame()).toContain('SETTINGS');
      await result.stdin.write('\x1b');
      await result.stdin.write('\x1b');
      await result.stdin.write('/');
      expect(result.lastFrame()).toContain('/jot');
      expect(result.lastFrame()).toContain(keymap === 'macos' ? '↩ run' : 'Enter run');
      expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('# One');
    } finally { result.dispose(); }
  });
  it('keeps move selection visible in short windows and after resize', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-move-scroll-')); temporaryRoots.push(root);
    await Promise.all(Array.from({ length: 25 }, (_, i) => mkdir(join(root, `Folder${String(i).padStart(2, '0')}`))));
    await writeFile(join(root, 'One.md'), '# One');
    const result = await render(App, { columns: 60, rows: 16, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
      await result.stdin.write('/move\rOne.md\r\x1b[F');
      let screen = await result.screen();
      expect(screen.lines.some(line => line.includes('›  Folder24'))).toBe(true);
      expect(screen.lines.some(line => line.includes('VAULT ·'))).toBe(false);
      await result.terminal.resize(80, 13);
      screen = await result.screen();
      expect(screen.lines.some(line => line.includes('›  Folder24'))).toBe(true);
      await result.stdin.write('\x1b[5~'); // PageUp: a full visible page.
      screen = await result.screen();
      expect(screen.lines.some(line => line.includes('›  Folder22'))).toBe(true);
      await result.stdin.write('\r');
      expect(result.lastFrame()).toContain('Confirm move');
      await result.stdin.write('\x1b');
      expect(result.lastFrame()).toContain('Choose destination folder');
      expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('# One');
    } finally { result.dispose(); }
  });
  it('moves a note through the vault destination picker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-move-')); temporaryRoots.push(root);
    await mkdir(join(root, 'Target'));
    await writeFile(join(root, 'One.md'), '# One');
    const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
      await result.stdin.write('/move\rOne.md\r');
      expect(result.lastFrame()).toContain('Choose destination folder');
      await result.stdin.write('Target\r');
      expect(result.lastFrame()).toContain('Confirm move');
      expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('# One');
      await result.stdin.write('\r');
      await vi.waitFor(async () => expect(await readFile(join(root, 'Target/One.md'), 'utf8')).toBe('# One'));
      await expect(readFile(join(root, 'One.md'))).rejects.toMatchObject({ code: 'ENOENT' });
      await vi.waitFor(() => expect(result.lastFrame()).toContain('Moved'));
    } finally { result.dispose(); }
  });
  it('imports a local file into the selected note parent from the CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-import-ui-')); temporaryRoots.push(root);
    const external = await mkdtemp(join(tmpdir(), 'lattice-import-source-')); temporaryRoots.push(external);
    await mkdir(join(root, 'Projects'));
    await writeFile(join(root, 'Projects/One.md'), '# One');
    await writeFile(join(external, 'Imported.md'), '# Imported');
    const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
      await result.stdin.write('/settings\r'); // settings opens without affecting selection
      await result.stdin.write('\x1b');
      await result.stdin.write('/import\r');
      expect(result.lastFrame()).toContain('Destination: Projects');
      await result.stdin.write(`\x1b[200~${join(external, 'Imported.md')}\x1b[201~\r`);
      await vi.waitFor(async () => expect(await readFile(join(root, 'Projects/Imported.md'), 'utf8')).toBe('# Imported'));
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' Imported'));
    } finally { result.dispose(); }
  });
  it('auto-saves by default and persists settings and theme across restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-settings-')); temporaryRoots.push(root);
    await writeFile(join(root, 'One.md'), 'hello');
    let result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
      await result.stdin.write('\r!');
      await vi.waitFor(async () => expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('hello!'), { timeout: 3000 });
      await result.stdin.write('\x1b');
      await result.stdin.write('/settings\r');
      expect(result.lastFrame()).toContain('AUTO SAVE · [ ON ]');
      expect(result.lastFrame()).not.toContain('VAULT · 0');
      await result.stdin.write('\r');
      await vi.waitFor(() => expect(result.lastFrame()).toContain('AUTO SAVE · [ OFF ]'));
      await result.stdin.write('\x1b[B\x1b[C');
      await vi.waitFor(() => expect(result.lastFrame()).toContain('THEME · Nord'));
      expect(JSON.parse(await readFile(join(root, '.lattice/settings.json'), 'utf8'))).toEqual({ autoSave: false, theme: 'nord', language: 'en', trashRetentionDays: 30 });
      await result.stdin.write('\x1b');
      expect(result.lastFrame()).toContain('One · thumbnail');
      await result.stdin.write('/edit\r');
      await result.stdin.write('?');
      await new Promise(resolve => setTimeout(resolve, 1200));
      expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('hello!');
      result.dispose();
      result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root } });
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
      await result.stdin.write('/settings\r');
      await vi.waitFor(() => expect(result.lastFrame()).toContain('THEME · Nord'));
      expect(result.lastFrame()).toContain('AUTO SAVE · [ OFF ]');
    } finally { result.dispose(); }
  });
  it.each([
    ["macos", "macOS", "⌃A/C/X/V", "⌥←/→", "⇥ · ↑↓ · ↩", "⌃⌫/⌦"],
    ["windows", "Windows", "Ctrl+A/C/X/V", "Ctrl+←/→", "Tab · ↑↓ · Enter", "Ctrl+Backspace/Del"],
    ["linux", "Linux", "Ctrl+A/C/X/V", "Ctrl+←/→", "Tab · ↑↓ · Enter", "Ctrl+Backspace/Del"],
  ] as const)("shows only %s text-editing keys", async (keymap, system, textKeys, wordKeys, navigationKeys, deletionKeys) => {
    const root = await mkdtemp(join(tmpdir(), "lattice-keymap-help-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "text");
    const result = await render(App, { columns: 120, rows: 24, props: { vaultPath: root, keymap } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("/help\r");
      const help = result.lastFrame();
      expect(help).toContain(`${system} · application actions use / commands`);
      expect(help).toContain("TEXT EDITING · ALL SYSTEMS");
      expect(help).toContain(textKeys);
      expect(help).toContain(wordKeys);
      expect(help).toContain(navigationKeys);
      expect(help).toContain(deletionKeys);
      expect(help).toContain("click cursor · drag selection");
      expect(help).not.toContain("⌘P/F/N");
      await result.stdin.write("/");
      const palette = result.lastFrame();
      expect(palette).toContain('/jot');
      expect(palette).toContain(keymap === "macos" ? '⇥ complete' : 'Tab complete');
    } finally { result.dispose(); }
  });

  it.each(["macos", "windows", "linux"] as const)("keeps %s text actions in the editor and e enters editing", async (keymap) => {
    const root = await mkdtemp(join(tmpdir(), "lattice-keymap-")); temporaryRoots.push(root);
    const original = "one two\nsecond";
    await writeFile(join(root, "One.md"), original);
    const copy = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue();
    const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root, keymap } });
    const control = (letter: string, shift = false) => `\x1b[${letter.codePointAt(0)};${5 + Number(shift)}u`;
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r\x1b[1;5H");
      await result.stdin.write("\x1b[1;2F"); // Shift+End selects the first line on every keymap.
      await result.stdin.write(control("c"));
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Selection copied"));
      expect(copy).toHaveBeenLastCalledWith("one two");
      await result.stdin.write("X");
      await result.stdin.write("/save\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      expect(await readFile(join(root, "One.md"), "utf8")).toBe("X\nsecond");
      await result.stdin.write(control("z"));
      await result.stdin.write("/save\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      expect(await readFile(join(root, "One.md"), "utf8")).toBe(original);
      await result.stdin.write(control("z", true));
      await result.stdin.write("/save\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      expect(await readFile(join(root, "One.md"), "utf8")).toBe("X\nsecond");
      await result.stdin.write("\x1b");
      await result.stdin.write("/");
      expect(result.lastFrame()).not.toContain("/select-all");
      expect(result.lastFrame()).not.toContain("/copy");
      expect(result.lastFrame()).not.toContain("/cut");
      expect(result.lastFrame()).not.toContain("/undo");
      expect(result.lastFrame()).not.toContain("/redo");
      await result.stdin.write("\x1b");
      await result.stdin.write("e");
      expect(result.lastFrame()).toContain("EDIT · One");
      await result.stdin.write(control("a"));
      await result.stdin.write(control("c"));
      await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("X\nsecond"));
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Selection copied"));
      await result.stdin.write(control("z"));
      await result.stdin.write("/save\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      expect(await readFile(join(root, "One.md"), "utf8")).toBe(original);
    } finally { result.dispose(); }
  });

  it.each(["macos", "windows", "linux"] as const)("preserves text for unsupported %s combinations and uses Ctrl word movement", async (keymap) => {
    const root = await mkdtemp(join(tmpdir(), "lattice-keymap-safety-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "one two");
    const copy = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue();
    const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root, keymap } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r\x1b[1;5H\x1b[120;7u\x1b[3;7~"); // Ctrl+Alt+X/Delete must not cut/delete.
      if (keymap !== "macos") await result.stdin.write("\x1b[120;9u\x1b[3;9:1~"); // Super is a desktop key.
      expect(copy).not.toHaveBeenCalled();
      await result.stdin.write("\x1b[1;5CX"); // Ctrl+Right: advance one word, insert before 'two'.
      await result.stdin.write("/save\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      expect(await readFile(join(root, "One.md"), "utf8")).toBe("one Xtwo");
    } finally { result.dispose(); }
  });
  it("selects with Shift, copies/cuts safely, replaces pasted text and supports undo/redo", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-edit-selection-")); temporaryRoots.push(root);
    const original = "abc中😀def\nsecond";
    await writeFile(join(root, "One.md"), original);
    const copy = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue();
    const result = await render(App, { columns: 120, rows: 30, color: "truecolor", props: { vaultPath: root, keymap: "macos" } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r\x1b[1;5H\x1b[1;2C\x1b[1;2C\x03");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Selection copied"));
      expect(result.lastFrame()).toContain("⌃C copy");
      expect(result.lastFrame()).toContain("⌃V paste");
      expect(copy).toHaveBeenLastCalledWith("ab");
      expect(result.lastFrame({ raw: true })).toMatch(/\x1b\[48;2;136;192;208m(?:\x1b\[[\d;]+m)*ab/);
      expect(result.lastFrame({ raw: true })).not.toContain("\x1b[7m");
      await result.stdin.write("\x18");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Selection cut"));
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("c中😀def\nsecond"));
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      await result.stdin.write("\x1a");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe(original));
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      await result.stdin.write("\x19");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("c中😀def\nsecond"));
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      copy.mockRejectedValueOnce(new Error("permission denied"));
      await result.stdin.write("\x01\x18");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Copy failed"));
      await result.stdin.write("/save\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      expect(await readFile(join(root, "One.md"), "utf8")).toBe("c中😀def\nsecond");
      await result.stdin.write("\x1b[200~replacement\r\n中文\x1b[201~");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("replacement\n中文"));
      await result.stdin.write("\x03");
      expect(result.lastFrame()).toContain("No text selected");
      expect(result.lastFrame()).toContain("EDIT · One");
    } finally { result.dispose(); }
  });

  it('finds and replaces text through Ctrl shortcuts and keeps each replacement undoable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lattice-find-replace-')); temporaryRoots.push(root);
    await writeFile(join(root, 'One.md'), 'alpha 中文 alpha');
    const control = (letter: string) => `\x1b[${letter.codePointAt(0)};5u`;
    const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root, keymap: 'macos' } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(' One'));
      await result.stdin.write(`\r${control('f')}alpha\r`);
      expect(result.lastFrame()).toContain('⌕ FIND');
      expect(result.lastFrame()).toContain('1 / 2');
      await result.stdin.write(control('r'));
      expect(result.lastFrame()).toContain('FIND & REPLACE');
      await result.stdin.write('\t');
      await result.stdin.write('beta');
      await result.stdin.write('\t\r');
      await vi.waitFor(() => expect(result.lastFrame()).toContain('Replaced · 1 matches remain'));
      await result.stdin.write('\t\r');
      expect(result.lastFrame()).toContain('Replaced 1 matches');
      await result.stdin.write('\x1b');
      await result.stdin.write('/save\r');
      await vi.waitFor(async () => expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('beta 中文 beta'));
      await result.stdin.write(control('z'));
      await result.stdin.write('/save\r');
      await vi.waitFor(async () => expect(await readFile(join(root, 'One.md'), 'utf8')).toBe('beta 中文 alpha'));
    } finally { result.dispose(); }
  });

  it("keeps Ctrl-Shift document selection continuous across CJK caret cells", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-edit-command-selection-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "中文abc");
    const copy = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue();
    const result = await render(App, { columns: 80, rows: 24, color: "truecolor", props: { vaultPath: root, keymap: "macos" } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r\x1b[1;5H"); // Ctrl+Home puts the caret on the first CJK glyph.
      await vi.waitFor(() => expect(result.lastFrame({ raw: true })).toMatch(/\x1b\[48;2;136;192;208m(?:\x1b\[[\d;]+m)*中(?:\x1b\[[\d;]+m)*\x1b\[48;2;17;19;24m/));
      expect(result.lastFrame({ raw: true })).not.toContain("\x1b[7m");
      await result.stdin.write("\x1b[1;5F\x1b[1;6H"); // End, then Ctrl+Shift+Home selects the document.
      await vi.waitFor(() => expect(result.lastFrame({ raw: true })).toMatch(/\x1b\[48;2;136;192;208m(?:\x1b\[[\d;]+m)*中文abc/));
      const selectedRow = result.lastFrame({ raw: true }).split('\n').find(line => line.includes('1 │'))!;
      const selectedStyle = selectedRow.slice(selectedRow.indexOf('\x1b[48;2;136;192;208m'), selectedRow.indexOf('中文abc'));
      expect(selectedStyle).not.toContain('\x1b[1m');
      await result.stdin.write("\x03"); // Ctrl+C
      await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("中文abc"));

      await result.stdin.write("\x1b[1;5H\x1b[1;2C\x03"); // Select one CJK glyph forwards.
      await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("中"));
      expect(result.lastFrame({ raw: true })).toMatch(/\x1b\[48;2;136;192;208m(?:\x1b\[[\d;]+m)*中(?:\x1b\[[\d;]+m)*\x1b\[48;2;17;19;24m/);

      await result.stdin.write("\x1b[1;5F"); // Ctrl+End collapses at document end.
      await result.stdin.write("\x1b[1;5H\x1b[1;6F\x03"); // Start, then Ctrl+Shift+End and copy.
      await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("中文abc"));
    } finally { result.dispose(); }
  });

  it("maps real mouse reports to editor cells, drags across Unicode/lines and ignores the preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-edit-mouse-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "abc中😀def\nsecond");
    let listener: ((event: MouseEvent) => void) | undefined;
    const enabled = vi.fn(), unsubscribe = vi.fn();
    const controller = { setEnabled: enabled, subscribe(handler: (event: MouseEvent) => void) { listener = handler; return unsubscribe; } };
    const parser = new MouseParser(() => {}, (event) => listener?.(event));
    const report = (button: number, x: number, y: number, up = false) => parser.feed(Buffer.from(`\x1b[<${button};${x + 1};${y + 1}${up ? "m" : "M"}`));
    const wrapper = defineComponent({ setup() { provide(MOUSE_INPUT, controller); return () => h(App, { vaultPath: root }); } });
    const copy = vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue();
    const result = await render(wrapper, { columns: 120, rows: 30, color: "truecolor", mode: "fullscreen" });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      expect(enabled).toHaveBeenLastCalledWith(false);
      await result.stdin.write("\r\x1b[1;5H");
      await vi.waitFor(() => expect(enabled).toHaveBeenLastCalledWith(true));
      const lines = (await result.screen()).lines;
      const y = lines.findIndex((line) => line.includes("abc中😀def"));
      const x = lines[y]!.indexOf("abc");
      expect(x).toBeGreaterThan(35); expect(y).toBeGreaterThan(0);
      report(0, x + 3, y); report(32, x + 7, y); report(0, x + 7, y, true);
      await result.stdin.write("\x03");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Selection copied"));
      expect(copy).toHaveBeenLastCalledWith("中😀");
      // Preview clicks must not reposition the editor's insertion point/selection.
      report(0, 115, y); report(0, 115, y, true);
      await result.stdin.write("X");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("abcXdef\nsecond"));
      report(0, x + 1, y); report(32, x + 2, y + 1); report(0, x + 3, y + 1, true);
      await result.stdin.write("\x03");
      await vi.waitFor(() => expect(copy).toHaveBeenLastCalledWith("bcXdef\nsec"));
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Selection copied"));
      // A plain click clears selection, then Shift-click extends from that caret.
      report(0, x, y); report(0, x, y, true);
      report(4, x + 3, y); report(4, x + 3, y, true);
      await result.stdin.write("Y");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("YXdef\nsecond"));
      await result.stdin.write("/");
      await vi.waitFor(() => expect(enabled).toHaveBeenLastCalledWith(true));
    } finally { result.dispose(); }
    expect(unsubscribe).toHaveBeenCalled();
    expect(enabled).toHaveBeenLastCalledWith(false);
  });

  it("keeps the caret visible on long lines and restores the start after resize/Home", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-edit-long-line-")); temporaryRoots.push(root);
    const original = "START-" + "中".repeat(80) + "-END";
    await writeFile(join(root, "One.md"), original);
    const result = await render(App, { columns: 80, rows: 24, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("-END"));
      await result.terminal.resize(120, 30);
      await result.stdin.write("\x1b[H");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("START-"));
      await result.stdin.write("\x1b[1;2F!"); // Shift+End replaces the full line.
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("!"));
    } finally { result.dispose(); }
  });
  it("wraps and vertically scrolls long preview text in a narrow terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-preview-wrap-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), `START-${"长".repeat(180)}-TAIL`);
    const result = await render(App, { columns: 60, rows: 16, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain("START-"));
      expect(result.lastFrame()).not.toContain("-TAIL");
      await result.stdin.write("\t");
      await result.stdin.write("\x1b[F");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("-TAIL"));
    } finally { result.dispose(); }
  });
  it("positions Warp images using measured panes and removes placements behind menus", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-app-warp-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "# One\n![sample](sample.png)\n" + "line\n".repeat(35));
    await writeFile(join(root, "sample.png"), testPng());
    const writes: string[] = [];
    const graphics = new KittyPlacementGraphics((data) => { writes.push(data); });
    const viewport = vi.spyOn(graphics, "setViewport");
    const wrapper = defineComponent({ setup() { provide(KITTY_GRAPHICS, graphics); return () => h(App, { vaultPath: root }); } });
    const result = await render(wrapper, { columns: 120, rows: 30, color: "truecolor", mode: "fullscreen" });
    try {
      await vi.waitFor(() => expect(writes.some((line) => line.includes("a=p"))).toBe(true));
      expect(viewport.mock.lastCall?.slice(1, 4)).toEqual([38, 5, 80]);
      expect(result.lastFrame()).not.toContain("▀");
      expect(result.lastFrame()).not.toContain(IMAGE_PLACEHOLDER);
      await result.stdin.write("\r\x1b[H");
      await vi.waitFor(() => expect(viewport.mock.lastCall?.[1]).toBeGreaterThan(70));
      expect(result.lastFrame()).toContain("Kitty native");
      await result.terminal.resize(80, 30);
      await vi.waitFor(() => expect(viewport.mock.lastCall?.[1]).toBeLessThan(50));
      await result.stdin.write("\x1b");
      await result.stdin.write("/");
      await vi.waitFor(() => expect(viewport.mock.lastCall?.[0]).toEqual([]));
      graphics.repaint();
      expect(writes.at(-1)).not.toContain("a=p");
    } finally { result.dispose(); graphics.dispose(); }
  });
  it("does not overwrite a pasted image when an earlier save completes", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-save-paste-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "# One\n\n");
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const original = Vault.prototype.save;
    vi.spyOn(Vault.prototype, "save").mockImplementation(async function (this: Vault, note, content) {
      await gate; return original.call(this, note, content);
    });
    vi.spyOn(clipboard, "readClipboard").mockResolvedValue({ image: testPng() });
    const result = await render(App, { columns: 120, rows: 30, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r");
      await result.stdin.write("/save\r");
      await result.stdin.write("\x16");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Pasted image"));
      finish();
      await vi.waitFor(() => expect(Vault.prototype.save).toHaveResolved());
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toContain("](One.assets/image-"));
    } finally { finish(); result.dispose(); }
  });
  it("pastes clipboard images into document assets and preserves ordinary text paste", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-app-clipboard-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "# One\n\n");
    const reader = vi.spyOn(clipboard, "readClipboard").mockResolvedValue({ image: testPng() });
    const result = await render(App, { columns: 80, rows: 30, props: { vaultPath: root, keymap: "macos" } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r");
      await result.stdin.write("\x16");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Pasted image"));
      expect(result.lastFrame()).toContain("⌃A/C/X/V text");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("▀"));
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toContain("](One.assets/image-"));
      const saved = await readFile(join(root, "One.md"), "utf8");
      const image = saved.match(/\]\(([^)]+)\)/)![1]!;
      expect(await readFile(join(root, image))).toEqual(testPng());
      // A bracketed text paste must never read a stale clipboard image.
      await result.stdin.write("\x1b[200~ordinary text\x1b[201~");
      expect(reader).toHaveBeenCalledTimes(1);
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toContain("ordinary text"));
      reader.mockRejectedValueOnce(new Error("clipboard denied"));
      await result.stdin.write("\x16");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Paste failed"));
      await result.stdin.write("/save\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Saved One.md"));
      expect(await readFile(join(root, "One.md"), "utf8")).toBe(saved + "ordinary text");
      reader.mockResolvedValueOnce({ text: "not an image" });
      await result.stdin.write("\x1b[200~\x1b[201~");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("No image in clipboard"));
      // Failed image-only terminal paste leaves the draft untouched; a key retry still works.
      reader.mockResolvedValue({ image: testPng() });
      await result.stdin.write("\x16");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("Pasted image"));
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect((await readFile(join(root, "One.md"), "utf8")).match(/!\[/g)).toHaveLength(2));
      expect(await readFile(join(root, "One.md"), "utf8")).not.toContain("/paste-image");
    } finally { result.dispose(); }
  });

  it("renders Kitty placeholders through Vue, resizes, scrolls and clears them for help", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-app-kitty-")); temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "# One\n![sample](sample.png)\n" + "line\n".repeat(35));
    await writeFile(join(root, "sample.png"), testPng());
    const writes: string[] = [];
    const graphics = new KittyGraphics((data) => { writes.push(data); });
    const wrapper = defineComponent({ setup() { provide(KITTY_GRAPHICS, graphics); return () => h(App, { vaultPath: root }); } });
    const result = await render(wrapper, { columns: 120, rows: 30, color: "truecolor" });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(IMAGE_PLACEHOLDER));
      expect(result.lastFrame()).not.toContain("▀");
      const id = Number(writes[0]!.match(/i=(\d+)/)![1]);
      expect(result.lastFrame({ raw: true })).toContain(`38;2;${id >> 16};${(id >> 8) & 255};${id & 255}`);
      expect((await result.screen()).lines.some((line) => line.includes(IMAGE_PLACEHOLDER))).toBe(true);
      await result.terminal.resize(60, 24);
      await vi.waitFor(() => expect(writes.filter((line) => line.includes("a=p"))).toHaveLength(2));
      await result.stdin.write("\t\x1b[F");
      await vi.waitFor(() => expect(result.lastFrame()).not.toContain(IMAGE_PLACEHOLDER));
      await result.stdin.write("\x1b[H");
      await vi.waitFor(() => expect(result.lastFrame()).toContain(IMAGE_PLACEHOLDER));
      await result.stdin.write("/help\r");
      expect(result.lastFrame()).toContain("Keyboard help");
      expect((await result.screen()).lines.join("\n")).not.toContain(IMAGE_PLACEHOLDER);
    } finally { result.dispose(); graphics.dispose(); }
  });
  it("selects a vault image, previews pixels, saves relative Markdown and cancels safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-app-image-"));
    temporaryRoots.push(root);
    await writeFile(join(root, "One.md"), "# One\n\n", "utf8");
    const result = await render(App, { columns: 120, rows: 30, color: true, props: { vaultPath: root } });
    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await mkdir(join(root, "assets"));
      // Added after startup: opening the picker should refresh the file list.
      await writeFile(join(root, "assets", "sample.png"), testPng());
      await result.stdin.write("\r");
      await result.stdin.write("/"); await result.stdin.write("image"); await result.stdin.write("\r");
      expect(result.lastFrame()).toContain("VAULT IMAGES");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("assets/sample.png"));
      await vi.waitFor(() => expect(result.lastFrame()).toContain("▀"));
      expect(result.lastFrame()).toContain("IMAGE PREVIEW · thumbnail");
      await result.stdin.write("sample"); await result.stdin.write("\r");
      await vi.waitFor(() => expect(result.lastFrame()).toContain("▀"));
      expect(result.lastFrame({ raw: true })).toContain("38;2;255;0;0");
      expect((await result.screen()).lines.some((line) => line.includes("▀"))).toBe(true);
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("# One\n\n![sample.png](assets/sample.png)\n"));
      await result.terminal.resize(80, 24);
      await vi.waitFor(() => expect(result.lastFrame()).toContain("▀"));
      await result.stdin.write("/"); await result.stdin.write("image"); await result.stdin.write("\r");
      await result.stdin.write("does-not-exist");
      await result.stdin.write("\r");
      expect(result.lastFrame()).toContain("VAULT IMAGES");
      await result.stdin.write("\x1b");
      expect(result.lastFrame()).toContain("EDIT · One");
      await result.stdin.write("/save\r");
      await vi.waitFor(async () => expect(await readFile(join(root, "One.md"), "utf8")).toBe("# One\n\n![sample.png](assets/sample.png)\n"));
    } finally { result.dispose(); }
  });
  it("opens a selected note in edit mode and updates the adjacent live preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "lattice-app-test-"));
    temporaryRoots.push(root);
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "manual.pdf"), "pdf", "utf8");
    await writeFile(join(root, "One.md"), "# One\n\n[Site](https://example.com)\n\nStart", "utf8");

    const result = await render(App, {
      columns: 120,
      rows: 30,
      color: false,
      props: { vaultPath: root },
    });

    try {
      await vi.waitFor(() => expect(result.lastFrame()).toContain(" One"));
      await result.stdin.write("\r");

      expect(result.lastFrame()).toContain("EDIT · One");
      expect(result.lastFrame()).toContain("LIVE PREVIEW");
      expect(result.lastFrame({ raw: true })).toContain("\u001b]8;;https://example.com/\u0007");

      await result.stdin.write("/");
      await result.stdin.write("file");
      await result.stdin.write("\r");
      expect(result.lastFrame()).toContain("VAULT FILES");
      await result.stdin.write("manual");
      expect(result.lastFrame()).toContain("assets/manual.pdf");
      await result.stdin.write("\r");
      expect(result.lastFrame()).toContain("EDIT · One");
      expect(result.lastFrame({ raw: true })).toContain(pathToFileURL(join(root, "assets", "manual.pdf")).href);

      await result.stdin.write("\rsynced");
      const frame = result.lastFrame();
      expect(frame.match(/synced/g)?.length).toBeGreaterThanOrEqual(2);

      await result.terminal.resize(80, 30);
      expect(result.lastFrame()).toContain("EDIT · One");
      expect(result.lastFrame()).toContain("LIVE PREVIEW");
      expect(result.lastFrame()).not.toContain("VAULT ·");
    } finally {
      result.dispose();
    }
  });
});
