import { validateNickname } from '../core/nickname';
import { readItem, writeItem } from './storage';

const NICKNAME_KEY = 'nickname';

function loadValidName(key: string): string | null {
  const raw = readItem(key);
  if (raw === null) return null;
  const result = validateNickname(raw);
  return result.ok ? result.value : null;
}

export const loadNickname = (): string | null => loadValidName(NICKNAME_KEY);
export const saveNickname = (name: string): void => writeItem(NICKNAME_KEY, name);
