/**
 * Jeden AudioContext pro efekty i hudbu. Prohlížeč ho pustí až po prvním kliknutí nebo
 * stisku klávesy – do té doby se nevytváří (jinak by v konzoli hlásil zablokování).
 */
let shared: AudioContext | null = null;

export function audioContext(): AudioContext {
  shared ??= new AudioContext();
  if (shared.state === 'suspended' && !document.hidden) void shared.resume();
  return shared;
}

/** Už hráč se stránkou něco udělal (klik, klávesa)? Teprve pak smí hrát zvuk. */
export function userHasInteracted(): boolean {
  return typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true;
}

/** Skrytá záložka: zvuk se pozastaví (šetří baterii), po návratu pokračuje. */
export function pauseAudioWhenHidden(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (!shared) return;
    if (document.hidden) void shared.suspend();
    else void shared.resume();
  });
}
