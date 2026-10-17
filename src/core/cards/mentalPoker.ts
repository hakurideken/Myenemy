/**
 * Mental poker (SRA): komutativní šifrování x ↦ x^e mod p. Balíček zamíchají a zašifrují
 * oba hráči, takže pořadí karet nezná nikdo. Kartu pak odhalí jen klíč(e) k její pozici:
 * soukromě (soupeř pošle svůj klíč jen mně) nebo veřejně (pošlou oba).
 *
 * Grupa: 2048bitové bezpečné prvočíslo p = 2q + 1 z RFC 3526 (MODP group 14). Karty jsou
 * kvadratická rezidua (podgrupa řádu q), jinak by šifrování prozrazovalo Legendreův symbol.
 */

export const P = BigInt(
  '0x' +
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05' +
    '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB' +
    '9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718' +
    '3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF',
);
/** Řád podgrupy kvadratických reziduí. */
export const Q = (P - 1n) / 2n;

/** Nejvýš 512 hex znaků – víc 2048bitové číslo mít nemůže. */
const HEX = /^[0-9a-f]{1,512}$/;

/** Umocňování s pevným 4bitovým oknem (asi o třetinu rychlejší než binární). */
export function modPow(base: bigint, exp: bigint, mod: bigint = P): bigint {
  const b = ((base % mod) + mod) % mod;
  const table: bigint[] = [1n, b];
  for (let i = 2; i < 16; i++) table.push(((table[i - 1] ?? 1n) * b) % mod);
  let result = 1n;
  for (const ch of exp.toString(16)) {
    result = (result * result) % mod;
    result = (result * result) % mod;
    result = (result * result) % mod;
    result = (result * result) % mod;
    const digit = parseInt(ch, 16);
    if (digit) result = (result * (table[digit] ?? 1n)) % mod;
  }
  return result;
}

export function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [((a % m) + m) % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  if (oldR !== 1n) throw new RangeError('modInverse: číslo není invertibilní');
  return ((oldS % m) + m) % m;
}

/** Jacobiho symbol (a/n) pro liché n – u prvočísla je to Legendreův symbol. */
export function jacobi(value: bigint, modulus: bigint): number {
  let a = ((value % modulus) + modulus) % modulus;
  let n = modulus;
  let sign = 1;
  while (a !== 0n) {
    while ((a & 1n) === 0n) {
      a >>= 1n;
      const r = n & 7n;
      if (r === 3n || r === 5n) sign = -sign;
    }
    [a, n] = [n, a];
    if ((a & 3n) === 3n && (n & 3n) === 3n) sign = -sign;
    a %= n;
  }
  return n === 1n ? sign : 0;
}

/** Kryptograficky náhodné číslo z intervalu [0, max). */
export function randomBelow(max: bigint): bigint {
  const bytes = Math.ceil(max.toString(16).length / 2);
  const buffer = new Uint8Array(bytes);
  for (;;) {
    crypto.getRandomValues(buffer);
    let value = 0n;
    for (const byte of buffer) value = (value << 8n) | BigInt(byte);
    // Odmítnutí místo modula – rovnoměrné rozdělení.
    const excess = BigInt(bytes * 8) - BigInt(max.toString(2).length);
    value >>= excess;
    if (value < max) return value;
  }
}

/** Fisher–Yates s kryptograficky náhodnými indexy. */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Number(randomBelow(BigInt(i + 1)));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** Karta → kvadratické reziduum (malé čtverce jsou různé a leží v podgrupě). */
export const encodeCard = (id: number): bigint => BigInt((id + 2) * (id + 2));

/** Zpětný převod z rezidua na kartu. */
export class CardCodec {
  private readonly byValue = new Map<bigint, number>();

  constructor(readonly deckSize: number) {
    for (let id = 0; id < deckSize; id++) this.byValue.set(encodeCard(id), id);
  }

  decode(value: bigint): number | null {
    return this.byValue.get(value) ?? null;
  }

  encodedDeck(): bigint[] {
    return Array.from({ length: this.deckSize }, (_, id) => encodeCard(id));
  }
}

export const toHex = (value: bigint): string => value.toString(16);

export function fromHex(text: string, max: bigint = P): bigint | null {
  if (!HEX.test(text)) return null;
  const value = BigInt(`0x${text}`);
  return value > 1n && value < max ? value : null;
}

/** Platný prvek balíčku: 1 < x < p − 1 a kvadratické reziduum. */
export const isDeckElement = (x: bigint): boolean => x > 1n && x < P - 1n && jacobi(x, P) === 1;

export interface KeyPair {
  /** Šifrovací exponent (stačí 256 bitů – útok by vyžadoval ~2^128 operací). */
  readonly e: bigint;
  /** Dešifrovací exponent e⁻¹ mod q. */
  readonly d: bigint;
}

export function createKeyPair(): KeyPair {
  for (;;) {
    const e = randomBelow(1n << 256n);
    if (e > 1n) return { e, d: modInverse(e, Q) };
  }
}

export interface PokerKeys {
  /** Společná vrstva pro míchání. */
  readonly global: KeyPair;
  /** Klíč ke každé pozici zamíchaného balíčku. */
  readonly perCard: readonly KeyPair[];
}

export function createPokerKeys(deckSize: number): PokerKeys {
  return {
    global: createKeyPair(),
    perCard: Array.from({ length: deckSize }, () => createKeyPair()),
  };
}

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Výpočetně náročné kroky po dávkách, ať se mezi nimi stihne překreslit UI. */
async function mapInBatches<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => R,
  batch = 4,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    out.push(fn(item, i));
    if ((i + 1) % batch === 0) await yieldNow();
  }
  return out;
}

/** Krok 1 a 2: zašifrovat společným klíčem a zamíchat. */
export async function encryptAndShuffle(deck: readonly bigint[], key: KeyPair): Promise<bigint[]> {
  return secureShuffle(await mapInBatches(deck, (x) => modPow(x, key.e), 16));
}

/** Krok 3 a 4: sundat společnou vrstvu a zamknout každou pozici vlastním klíčem. */
export function lockPerCard(deck: readonly bigint[], keys: PokerKeys): Promise<bigint[]> {
  return mapInBatches(deck, (x, j) => {
    const perCard = keys.perCard[j];
    if (!perCard) throw new RangeError('lockPerCard: chybí klíč pozice');
    return modPow(x, (keys.global.d * perCard.e) % Q);
  });
}

/** Odemknutí pozice oběma klíči (dešifrovací exponenty obou hráčů). */
export const unlockCard = (x: bigint, mine: bigint, theirs: bigint): bigint =>
  modPow(x, (mine * theirs) % Q);

/** Validace balíčku od soupeře: správná délka, prvky grupy, žádné duplicity. */
export function validDeck(deck: readonly bigint[], size: number): boolean {
  if (deck.length !== size) return false;
  const seen = new Set<bigint>();
  for (const x of deck) {
    if (!isDeckElement(x) || seen.has(x)) return false;
    seen.add(x);
  }
  return true;
}
