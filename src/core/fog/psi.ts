import { hashToResidue, jacobi, modPow, randomBelow } from '../cards/mentalPoker';

/**
 * Šifrovaný průnik množin pro mlhu (Diffie–Hellman PSI). Pozorovatel pošle štítky, kam
 * dohlédne, zašifrované svým klíčem: H(l)^o. Cíl je zašifruje i svým klíčem (H(l)^ot)
 * a přidá, čím se prozrazuje: H(e)^t. Pozorovatel dopočítá H(e)^to a porovná – pozná
 * jen shodné štítky (co vidí). Cíl se nedozví nic, pozorovatel nic navíc.
 *
 * Grupa: 1024bitové bezpečné prvočíslo p = 2q + 1 (RFC 2409, skupina 2), klíče mají
 * 160 bitů. Na pár minut hry stačí a je rychlá i na mobilu (~0,2 ms na operaci).
 */
export const FOG_P = BigInt(
  '0x' +
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381FFFFFFFFFFFFFFFF',
);

/** Nejvýš 256 hex znaků – víc 1024bitové číslo mít nemůže. */
const HEX = /^[0-9a-f]{1,256}$/;

/** Náhodný klíč (exponent) – pro každé pozorování nový, ať nejdou spojit. */
export function randomKey(): bigint {
  for (;;) {
    const key = randomBelow(1n << 160n);
    if (key > 1n) return key;
  }
}

export const blind = (value: bigint, key: bigint): bigint => modPow(value, key, FOG_P);

/** Prvek grupy: 1 < x < p − 1 a kvadratické reziduum. */
export const isFogElement = (x: bigint): boolean =>
  x > 1n && x < FOG_P - 1n && jacobi(x, FOG_P) === 1;

export const fogHex = (value: bigint): string => value.toString(16);

export function parseFogHex(text: string): bigint | null {
  if (!HEX.test(text)) return null;
  const value = BigInt(`0x${text}`);
  return isFogElement(value) ? value : null;
}

const hashes = new Map<string, Promise<bigint>>();

/** Štítek → prvek grupy (pseudonáhodné kvadratické reziduum). */
export function hashToGroup(label: string): Promise<bigint> {
  let cached = hashes.get(label);
  if (!cached) {
    cached = hashToResidue(`myenemy-fog:${label}`, FOG_P);
    if (hashes.size > 5000) hashes.clear();
    hashes.set(label, cached);
  }
  return cached;
}

/**
 * Štítky doplněné na pevný počet (počet by jinak prozrazoval, kolik toho hráč vidí).
 * Seřazené a s předvídatelnými výplněmi, takže je soupeř po odhalení klíče přepočítá.
 * null = skutečných štítků je víc, než smí být.
 */
export function padLabels(real: readonly string[], size: number, tag: string): string[] | null {
  const unique = [...new Set(real)].sort();
  if (unique.length > size || unique.some((label) => label.startsWith('X:'))) return null;
  const out = [...unique];
  for (let i = 0; out.length < size; i++) out.push(`X:${tag}:${i}`);
  return out;
}

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Zašifrování po dávkách, ať mezi nimi stihne odpovídat UI. */
export async function blindAll(values: readonly bigint[], key: bigint): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let i = 0; i < values.length; i++) {
    out.push(blind(values[i] ?? 1n, key));
    if ((i + 1) % 16 === 0) await yieldNow();
  }
  return out;
}

/** Štítky zašifrované klíčem (H(l)^key). */
export async function blindLabels(labels: readonly string[], key: bigint): Promise<bigint[]> {
  return blindAll(await Promise.all(labels.map(hashToGroup)), key);
}
