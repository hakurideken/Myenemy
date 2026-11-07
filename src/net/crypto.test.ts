import { describe, expect, it } from 'vitest';
import {
  createKeyPair,
  deriveReportKey,
  deriveSessionKey,
  fromBase64Url,
  matchReportKey,
  signText,
  toBase64Url,
  verifyText,
} from './crypto';

describe('autentizace zpráv (ECDH + HMAC)', () => {
  it('base64url tam a zpět', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });

  it('oba hráči odvodí stejný klíč, cizí klíč podpis neověří', async () => {
    const host = await createKeyPair();
    const guest = await createKeyPair();
    const eve = await createKeyPair();
    expect(host.publicKey).toHaveLength(87);

    const hostKey = await deriveSessionKey(host, guest.publicKey, 'ABCDE');
    const guestKey = await deriveSessionKey(guest, host.publicKey, 'ABCDE');
    const eveKey = await deriveSessionKey(eve, host.publicKey, 'ABCDE');

    const mac = await signText(hostKey, 'tah: kámen');
    expect(await verifyText(guestKey, 'tah: kámen', mac)).toBe(true);
    expect(await verifyText(guestKey, 'tah: papír', mac)).toBe(false);
    expect(await verifyText(eveKey, 'tah: kámen', mac)).toBe(false);
  });

  it('klíč je vázaný na místnost', async () => {
    const host = await createKeyPair();
    const guest = await createKeyPair();
    const a = await deriveSessionKey(host, guest.publicKey, 'ABCDE');
    const b = await deriveSessionKey(guest, host.publicKey, 'XYZ23');
    expect(await verifyText(b, 'x', await signText(a, 'x'))).toBe(false);
  });

  it('neplatný veřejný klíč nebo podpis neshodí aplikaci', async () => {
    const own = await createKeyPair();
    await expect(deriveSessionKey(own, 'nesmysl', 'ABCDE')).rejects.toThrow();
    const key = await deriveSessionKey(own, (await createKeyPair()).publicKey, 'ABCDE');
    expect(await verifyText(key, 'x', '!!!')).toBe(false);
  });

  it('klíč zápasu pro kamarády: oba hráči stejný, pozorovatel ze seedu ho nespočítá', async () => {
    const host = await createKeyPair();
    const guest = await createKeyPair();
    const eve = await createKeyPair();
    const seed = 'a'.repeat(32);
    const hostKey = await matchReportKey(
      await deriveReportKey(host, guest.publicKey, 'ABCDE'),
      seed,
    );
    const guestKey = await matchReportKey(
      await deriveReportKey(guest, host.publicKey, 'ABCDE'),
      seed,
    );
    const eveKey = await matchReportKey(await deriveReportKey(eve, host.publicKey, 'ABCDE'), seed);
    expect(hostKey).toMatch(/^[0-9a-f]{64}$/);
    expect(guestKey).toBe(hostKey);
    expect(eveKey).not.toBe(hostKey);
    // Jiný zápas (seed) = jiný klíč.
    const next = await matchReportKey(
      await deriveReportKey(host, guest.publicKey, 'ABCDE'),
      'b'.repeat(32),
    );
    expect(next).not.toBe(hostKey);
  });
});
