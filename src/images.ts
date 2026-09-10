import { execFile } from "node:child_process";
import { readFile, realpath, stat, mkdtemp, rm } from "node:fs/promises";
import { relative, isAbsolute, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { promisify } from "node:util";
import { resolveLinkTarget } from "./links.js";
import type { RenderLine, StyledSegment } from "./types.js";
import type { ImageGraphics } from "./graphics.js";

const run = promisify(execFile);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;
export const isImageFile = (path: string): boolean => /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(path);

/** Decodes 8-bit non-interlaced PNGs, including indexed colour and transparency. */
export function decodePng(bytes: Buffer): { width: number; height: number; rgba: Buffer } {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Not a PNG image");
  let width = 0, height = 0, channels = 0, colour = 0;
  let palette = Buffer.alloc(0), transparency = Buffer.alloc(0);
  const data: Buffer[] = [];
  for (let pos = 8; pos + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(pos);
    if (size > bytes.length - pos - 12) throw new Error("Truncated PNG");
    const type = bytes.toString("ascii", pos + 4, pos + 8);
    const chunk = bytes.subarray(pos + 8, pos + 8 + size);
    if (type === "IHDR") {
      if (size !== 13) throw new Error("Invalid PNG header");
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); colour = chunk[9]!;
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colour] ?? 0;
      if (!width || !height || width * height > MAX_PIXELS) throw new Error("Image exceeds 16 megapixels");
      if (chunk[8] !== 8 || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0 || !channels) throw new Error("PNG needs format conversion");
    } else if (type === "PLTE") palette = Buffer.from(chunk);
    else if (type === "tRNS") transparency = Buffer.from(chunk);
    else if (type === "IDAT") data.push(chunk);
    else if (type === "IEND") break;
    pos += size + 12;
  }
  if (!channels || !data.length) throw new Error("Incomplete PNG");
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error("Invalid PNG pixel data");
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw new Error("Invalid PNG filter");
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? pixels[i - channels]! : 0;
      const b = y ? pixels[i - stride]! : 0;
      const c = y && x >= channels ? pixels[i - stride - channels]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const prediction = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      pixels[i] = (raw[y * (stride + 1) + x + 1]! + prediction) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = i * channels, target = i * 4, value = pixels[source]!;
    if (colour === 3) {
      if (value * 3 + 2 >= palette.length) throw new Error("Invalid PNG palette");
      for (let c = 0; c < 3; c++) rgba[target + c] = palette[value * 3 + c]!;
      rgba[target + 3] = transparency[value] ?? 255;
    } else {
      const gray = colour === 0 || colour === 4;
      rgba[target] = value;
      rgba[target + 1] = gray ? value : pixels[source + 1]!;
      rgba[target + 2] = gray ? value : pixels[source + 2]!;
      rgba[target + 3] = colour === 4 ? pixels[source + 1]! : colour === 6 ? pixels[source + 3]! : 255;
      if (colour === 0 && transparency.length === 2 && value === transparency.readUInt16BE(0)) rgba[target + 3] = 0;
      if (colour === 2 && transparency.length === 6 && [0, 1, 2].every((c) => pixels[source + c] === transparency.readUInt16BE(c * 2))) rgba[target + 3] = 0;
    }
  }
  return { width, height, rgba };
}

async function convertedPng(path: string, maxSize = 256): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "lattice-image-"));
  const output = join(directory, "preview.png");
  try {
    if (process.platform === "darwin") {
      await run("/usr/bin/sips", ["-s", "format", "png", "--resampleHeightWidthMax", String(maxSize), path, "--out", output], { timeout: 15000 });
    } else if (process.platform === "win32") {
      // Paths are environment values, never interpolated as PowerShell code.
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
        "Add-Type -AssemblyName System.Drawing",
        "$image = [System.Drawing.Image]::FromFile($env:LATTICE_IMAGE_SOURCE)",
        "try { $image.Save($env:LATTICE_IMAGE_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $image.Dispose() }",
      ].join("\n")], { timeout: 15000, windowsHide: true, env: { ...process.env, LATTICE_IMAGE_SOURCE: path, LATTICE_IMAGE_OUTPUT: output } });
    } else {
      await run("magick", ["-limit", "memory", "128MiB", "-limit", "disk", "0", `${path}[0]`, "-thumbnail", `${maxSize}x${maxSize}>`, "-depth", "8", `PNG32:${output}`], { timeout: 15000 });
    }
    if ((await stat(output)).size > MAX_BYTES) throw new Error("Converted image too large");
    return await readFile(output);
  } catch {
    throw new Error("Image conversion unavailable; use an 8-bit PNG or open the original");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export class ImagePreviewCache {
  private cache = new Map<string, Promise<RenderLine[]>>();
  constructor(private graphics?: ImageGraphics) {}

  async load(target: string, source: string, root: string, columns: number, maxRows = 12): Promise<RenderLine[]> {
    const href = resolveLinkTarget(target, source);
    if (!href?.startsWith("file:")) throw new Error("Remote image: open the link to view");
    const url = new URL(href); url.hash = "";
    const [path, realRoot] = await Promise.all([realpath(fileURLToPath(url)), realpath(root)]);
    const rel = relative(realRoot, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Image is outside this vault");
    if (!isImageFile(path)) throw new Error("Unsupported image format");
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Image exceeds 20 MB");
    const width = Math.max(2, Math.min(60, Math.floor(columns)));
    const rows = Math.max(1, Math.min(12, Math.floor(maxRows)));
    const key = `${path}:${info.mtimeMs}:${info.size}:${width}:${rows}`;
    let result = this.cache.get(key);
    if (!result) {
      result = this.render(path, width, rows);
      this.cache.set(key, result);
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      void result.catch(() => this.cache.delete(key));
    }
    return result;
  }

  private async render(path: string, columns: number, maxRows: number): Promise<RenderLine[]> {
    let bytes: Buffer = await readFile(path);
    let decoded: ReturnType<typeof decodePng>;
    try { decoded = decodePng(bytes); }
    catch { bytes = await convertedPng(path, this.graphics ? 2048 : 256); decoded = decodePng(bytes); }
    const { width, height, rgba } = decoded;
    if (this.graphics) return this.graphics.render(bytes, width, height, columns, maxRows);
    const scale = Math.min(columns / width, Math.min(20, maxRows * 2) / height);
    const w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
    const pixel = (x: number, y: number): `#${string}` => {
      if (y >= h) return "#111318";
      const i = (Math.min(height - 1, Math.floor(y / h * height)) * width + Math.min(width - 1, Math.floor(x / w * width))) * 4;
      const alpha = rgba[i + 3]! / 255;
      return `#${[17, 19, 24].map((base, c) => Math.round(rgba[i + c]! * alpha + base * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
    };
    const lines: RenderLine[] = [];
    for (let y = 0; y < h; y += 2) {
      const segments: StyledSegment[] = [];
      for (let x = 0; x < w; x++) segments.push({ text: "▀", color: pixel(x, y), backgroundColor: pixel(x, y + 1) });
      lines.push({ kind: "image", indent: 0, segments });
    }
    return lines;
  }
}
