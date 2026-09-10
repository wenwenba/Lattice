import type { EditorState } from "./editor.js";

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  keywords: string;
  insertion: string;
  cursorOffset?: number;
  action?: "pick-vault-file" | "pick-vault-image" | "save-note";
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  command("heading-1", "Heading 1", "Large section heading", "h1 title heading", "# "),
  command("heading-2", "Heading 2", "Medium section heading", "h2 subtitle heading", "## "),
  command("heading-3", "Heading 3", "Small section heading", "h3 heading", "### "),
  command("bullet-list", "Bullet list", "Start an unordered list", "bullet unordered list", "- "),
  command("numbered-list", "Numbered list", "Start an ordered list", "number ordered list", "1. "),
  command("task", "Task", "Insert an unchecked task", "todo checkbox task", "- [ ] "),
  command("quote", "Quote", "Insert a block quote", "quote blockquote", "> "),
  command("code", "Code block", "Fenced code block", "code fence snippet", "```\n\n```", 4),
  command("table", "Table", "Two-column Markdown table", "table columns", "| Column | Column |\n| --- | --- |\n| Value | Value |"),
  command("wiki-link", "Wiki link", "Link another note", "link wiki backlink", "[[]]", 2),
  command("file-link", "Vault file link", "Choose a file inside this vault", "file link attachment vault browse picker", "", undefined, "pick-vault-file"),
  command("image", "Image", "Insert a vault image", "image img picture photo 图片", "", undefined, "pick-vault-image"),
  command("callout", "Callout", "Obsidian-style info callout", "callout info note", "> [!note]\n> "),
  command("divider", "Divider", "Horizontal rule", "divider rule separator", "---"),
  command("save", "Save note", "Save the current draft", "save write", "", undefined, "save-note"),
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((item) => {
    const haystack = `${item.label} ${item.keywords}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function applySlashCommand(state: EditorState, slashStart: number, item: SlashCommand): EditorState {
  const start = Math.max(0, Math.min(slashStart, state.cursor));
  const content = state.content.slice(0, start) + item.insertion + state.content.slice(state.cursor);
  return {
    content,
    cursor: start + (item.cursorOffset ?? item.insertion.length),
  };
}

function command(
  id: string,
  label: string,
  description: string,
  keywords: string,
  insertion: string,
  cursorOffset?: number,
  action?: SlashCommand["action"],
): SlashCommand {
  return { id, label, description, keywords, insertion, cursorOffset, action };
}
