import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { InjectionKey } from "vue";

export interface MouseEvent { type: "down" | "move" | "up" | "wheel"; button: number; x: number; y: number; shift: boolean; delta: number }
export interface MouseController {
  setEnabled(enabled: boolean): void;
  subscribe(handler: (event: MouseEvent) => void): () => void;
}
export const MOUSE_INPUT: InjectionKey<MouseController> = Symbol("lattice-mouse");

/** SGR mouse input is removed before Runtime normalizes keyboard/text events.
 * Paste payloads, UTF-8 bytes and unrelated escape sequences are passed unchanged. */
export class MouseParser {
  private buffer = "";
  private paste = false;
  constructor(private text: (bytes: Buffer) => void, private mouse: (event: MouseEvent) => void) {}
  feed(bytes: Buffer): void {
    this.buffer += bytes.toString("latin1");
    while (this.buffer) {
      const escape = this.buffer.indexOf("\x1b");
      if (escape < 0) { this.send(this.buffer.length); break; }
      if (escape > 0) { this.send(escape); continue; }
      const boundary = this.paste ? "\x1b[201~" : "\x1b[200~";
      if (this.buffer.length < boundary.length && boundary.startsWith(this.buffer)) break;
      if (this.buffer.startsWith(boundary)) { this.send(boundary.length); this.paste = !this.paste; continue; }
      if (!this.paste) {
        if ("\x1b[<".startsWith(this.buffer)) break;
        if (this.buffer.startsWith("\x1b[<")) {
          const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.buffer);
          if (!match && /^\x1b\[<[\d;]*$/.test(this.buffer) && this.buffer.length < 64) break;
          if (match) {
            this.buffer = this.buffer.slice(match[0].length);
            const code = Number(match[1]), x = Number(match[2]) - 1, y = Number(match[3]) - 1;
            if (x >= 0 && y >= 0 && x < 65535 && y < 65535 && code < 256) {
              this.mouse({ type: code & 64 ? "wheel" : match[4] === "m" ? "up" : code & 32 ? "move" : "down",
                button: code & 3, x, y, shift: Boolean(code & 4), delta: code & 1 ? 3 : -3 });
            }
            continue;
          }
        }
      }
      this.send(1);
    }
  }
  // A solitary Escape must not be withheld indefinitely while waiting for a mouse prefix.
  flush(): void {
    if (!this.paste && this.buffer.startsWith("\x1b[<")) this.buffer = "";
    else this.send(this.buffer.length);
  }
  private send(count: number): void {
    if (!count) return;
    const value = this.buffer.slice(0, count); this.buffer = this.buffer.slice(count);
    this.text(Buffer.from(value, "latin1"));
  }
}

export class TerminalMouseInput extends PassThrough implements MouseController {
  private bus = new EventEmitter();
  private enabled = false;
  private timer?: NodeJS.Timeout;
  private parser = new MouseParser((bytes) => { this.write(bytes); }, (event) => { if (this.enabled) this.bus.emit("mouse", event); });
  constructor(private source: NodeJS.ReadStream, private output: (value: string) => void) {
    super();
    Object.defineProperty(this, "isTTY", { get: () => source.isTTY });
    Object.defineProperty(this, "isRaw", { get: () => source.isRaw });
  }
  setRawMode(value: boolean): this { this.source.setRawMode(value); return this; }
  private receive = (bytes: Buffer | string) => {
    if (this.timer) clearTimeout(this.timer);
    this.parser.feed(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    this.timer = setTimeout(() => this.parser.flush(), 35);
  };
  private ended = () => { this.parser.flush(); this.end(); };
  private failed = (error: Error) => { this.destroy(error); };
  start(): void { this.source.on("data", this.receive); this.source.on("end", this.ended); this.source.on("error", this.failed); }
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.output(enabled ? "\x1b[?1002h\x1b[?1006h" : "\x1b[?1002l\x1b[?1006l");
  }
  subscribe(handler: (event: MouseEvent) => void): () => void { this.bus.on("mouse", handler); return () => { this.bus.off("mouse", handler); }; }
  release(): void {
    this.setEnabled(false);
    if (this.timer) clearTimeout(this.timer);
    this.source.off("data", this.receive); this.source.off("end", this.ended); this.source.off("error", this.failed);
    this.source.pause();
    this.bus.removeAllListeners();
  }
}
