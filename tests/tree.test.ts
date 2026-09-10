import { describe, expect, it } from "vitest";
import { buildVaultTree } from "../src/tree.js";
import type { Note } from "../src/types.js";

function note(relativePath: string): Note {
  return {
    id: relativePath.replace(/\.md$/, ""),
    title: relativePath,
    path: `/${relativePath}`,
    relativePath,
    content: "",
    links: [],
    tags: [],
    modifiedAt: 0,
  };
}

describe("vault tree", () => {
  it("shows folders before notes and honors expansion", () => {
    const notes = [note("Root.md"), note("Work/Ideas/One.md")];
    const expanded = new Set(["Work", "Work/Ideas"]);
    const tree = buildVaultTree(notes, ["Empty", "Work", "Work/Ideas"], expanded);

    expect(tree.map((item) => `${item.kind}:${item.relativePath}`)).toEqual([
      "folder:Empty",
      "folder:Work",
      "folder:Work/Ideas",
      "note:Work/Ideas/One.md",
      "note:Root.md",
    ]);
    expect(tree.find((item) => item.relativePath === "Work/Ideas/One.md")?.depth).toBe(2);
  });

  it("hides descendants of collapsed folders", () => {
    const tree = buildVaultTree([note("Work/One.md")], ["Work"], new Set());
    expect(tree.map((item) => item.relativePath)).toEqual(["Work"]);
  });
});
