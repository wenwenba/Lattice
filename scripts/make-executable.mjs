import { chmod } from "node:fs/promises";

if (process.platform !== "win32") {
  await chmod(new URL("../dist/main.mjs", import.meta.url), 0o755);
}
