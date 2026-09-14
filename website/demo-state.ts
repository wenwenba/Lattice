import { extractLinks, extractTags, noteTitle, renderMarkdown, wrapRenderLine } from '../src/markdown';
import type { Note, RenderLine } from '../src/types';

export type DemoNote = Note;

export type PreviewRow = {
  text: string;
  kind: RenderLine['kind'];
};

export const createDefaultNotes = (): DemoNote[] => [
  createNote('Welcome.md', `# Welcome to Lattice

本地 Markdown，就是你的数据库。

## 今天
- [x] 整理项目笔记
- [ ] 连接 [[Roadmap]]

> 选中文件后按 Enter，直接进入编辑。`),
  createNote('Projects/Roadmap.md', `# Roadmap

| 状态 | 计划 |
| :--- | :--- |
| ✓ | Web 交互演示 |
| · | 双向链接视图 |

\`\`\`ts
const notes = await vault.list()
\`\`\``),
  createNote('随记.md', `# 随记

把想法留在这里。

- 支持中文输入
- 自动保存在浏览器本地`),
];

export function updateDemoNote(note: DemoNote, content: string): void {
  note.content = content;
  note.title = noteTitle(note.relativePath, content);
  note.links = extractLinks(content);
  note.tags = extractTags(content);
  note.modifiedAt = Date.now();
}

export function createDemoNote(relativePath: string, content?: string): DemoNote {
  const normalized = normalizeNoteName(relativePath);
  return createNote(normalized, content ?? `# ${normalized.replace(/\.md$/iu, '')}\n\n`);
}

export function renderMarkdownPreview(markdown: string, width: number, maxRows: number): PreviewRow[] {
  return renderMarkdown(markdown)
    .flatMap((line) => wrapRenderLine(line, width))
    .slice(0, maxRows)
    .map((line) => ({
      text: `${'  '.repeat(line.indent)}${line.segments.map((segment) => segment.text).join('')}`,
      kind: line.kind,
    }));
}

export function wrapIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return ((index + delta) % length + length) % length;
}

export function normalizeNoteName(value: string): string {
  const clean = value.trim().replace(/[\\/:*?"<>|]/gu, '-');
  if (!clean) return 'Untitled.md';
  return clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`;
}

function createNote(relativePath: string, content: string): DemoNote {
  return {
    id: relativePath,
    title: noteTitle(relativePath, content),
    path: relativePath,
    relativePath,
    content,
    links: extractLinks(content),
    tags: extractTags(content),
    modifiedAt: Date.now(),
  };
}
