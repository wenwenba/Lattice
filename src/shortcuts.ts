import type { TuiKey } from "@vue-tui/runtime";
import type { Direction } from "./editor.js";

export type Keymap = "auto" | "macos" | "windows" | "linux";
export function keymapPlatform(keymap: Keymap = "auto", platform = process.platform): NodeJS.Platform {
  return keymap === "macos" ? "darwin" : keymap === "windows" ? "win32" : keymap === "linux" ? "linux" : platform;
}
export function hasNonShiftModifier(key: TuiKey): boolean { return key.ctrl || key.alt || key.meta || key.super || key.hyper; }
export function isControlKey(key: TuiKey, character: string): boolean {
  return key.ctrl && !key.shift && !key.alt && !key.meta && !key.super && !key.hyper && key.character === character;
}
export type EditorShortcut =
  | { action: "select-all" | "copy" | "cut" | "paste" | "undo" | "redo" | "find" | "replace" }
  | { action: "delete-word" | "delete-line"; direction: "left" | "right" }
  | { action: "page"; direction: "up" | "down"; select: boolean }
  | { action: "move"; direction: Direction; select: boolean; word?: boolean; document?: boolean; paragraph?: boolean; wordEnd?: boolean };

export function resolveEditorShortcut(key: TuiKey, platform = process.platform): EditorShortcut | undefined {
  const character = key.character?.toLowerCase();
  const plain = !hasNonShiftModifier(key);
  const ctrl = key.ctrl && !key.alt && !key.meta && !key.super && !key.hyper;
  const option = platform === "darwin" && key.alt && !key.ctrl && !key.meta && !key.super && !key.hyper;
  const command = platform === "darwin" && (key.meta || key.super) && !key.ctrl && !key.alt && !key.hyper;
  // Clipboard/edit-history commands retain the explicitly chosen Ctrl bindings.
  if (ctrl) {
    if (character === "a") return { action: "select-all" };
    if (character === "c") return { action: "copy" };
    if (character === "x") return { action: "cut" };
    if (character === "v") return { action: "paste" };
    if (character === "f") return { action: "find" };
    if (character === "r") return { action: "replace" };
    if (character === "z") return { action: key.shift ? "redo" : "undo" };
    if (character === "y") return { action: "redo" };
    if (character === "w") return { action: "delete-word", direction: "left" };
    if (character === "u" || character === "k") return { action: "delete-line", direction: character === "u" ? "left" : "right" };
    if (key.name === "backspace" || key.name === "delete") {
      return { action: "delete-word", direction: key.name === "backspace" ? "left" : "right" };
    }
  }
  if (command && ["left", "right", "up", "down"].includes(key.name ?? "")) {
    return { action: "move", direction: key.name === "left" || key.name === "up" ? "home" : "end", select: key.shift, document: key.name === "up" || key.name === "down" };
  }
  if (option && ["left", "right"].includes(key.name ?? "")) {
    return { action: "move", direction: key.name as Direction, select: key.shift, word: true, wordEnd: true };
  }
  if ((option || (ctrl && platform !== "darwin")) && ["up", "down"].includes(key.name ?? "")) {
    return { action: "move", direction: key.name as Direction, select: key.shift, paragraph: true };
  }
  if (plain && (key.name === "page-up" || key.name === "page-down")) return { action: "page", direction: key.name === "page-up" ? "up" : "down", select: key.shift };
  if (!(plain || ctrl) || !["left", "right", "up", "down", "home", "end"].includes(key.name ?? "")) return undefined;
  const direction = key.name as Direction;
  // Leave plain arrows to the editor's slash-menu navigation.
  if (plain && !key.shift) return undefined;
  if (ctrl && ["up", "down"].includes(direction)) return undefined;
  return { action: "move", direction, select: key.shift, word: ctrl && ["left", "right"].includes(direction), document: ctrl && ["home", "end"].includes(direction) };
}
