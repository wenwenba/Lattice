import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { markdownVaultFileLink, resolveLinkTarget, terminalHyperlink } from "../src/links.js";

describe("preview links", () => {
  it("creates a portable link relative to the current vault note", () => {
    expect(markdownVaultFileLink("assets/Report [final].pdf", "Guides/Note.md"))
      .toBe("[Report \\[final\\].pdf](../assets/Report%20%5Bfinal%5D.pdf)");
  });

  it("resolves relative note links and rejects unsafe protocols", () => {
    const note = join(process.cwd(), "notes", "Guide.md");
    expect(resolveLinkTarget("../assets/manual.pdf", note)).toBe(pathToFileURL(join(process.cwd(), "assets", "manual.pdf")).href);
    expect(resolveLinkTarget("javascript:alert(1)", note)).toBeUndefined();
  });

  it("wraps supported targets in an OSC 8 terminal hyperlink", () => {
    const value = terminalHyperlink("Open ↗", "https://example.com");
    expect(value).toContain("\u001b]8;;https://example.com/\u0007");
    expect(value).toContain("Open ↗");
  });
});
