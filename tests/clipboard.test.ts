import { writeFile, stat, readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testPng } from "./image-fixture.js";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(() => {}, { [promisify.custom]: execute }) };
});
import { readClipboard, writeClipboardText } from "../src/clipboard.js";
afterEach(() => { execute.mockReset(); });

describe("clipboard adapters", () => {
  it.each(["win32", "linux"] as const)("copies text through a private file on %s and cleans up", async (platform) => {
    let input = "";
    const text = "中文😀\n\"quotes\" $(never-execute)";
    execute.mockImplementation(async (exe, args, options) => {
      input = options.env.LATTICE_CLIPBOARD_INPUT;
      expect(await readFile(input, "utf8")).toBe(text);
      expect(args.join(" ")).not.toContain(text);
      expect(exe).toBe(platform === "win32" ? "powershell.exe" : "xclip");
      if (platform === "win32") expect(args).toContain("-STA");
      return { stdout: "", stderr: "" };
    });
    await writeClipboardText(text, platform, {});
    await expect(stat(input)).rejects.toThrow();
  });

  it("uses macOS pbcopy stdin so copied text is not interpreted as script or arguments", async () => {
    const end = vi.fn(), on = vi.fn();
    execute.mockImplementation((exe, args) => {
      expect(exe).toBe("/usr/bin/pbcopy"); expect(args).toEqual([]);
      return Object.assign(Promise.resolve({ stdout: "", stderr: "" }), { child: { stdin: { end, on } } });
    });
    const text = "中文😀\n\"quotes\" $(never-execute)";
    await writeClipboardText(text, "darwin", {});
    expect(on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(end).toHaveBeenCalledWith(text);
  });

  it("pipes large Wayland selections through stdin instead of command arguments", async () => {
    const end = vi.fn(), on = vi.fn();
    execute.mockImplementation(() => Object.assign(Promise.resolve({ stdout: "" }), { child: { stdin: { end, on } } }));
    const text = "中文😀".repeat(100000);
    await writeClipboardText(text, "linux", { WAYLAND_DISPLAY: "wayland-0" });
    expect(end).toHaveBeenCalledWith(text);
    expect(execute.mock.calls[0]?.slice(0, 2)).toEqual(["wl-copy", ["--type", "text/plain;charset=utf-8"]]);
  });

  it("reports copy failures and removes the temporary selection file", async () => {
    let input = "";
    execute.mockImplementation((_exe, _args, options) => {
      input = options.env.LATTICE_CLIPBOARD_INPUT;
      return Object.assign(Promise.reject(new Error("denied")), { child: { stdin: { end: vi.fn(), on: vi.fn() } } });
    });
    await expect(writeClipboardText("selection", "darwin", {})).rejects.toThrow("Cannot copy");
    await expect(stat(input)).rejects.toThrow();
  });
  it("uses macOS AppKit PNG/TIFF export, then cleans temporary files", async () => {
    let output = "";
    execute.mockImplementation(async (exe, args, options) => {
      expect(exe).toBe("/usr/bin/osascript");
      expect(args.at(-1)).toContain("NSPasteboardTypeTIFF");
      output = options.env.LATTICE_CLIPBOARD_OUTPUT;
      await writeFile(output, testPng());
      return { stdout: "", stderr: "" };
    });
    expect(await readClipboard("darwin", {})).toEqual({ image: testPng() });
    await expect(stat(output)).rejects.toThrow();
  });

  it("falls back to pbpaste without changing ordinary text", async () => {
    execute.mockResolvedValueOnce({ stdout: "", stderr: "" }).mockResolvedValueOnce({ stdout: "text\n", stderr: "" });
    expect(await readClipboard("darwin", {})).toEqual({ text: "text\n" });
    expect(execute.mock.calls[1]?.[0]).toBe("/usr/bin/pbpaste");
  });

  it("uses Windows STA and environment paths, preserving UTF-8 text", async () => {
    execute.mockResolvedValue({ stdout: "中文", stderr: "" });
    expect(await readClipboard("win32", {})).toEqual({ text: "中文" });
    expect(execute.mock.calls[0]?.[1]).toContain("-STA");
    expect(execute.mock.calls[0]?.[1].at(-1)).toContain("$env:LATTICE_CLIPBOARD_OUTPUT");
  });

  it.each([true, false])("reads PNG MIME bytes on Wayland=%s", async (wayland) => {
    execute.mockResolvedValueOnce({ stdout: "image/png\ntext/plain\n" })
      .mockResolvedValueOnce({ stdout: testPng() });
    expect(await readClipboard("linux", wayland ? { WAYLAND_DISPLAY: "wayland-0" } : {})).toEqual({ image: testPng() });
    expect(execute.mock.calls[0]?.[0]).toBe(wayland ? "wl-paste" : "xclip");
    expect(execute.mock.calls[1]?.[1]).toContain("image/png");
    expect(execute.mock.calls[1]?.[2].encoding).toBe("buffer");
  });

  it("reports a missing Linux helper instead of inserting garbage", async () => {
    execute.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(readClipboard("linux", {})).rejects.toThrow("wl-clipboard");
  });
});
