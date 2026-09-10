import { describe, expect, it } from "vitest";
import { backspace, deleteForward, insertText, moveCursor, selectedText, selectAll, setCursor, cursorAtPoint, cursorCellWidth, editorLines, EditorHistory, deleteWord } from "../src/editor.js";

describe("editor operations", () => {
  it("selects macOS words without trailing spaces and segments Chinese words", () => {
    const first = moveCursor({ content: "hello world", cursor: 0 }, "right", { word: true, wordEnd: true, select: true });
    expect(selectedText(first)).toBe("hello");
    expect(selectedText(moveCursor(first, "right", { word: true, wordEnd: true, select: true }))).toBe("hello world");
    const chinese = moveCursor({ content: "你好世界", cursor: 0 }, "right", { word: true, wordEnd: true, select: true });
    expect(selectedText(chinese)).toBe("你好");
    expect(moveCursor({ content: "hello world", cursor: 2 }, "right", { word: true }).cursor).toBe(6);
  });

  it("extends and reverses paragraph selections across empty lines", () => {
    const source = { content: "abc\n\ndef", cursor: 1 };
    const down = moveCursor(source, "down", { paragraph: true, select: true });
    expect(selectedText(down)).toBe("bc");
    const blank = moveCursor(down, "down", { paragraph: true, select: true });
    expect(selectedText(blank)).toBe("bc\n");
    const end = moveCursor(blank, "down", { paragraph: true, select: true });
    expect(selectedText(end)).toBe("bc\n\ndef");
    expect(moveCursor(end, "up", { paragraph: true, select: true })).toMatchObject({ cursor: 5, anchor: 1 });
    expect(moveCursor({ content: "", cursor: 0 }, "up", { paragraph: true }).cursor).toBe(0);
  });
  it("inserts and removes text at the software cursor", () => {
    const inserted = insertText({ content: "ac", cursor: 1 }, "b");
    expect(inserted).toEqual({ content: "abc", cursor: 2 });
    expect(backspace(inserted)).toEqual({ content: "ac", cursor: 1 });
    expect(deleteForward({ content: "abc", cursor: 1 })).toEqual({ content: "ac", cursor: 1 });
  });

  it("moves vertically while preserving the preferred column", () => {
    const start = { content: "abcd\nx\n12345", cursor: 3 };
    const down = moveCursor(start, "down");
    expect(down.cursor).toBe(6);
    expect(moveCursor(down, "down").cursor).toBe(10);
  });

  it("does not split an emoji when deleting", () => {
    expect(backspace({ content: "a😀b", cursor: 3 })).toEqual({ content: "ab", cursor: 1 });
    expect(deleteForward({ content: "a😀b", cursor: 1 })).toEqual({ content: "ab", cursor: 1 });
  });

  it("extends and collapses selections and replaces them as a single edit", () => {
    const source = { content: "abc\ndef", cursor: 2 };
    const selected = moveCursor(moveCursor(source, "right", { select: true }), "down", { select: true });
    expect(selectedText(selected)).toBe("c\ndef");
    expect(insertText(selected, "X")).toEqual({ content: "abX", cursor: 3 });
    expect(backspace(selected)).toEqual({ content: "ab", cursor: 2 });
    expect(deleteForward(selectAll(source))).toEqual({ content: "", cursor: 0 });
    expect(moveCursor(selected, "left").cursor).toBe(2);
    expect(selectedText(moveCursor(selected, "left"))).toBe("");
  });

  it("uses grapheme boundaries for combining accents and ZWJ emoji", () => {
    const text = "a👩‍💻e\u0301中";
    expect(moveCursor({ content: text, cursor: 1 }, "right").cursor).toBe(6);
    expect(deleteForward({ content: text, cursor: 1 }).content).toBe("ae\u0301中");
    expect(backspace({ content: text, cursor: 8 }).content).toBe("a👩‍💻中");
    expect(setCursor({ content: text, cursor: 0 }, 3).cursor).toBe(1);
  });

  it("maps cell coordinates to CJK, emoji and tab positions", () => {
    const text = "中👩‍💻e\u0301\tZ\nNext";
    expect(cursorAtPoint(text, 0, 1)).toBe(0);
    expect(cursorAtPoint(text, 0, 2)).toBe(1);
    expect(cursorAtPoint(text, 0, 4)).toBe(6);
    expect(cursorAtPoint(text, 0, 7)).toBe(8);
    expect(cursorAtPoint(text, 0, 8)).toBe(9);
    expect(cursorAtPoint(text, 1, 2)).toBe(13);
    const cells = editorLines(selectAll({ content: "中ab", cursor: 0 }), 1, 2)[0]!.cells;
    expect(cells.map((cell) => cell.text).join("")).toBe(" a");
    expect(cells.every((cell) => cell.selected)).toBe(true);
  });

  it("does not paint the insertion caret over the CJK glyph after a selection", () => {
    const cells = editorLines({ content: "中文abc", anchor: 0, cursor: 1 })[0]!.cells;
    expect(cells.filter((cell) => cell.selected).map((cell) => cell.text).join("")).toBe("中");
    expect(cells.some((cell) => cell.cursor)).toBe(false);
  });

  it("reports the complete terminal width of the grapheme under the caret", () => {
    expect(cursorCellWidth({ content: "a中b", cursor: 1 })).toBe(2);
    expect(cursorCellWidth({ content: "a👩‍💻b", cursor: 1 })).toBe(2);
    expect(cursorCellWidth({ content: "a\nb", cursor: 1 })).toBe(1);
    expect(cursorCellWidth({ content: "ab", cursor: 2 })).toBe(1);
  });

  it("handles blank first lines and word/document navigation", () => {
    expect(moveCursor({ content: "\na", cursor: 0 }, "home").cursor).toBe(0);
    expect(moveCursor({ content: "\na", cursor: 1 }, "up").cursor).toBe(0);
    expect(deleteWord({ content: "one two", cursor: 7 }, "left").content).toBe("one ");
    expect(selectedText(moveCursor({ content: "one\ntwo", cursor: 4 }, "end", { select: true, document: true }))).toBe("two");
  });

  it("undoes and redoes selection replacement, clearing redo after a new edit", () => {
    const history = new EditorHistory(), initial = selectAll({ content: "hello", cursor: 0 });
    const edited = insertText(initial, "world"); history.record(initial, edited);
    const undone = history.undo(edited); expect(undone).toEqual(initial);
    expect(history.redo(undone)).toEqual(edited);
    history.undo(edited); const next = insertText(initial, "new"); history.record(initial, next);
    expect(history.redo(next)).toEqual(next);
    const checkpoint = history.checkpoint(); history.record(next, insertText(next, "/save")); history.restore(checkpoint);
    expect(history.undo(next)).toEqual(initial);
  });
});
