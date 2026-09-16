#!/usr/bin/env node
import { createApp } from "@vue-tui/runtime";
import App from "./app.vue";
import { helpText, LATTICE_VERSION, parseCliArgs } from "./cli.js";
import { KITTY_GRAPHICS, KittyGraphics, KittyPlacementGraphics, graphicsOutput, kittyEnabled, usesKittyPlacements } from "./graphics.js";
import { MOUSE_INPUT, TerminalMouseInput } from "./mouse.js";
import { resolveStartupVault } from "./startup.js";
import { checkForUpdate } from "./update-check.js";

async function main(): Promise<void> {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Lattice: ${error instanceof Error ? error.message : String(error)}\nUse --help for usage.\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (options.version) {
    process.stdout.write(`${LATTICE_VERSION}\n`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("Lattice requires an interactive terminal. On Windows, use Windows Terminal or PowerShell.\n");
    process.exitCode = 1;
    return;
  }

  let vaultPath: string;
  try {
    vaultPath = await resolveStartupVault(options.vaultPath);
  } catch (error) {
    process.stderr.write(`Lattice: could not open the vault: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const app = createApp(App, { vaultPath, keymap: options.keymap, updateCheck: checkForUpdate(LATTICE_VERSION) });
  const native = usesKittyPlacements(process.env) && options.mode === "fullscreen"
    && kittyEnabled({ ...process.env, LATTICE_GRAPHICS: "kitty" }, Boolean(process.stdout.isTTY), options.color);
  const graphics = native ? new KittyPlacementGraphics((data) => { process.stdout.write(data); })
    : !usesKittyPlacements(process.env) && kittyEnabled(process.env, Boolean(process.stdout.isTTY), options.color)
      ? new KittyGraphics((data) => { process.stdout.write(data); }) : undefined;
  const output = graphics instanceof KittyPlacementGraphics ? graphicsOutput(process.stdout, graphics) : undefined;
  if (graphics) app.provide(KITTY_GRAPHICS, graphics);
  const mouse = options.mode === "fullscreen" && process.env.LATTICE_MOUSE !== "off"
    ? new TerminalMouseInput(process.stdin, (data) => { process.stdout.write(data); }) : undefined;
  if (mouse) app.provide(MOUSE_INPUT, mouse);
  const restoreMouse = () => mouse?.setEnabled(false);
  process.once("exit", restoreMouse);
  try {
    app.mount({ stdin: mouse, stdout: output, mode: options.mode, color: graphics ? "truecolor" : options.color, exitOnCtrlC: false, patchConsole: true });
    mouse?.start();
    await app.waitUntilExit();
  } finally { mouse?.release(); process.off("exit", restoreMouse); graphics?.dispose(); output?.release(); }
}

await main();
