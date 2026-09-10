import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { MouseParser, TerminalMouseInput, type MouseEvent } from "../src/mouse.js";

describe("terminal mouse input", () => {
  it("decodes split SGR events and leaves UTF-8, arrows and paste bytes unchanged", () => {
    const text: Buffer[] = [], events: MouseEvent[] = [];
    const parser = new MouseParser((bytes) => text.push(bytes), (event) => events.push(event));
    const paste = "\x1b[200~中😀\x1b[<0;2;3M\x1b[201~";
    const bytes = Buffer.from("中文\x1b[1;2C\x1b[<0;45;5M\x1b[<36;47;6M\x1b[<0;47;6m\x1b[<65;47;6M" + paste);
    for (const byte of bytes) parser.feed(Buffer.from([byte]));
    parser.flush();
    expect(Buffer.concat(text).toString()).toBe("中文\x1b[1;2C" + paste);
    expect(events.map(({ type, button, x, y, shift }) => ({ type, button, x, y, shift }))).toEqual([
      { type: "down", button: 0, x: 44, y: 4, shift: false },
      { type: "move", button: 0, x: 46, y: 5, shift: true },
      { type: "up", button: 0, x: 46, y: 5, shift: false },
      { type: "wheel", button: 1, x: 46, y: 5, shift: false },
    ]);
    expect(events[3]?.delta).toBe(3);
  });

  it("recognizes whole paste delimiters and flushes Escape without inserting incomplete mouse data", () => {
    const text: Buffer[] = [], mouse = vi.fn();
    const parser = new MouseParser((bytes) => text.push(bytes), mouse);
    for (const value of ["\x1b[200~", "\x1b[<0;2;3M", "\x1b[201~", "\x1b"]) parser.feed(Buffer.from(value));
    parser.flush();
    parser.feed(Buffer.from("\x1b[<0;")); parser.flush();
    expect(Buffer.concat(text).toString()).toBe("\x1b[200~\x1b[<0;2;3M\x1b[201~\x1b");
    expect(mouse).not.toHaveBeenCalled();
  });

  it("proxies raw mode, isolates mouse from keyboard, disables tracking and releases listeners", () => {
    const source = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn() });
    const modes = vi.fn(), events = vi.fn(), text: Buffer[] = [];
    const input = new TerminalMouseInput(source as unknown as NodeJS.ReadStream, modes);
    input.on("data", (bytes: Buffer) => text.push(bytes));
    const unsubscribe = input.subscribe(events);
    input.start(); input.setRawMode(true); input.setEnabled(true); input.setEnabled(true);
    source.write(Buffer.from("a\x1b[<0;45;5Mb"));
    expect(source.setRawMode).toHaveBeenCalledWith(true);
    expect(events).toHaveBeenCalledTimes(1);
    expect(Buffer.concat(text).toString()).toBe("ab");
    input.setEnabled(false); source.write("\x1b[<0;45;5M");
    expect(events).toHaveBeenCalledTimes(1);
    input.setEnabled(true); unsubscribe(); source.write("\x1b[<0;45;5M");
    expect(events).toHaveBeenCalledTimes(1);
    input.release();
    expect(modes.mock.calls.map(([value]) => value)).toEqual([
      "\x1b[?1002h\x1b[?1006h", "\x1b[?1002l\x1b[?1006l",
      "\x1b[?1002h\x1b[?1006h", "\x1b[?1002l\x1b[?1006l",
    ]);
    expect(source.listenerCount("data")).toBe(0);
    expect(source.listenerCount("end")).toBe(0);
    expect(source.listenerCount("error")).toBe(0);
    expect(source.isPaused()).toBe(true);
    input.destroy(); source.destroy();
  });
});
