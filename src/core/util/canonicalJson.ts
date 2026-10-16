/**
 * Deterministický JSON: klíče seřazené, bez undefined, jen konečná čísla.
 * Oba klienti z něj hashují/podepisují stejné bajty bez ohledu na pořadí klíčů v objektu.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: nekonečné číslo nebo NaN');
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: nepodporovaný typ ${typeof value}`);
}
