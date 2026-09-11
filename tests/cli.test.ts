import { describe, expect, it } from "vitest";
import { helpText, parseCliArgs } from "../src/cli.js";

describe("cross-platform CLI", () => {
  it("resolves POSIX vault paths and portable display options", () => {
    expect(parseCliArgs(["--vault", "docs/vault", "--no-color", "--inline"], "/work", "linux")).toMatchObject({
      vaultPath: "/work/docs/vault",
      color: false,
      mode: "inline",
    });
  });

  it("resolves Windows drive paths with Windows semantics", () => {
    expect(parseCliArgs(["C:\\Users\\me\\Vault"], "C:\\Work", "win32").vaultPath).toBe("C:\\Users\\me\\Vault");
    expect(helpText("win32")).toContain("C:\\Users\\me\\Documents\\Vault");
  });

  it("leaves vault selection to startup when no path is supplied and expands tilde paths", () => {
    expect(parseCliArgs([], "/work", "linux", "/home/me").vaultPath).toBeUndefined();
    expect(parseCliArgs(["~/Notes"], "/work", "linux", "/home/me").vaultPath).toBe("/home/me/Notes");
  });

  it("rejects unknown options with an actionable error", () => {
    expect(() => parseCliArgs(["--unknown"], "/work", "linux")).toThrow("Unknown option");
    expect(() => parseCliArgs(["--vault"], "/work", "linux")).toThrow("requires a folder path");
    expect(() => parseCliArgs(["--vault="], "/work", "linux")).toThrow("requires a folder path");
    expect(() => parseCliArgs(["--", "one", "two"], "/work", "linux")).toThrow("Unexpected argument");
    expect(() => parseCliArgs(["--keymap"], "/work", "linux")).toThrow("--keymap requires");
    expect(() => parseCliArgs(["--keymap=bogus"], "/work", "linux")).toThrow("--keymap requires");
  });
  it("allows laptop keymaps independently of the local/remote runtime OS", () => {
    expect(parseCliArgs([], "/work", "linux").keymap).toBe("auto");
    expect(parseCliArgs(["--keymap", "macos"], "/work", "linux").keymap).toBe("macos");
    expect(parseCliArgs(["--keymap=windows"], "/work", "darwin").keymap).toBe("windows");
  });
});
