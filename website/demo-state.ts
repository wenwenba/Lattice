import stringWidth from 'string-width';

export type DemoNote = {
  id: string;
  name: string;
  content: string;
};

export type PreviewRow = {
  text: string;
  kind: 'body' | 'heading1' | 'heading2' | 'heading3' | 'task' | 'quote' | 'code' | 'table';
};

export const createDefaultNotes = (): DemoNote[] => [
  {
    id: 'welcome',
    name: 'Welcome.md',
    content: `# Welcome to Lattice

本地 Markdown，就是你的数据库。

## 今天
- [x] 整理项目笔记
- [ ] 连接 [[Roadmap]]

> 点击左侧文件，直接在这里编辑。`,
  },
  {
    id: 'roadmap',
    name: 'Roadmap.md',
    content: `# Roadmap

| 状态 | 计划 |
| --- | --- |
| ✓ | Web 交互演示 |
| · | 双向链接视图 |

\`\`\`ts
const notes = await vault.list()
\`\`\``,
  },
  {
    id: 'scratch',
    name: '随记.md',
    content: `# 随记

把想法留在这里。

- 支持中文输入
- 自动保存在浏览器本地`,
  },
];

function wrapByWidth(text: string, width: number): string[] {
  if (!text) return [''];
  const rows: string[] = [];
  let row = '';
  let cells = 0;

  for (const char of text) {
    const charWidth = stringWidth(char);
    if (row && cells + charWidth > width) {
      rows.push(row);
      row = '';
      cells = 0;
    }
    row += char;
    cells += charWidth;
  }
  rows.push(row);
  return rows;
}

function cleanInlineMarkdown(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '▣ $1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '$1 ↗')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1 ↗')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/`([^`]+)`/gu, '‹$1›');
}

export function renderMarkdownPreview(markdown: string, width: number, maxRows: number): PreviewRow[] {
  const result: PreviewRow[] = [];
  let inCode = false;

  for (const sourceLine of markdown.replace(/\r/gu, '').split('\n')) {
    const trimmed = sourceLine.trim();
    let kind: PreviewRow['kind'] = inCode ? 'code' : 'body';
    let text = sourceLine;

    if (/^```/u.test(trimmed)) {
      text = inCode ? '└────────────────' : `┌ code ${trimmed.slice(3)}`.trimEnd();
      kind = 'code';
      inCode = !inCode;
    } else if (inCode) {
      text = `  ${sourceLine}`;
    } else if (/^#\s+/u.test(trimmed)) {
      text = `█ ${trimmed.replace(/^#\s+/u, '')}`;
      kind = 'heading1';
    } else if (/^##\s+/u.test(trimmed)) {
      text = `◆ ${trimmed.replace(/^##\s+/u, '')}`;
      kind = 'heading2';
    } else if (/^###\s+/u.test(trimmed)) {
      text = `◇ ${trimmed.replace(/^###\s+/u, '')}`;
      kind = 'heading3';
    } else if (/^- \[[xX ]\]\s+/u.test(trimmed)) {
      text = trimmed.replace(/^- \[[xX]\]\s+/u, '✓ ').replace(/^- \[ \]\s+/u, '□ ');
      kind = 'task';
    } else if (/^>\s?/u.test(trimmed)) {
      text = `│ ${trimmed.replace(/^>\s?/u, '')}`;
      kind = 'quote';
    } else if (/^\|?[\s:|-]+\|[\s:|-]+\|?$/u.test(trimmed)) {
      continue;
    } else if (trimmed.includes('|')) {
      text = trimmed.replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim()).join(' │ ');
      kind = 'table';
    } else {
      text = cleanInlineMarkdown(trimmed);
    }

    const wrapped = wrapByWidth(text, Math.max(4, width));
    for (const row of wrapped) result.push({ text: row, kind });
    if (result.length >= maxRows) return result.slice(0, maxRows);
  }

  return result;
}

export function normalizeNoteName(value: string): string {
  const clean = value.trim().replace(/[\\/:*?"<>|]/gu, '-');
  if (!clean) return 'Untitled.md';
  return clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`;
}
