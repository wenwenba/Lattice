import type { RenderLine, StyledSegment } from "./types.js";
import { wikiReferences } from './wiki.js';

const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "shell",
  sh: "shell",
  shell: "shell",
  zsh: "shell",
  js: "javascript",
  jsx: "javascript",
  javascript: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  yml: "yaml",
  yaml: "yaml",
  html: "html",
  vue: "vue",
  css: "css",
  scss: "css",
  json: "json",
  sql: "sql",
};

const KEYWORDS: Record<string, Set<string>> = {
  javascript: words("as async await break case catch class const continue default delete do else export extends finally for from function get if implements import in instanceof interface let new of private protected public return set static super switch throw try typeof var void while with yield true false null undefined"),
  typescript: words("as async await break case catch class const continue declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface keyof let namespace never new of private protected public readonly return satisfies set static super switch throw try type typeof unknown var void while with yield true false null undefined"),
  python: words("and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield"),
  shell: words("case do done elif else esac export fi for function if in local readonly then until while"),
  sql: words("all alter and as asc begin between by case check column create database default delete desc distinct drop else end exists foreign from full group having in index inner insert into is join key left like limit not null on or order outer primary references right select set table then union unique update values view when where with"),
  json: words("true false null"),
  yaml: words("true false null yes no on off"),
  css: words("important media supports keyframes from to"),
  html: new Set(),
  vue: words("const let function return import from true false null undefined"),
  text: new Set(),
};

export function extractLinks(content: string): string[] {
  return unique(wikiReferences(content).map(link => link.target));
}

export function extractTags(content: string): string[] {
  return unique([...content.matchAll(TAG)].map((match) => match[2]!).filter(Boolean));
}

export function noteTitle(relativePath: string, content: string): string {
  const lines = normalizeLines(content);
  let fence: Fence | undefined;
  let startIndex = 0;
  if (lines[0]?.trim() === "---") {
    const frontmatterEnd = lines.slice(1).findIndex((item) => item.trim() === "---");
    if (frontmatterEnd >= 0) startIndex = frontmatterEnd + 2;
  }
  for (let index = startIndex; index < lines.length; index++) {
    const currentLine = lines[index]!;
    const opening = readFence(currentLine);
    if (!fence && opening) {
      fence = opening;
      continue;
    }
    if (fence && isClosingFence(currentLine, fence)) {
      fence = undefined;
      continue;
    }
    if (fence) continue;
    const atx = currentLine.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if (atx) return atx[1]!.trim();
    if (currentLine.trim() && /^[=-]{3,}\s*$/.test(lines[index + 1] ?? "")) return currentLine.trim();
  }
  const leaf = relativePath.split("/").at(-1) ?? relativePath;
  return leaf.replace(/\.md$/i, "");
}

export function renderMarkdown(content: string): RenderLine[] {
  const lines = normalizeLines(content);
  const output: RenderLine[] = [];
  let index = 0;

  if (lines[0]?.trim() === "---") {
    const end = lines.slice(1).findIndex((item) => item.trim() === "---");
    if (end >= 0) {
      output.push(renderLine("frontmatter", [{ text: "◇ properties", color: "magenta", bold: true }]));
      for (const property of lines.slice(1, end + 1)) {
        const separator = property.indexOf(":");
        output.push(renderLine("frontmatter", separator < 0
          ? [{ text: `  ${sanitize(property)}`, color: "gray", dim: true }]
          : [
              { text: `  ${sanitize(property.slice(0, separator))}`, color: "cyan" },
              { text: ":", color: "gray" },
              { text: sanitize(property.slice(separator + 1)), color: "gray" },
            ]));
      }
      output.push(blankLine());
      index = end + 2;
    }
  }

  while (index < lines.length) {
    const rawLine = lines[index]!;
    const fence = readFence(rawLine);
    if (fence) {
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !isClosingFence(lines[index]!, fence)) {
        codeLines.push(lines[index]!);
        index++;
      }
      if (index < lines.length) index++;
      output.push(...renderCodeBlock(codeLines, fence.language));
      continue;
    }

    if (isIndentedCode(rawLine)) {
      const codeLines: string[] = [];
      while (index < lines.length && (isIndentedCode(lines[index]!) || !lines[index]!.trim())) {
        const value = lines[index]!;
        codeLines.push(value.startsWith("\t") ? value.slice(1) : value.slice(4));
        index++;
      }
      while (codeLines.at(-1) === "") codeLines.pop();
      output.push(...renderCodeBlock(codeLines, "text"));
      continue;
    }

    if (isTableHeader(lines, index)) {
      const header = splitTableRow(rawLine);
      const alignments = splitTableRow(lines[index + 1]!).map(parseAlignment);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim()) {
        rows.push(splitTableRow(lines[index]!));
        index++;
      }
      output.push(...renderTable(header, rows, alignments));
      continue;
    }

    if (rawLine.trim() && /^[=-]{3,}\s*$/.test(lines[index + 1] ?? "")) {
      output.push(headingLine(lines[index + 1]!.trim().startsWith("=") ? 1 : 2, rawLine.trim()));
      index += 2;
      continue;
    }

    output.push(renderOrdinaryLine(rawLine));
    index++;
  }

  return output.length ? output : [blankLine()];
}

export function wrapRenderLine(line: RenderLine, columns: number): RenderLine[] {
  if (line.graphic || line.kind === "image" || line.kind === "table") return [line];
  const width = Math.max(1, Math.floor(columns) - line.indent * 2);
  if (segmentWidth(line.segments) <= width) return [line];
  const wrapped: RenderLine[] = [];
  let segments: StyledSegment[] = [];
  let used = 0;
  const flush = () => {
    wrapped.push({ ...line, segments });
    segments = [];
    used = 0;
  };
  for (const segment of line.segments) {
    let text = "";
    for (const character of segment.text) {
      const size = displayWidth(character);
      if (used && used + size > width) {
        if (text) segments.push({ ...segment, text });
        text = "";
        flush();
      }
      text += character;
      used += size;
    }
    if (text) segments.push({ ...segment, text });
  }
  if (segments.length) flush();
  return wrapped;
}

function renderCodeBlock(codeLines: string[], requestedLanguage: string): RenderLine[] {
  const language = normalizeLanguage(requestedLanguage);
  const label = language === "text" ? "code" : language;
  const numberWidth = String(Math.max(1, codeLines.length)).length;
  const result: RenderLine[] = [
    renderLine("code-header", [
      { text: "╭─ ", color: "gray", dim: true },
      { text: label, color: "cyan", bold: true },
      { text: "  ", color: "gray" },
    ], "black"),
  ];

  const source = codeLines.length ? codeLines : [""];
  source.forEach((sourceLine, lineIndex) => {
    result.push(renderLine("code", [
      { text: `│ ${String(lineIndex + 1).padStart(numberWidth, " ")} │ `, color: "gray", dim: true },
      ...highlightCode(sanitize(sourceLine).replace(/\t/g, "  "), language),
    ], "black"));
  });
  result.push(renderLine("code-footer", [{ text: "╰─", color: "gray", dim: true }], "black"));
  return result;
}

function renderOrdinaryLine(rawLine: string): RenderLine {
  if (!rawLine.trim()) return blankLine();
  if (/^\s*(---+|___+|\*\s*\*\s*\*+)\s*$/.test(rawLine)) {
    return renderLine("rule", [{ text: "─".repeat(48), color: "gray", dim: true }]);
  }

  const heading = rawLine.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
  if (heading) {
    return headingLine(heading[1]!.length, heading[2]!);
  }

  const task = rawLine.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
  if (task) {
    const checked = task[2]!.toLowerCase() === "x";
    return {
      kind: "list",
      indent: indentation(task[1]!),
      segments: [
        { text: checked ? "✓ " : "○ ", color: checked ? "green" : "yellow", bold: true },
        ...inlineSegments(task[3]!, checked ? "gray" : undefined, false, checked),
      ],
    };
  }

  const list = rawLine.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  if (list) {
    return {
      kind: "list",
      indent: indentation(list[1]!),
      segments: [{ text: `${list[2]} `, color: "magenta", bold: true }, ...inlineSegments(list[3]!)],
    };
  }

  const quote = rawLine.match(/^(\s*)((?:>\s*)+)(.*)$/);
  if (quote) {
    const depth = (quote[2]!.match(/>/g) ?? []).length;
    return {
      kind: "quote",
      indent: indentation(quote[1]!),
      segments: [{ text: "│ ".repeat(depth), color: "magenta" }, ...inlineSegments(quote[3]!, "gray")],
    };
  }

  if (/^\s*<[^>]+>/.test(rawLine)) {
    return renderLine("paragraph", [{ text: sanitize(rawLine), color: "gray", dim: true }]);
  }
  return renderLine("paragraph", inlineSegments(rawLine));
}

function inlineSegments(
  rawText: string,
  defaultColor?: StyledSegment["color"],
  bold = false,
  dim = false,
): StyledSegment[] {
  const text = sanitize(rawText);
  const tokens: Array<{ start: number; end: number; priority: number; segment: StyledSegment }> = [];
  const add = (regex: RegExp, priority: number, create: (match: RegExpMatchArray) => StyledSegment): void => {
    for (const match of text.matchAll(regex)) {
      if (isEscaped(text, match.index)) continue;
      tokens.push({ start: match.index, end: match.index + match[0].length, priority, segment: create(match) });
    }
  };

  add(/`+([^`]+?)`+/g, 0, (match) => ({ text: match[1] || "", color: "yellow" }));
  add(WIKI_LINK, 1, (match) => ({ text: match[2] || match[1] || "", color: "cyan", underline: true }));
  add(/!\[((?:\\.|[^\]\\])*)\]\(([^)]+)\)/g, 1, (match) => ({
    text: `▧ ${unescapeMarkdown(match[1] || "image")}`, color: "magenta",
    image: { target: match[2]!.replace(/^<|>$/g, ""), alt: unescapeMarkdown(match[1] || "image") },
    href: match[2]!.replace(/^<|>$/g, ""),
  }));
  add(MARKDOWN_LINK, 2, (match) => ({ text: `${match[1] || match[2] || "link"} ↗`, href: match[2], color: "blue", underline: true }));
  add(/<((?:https?:\/\/|mailto:|file:)[^>]+)>/g, 2, (match) => ({ text: `${match[1] || "link"} ↗`, href: match[1], color: "blue", underline: true }));
  add(/\*\*([^*]+)\*\*|__([^_]+)__/g, 3, (match) => ({ text: match[1] || match[2] || "", bold: true, color: defaultColor }));
  add(/~~([^~]+)~~/g, 3, (match) => ({ text: match[1] || "", color: "gray", strikethrough: true }));
  add(/(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g, 4, (match) => ({ text: match[1] || match[2] || "", color: defaultColor, italic: true }));

  tokens.sort((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end);
  const accepted = tokens.filter((token, tokenIndex, all) => !all.slice(0, tokenIndex).some((other) => token.start < other.end));
  const segments: StyledSegment[] = [];
  let cursor = 0;
  for (const token of accepted) {
    if (token.start > cursor) segments.push({ text: unescapeMarkdown(text.slice(cursor, token.start)), color: defaultColor, bold, dim });
    segments.push({ ...token.segment, dim: token.segment.dim ?? dim });
    cursor = token.end;
  }
  if (cursor < text.length) segments.push({ text: unescapeMarkdown(text.slice(cursor)), color: defaultColor, bold, dim });
  return segments.length ? segments : [{ text: unescapeMarkdown(text), color: defaultColor, bold, dim }];
}

function highlightCode(source: string, language: string): StyledSegment[] {
  if (!source) return [{ text: " " }];
  const keywords = KEYWORDS[language] ?? KEYWORDS.text!;
  const result: StyledSegment[] = [];
  let index = 0;

  while (index < source.length) {
    const rest = source.slice(index);
    const comment = commentAt(rest, language);
    if (comment) {
      result.push({ text: comment, color: "gray", dim: true });
      index += comment.length;
      continue;
    }
    const quote = rest.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/)?.[0];
    if (quote) {
      result.push({ text: quote, color: "green" });
      index += quote.length;
      continue;
    }
    const number = rest.match(/^(?:0x[\da-f]+|0b[01]+|\d+(?:\.\d+)?)/i)?.[0];
    if (number) {
      result.push({ text: number, color: "yellow" });
      index += number.length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_$][\w$-]*/)?.[0];
    if (word) {
      const keyword = keywords.has(word) || keywords.has(word.toLocaleLowerCase());
      result.push({ text: word, color: keyword ? "magenta" : undefined, bold: keyword });
      index += word.length;
      continue;
    }
    const punctuation = rest.match(/^[{}()[\].,:;=<>+\-*/%!?&|]+/)?.[0];
    if (punctuation) {
      result.push({ text: punctuation, color: "cyan" });
      index += punctuation.length;
      continue;
    }
    const plain = rest.match(/^[^A-Za-z_$\d"'`{}()[\].,:;=<>+\-*/%!?&|]+/)?.[0] ?? rest[0]!;
    result.push({ text: plain });
    index += plain.length;
  }
  return result;
}

function commentAt(rest: string, language: string): string | undefined {
  if (["javascript", "typescript", "vue", "css"].includes(language) && rest.startsWith("//")) return rest;
  if (["javascript", "typescript", "vue", "css"].includes(language) && rest.startsWith("/*")) {
    const end = rest.indexOf("*/", 2);
    return end < 0 ? rest : rest.slice(0, end + 2);
  }
  if (["python", "shell", "yaml"].includes(language) && rest.startsWith("#")) return rest;
  if (language === "sql" && rest.startsWith("--")) return rest;
  if (["html", "vue"].includes(language) && rest.startsWith("<!--")) {
    const end = rest.indexOf("-->", 4);
    return end < 0 ? rest : rest.slice(0, end + 3);
  }
  return undefined;
}

interface Fence {
  marker: "`" | "~";
  length: number;
  language: string;
}

function readFence(value: string): Fence | undefined {
  const match = value.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`~]+)?[^`~]*$/);
  if (!match) return undefined;
  return { marker: match[1]![0] as "`" | "~", length: match[1]!.length, language: match[2] ?? "text" };
}

function isClosingFence(value: string, fence: Fence): boolean {
  const match = value.match(/^ {0,3}(`+|~+)\s*$/);
  return Boolean(match && match[1]![0] === fence.marker && match[1]!.length >= fence.length);
}

function isIndentedCode(value: string): boolean {
  return /^(?: {4}|\t)\S/.test(value);
}

function isTableHeader(lines: string[], index: number): boolean {
  return lines[index]!.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "");
}

function splitTableRow(value: string): string[] {
  const trimmed = value.trim().replace(/^\||\|$/g, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed[index]!;
    if (character === "|" && trimmed[index - 1] !== "\\") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/\\\|/g, "|"));
}

function headingLine(level: number, text: string): RenderLine {
  const styles: Array<{ marker: string; color: StyledSegment["color"]; indent: number; underline?: boolean }> = [
    { marker: "█ ", color: "cyan", indent: 0, underline: true },
    { marker: "▌ ", color: "blue", indent: 0 },
    { marker: "◆ ", color: "magenta", indent: 1 },
    { marker: "◇ ", color: "yellow", indent: 1 },
    { marker: "› ", color: "green", indent: 2 },
    { marker: "· ", color: "gray", indent: 2 },
  ];
  const style = styles[Math.max(0, Math.min(5, level - 1))]!;
  return {
    kind: "heading",
    indent: style.indent,
    segments: [
      { text: style.marker, color: style.color, bold: true },
      ...inlineSegments(text, style.color, true).map((segment) => ({ ...segment, underline: segment.underline ?? style.underline })),
    ],
  };
}

function renderTable(header: string[], rows: string[][], requestedAlignments: Array<"left" | "center" | "right">): RenderLine[] {
  const columnCount = Math.max(header.length, requestedAlignments.length, ...rows.map((row) => row.length));
  const alignments = Array.from({ length: columnCount }, (_, index) => requestedAlignments[index] ?? "left");
  const normalizedHeader = normalizeTableRow(header, columnCount);
  const normalizedRows = rows.map((row) => normalizeTableRow(row, columnCount));
  const allRows = [normalizedHeader, ...normalizedRows];
  const widths = Array.from({ length: columnCount }, (_, column) => clampTableWidth(
    Math.max(...allRows.map((row) => segmentWidth(inlineSegments(row[column] ?? ""))), 3),
  ));
  const border = (left: string, middle: string, right: string): RenderLine => renderLine("table", [{
    text: `${left}${widths.map((width) => "─".repeat(width + 2)).join(middle)}${right}`,
    color: "gray",
    dim: true,
  }]);

  return [
    border("┌", "┬", "┐"),
    tableContentLine(normalizedHeader, widths, alignments, true),
    border("├", "┼", "┤"),
    ...normalizedRows.map((row) => tableContentLine(row, widths, alignments, false)),
    border("└", "┴", "┘"),
  ];
}

function tableContentLine(
  cells: string[],
  widths: number[],
  alignments: Array<"left" | "center" | "right">,
  header: boolean,
): RenderLine {
  const segments: StyledSegment[] = [{ text: "│", color: "gray" }];
  cells.forEach((cell, index) => {
    const content = fitSegments(inlineSegments(cell, header ? "cyan" : undefined, header), widths[index]!);
    const padding = widths[index]! - segmentWidth(content);
    const left = alignments[index] === "right" ? padding : alignments[index] === "center" ? Math.floor(padding / 2) : 0;
    const right = padding - left;
    segments.push({ text: ` ${" ".repeat(left)}` });
    segments.push(...content);
    segments.push({ text: `${" ".repeat(right)} ` });
    segments.push({ text: "│", color: "gray" });
  });
  return renderLine("table", segments);
}

function normalizeTableRow(row: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => row[index] ?? "");
}

function clampTableWidth(width: number): number {
  return Math.max(3, Math.min(24, width));
}

function segmentWidth(segments: StyledSegment[]): number {
  return segments.reduce((total, segment) => total + displayWidth(segment.text), 0);
}

function fitSegments(segments: StyledSegment[], width: number): StyledSegment[] {
  if (segmentWidth(segments) <= width) return segments;
  const result: StyledSegment[] = [];
  let remaining = Math.max(0, width - 1);
  for (const segment of segments) {
    if (remaining <= 0) break;
    let value = "";
    for (const character of segment.text) {
      const size = displayWidth(character);
      if (size > remaining) break;
      value += character;
      remaining -= size;
    }
    if (value) result.push({ ...segment, text: value });
  }
  result.push({ text: "…", color: "gray" });
  return result;
}

function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (/\p{Mark}/u.test(character)) continue;
    width += code >= 0x1100 && (
      code <= 0x115f || code === 0x2329 || code === 0x232a
      || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe10 && code <= 0xfe19)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1faff)
    ) ? 2 : 1;
  }
  return width;
}

function parseAlignment(value: string): "left" | "center" | "right" {
  const trimmed = value.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  return trimmed.endsWith(":") ? "right" : "left";
}

function normalizeLanguage(value: string): string {
  const normalized = value.toLocaleLowerCase().replace(/^\{\.?|\}$/g, "");
  return LANGUAGE_ALIASES[normalized] ?? (normalized || "text");
}

function indentation(value: string): number {
  return Math.floor(value.replace(/\t/g, "  ").length / 2);
}

function normalizeLines(content: string): string[] {
  return content.replace(/\r\n?/g, "\n").split("\n");
}

function sanitize(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "�");
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let position = index - 1; position >= 0 && value[position] === "\\"; position--) slashes++;
  return slashes % 2 === 1;
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_[\]{}()#+\-.!|>~])/g, "$1");
}

function renderLine(kind: RenderLine["kind"], segments: StyledSegment[], backgroundColor?: RenderLine["backgroundColor"]): RenderLine {
  return { kind, indent: 0, segments, backgroundColor };
}

function blankLine(): RenderLine {
  return renderLine("blank", [{ text: " " }]);
}

function words(value: string): Set<string> {
  return new Set(value.split(" "));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
