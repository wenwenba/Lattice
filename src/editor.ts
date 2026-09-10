import stringWidth from "string-width";

export interface EditorState {
  content: string;
  cursor: number;
  anchor?: number;
  preferredColumn?: number;
}
export type Direction = "left" | "right" | "up" | "down" | "home" | "end";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

export function selectionRange(state: EditorState): { start: number; end: number } {
  return { start: Math.min(state.anchor ?? state.cursor, state.cursor), end: Math.max(state.anchor ?? state.cursor, state.cursor) };
}
export function selectedText(state: EditorState): string {
  const { start, end } = selectionRange(state); return state.content.slice(start, end);
}
export function selectAll(state: EditorState): EditorState {
  return { content: state.content, cursor: state.content.length, anchor: 0 };
}
export function insertText(state: EditorState, text: string): EditorState {
  text = normalizeEditorNewlines(text);
  const { start, end } = selectionRange(state);
  return { content: state.content.slice(0, start) + text + state.content.slice(end), cursor: start + text.length };
}

/** The editor uses LF for line boundaries. Normalize incoming text, not the
 * existing buffer, so selection offsets remain valid. Do not trim blank lines. */
export function normalizeEditorNewlines(text: string): string {
  return text.replace(/\r\n|[\r\v\f\u0085\u2028\u2029]/g, '\n');
}
export function backspace(state: EditorState): EditorState {
  if (selectedText(state)) return insertText(state, "");
  return insertText({ ...state, anchor: previousBoundary(state.content, state.cursor) }, "");
}
export function deleteForward(state: EditorState): EditorState {
  if (selectedText(state)) return insertText(state, "");
  return insertText({ ...state, anchor: nextBoundary(state.content, state.cursor) }, "");
}
export function setCursor(state: EditorState, cursor: number, extend = false): EditorState {
  const position = snapBoundary(state.content, Math.max(0, Math.min(state.content.length, cursor)));
  return extend ? { content: state.content, cursor: position, anchor: state.anchor ?? state.cursor }
    : { content: state.content, cursor: position };
}

export function moveCursor(state: EditorState, direction: Direction, options: { select?: boolean; word?: boolean; document?: boolean; paragraph?: boolean; wordEnd?: boolean } = {}): EditorState {
  if (!options.select && selectedText(state) && (direction === "left" || direction === "right") && !options.word) {
    const range = selectionRange(state); return setCursor(state, direction === "left" ? range.start : range.end);
  }
  const start = lineStart(state.content, state.cursor), end = lineEnd(state.content, state.cursor);
  let position = state.cursor;
  if (options.paragraph) {
    // A hard newline is a paragraph boundary in the unwrapped source editor.
    position = direction === "up" ? (state.cursor > start ? start : lineStart(state.content, Math.max(0, start - 1)))
      : (state.cursor < end ? end : lineEnd(state.content, Math.min(state.content.length, end + 1)));
  }
  else if (direction === "home") position = options.document ? 0 : start;
  else if (direction === "end") position = options.document ? state.content.length : end;
  else if (direction === "left") position = options.word ? wordBoundary(state.content, state.cursor, -1) : previousBoundary(state.content, state.cursor);
  else if (direction === "right") position = options.word ? wordBoundary(state.content, state.cursor, 1, options.wordEnd) : nextBoundary(state.content, state.cursor);
  else {
    const column = state.preferredColumn ?? displayWidth(state.content.slice(start, state.cursor));
    if (direction === "up" && start > 0) {
      const target = lineStart(state.content, start - 1);
      position = target + indexAtColumn(state.content.slice(target, start - 1), column);
    } else if (direction === "down" && end < state.content.length) {
      position = end + 1 + indexAtColumn(state.content.slice(end + 1, lineEnd(state.content, end + 1)), column);
    }
    return { ...setCursor(state, position, options.select), preferredColumn: column };
  }
  return setCursor(state, position, options.select);
}

export function deleteWord(state: EditorState, direction: "left" | "right"): EditorState {
  return insertText(selectedText(state) ? state : moveCursor(state, direction, { word: true, select: true }), "");
}

export function displayWidth(text: string): number {
  let column = 0;
  for (const { segment } of graphemes.segment(text)) column += cellWidth(segment, column);
  return column;
}
export function cursorColumn(state: EditorState): number {
  return displayWidth(state.content.slice(lineStart(state.content, state.cursor), state.cursor));
}
/** Width of the grapheme under the caret. Keeping the whole grapheme visible is
 * important for CJK/emoji: clipping half of a wide glyph turns it into a
 * one-column blank and makes the software caret appear to have the wrong size. */
export function cursorCellWidth(state: EditorState): number {
  if (state.cursor >= state.content.length || state.content[state.cursor] === "\n") return 1;
  for (const { index, segment } of graphemes.segment(state.content)) {
    if (index === state.cursor) return cellWidth(segment, cursorColumn(state));
    if (index > state.cursor) break;
  }
  return 1;
}
export function cursorAtPoint(content: string, row: number, column: number): number {
  const lines = content.split("\n"), target = Math.max(0, Math.min(lines.length - 1, row));
  let start = 0;
  for (let i = 0; i < target; i++) start += lines[i]!.length + 1;
  return start + indexAtColumn(lines[target]!, Math.max(0, column));
}
export interface EditorCell { text: string; selected: boolean; cursor: boolean }
export function editorLines(state: EditorState, offset = 0, width = Infinity): Array<{ cells: EditorCell[] }> {
  const range = selectionRange(state);
  const hasSelection = range.start !== range.end;
  let start = 0;
  return state.content.split("\n").map((line) => {
    let column = 0;
    const cells: EditorCell[] = [];
    for (const { segment, index } of graphemes.segment(line + " ")) {
      const endOfLine = index === line.length;
      const size = cellWidth(segment, column);
      const left = Math.max(column, offset), right = Math.min(column + size, offset + width);
      if (right > left) {
        cells.push({ text: segment === "\t" || left > column || right < column + size ? " ".repeat(right - left) : visibleGrapheme(segment),
          selected: start + index >= range.start && start + index < range.end,
          cursor: !hasSelection && state.cursor === start + index });
      }
      column += size;
      if (endOfLine || column >= offset + width) break;
    }
    start += line.length + 1;
    return { cells: cells.length ? cells : [{ text: " ", selected: false, cursor: false }] };
  });
}

function cellWidth(segment: string, column: number): number {
  return segment === "\t" ? 4 - column % 4 : Math.max(1, stringWidth(visibleGrapheme(segment)));
}
function visibleGrapheme(segment: string): string { return /[\x00-\x1f\x7f]/.test(segment) ? "�" : segment; }
function indexAtColumn(line: string, wanted: number): number {
  let column = 0;
  for (const { segment, index } of graphemes.segment(line)) {
    const size = cellWidth(segment, column);
    if (wanted < column + size) return index;
    column += size;
  }
  return line.length;
}
function lineStart(text: string, at: number): number { return at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1; }
function lineEnd(text: string, at: number): number { const end = text.indexOf("\n", at); return end < 0 ? text.length : end; }
function snapBoundary(text: string, at: number): number {
  if (at === text.length) return at;
  for (const { index, segment } of graphemes.segment(text)) if (index + segment.length > at) return index;
  return text.length;
}
function previousBoundary(text: string, at: number): number {
  let previous = 0;
  for (const { index } of graphemes.segment(text)) { if (index >= at) break; previous = index; }
  return previous;
}
function nextBoundary(text: string, at: number): number {
  for (const { index, segment } of graphemes.segment(text)) if (index + segment.length > at) return index + segment.length;
  return text.length;
}
function wordBoundary(text: string, at: number, direction: -1 | 1, wordEnd = false): number {
  const parts = [...words.segment(text)];
  const kind = (value: string) => /\s/u.test(value) ? "space" : /[\p{L}\p{N}_]/u.test(value) ? "word" : "punctuation";
  if (direction < 0) {
    let i = parts.findIndex((part) => part.index >= at); if (i < 0) i = parts.length; i--;
    while (i >= 0 && kind(parts[i]!.segment) === "space") i--;
    return parts[i]?.index ?? 0;
  }
  if (wordEnd) {
    const next = parts.find((part) => part.index + part.segment.length > at && !/^\s+$/u.test(part.segment));
    return next ? next.index + next.segment.length : text.length;
  }
  let i = parts.findIndex((part) => part.index + part.segment.length > at); if (i < 0) return text.length;
  i++;
  while (i < parts.length && kind(parts[i]!.segment) === "space") i++;
  return parts[i]?.index ?? text.length;
}

export class EditorHistory {
  private undoStack: EditorState[] = [];
  private redoStack: EditorState[] = [];
  record(before: EditorState, after: EditorState): void {
    if (before.content === after.content) return;
    this.undoStack.push({ ...before }); this.redoStack = [];
    while (this.undoStack.length > 100 || this.undoStack.reduce((sum, item) => sum + item.content.length, 0) > 8 * 1024 * 1024) this.undoStack.shift();
  }
  undo(state: EditorState): EditorState { const previous = this.undoStack.pop(); if (!previous) return state; this.redoStack.push({ ...state }); return previous; }
  redo(state: EditorState): EditorState { const next = this.redoStack.pop(); if (!next) return state; this.undoStack.push({ ...state }); return next; }
  checkpoint(): { undo: EditorState[]; redo: EditorState[] } {
    return { undo: this.undoStack.map((state) => ({ ...state })), redo: this.redoStack.map((state) => ({ ...state })) };
  }
  restore(checkpoint: { undo: EditorState[]; redo: EditorState[] }): void {
    this.undoStack = checkpoint.undo.map((state) => ({ ...state })); this.redoStack = checkpoint.redo.map((state) => ({ ...state }));
  }
  clear(): void { this.undoStack = []; this.redoStack = []; }
}
