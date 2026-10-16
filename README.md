# Myenemy

Webová hra – souboj 1v1 v sadě miniher. Hraje se proti AI, ve dvou na jednom zařízení
a (od fáze 3) online. Žádné účty ani databáze, jen přezdívka uložená v prohlížeči.

## Stav vývoje

| Fáze | Obsah                                                                          | Stav   |
| ---- | ------------------------------------------------------------------------------ | ------ |
| 1    | Návrh architektury                                                             | hotovo |
| 2    | MVP: přezdívka, menu, všechny formáty, PvE + lokální PvP, Rychlý tasec, KNP    | hotovo |
| 3    | Online PvP s kódem místnosti (InMemoryTransport → Supabase Realtime Broadcast) | čeká   |
| 4    | Zbývající minihry (reakční a tahové → skrytá informace → karetní)              | čeká   |
| 5    | Doladění UI a přístupnosti, nasazení na GitHub Pages                           | čeká   |

## Minihry

| Hra               | Typ               | Délka  | Stav   |
| ----------------- | ----------------- | ------ | ------ |
| Rychlý tasec      | reakční           | rychlá | hotovo |
| Kámen-nůžky-papír | tahová (současná) | rychlá | hotovo |
| Klikací souboj    | reakční           | rychlá | fáze 4 |
| Postřeh           | reakční           | rychlá | fáze 4 |
| Piškvorky 3×3     | tahová            | rychlá | fáze 4 |
| Čtyři v řadě      | tahová            | delší  | fáze 4 |
| Sirky (Nim)       | tahová            | rychlá | fáze 4 |
| Tečky a čtverečky | tahová            | delší  | fáze 4 |
| Lodě              | skrytá informace  | delší  | fáze 4 |
| Logik souboj      | skrytá informace  | delší  | fáze 4 |
| Prší              | karetní           | delší  | fáze 4 |
| Oko bere          | karetní           | rychlá | fáze 4 |
| Pexeso duel       | karetní           | delší  | fáze 4 |

## Formáty zápasu

- **Rychlovka** – best of 5 z rychlých her (vyhrává, kdo první vyhraje 3).
- **Velký souboj** – best of 3 z delších her (vyhrává, kdo první vyhraje 2). Dokud žádná
  delší hra neexistuje, je formát zašedlý.
- **Vlastní výběr** – 1, 3, 5, 7 nebo 9 her; konkrétní hry v pořadí výběru, nebo náhodně ze
  všech. Chybějící hry se doplní náhodně bez opakování; opakovat se začne, až když nabídka
  dojde (nikdy ne dvakrát za sebou).

Zápas končí, jakmile má někdo potřebný počet výher. Remíza se nepočítá a hraje se rozhodující
kolo stejné hry – nejvýš třikrát, pak rozhodne los. Začínající hráč se střídá každé kolo.

## Lokální spuštění

Potřebuješ Node.js 22 nebo novější.

```bash
npm install
```

```bash
npm run dev
```

Hra poběží na <http://localhost:5173>.

| Příkaz                 | Co dělá                                          |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | vývojový server s automatickým obnovením         |
| `npm test`             | unit testy (Vitest)                              |
| `npm run lint`         | ESLint včetně typové kontroly pravidel           |
| `npm run format:check` | kontrola formátování (Prettier)                  |
| `npm run build`        | typová kontrola + produkční build do `dist/`     |
| `npm run preview`      | náhled produkčního buildu na `/Myenemy/` (s CSP) |

## Jak otestovat fázi 2

1. `npm test` – musí projít všechny testy (formáty, remízy a los, střídání začínajícího,
   GameRunner s AI a časovači, model reakční doby AI, pravidla Tasce a KNP, AI KNP).
2. `npm run dev` a v prohlížeči:
   - Přezdívka: zkus `A` (krátká), `<b>` (nepovolené znaky) a ` Žluťoučký  kůň` (projde a ořízne se).
   - **Proti AI → Rychlovka**: střídají se Tasec a KNP; zkontroluj skóre a „Hra X z max. 5“.
   - Tasec: zkus vystřelit před signálem (prohra kola) a pak normálně. Těžká AI reaguje
     zhruba za 250 ms, lehká za 450 ms.
   - KNP: vyber klávesou 1/2/3 nebo myší. Nech vypršet 15 s – zvolí se náhodně.
   - Při remíze musí přijít „Rozhodující kolo 1/3“ a skóre se nezmění.
   - **Vlastní výběr**: best of 3, vyber KNP a pak Tasec – v přehledu musí být v tomto pořadí
     a třetí hra jako „?“.
   - **Dva hráči**: Tasec na půlené obrazovce (klávesy A a L; na telefonu na výšku jsou
     poloviny pod sebou a horní je otočená). U KNP se mezi volbami ukáže „Předej zařízení“
     a druhý hráč nesmí vidět volbu prvního.
   - Nastavení: vypni zvuky a obnov stránku – volba musí zůstat.
3. Mobil: v DevTools přepni na telefon (např. 375 × 812) a projdi totéž dotykem.

## Architektura

```
src/
├─ core/                    čistá logika – žádný DOM ani síť
│  ├─ MiniGame.ts           rozhraní miniher (GameLogic, MiniGameModule, MiniGame)
│  ├─ GameRunner.ts         spojí logiku, vykreslení a hráče (člověk / AI / síť)
│  ├─ match/                planMatch (formáty, losování), MatchController (skóre, remízy)
│  ├─ ai/reaction.ts        lidsky působící reakční doby AI
│  └─ util/                 RNG se seedem, hodiny (i ruční pro testy)
├─ games/
│  ├─ registry.ts           JEDINÝ seznam miniher
│  └─ <hra>/                logic.ts · ai.ts · view.ts · index.ts · *.test.ts
├─ ui/                      router (App), průběh zápasu (MatchFlow), obrazovky, komponenty
└─ platform/                localStorage, nastavení, zvuky (WebAudio syntéza)
```

- **Herní logika je čistá funkce stavu** (`setup → toMove → legal → apply → outcome → view`).
  Stejná logika běží v PvE, lokálně i online; `view(state, hráč)` vrací jen to, co hráč smí
  vidět.
- **GameRunner** implementuje rozhraní `MiniGame` ze zadání (`init/start/onInput/onEnd/destroy`)
  a stará se o „přemýšlení“ AI (0,5–1,5 s), limit na tah (pak automatický tah) a v lokálním
  režimu o obrazovku „Předej zařízení“ před každou tajnou volbou.
- **MatchController** nezná konkrétní hry: řeší best of N, remízová kola, los a kontumace.
- Náhoda zápasu se odvozuje z jednoho seedu – v online režimu ho oba hráči vytvoří společně
  (commit-reveal), takže losování nemůže ovlivnit ani hostitel.

## Jak přidat novou minihru

1. Vytvoř složku `src/games/<id>/`.
2. `logic.ts` – implementuj `GameLogic` a Zod schéma tahu. V `outcome` definuj, co je remíza.
3. `ai.ts` – `getAIMove` pro obtížnosti `easy` / `medium` / `hard`. Lehká AI musí vždy vrátit
   platný tah (používá se i jako automatický tah při neaktivitě).
4. `view.ts` – vykreslení přes `h()` / `svg()` z `src/ui/dom.ts` (text nikdy přes `innerHTML`).
5. `index.ts` – `defineGame({...})` s názvem, typem, délkou, pravidly a ovládáním.
6. Přidej hru do pole `GAMES` v `src/games/registry.ts` – automaticky se objeví ve vlastním
   výběru i v losování.
7. Napiš `logic.test.ts`. Obecný kontrakt (pravidla, ovládání, platné tahy AI pro všechny
   obtížnosti) hlídá `registry.test.ts` sám.

## Bezpečnost

- Text od uživatele nebo soupeře jde vždy přes textové uzly; ESLint zakazuje `innerHTML`,
  `outerHTML`, `insertAdjacentHTML` i `document.write`.
- Produkční build obsahuje Content-Security-Policy (`<meta>`, protože GitHub Pages neumí
  vlastní hlavičky): skripty a styly jen z vlastní domény, síť jen na Supabase.
- Přezdívka: 2–16 znaků po oříznutí, písmena včetně diakritiky, číslice, mezera a `_ . -`;
  žádné řídicí ani neviditelné znaky.
- V repozitáři nejsou žádná tajemství. Konfigurace Supabase půjde přes `VITE_…` proměnné
  (viz `.env.example`).

Návod na nastavení Supabase a nasazení na GitHub Pages přibude ve fázích 3 a 5.
