import { dirname, isAbsolute, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function markdownVaultFileLink(targetRelativePath: string, sourceNoteRelativePath: string, image = false): string {
  const label = escapeMarkdownLabel(posix.basename(targetRelativePath));
  const relativePath = posix.relative(posix.dirname(sourceNoteRelativePath), targetRelativePath) || posix.basename(targetRelativePath);
  const encodedPath = relativePath.split("/").map((part) => encodeURIComponent(part).replace(/[()]/g, (value) => `%${value.charCodeAt(0).toString(16)}`)).join("/");
  return `${image ? "!" : ""}[${label}](${encodedPath})`;
}

export function terminalHyperlink(text: string, target: string, sourceFile?: string): string {
  const href = resolveLinkTarget(target, sourceFile);
  if (!href) return text;
  return `\u001b]8;;${href}\u0007${text}\u001b]8;;\u0007`;
}

export function resolveLinkTarget(target: string, sourceFile?: string): string | undefined {
  const clean = target.trim().replace(/^<|>$/g, "").replace(/[\x00-\x1f\x7f]/g, "");
  if (!clean || clean.startsWith("#")) return undefined;

  if (/^[a-z][a-z\d+.-]*:/i.test(clean)) {
    try {
      const url = new URL(clean);
      return ["http:", "https:", "mailto:", "file:"].includes(url.protocol) ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  if (!sourceFile) return undefined;
  const [filePart, fragment] = clean.split("#", 2);
  let decoded = filePart ?? "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep malformed percent sequences as literal filename characters.
  }
  const absolute = isAbsolute(decoded) ? decoded : resolve(dirname(sourceFile), decoded);
  const url = pathToFileURL(absolute);
  if (fragment) url.hash = fragment;
  return url.href;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, "\\$1");
}
