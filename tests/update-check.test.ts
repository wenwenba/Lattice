import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, isNewerVersion } from "../src/update-check.js";

describe("update check", () => {
  it("detects only newer semantic versions", () => {
    expect(isNewerVersion("0.1.2", "0.1.3")).toBe(true);
    expect(isNewerVersion("0.1.2", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.1.2", "0.1.2")).toBe(false);
    expect(isNewerVersion("0.1.2", "0.1.1")).toBe(false);
    expect(isNewerVersion("invalid", "1.0.0")).toBe(false);
  });

  it("silently returns the available version or ignores network failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: "0.1.3" })));
    expect(await checkForUpdate("0.1.2", fetcher)).toBe("0.1.3");
    expect(await checkForUpdate("0.1.2", vi.fn().mockRejectedValue(new Error("offline")))).toBeUndefined();
  });
});
