import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
export type ClipboardContent = { image: Buffer } | { text: string };
const MAX_BYTES = 20 * 1024 * 1024;

export async function writeClipboardText(text: string, platform = process.platform, env = process.env): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "lattice-copy-"));
  const input = join(directory, "selection.txt");
  try {
    await writeFile(input, text, { encoding: "utf8", mode: 0o600 });
    const options = { timeout: 10000, windowsHide: true, env: { ...env, LATTICE_CLIPBOARD_INPUT: input } };
    if (platform === "darwin") {
      await runWithInput("/usr/bin/pbcopy", [], text, options);
    } else if (platform === "win32") {
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", `
        $ErrorActionPreference = 'Stop'
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Clipboard]::SetText([System.IO.File]::ReadAllText($env:LATTICE_CLIPBOARD_INPUT, [System.Text.Encoding]::UTF8))
      `], options);
    } else if (env.WAYLAND_DISPLAY) {
      await runWithInput("wl-copy", ["--type", "text/plain;charset=utf-8"], text, options);
    } else {
      await run("xclip", ["-selection", "clipboard", "-i", input], options);
    }
  } catch (error) {
    const advice = platform === "linux" ? "install wl-clipboard (Wayland) or xclip (X11)" : "check local clipboard access";
    throw new Error(`Cannot copy to the local clipboard; ${advice}`, { cause: error });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runWithInput(executable: string, args: string[], input: string,
  options: Parameters<typeof run>[2]): Promise<void> {
  const running = run(executable, args, options);
  const stdin = running.child.stdin;
  if (!stdin) { await running; throw new Error(`${executable} did not expose standard input`); }
  // The process result carries EPIPE/exit failures; consuming the stream error
  // also prevents Node from treating it as an uncaught event.
  stdin.on("error", () => {});
  stdin.end(input);
  await running;
}

// Native clipboard access stays local. Never interpolate clipboard data into a shell.
export async function readClipboard(platform = process.platform, env = process.env): Promise<ClipboardContent> {
  const directory = await mkdtemp(join(tmpdir(), "lattice-clipboard-"));
  const output = join(directory, "clipboard.png");
  const options = { timeout: 10000, maxBuffer: MAX_BYTES, windowsHide: true,
    env: { ...env, LATTICE_CLIPBOARD_OUTPUT: output } };
  try {
    if (platform === "darwin") {
      await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", `
        ObjC.import('AppKit');
        const board = $.NSPasteboard.generalPasteboard;
        if (board.isNil()) throw new Error('Clipboard unavailable in this session');
        let data = board.dataForType($.NSPasteboardTypePNG);
        if (data.isNil()) {
          const tiff = board.dataForType($.NSPasteboardTypeTIFF);
          if (!tiff.isNil()) data = $.NSBitmapImageRep.imageRepWithData(tiff)
            .representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
        }
        if (!data.isNil()) {
          const path = $.NSProcessInfo.processInfo.environment.objectForKey('LATTICE_CLIPBOARD_OUTPUT');
          if (!data.writeToFileAtomically(path, true)) throw new Error('Cannot write clipboard image');
        }
      `], options);
      if (await exists(output)) return { image: await readImage(output) };
      return { text: (await run("/usr/bin/pbpaste", [], options)).stdout };
    }
    if (platform === "win32") {
      const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", `
        $ErrorActionPreference = 'Stop'
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
          $image = [System.Windows.Forms.Clipboard]::GetImage()
          try { $image.Save($env:LATTICE_CLIPBOARD_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png) }
          finally { $image.Dispose() }
        } else {
          [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
          [Console]::Write([System.Windows.Forms.Clipboard]::GetText())
        }
      `], options);
      return await exists(output) ? { image: await readImage(output) } : { text: result.stdout };
    }
    // Query MIME types first: never mistake an unavailable image target for image bytes.
    const wayland = Boolean(env.WAYLAND_DISPLAY);
    const executable = wayland ? "wl-paste" : "xclip";
    const typesArgs = wayland ? ["--list-types"] : ["-selection", "clipboard", "-o", "-t", "TARGETS"];
    const types = (await run(executable, typesArgs, options)).stdout.split(/\r?\n/);
    const image = types.includes("image/png");
    const args = wayland
      ? ["--no-newline", "--type", image ? "image/png" : "text"]
      : ["-selection", "clipboard", "-o", "-t", image ? "image/png" : "UTF8_STRING"];
    const result = await run(executable, args, { ...options, encoding: "buffer" });
    return image ? { image: result.stdout } : { text: result.stdout.toString("utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Clipboard helper missing: install wl-clipboard (Wayland) or xclip (X11)");
    }
    throw new Error("Cannot read the local clipboard. Copy an image/text first; remote SSH clipboards are not available.", { cause: error });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function readImage(path: string): Promise<Buffer> {
  if ((await stat(path)).size > MAX_BYTES) throw new Error("Clipboard image exceeds 20 MB");
  return readFile(path);
}
