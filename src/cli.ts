import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { Keymap } from "./shortcuts.js";

export const LATTICE_VERSION = "0.1.3";

export interface CliOptions {
  vaultPath?: string;
  color: boolean;
  mode: "fullscreen" | "inline";
  help: boolean;
  version: boolean;
  keymap: Keymap;
}

export function parseCliArgs(
  args: string[],
  cwd = process.cwd(),
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): CliOptions {
  const path = platform === "win32" ? win32 : posix;
  let vaultPath: string | undefined;
  let color = true;
  let mode: CliOptions["mode"] = "fullscreen";
  let help = false;
  let version = false;
  let keymap: Keymap = "auto";

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--") {
      const positional = args[index + 1];
      if (!positional) break;
      if (vaultPath) throw new Error(`Unexpected argument: ${positional}`);
      if (args[index + 2]) throw new Error(`Unexpected argument: ${args[index + 2]}`);
      vaultPath = positional;
      break;
    }
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--version" || argument === "-v") version = true;
    else if (argument === "--no-color") color = false;
    else if (argument === "--inline") mode = "inline";
    else if (argument === "--keymap" || argument.startsWith("--keymap=")) {
      const value = argument === "--keymap" ? args[++index] : argument.slice("--keymap=".length);
      if (!["auto", "macos", "windows", "linux"].includes(value ?? "")) throw new Error("--keymap requires auto, macos, windows or linux");
      keymap = value as Keymap;
    }
    else if (argument === "--vault" || argument === "-V") {
      const value = args[++index];
      if (!value) throw new Error(`${argument} requires a folder path`);
      vaultPath = value;
    } else if (argument.startsWith("--vault=")) {
      const value = argument.slice("--vault=".length);
      if (!value) throw new Error("--vault requires a folder path");
      vaultPath = value;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!vaultPath) {
      vaultPath = argument;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  return {
    vaultPath: vaultPath
      ? path.resolve(cwd, vaultPath === "~" ? home : vaultPath.startsWith("~/") || vaultPath.startsWith("~\\") ? path.join(home, vaultPath.slice(2)) : vaultPath)
      : undefined,
    color,
    mode,
    help,
    version,
    keymap,
  };
}

export function helpText(platform: NodeJS.Platform = process.platform): string {
  const example = platform === "win32"
    ? "lattice --vault C:\\Users\\me\\Documents\\Vault"
    : "lattice --vault ~/Documents/Vault";
  return [
    "Lattice — an Obsidian-inspired terminal knowledge base",
    "",
    "Usage: lattice [vault-path] [options]",
    "       lattice                 Reopen the last vault (creates a default vault on first run)",
    "",
    "Options:",
    "  -V, --vault <path>  Open a Markdown vault",
    "      --inline        Avoid the alternate screen for limited terminals",
    "      --no-color      Disable ANSI colors",
    "      --keymap <name>  auto (default), macos, windows or linux; useful over SSH",
    "  -v, --version       Print the version",
    "  -h, --help          Show this help",
    "",
    `Switch vault: ${example}`,
    "",
  ].join("\n");
}
