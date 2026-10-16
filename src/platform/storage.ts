const PREFIX = 'myenemy:';

// localStorage může být nedostupné (soukromý režim, zakázaná úložiště) – hra pak jen nic nepamatuje.
export function readItem(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* viz výše */
  }
}

export function readJson(key: string): unknown {
  const raw = readItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeItem(key, JSON.stringify(value));
}
