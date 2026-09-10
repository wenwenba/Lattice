export interface Note {
  id: string;
  title: string;
  path: string;
  relativePath: string;
  content: string;
  links: string[];
  tags: string[];
  modifiedAt: number;
}

export interface VaultFile {
  path: string;
  relativePath: string;
  name: string;
}

export type AppMode =
  | "move"
  | "import"
  | "settings"
  | "ai-config"
  | "ai-review"
  | "browse"
  | "edit"
  | "search"
  | "create"
  | "create-folder"
  | "rename"
  | "commands"
  | "pick-file"
  | "confirm-delete"
  | "confirm-quit";
export type MainView = "preview" | "backlinks" | "help";
export type FocusPane = "sidebar" | "main";

export interface StyledSegment {
  text: string;
  href?: string;
  color?: "cyan" | "blue" | "green" | "yellow" | "magenta" | "gray" | "white" | "red" | `#${string}`;
  backgroundColor?: `#${string}`;
  image?: { target: string; alt: string };
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface RenderLine {
  graphic?: { id: number; row: number; rows: number; columns: number; width: number; height: number };
  kind:
    | "blank"
    | "image"
    | "heading"
    | "paragraph"
    | "list"
    | "quote"
    | "code-header"
    | "code"
    | "code-footer"
    | "table"
    | "frontmatter"
    | "rule";
  indent: number;
  segments: StyledSegment[];
  backgroundColor?: "black";
}
