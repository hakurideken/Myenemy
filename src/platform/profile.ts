import { validateNickname } from '../core/nickname';
import { readItem, writeItem } from './storage';

const NICKNAME_KEY = 'nickname';
const LOCAL_OPPONENT_KEY = 'local-opponent';

function loadValidName(key: string): string | null {
  const raw = readItem(key);
  if (raw === null) return null;
  const result = validateNickname(raw);
  return result.ok ? result.value : null;
}

export const loadNickname = (): string | null => loadValidName(NICKNAME_KEY);
export const saveNickname = (name: string): void => writeItem(NICKNAME_KEY, name);

export const loadLocalOpponent = (): string | null => loadValidName(LOCAL_OPPONENT_KEY);
export const saveLocalOpponent = (name: string): void => writeItem(LOCAL_OPPONENT_KEY, name);
