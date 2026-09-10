import { describe, expect, it } from "vitest";
import { extractLinks, extractTags, noteTitle, renderMarkdown, wrapRenderLine } from "../src/markdown.js";

describe("markdown helpers", () => {
  it("extracts unique wiki links and tags", () => {
    const content = "See [[Daily/Today|today]] and [[Ideas]]. Again [[Ideas]]. #work #中文";
    expect(extractLinks(content)).toEqual(["Daily/Today", "Ideas"]);
    expect(extractTags(content)).toEqual(["work", "中文"]);
  });

  it("prefers the first heading as the title", () => {
    expect(noteTitle("folder/file.md", "# Better title\nBody")).toBe("Better title");
    expect(noteTitle("folder/file.md", "Body")).toBe("file");
  });

  it("turns markdown into terminal-friendly styled lines", () => {
    const lines = renderMarkdown("# Heading\n- [x] Done\n> quote\n`code` and [[Note]]");
    expect(lines.map((line) => line.kind)).toEqual(["heading", "list", "quote", "paragraph"]);
    expect(lines[1]?.segments[0]?.text).toBe("✓ ");
    expect(lines[3]?.segments.some((segment) => segment.underline && segment.text === "Note")).toBe(true);
  });

  it("gives each heading level a distinct visual hierarchy", () => {
    const lines = renderMarkdown(["# One", "## Two", "### Three", "#### Four", "##### Five", "###### Six"].join("\n"));
    const markers = lines.map((line) => line.segments[0]?.text);
    const colors = lines.map((line) => line.segments[0]?.color);

    expect(markers).toEqual(["█ ", "▌ ", "◆ ", "◇ ", "› ", "· "]);
    expect(new Set(colors).size).toBe(6);
    expect(lines[0]?.segments[1]?.underline).toBe(true);
  });

  it("renders fenced code blocks without exposing fence markers", () => {
    const lines = renderMarkdown([
      "```ts",
      "const answer: number = 42;",
      "// keep markdown **literal** in code",
      "```",
    ].join("\n"));

    expect(lines.map((line) => line.kind)).toEqual(["code-header", "code", "code", "code-footer"]);
    expect(lines[0]?.segments.map((segment) => segment.text).join("")).toContain("typescript");
    expect(lines[1]?.segments.map((segment) => segment.text).join("")).toContain("const answer: number = 42;");
    expect(lines[1]?.segments.some((segment) => segment.text === "const" && segment.color === "magenta")).toBe(true);
    expect(lines[2]?.segments.map((segment) => segment.text).join("")).toContain("**literal**");
    expect(lines.flatMap((line) => line.segments).some((segment) => segment.text.includes("```"))).toBe(false);
  });

  it("supports tilde, unclosed and indented code blocks", () => {
    expect(renderMarkdown("~~~python\nprint('ok')\n~~~").map((line) => line.kind)).toEqual(["code-header", "code", "code-footer"]);
    expect(renderMarkdown("```json\n{\"ok\": true}").at(-1)?.kind).toBe("code-footer");
    expect(renderMarkdown("    npm run build").map((line) => line.kind)).toEqual(["code-header", "code", "code-footer"]);
  });

  it("renders frontmatter, tables and common inline styles", () => {
    const lines = renderMarkdown([
      "---",
      "status: draft",
      "---",
      "| Name | Value |",
      "| :--- | ---: |",
      "| **one** | ~~old~~ |",
    ].join("\n"));

    expect(lines.some((line) => line.kind === "frontmatter")).toBe(true);
    const tableLines = lines.filter((line) => line.kind === "table");
    expect(tableLines).toHaveLength(5);
    expect(tableLines[0]?.segments[0]?.text).toMatch(/^┌.*┬.*┐$/);
    expect(tableLines[2]?.segments[0]?.text).toMatch(/^├.*┼.*┤$/);
    expect(tableLines[4]?.segments[0]?.text).toMatch(/^└.*┴.*┘$/);
    expect(lines.flatMap((line) => line.segments).some((segment) => segment.text === "one" && segment.bold)).toBe(true);
    expect(lines.flatMap((line) => line.segments).some((segment) => segment.text === "old" && segment.strikethrough)).toBe(true);
  });

  it("marks Markdown and autolinks as clickable preview segments", () => {
    const lines = renderMarkdown("[OpenAI](https://openai.com) and <mailto:hello@example.com>");
    const links = lines.flatMap((line) => line.segments).filter((segment) => segment.href);

    expect(links.map((segment) => segment.href)).toEqual(["https://openai.com", "mailto:hello@example.com"]);
    expect(links.every((segment) => segment.underline && segment.text.endsWith("↗"))).toBe(true);
  });

  it("wraps long preview text by terminal-cell width without losing styles", () => {
    const line = renderMarkdown("中文 [long-link](https://example.com) tail")[0]!;
    const wrapped = wrapRenderLine(line, 10);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.flatMap((item) => item.segments).map((segment) => segment.text).join(""))
      .toBe(line.segments.map((segment) => segment.text).join(""));
    expect(wrapped.flatMap((item) => item.segments).filter((segment) => segment.href).every((segment) => segment.href === "https://example.com")).toBe(true);
  });

  it("does not use headings inside code fences as note titles", () => {
    expect(noteTitle("fallback.md", "```md\n# Not a title\n```\n# Real title")).toBe("Real title");
    expect(noteTitle("fallback.md", "---\nstatus: draft\n---\n# Frontmatter-safe title")).toBe("Frontmatter-safe title");
  });
});
