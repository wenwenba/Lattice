import { describe, expect, it } from "vitest";
import { applySlashCommand, filterSlashCommands, SLASH_COMMANDS } from "../src/slash.js";

describe("slash commands", () => {
  it("filters commands by label and aliases", () => {
    expect(filterSlashCommands("code")[0]?.id).toBe("code");
    expect(filterSlashCommands("todo")[0]?.id).toBe("task");
    expect(filterSlashCommands("file")[0]?.action).toBe("pick-vault-file");
    expect(filterSlashCommands("save")[0]?.action).toBe("save-note");
    expect(filterSlashCommands("paste-image")).toEqual([]);
    expect(SLASH_COMMANDS.some((item) => item.label === "Paste clipboard image")).toBe(false);
  });

  it("replaces the slash query and positions the cursor inside templates", () => {
    const code = SLASH_COMMANDS.find((item) => item.id === "code")!;
    expect(applySlashCommand({ content: "Before\n/code", cursor: 12 }, 7, code)).toEqual({
      content: "Before\n```\n\n```",
      cursor: 11,
    });

    const link = SLASH_COMMANDS.find((item) => item.id === "wiki-link")!;
    expect(applySlashCommand({ content: "/link", cursor: 5 }, 0, link)).toEqual({ content: "[[]]", cursor: 2 });
  });
});
