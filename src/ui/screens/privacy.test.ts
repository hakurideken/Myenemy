import { describe, expect, it } from 'vitest';
import page from '../../../public/privacy.html?raw';
import { privacySections } from './account';

describe('zásady soukromí', () => {
  it('statická stránka public/privacy.html má stejné texty jako obrazovka ve hře', () => {
    const html = page.replace(/\s+/g, ' ');
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    for (const { title, text } of privacySections()) {
      expect(html, title).toContain(esc(title));
      expect(html, title).toContain(esc(text));
    }
  });
});
