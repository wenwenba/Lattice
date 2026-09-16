const REGISTRY_URL = "https://registry.npmjs.org/lattice-tui/latest";

export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)?.slice(1, 4).map(Number);
  const currentParts = parse(current), latestParts = parse(latest);
  if (!currentParts || !latestParts) return false;
  for (let index = 0; index < 3; index++) {
    if (latestParts[index] !== currentParts[index]) return latestParts[index]! > currentParts[index]!;
  }
  return false;
}

export async function checkForUpdate(current: string, fetcher = fetch): Promise<string | undefined> {
  try {
    const response = await fetcher(REGISTRY_URL, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return undefined;
    const data = await response.json() as { version?: unknown };
    return typeof data.version === "string" && isNewerVersion(current, data.version) ? data.version : undefined;
  } catch {
    return undefined;
  }
}
