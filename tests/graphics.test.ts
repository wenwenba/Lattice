import { describe, expect, it } from "vitest";
import { KittyGraphics, KittyPlacementGraphics, IMAGE_PLACEHOLDER, kittyEnabled, usesKittyPlacements, graphicsOutput } from "../src/graphics.js";
import { Writable } from "node:stream";
import { testPng } from "./image-fixture.js";

describe("Kitty graphics", () => {
  it("selects regular placements for Warp without enabling Unicode placeholders", () => {
    expect(usesKittyPlacements({ TERM_PROGRAM: "WarpTerminal" })).toBe(true);
    expect(kittyEnabled({ TERM_PROGRAM: "WarpTerminal" }, true, true)).toBe(false);
    expect(usesKittyPlacements({ TERM_PROGRAM: "WarpTerminal", LATTICE_GRAPHICS: "off" })).toBe(false);
    expect(usesKittyPlacements({ TERM_PROGRAM: "WarpTerminal", LATTICE_GRAPHICS: "kitty-native" })).toBe(true);
    expect(usesKittyPlacements({ TERM_PROGRAM: "WarpTerminal", LATTICE_GRAPHICS: "kitty" })).toBe(true);
  });

  it("crops placements on scroll, clears hidden images, and transmits only once on resize", () => {
    const writes: string[] = [];
    const graphics = new KittyPlacementGraphics((data) => { writes.push(data); });
    const rows = graphics.render(testPng(), 8, 4, 8);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.segments[0]!.text.trim() === "")).toBe(true);
    graphics.setViewport(rows, 10, 5, 8, 2); graphics.repaint();
    expect(writes.at(-1)).toContain("\x1b[6;11H");
    expect(writes.at(-1)).toContain("c=8,r=2,x=0,y=0,w=8,h=4");
    graphics.setViewport(rows.slice(1), 10, 5, 4, 1); graphics.repaint();
    expect(writes.at(-1)).toContain("a=d,d=i");
    expect(writes.at(-1)).toContain("c=4,r=1,x=0,y=2,w=4,h=2");
    graphics.render(testPng(), 8, 4, 20);
    expect(writes.filter((line) => line.includes("a=t"))).toHaveLength(1);
    graphics.setViewport([], 0, 0, 0, 0); graphics.repaint();
    expect(writes.at(-1)).toContain("a=d,d=i");
    expect(writes.at(-1)).not.toContain("a=p");
    expect(writes.join("")).not.toContain("U=1");
    expect(writes.join("")).not.toContain(IMAGE_PLACEHOLDER);
    graphics.dispose();
    expect(writes.at(-1)).toContain("a=d,d=I");
  });

  it("appends raster placement after Runtime writes and restores the cursor", async () => {
    const writes: string[] = [];
    const output = Object.assign(new Writable({ write(data, _, done) { writes.push(data.toString()); done(); } }), { columns: 120, rows: 30, isTTY: true });
    const graphics = new KittyPlacementGraphics((data) => { output.write(data); });
    const adapter = graphicsOutput(output as unknown as NodeJS.WriteStream, graphics);
    const rows = graphics.render(testPng(), 8, 4, 8);
    graphics.setViewport(rows, 10, 5, 8, 2);
    await new Promise<void>((resolve, reject) => adapter.write("VUE FRAME", (error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes.at(-2)).toBe("VUE FRAME");
    expect(writes.at(-1)).toMatch(/^\x1b7.*\x1b8$/s);
    adapter.release(); graphics.dispose();
    expect(output.listenerCount("resize")).toBe(0);
  });
  it("gates graphics by terminal capability and explicit overrides", () => {
    expect(kittyEnabled({ TERM: "xterm-kitty" }, true, true)).toBe(true);
    expect(kittyEnabled({ TERM_PROGRAM: "ghostty" }, true, true)).toBe(true);
    expect(kittyEnabled({ LATTICE_GRAPHICS: "kitty" }, true, true)).toBe(true);
    expect(kittyEnabled({ TERM: "xterm-kitty", LATTICE_GRAPHICS: "off" }, true, true)).toBe(false);
    for (const env of [{ TMUX: "yes" }, { CI: "1" }, { NO_COLOR: "" }]) {
      expect(kittyEnabled({ TERM: "xterm-kitty", ...env }, true, true)).toBe(false);
    }
    expect(kittyEnabled({ TERM: "xterm-kitty" }, false, true)).toBe(false);
    expect(kittyEnabled({ TERM: "xterm-kitty" }, true, false)).toBe(false);
    expect(kittyEnabled({ TERM_PROGRAM: "Apple_Terminal" }, true, true)).toBe(false);
  });

  it("transmits real PNG bytes, makes virtual placements and reuses stable IDs", () => {
    const writes: string[] = [];
    const graphics = new KittyGraphics((data) => { writes.push(data); });
    const rows = graphics.render(testPng(), 8, 4, 8);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.segments[0]!.text.split(IMAGE_PLACEHOLDER)).toHaveLength(9);
    expect(writes[0]).toContain(`;${testPng().toString("base64")}\x1b\\`);
    expect(writes[1]).toMatch(/a=p,U=1,i=\d+,p=1,c=8,r=2,q=2/);
    expect(graphics.render(testPng(), 8, 4, 8)).toEqual(rows);
    expect(writes).toHaveLength(2);
    graphics.render(testPng(), 8, 4, 20);
    expect(writes).toHaveLength(4);
    expect(graphics.render(testPng(), 8, 4, 8)).toEqual(rows);
    expect(writes).toHaveLength(4);
    graphics.dispose();
    expect(writes.slice(4).every((line) => /a=d,d=I,i=\d+,q=2/.test(line))).toBe(true);
    graphics.dispose(); expect(writes).toHaveLength(6);
    expect(() => graphics.render(testPng(), 8, 4, 8)).toThrow("closed");
  });

  it("splits payloads into protocol-sized chunks without moving the cursor", () => {
    const writes: string[] = [];
    new KittyGraphics((data) => { writes.push(data); }).render(Buffer.alloc(9000, 1), 30, 30, 30);
    const transfers = writes.filter((line) => line.includes(";"));
    expect(transfers).toHaveLength(3);
    const payload = transfers.map((line) => line.split(";")[1]!.slice(0, -2));
    expect(payload.every((part) => part.length <= 4096 && part.length % 4 === 0)).toBe(true);
    expect(Buffer.from(payload.join(""), "base64")).toEqual(Buffer.alloc(9000, 1));
    expect(writes.join("")).not.toContain("a=T");
  });
});
