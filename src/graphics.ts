import { createHash, randomInt } from "node:crypto";
import type { InjectionKey } from "vue";
import type { RenderLine } from "./types.js";
import { Writable } from "node:stream";

export interface ImageGraphics {
  readonly label: string;
  render(png: Buffer, width: number, height: number, columns: number, maxRows?: number): RenderLine[];
  dispose(): void;
  setViewport?(lines: RenderLine[], x: number, y: number, width: number, height: number): void;
}
export const KITTY_GRAPHICS: InjectionKey<ImageGraphics> = Symbol("lattice-kitty-graphics");
export const IMAGE_PLACEHOLDER = "\u{10eeee}";
// Kitty's protocol-defined row/column encoding, not arbitrary combining accents.
// https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders
const diacritics = [0x305, 0x30d, 0x30e, 0x310, 0x312, 0x33d, 0x33e, 0x33f, 0x346, 0x34a,
  0x34b, 0x34c, 0x350, 0x351, 0x352, 0x357, 0x35b, 0x363, 0x364, 0x365, 0x366, 0x367,
  0x368, 0x369, 0x36a, 0x36b, 0x36c, 0x36d, 0x36e, 0x36f, 0x483, 0x484, 0x485, 0x486,
  0x487, 0x592, 0x593, 0x594, 0x595, 0x597, 0x598, 0x599, 0x59c, 0x59d, 0x59e, 0x59f,
  0x5a0, 0x5a1, 0x5a8, 0x5a9, 0x5ab, 0x5ac, 0x5af, 0x5c4, 0x610, 0x611, 0x612, 0x613,
  0x614, 0x615].map((code) => String.fromCodePoint(code));

export function kittyEnabled(env: NodeJS.ProcessEnv, isTTY: boolean, color: boolean): boolean {
  if (!isTTY || !color || env.NO_COLOR !== undefined || env.CI || env.TMUX || env.STY || env.ZELLIJ) return false;
  const protocol = env.LATTICE_GRAPHICS ?? env.VUE_TUI_TERMINAL_GRAPHICS ?? env.VUE_TUI_GRAPHICS_PROTOCOL;
  if (protocol && protocol !== "auto") return protocol === "kitty";
  return Boolean(env.KITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR
    || /kitty|ghostty/.test(`${env.TERM ?? ""} ${env.TERM_PROGRAM ?? ""}`.toLowerCase()));
}

/** Virtual placements let Vue's text renderer own clipping, scrolling and erasure.
 * Pixel bytes travel out-of-band, never through Text's ANSI sanitizer. The visible
 * cells are protocol placeholders, not a character approximation of the image.
 */
export class KittyGraphics {
  readonly label = "Kitty";
  private nextId = randomInt(1, 0xff0000);
  private images = new Map<string, { id: number; placements: Set<string> }>();
  private bytes = 0;
  private disposed = false;
  constructor(private write: (data: string) => void) {}

  render(png: Buffer, width: number, height: number, columns: number, maxRows = 12): RenderLine[] {
    if (this.disposed) throw new Error("Graphics session closed");
    const scale = Math.min(Math.max(1, Math.min(60, columns)) / width, Math.max(1, Math.min(12, maxRows)) * 2 / height);
    const cols = Math.max(1, Math.floor(width * scale));
    const rows = Math.max(1, Math.ceil(height * scale / 2));
    const key = `${createHash("sha256").update(png).digest("hex")}:${cols}x${rows}`;
    let image = this.images.get(key);
    if (!image) {
      if (this.bytes + png.length > 64 * 1024 * 1024) throw new Error("Terminal image cache is full");
      image = { id: this.nextId++, placements: new Set() };
      if (this.nextId > 0xffffff) this.nextId = 1;
      const base64 = png.toString("base64");
      // Kitty requires <=4096-byte, base64-aligned chunks; q=2 suppresses input replies.
      for (let offset = 0; offset < base64.length; offset += 4096) {
        const chunk = base64.slice(offset, offset + 4096), more = offset + 4096 < base64.length ? 1 : 0;
        const header = offset === 0 ? `a=t,f=100,t=d,i=${image.id},q=2,m=${more}` : `m=${more},q=2`;
        this.write(`\x1b_G${header};${chunk}\x1b\\`);
      }
      this.bytes += png.length;
      this.images.set(key, image);
    }
    // Each cached size has its own stable ID, so returning to a previous window
    // size (or rendering the same image twice) cannot use a stale placement.
    const size = `${cols}x${rows}`;
    if (!image.placements.has(size)) {
      image.placements.clear(); image.placements.add(size);
      this.write(`\x1b_Ga=p,U=1,i=${image.id},p=1,c=${cols},r=${rows},q=2\x1b\\`);
    }
    const color = `#${image.id.toString(16).padStart(6, "0")}` as const;
    return Array.from({ length: rows }, (_, y) => ({
      kind: "image", indent: 0,
      segments: [{ color, text: Array.from({ length: cols }, (_, x) =>
        IMAGE_PLACEHOLDER + diacritics[y]! + diacritics[x]!).join("") }],
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Delete only our own IDs, never images owned by the terminal or another app.
    for (const image of this.images.values()) this.write(`\x1b_Ga=d,d=I,i=${image.id},q=2\x1b\\`);
    this.images.clear();
  }
}

/** Warp implements regular Kitty placements; Unicode placeholder support is not
 * required. Keep raster drawing after the Vue frame so blank reserved rows cannot
 * erase it. Only fullscreen has an absolute, renderer-owned terminal origin. */
export class KittyPlacementGraphics implements ImageGraphics {
  readonly label = "Kitty native";
  private nextId = randomInt(0x100000, 0xefffff);
  private images = new Map<string, number>();
  private bytes = 0;
  private viewport = "";
  private visibleIds = new Set<number>();
  private paintedIds = new Set<number>();
  private pending?: NodeJS.Immediate;
  private disposed = false;
  constructor(private write: (data: string) => void) {}

  render(png: Buffer, width: number, height: number, columns: number, maxRows = 12): RenderLine[] {
    if (this.disposed) throw new Error("Graphics session closed");
    const key = createHash("sha256").update(png).digest("hex");
    let id = this.images.get(key);
    if (!id) {
      if (this.bytes + png.length > 64 * 1024 * 1024) throw new Error("Terminal image cache is full");
      id = this.nextId++;
      const data = png.toString("base64");
      for (let offset = 0; offset < data.length; offset += 4096) {
        const more = offset + 4096 < data.length ? 1 : 0;
        this.write(`\x1b_G${offset ? `m=${more},q=2` : `a=t,f=100,t=d,i=${id},q=2,m=${more}`};${data.slice(offset, offset + 4096)}\x1b\\`);
      }
      this.images.set(key, id); this.bytes += png.length;
    }
    const scale = Math.min(Math.max(1, columns) / width, Math.max(1, Math.min(12, maxRows)) * 2 / height);
    const cols = Math.max(1, Math.floor(width * scale)), rows = Math.max(1, Math.ceil(height * scale / 2));
    return Array.from({ length: rows }, (_, row) => ({
      kind: "image", indent: 0, segments: [{ text: " ".repeat(cols) }],
      graphic: { id: id!, row, rows, columns: cols, width, height },
    }));
  }

  setViewport(lines: RenderLine[], x: number, y: number, width: number, height: number): void {
    if (this.disposed) return;
    const ids = new Set<number>();
    let commands = "";
    for (let i = 0; i < Math.min(lines.length, height); i++) {
      const graphic = lines[i]?.graphic;
      if (!graphic || width < 1 || x < 0 || y < 0) continue;
      let count = 1;
      while (i + count < Math.min(lines.length, height)) {
        const next = lines[i + count]?.graphic;
        if (next?.id !== graphic.id || next.row !== graphic.row + count) break;
        count++;
      }
      const cols = Math.min(width, graphic.columns);
      const cropY = Math.floor(graphic.row * graphic.height / graphic.rows);
      const cropHeight = Math.max(1, Math.ceil((graphic.row + count) * graphic.height / graphic.rows) - cropY);
      const cropWidth = Math.max(1, Math.floor(cols * graphic.width / graphic.columns));
      ids.add(graphic.id);
      commands += `\x1b[${Math.floor(y + i + 1)};${Math.floor(x + 1)}H`
        + `\x1b_Ga=p,i=${graphic.id},p=${i + 1},q=2,C=1,c=${cols},r=${count},x=0,y=${cropY},w=${cropWidth},h=${cropHeight}\x1b\\`;
      i += count - 1;
    }
    this.viewport = commands; this.visibleIds = ids;
    this.scheduleRepaint();
  }

  scheduleRepaint(): void {
    if (this.disposed || this.pending) return;
    this.pending = setImmediate(() => { this.pending = undefined; this.repaint(); });
  }

  repaint(): void {
    if (this.disposed) return;
    const clear = [...this.paintedIds].map((id) => `\x1b_Ga=d,d=i,i=${id},q=2\x1b\\`).join("");
    if (clear || this.viewport) this.write(`\x1b7${clear}${this.viewport}\x1b8`);
    this.paintedIds = new Set(this.visibleIds);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pending) clearImmediate(this.pending);
    for (const id of this.images.values()) this.write(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`);
    this.images.clear();
  }
}

export function usesKittyPlacements(env: NodeJS.ProcessEnv): boolean {
  const override = env.LATTICE_GRAPHICS ?? env.VUE_TUI_TERMINAL_GRAPHICS ?? env.VUE_TUI_GRAPHICS_PROTOCOL;
  const regular = /warp|wezterm/.test((env.TERM_PROGRAM ?? "").toLowerCase()) || Boolean(env.WEZTERM_PANE);
  if (override && override !== "auto") return override === "kitty-native" || (override === "kitty" && regular);
  return regular;
}

/** Use Runtime's public stdout hook; do not patch its private frame coordinator. */
export function graphicsOutput(output: NodeJS.WriteStream, graphics: KittyPlacementGraphics): Writable & { release(): void } {
  const stream = new Writable({
    write(chunk, encoding, callback) {
      output.write(chunk, encoding as BufferEncoding, (error) => {
        if (!error) graphics.scheduleRepaint();
        callback(error);
      });
    },
  });
  for (const key of ["isTTY", "columns", "rows"] as const) {
    Object.defineProperty(stream, key, { get: () => output[key] });
  }
  const resized = () => { stream.emit("resize"); };
  output.on("resize", resized);
  return Object.assign(stream, { release() { output.off("resize", resized); } });
}
