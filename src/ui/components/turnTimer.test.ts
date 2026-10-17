import { describe, expect, it } from 'vitest';
import { secondsLeftText } from './turnTimer';

describe('časovač tahu', () => {
  it('upozornění ve správném tvaru češtiny', () => {
    expect(secondsLeftText(5)).toBe('Zbývá 5 sekund na tah.');
    expect(secondsLeftText(3)).toBe('Zbývají 3 sekundy na tah.');
    expect(secondsLeftText(1)).toBe('Zbývá 1 sekunda na tah.');
  });
});
