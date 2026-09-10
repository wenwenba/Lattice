import { describe, expect, it } from "vitest";
import type { TuiKey } from "@vue-tui/runtime";
import { resolveEditorShortcut, keymapPlatform, isControlKey } from "../src/shortcuts.js";

const modifiers = { shift: false, alt: false, ctrl: false, meta: false, super: false, hyper: false };
const character = (value: string, overrides: Partial<TuiKey> = {}) => ({ ...modifiers, character: value, ...overrides }) as TuiKey;

describe("text-editing shortcuts", () => {
  it.each(["darwin", "win32", "linux"] as const)("keeps only text operations on %s", platform => {
    for (const [key, action] of Object.entries({ a: "select-all", c: "copy", x: "cut", v: "paste", z: "undo", y: "redo" })) {
      expect(resolveEditorShortcut(character(key, { ctrl: true }), platform)).toEqual({ action });
    }
    expect(resolveEditorShortcut(character('f', { ctrl: true }), platform)).toEqual({ action: 'find' });
    expect(resolveEditorShortcut(character('r', { ctrl: true }), platform)).toEqual({ action: 'replace' });
    expect(resolveEditorShortcut(character("z", { ctrl: true, shift: true }), platform)).toEqual({ action: "redo" });
    for (const key of ["p", "q", "s", "n", "b", "e", "g", "o"]) {
      expect(resolveEditorShortcut(character(key, { ctrl: true }), platform)).toBeUndefined();
      expect(resolveEditorShortcut(character(key, { meta: true }), platform)).toBeUndefined();
    }
  });

  it("maps native movement and selection without application actions", () => {
    expect(resolveEditorShortcut({ ...modifiers, name: "right", alt: true, shift: true }, "darwin")).toMatchObject({ action: "move", word: true, select: true });
    expect(resolveEditorShortcut({ ...modifiers, name: "up", super: true, shift: true }, "darwin")).toMatchObject({ action: "move", document: true, select: true });
    expect(resolveEditorShortcut({ ...modifiers, name: "right", ctrl: true, shift: true }, "win32")).toMatchObject({ action: "move", word: true, select: true });
    expect(resolveEditorShortcut(character("w", { ctrl: true }), "linux")).toEqual({ action: "delete-word", direction: "left" });
    expect(resolveEditorShortcut(character("u", { ctrl: true }), "win32")).toEqual({ action: "delete-line", direction: "left" });
  });

  it("rejects AltGr and desktop combinations", () => {
    expect(resolveEditorShortcut(character("x", { ctrl: true, alt: true }), "linux")).toBeUndefined();
    expect(resolveEditorShortcut(character("v", { super: true }), "darwin")).toBeUndefined();
    expect(isControlKey(character("c", { ctrl: true, shift: true }), "c")).toBe(false);
  });

  it("selects an explicit platform keymap", () => {
    expect(keymapPlatform("macos", "linux")).toBe("darwin");
    expect(keymapPlatform("windows", "darwin")).toBe("win32");
    expect(keymapPlatform("linux", "darwin")).toBe("linux");
  });
});
