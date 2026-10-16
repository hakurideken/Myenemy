# Myenemy

Webová hra – souboj 1v1 v sadě miniher. Hraje se proti AI, ve dvou na jednom zařízení
nebo online s kódem místnosti. Žádné účty ani databáze, jen přezdívka uložená v prohlížeči.

## Stav vývoje

| Fáze | Obsah                                                                          | Stav   |
| ---- | ------------------------------------------------------------------------------ | ------ |
| 1    | Návrh architektury                                                             | hotovo |
| 2    | MVP: přezdívka, menu, všechny formáty, PvE + lokální PvP, Rychlý tasec, KNP    | hotovo |
| 3    | Online PvP s kódem místnosti (InMemoryTransport → Supabase Realtime Broadcast) | hotovo |
| 4    | Zbývající minihry: reakční, tahové a skrytá informace (hotovo) → karetní       | běží   |
| 5    | Doladění UI a přístupnosti, nasazení na GitHub Pages                           | čeká   |

## Minihry

| Hra               | Typ               | Délka  | Stav   |
| ----------------- | ----------------- | ------ | ------ |
| Rychlý tasec      | reakční           | rychlá | hotovo |
| Kámen-nůžky-papír | tahová (současná) | rychlá | hotovo |
| Klikací souboj    | reakční           | rychlá | hotovo |
| Postřeh           | reakční           | rychlá | hotovo |
| Piškvorky 3×3     | tahová            | rychlá | hotovo |
| Čtyři v řadě      | tahová            | delší  | hotovo |
| Sirky (Nim)       | tahová            | rychlá | hotovo |
| Tečky a čtverečky | tahová            | delší  | hotovo |
| Lodě              | skrytá informace  | delší  | hotovo |
| Logik souboj      | skrytá informace  | delší  | hotovo |
| Prší              | karetní           | delší  | fáze 4 |
| Oko bere          | karetní           | rychlá | fáze 4 |
| Pexeso duel       | karetní           | delší  | fáze 4 |

## Formáty zápasu

- **Rychlovka** – best of 5 z rychlých her (vyhrává, kdo první vyhraje 3).
- **Velký souboj** – best of 3 z delších her (vyhrává, kdo první vyhraje 2).
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

Hra poběží na <http://localhost:5173>. PvE i hra ve dvou fungují bez jakékoli konfigurace.

| Příkaz                 | Co dělá                                          |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | vývojový server s automatickým obnovením         |
| `npm test`             | unit testy (Vitest)                              |
| `npm run lint`         | ESLint včetně typové kontroly pravidel           |
| `npm run format:check` | kontrola formátování (Prettier)                  |
| `npm run build`        | typová kontrola + produkční build do `dist/`     |
| `npm run preview`      | náhled produkčního buildu na `/Myenemy/` (s CSP) |

## Online hra

1. Hostitel zvolí **Online 1v1 → Vytvořit místnost**, vybere formát a dostane 5znakový kód
   (bez zaměnitelných 0/O a 1/I) a odkaz `…?room=KOD`.
2. Soupeř zadá kód, nebo otevře odkaz (po zadání přezdívky se připojí rovnou). Třetí hráč
   dostane „Místnost je plná“.
3. Oba vidí lobby s formátem a seznamem her (losované jako „?“); hostitel spustí souboj.
4. Každé kolo začne, až oba kliknou na „Připraven“. Po zápase lze dát odvetu ve stejné místnosti.

**Jak to funguje uvnitř:**

- Herní kód mluví jen s rozhraním `Transport` – implementace `SupabaseTransport`
  (Realtime Broadcast, kanál `myenemy:KOD`, žádné tabulky) a `InMemoryTransport` (vývoj, testy).
- Nad transportem je `Peer`: každá zpráva má verzi protokolu, typ a obsah, validuje se Zodem
  (nevalidní se zahodí a zaloguje), doručení je spolehlivé a seřazené (pořadová čísla, potvrzení,
  opakované odeslání) a každá zpráva je podepsaná HMAC klíčem z ECDH výměny při spárování –
  kdo jen zná kód místnosti, nemůže za hráče podvrhnout tah.
- Hostitel řídí zápas (pořadí her, skóre, časovače), host posílá jen vstupy.
- **Společný seed:** na začátku zápasu oba pošlou SHA-256 závazek svého seedu a teprve pak ho
  odhalí; z obou vznikne seed zápasu, ze kterého se losuje pořadí her i veškerá náhoda.
  Host si pořadí her přepočítá sám a nesoulad pozná.
- **Zapečetěné tahy (KNP):** hostitel je zároveň hráč, takže volby jdou nejdřív jako závazek
  (commit) a odhalují se, až mají závazek oba. Host navíc kolo přehraje z odhalených tahů
  a ověří výsledek, který mu poslal hostitel. Nesoulad = prohra kontumací + hláška.
- **Skrytá informace (Lodě, Logik):** rozmístění lodí / tajný kód zná jen jeho majitel – ani
  hostitel ho nevidí. Před začátkem hry pošle každý jen závazek (SHA-256 se solí), na dotazy
  soupeře (výstřel, tip) odpovídá jeho vlastní klient. Po konci hry se data odhalí a obě strany
  ověří, že odpovídají závazku a že soupeř po celou hru odpovídal podle nich. Host navíc
  kontroluje, že mu hostitel nepozměnil odpovědi a že výsledek plyne z odehraného stavu.
  Hostitel bez závazku nebo lež v odpovědi = prohra kontumací.
- **Reakční hry:** každý měří reakci lokálně (`performance.now()` od zobrazení signálu)
  a posílá změřený čas, ne okamžik doručení. Reakce pod 100 ms se počítá jako předčasná.
- **Odpojení:** po 5 s ticha se ukáže odpočet, po dalších 15 s vyhrává zbylý hráč
  kontumací. Kdo zápas opustí, prohraje hned.
- **Neaktivita:** po lhůtě na tah se zahraje automaticky; třikrát po sobě = prohra kontumací.
- **Jiná verze:** dva hráči s jiným buildem se nespojí – oba uvidí „Soupeř má jinou verzi hry –
  obnovte stránku“.
- **Výpadek serveru:** když se server do 5 s neozve (výpadek, uspaný projekt), hra to řekne
  a nabídne PvE nebo hru ve dvou.

### Nastavení Supabase (krok za krokem)

1. Založ si účet na [supabase.com](https://supabase.com) a vytvoř nový projekt
   (region v EU, např. Frankfurt). Databázové tabulky nejsou potřeba.
2. V **Project Settings → API** (případně **API Keys**) zkopíruj **Project URL**
   a veřejný **anon / publishable** klíč. (Klíč je veřejný a skončí v prohlížeči hráčů,
   přesto ho do kódu nepiš – jde přes proměnné prostředí.)
3. V nastavení **Realtime** nech povolený přístup k veřejným kanálům (bez „private channels
   only“) – hra používá jen Broadcast na veřejném kanálu.
4. Lokálně zkopíruj `.env.example` na `.env.local` a doplň hodnoty:

   ```bash
   cp .env.example .env.local
   ```

5. Restartuj `npm run dev`. V menu se u **Online 1v1** objeví „Založ místnost nebo se připoj
   kódem“.
6. Projekt ve free plánu se po týdnu bez provozu uspí – hra pak ukáže „Online server je
   nedostupný“. V dashboardu Supabase ho obnovíš tlačítkem **Restore**.

Nasazení na GitHub Pages (s proměnnými v GitHub Actions) přibude ve fázi 5.

## Jak otestovat fázi 3

1. `npm test` – testy online logiky běží celé přes `InMemoryTransport` bez internetu:
   spolehlivé doručení při ztrátách a přeházení zpráv, odmítnutí podvržených podpisů,
   neshoda verzí, 5 s / 15 s odpojení, párování a plná místnost, commit-reveal, celý online
   zápas KNP a Tasce, odveta, neaktivita i podvádějící klient (jiný tah než závazek, jiné
   pořadí her než ze seedu).
2. **Bez Supabase, dva hráči v jedné záložce:** `npm run dev` a otevři
   <http://localhost:5173/?duo> (jen ve vývoji). Ovládej myší – klávesové zkratky by zabraly
   v obou polovinách.
   - Vlevo **Online 1v1 → Vytvořit místnost → Vytvořit místnost**, vpravo **Online 1v1** (kód je
     předvyplněný) → **Připojit se**. Obě strany musí ukázat stejné lobby.
   - Vlevo **Do boje!**, pak oba **Připraven** (druhý uvidí „✓ Soupeř je připravený“).
   - KNP: vyber vpravo – vlevo musí být jen „Soupeř už má vybráno!“ bez prozrazení volby.
   - Tasec: každá strana má vlastní arénu a vlastní změřený čas.
   - Výpadek: v konzoli prohlížeče `__duo.transports[1].setConnected(false)` – po 5 s banner
     s odpočtem, po dalších 15 s výhra kontumací.
   - Nedostupný server: `__duo.hub.available = false` a pak vytvoř místnost – do 5 s hláška
     s nabídkou PvE / hry ve dvou.
3. **Se Supabase:** nastav `.env.local` podle návodu výše, otevři hru ve dvou prohlížečích
   (nebo v normálním a anonymním okně). Vyzkoušej kód i odkaz `?room=`, třetí okno
   („Místnost je plná“), odchod přes ✕ (soupeř vyhraje kontumací) a odvetu.

## Jak otestovat fázi 4 – reakční a tahové hry

1. `npm test` – pravidla a remízy všech šesti her, AI (těžká v Piškvorkách nikdy neprohraje,
   v Sirkách z vyhrané pozice vždy vyhraje, v Tečkách a čtverečcích přesně propočítá koncovku)
   a obecný kontrakt v `registry.test.ts` (platné tahy AI, pohledy projdou schématem).
2. Nejrychleji: **Proti AI → Vlastní výběr → best of 1 → Vybrat hry** a jedna konkrétní hra.
   - **Klikací souboj:** odpočet 3-2-1, pak 5 s klikání (mezerník / klepání). Držení klávesy
     se nepočítá.
   - **Postřeh:** po výzvě „zelený trojúhelník“ apod. klepni na správný cíl (klávesy 1–4).
     Cíl jde poznat podle barvy i podle tvaru. Špatný cíl = prohra kola.
   - **Piškvorky:** klávesy 1–9. Těžká AI je neporazitelná – zkus aspoň remízu.
   - **Čtyři v řadě:** klávesy 1–7, kámen „spadne“ dolů. Těžká AI hledá 7 tahů dopředu.
   - **Sirky:** „Vzít 1/2/3“; při najetí se sirky, které bys vzal, nadzvednou. Trik: nech
     soupeři počet, který dává zbytek 1 po dělení čtyřmi.
   - **Tečky a čtverečky:** klikej na čáry mezi tečkami; kdo uzavře políčko, hraje znovu.
3. **Dva hráči:** Klikací souboj a Postřeh mají půlenou obrazovku (A: klávesa A / Q W E R,
   B: klávesa L / U I O P), deskové hry mají společnou desku.
4. **Velký souboj** je teď dostupný (Čtyři v řadě a Tečky a čtverečky).
5. Online (`?duo` nebo Supabase): všechny nové hry fungují i po síti – hostitel posílá stav,
   reakční hry posílají lokálně změřený výsledek.

## Jak otestovat fázi 4 – skrytá informace (Lodě, Logik)

1. `npm test` – pravidla obou her, AI (těžká v Lodích střílí podle mapy pravděpodobnosti,
   v Logiku prolomí každý kód nejvýš na 7 pokusů), automatické odpovědi z tajných dat,
   předávání zařízení a online závazky: poctivá hra, lež hosta i hostitele v odpovědích,
   hostitel, který pozmění odpověď hosta, hostitel bez závazku a host, který nezvolí kód.
2. **Proti AI → Vlastní výběr → best of 1 → Vybrat hry → Lodě:**
   - Rozmístění: vyber loď v paletě, klikni do moře (náhled zežloutne, nepovolené místo
     zčervená), **R** nebo „Otočit“ mění směr, klik na položenou loď ji zvedne. „Náhodně“
     rozmístí vše, „Hotovo“ potvrdí. Po 90 s se rozmístí samo.
   - Bitva: střílíš do levého moře (klik, nebo šipky + Enter). Zásah = střílíš znovu.
     Kolem potopené lodi se pole označí jako „jistě voda“. Vpravo vidíš svou flotilu
     a výstřely AI, pod levým mořem zbývající lodě soupeře.
3. **Logik souboj:** zvol tajný kód (klávesy 1–6 nebo klik na barvy, Backspace maže, Enter
   potvrdí), pak tipuj. Odpověď: zlatá tečka = barva i místo, kroužek = jen barva. Barvy mají
   i vlastní symbol. Vyhrává, kdo prolomí kód na méně pokusů.
4. **Dva hráči:** obě hry jdou přes „Předej zařízení“ – každý vidí jen své lodě / svůj kód.
   Po výstřelu vedle zůstane výsledek 1,5 s vidět, pak se zařízení předá. V Logiku tipuje
   první ten, kdo zařízení právě drží (jedno předání na kolo).
5. **Online (`?duo` nebo Supabase):** obě strany zadají lodě / kód, hra začne až po obou.
   Na konci se kódy odhalí a ověří – výsledek musí být u obou stejný, v konzoli bez varování.

## Architektura

```
src/
├─ core/                    čistá logika – žádný DOM ani síť
│  ├─ MiniGame.ts           rozhraní miniher (GameLogic, MiniGameModule, MiniGame)
│  ├─ GameRunner.ts         spojí logiku, vykreslení a hráče (člověk / AI / síť)
│  ├─ match/                planMatch (formáty, losování), MatchController (skóre, remízy)
│  ├─ ai/reaction.ts        lidsky působící reakční doby AI
│  └─ util/                 RNG se seedem, hodiny, commit-reveal, kanonický JSON
├─ net/                     Transport, InMemory/Supabase, protokol (Zod), Peer, místnosti
├─ online/                  OnlineSession (zápas po síti), RemoteRunner (host), commit-reveal výměny
├─ games/
│  ├─ registry.ts           JEDINÝ seznam miniher
│  └─ <hra>/                logic.ts · ai.ts · view.ts · index.ts · *.test.ts
├─ ui/                      router (App), MatchFlow, OnlineFlow, obrazovky, komponenty
└─ platform/                localStorage, nastavení, zvuky (WebAudio syntéza)
```

- **Herní logika je čistá funkce stavu** (`setup → toMove → legal → apply → outcome → view`).
  Stejná logika běží v PvE, lokálně i online; `view(state, hráč)` vrací jen to, co hráč smí
  vidět.
- **GameRunner** implementuje rozhraní `MiniGame` ze zadání (`init/start/onInput/onEnd/destroy`)
  a stará se o „přemýšlení“ AI (0,5–1,5 s), limit na tah (pak automatický tah), v lokálním
  režimu o obrazovku „Předej zařízení“ a online u hostitele o posílání stavu soupeři.
- **RemoteRunner** u online hosta logiku nespouští – jen vykresluje stav od hostitele
  (validovaný schématem pohledu) a posílá vstupy.
- **MatchController** nezná konkrétní hry: řeší best of N, remízová kola, los a kontumace.

## Jak přidat novou minihru

1. Vytvoř složku `src/games/<id>/`.
2. `logic.ts` – implementuj `GameLogic`, Zod schéma tahu (`moveSchema`) a pohledu
   (`viewSchema`). V `outcome` definuj, co je remíza.
3. `ai.ts` – `getAIMove` pro obtížnosti `easy` / `medium` / `hard`. Lehká AI musí vždy vrátit
   platný tah (používá se i jako automatický tah při neaktivitě).
4. `view.ts` – vykreslení přes `h()` / `svg()` z `src/ui/dom.ts` (text nikdy přes `innerHTML`).
5. `index.ts` – `defineGame({...})` s názvem, typem, délkou, pravidly a ovládáním. Hra se
   současným tajným tahem (jako KNP) nastaví `sealed` – online pak jde přes commit-reveal.
   Hra s tajnými daty, na která se soupeř ptá (jako Lodě nebo Logik), nastaví `hidden`:
   schéma a kontrolu dat, náhodná data, `respond` (odpověď z dat), `consistent` (ověření
   odpovědí po odhalení) a `outcome` z veřejného stavu. Logika samotná tajná data nezná.
6. Přidej hru do pole `GAMES` v `src/games/registry.ts` – automaticky se objeví ve vlastním
   výběru, v losování i online.
7. Napiš `logic.test.ts`. Obecný kontrakt (pravidla, ovládání, platné tahy AI pro všechny
   obtížnosti, pohledy projdou `viewSchema`) hlídá `registry.test.ts` sám.

## Bezpečnost

- Text od uživatele nebo soupeře jde vždy přes textové uzly; ESLint zakazuje `innerHTML`,
  `outerHTML`, `insertAdjacentHTML` i `document.write`, a import Supabase mimo
  `SupabaseTransport.ts`.
- Produkční build obsahuje Content-Security-Policy (`<meta>`, protože GitHub Pages neumí
  vlastní hlavičky): skripty a styly jen z vlastní domény, síť jen na nastavený Supabase.
- Přezdívka: 2–16 znaků po oříznutí, písmena včetně diakritiky, číslice, mezera a `_ . -`;
  žádné řídicí ani neviditelné znaky. Kontroluje se i u přezdívky soupeře ze sítě.
- V repozitáři nejsou žádná tajemství; konfigurace Supabase jde přes `VITE_…` proměnné.

**Známá omezení online režimu (bez serveru, který by rozhodoval):**

- Reakční časy jsou na důvěře – upravený klient může poslat vymyšlený (ale ≥ 100 ms) čas.
- Při výpadku spojení vidí výhru kontumací oba hráči (každý vidí odpojení toho druhého).
- Kdo zná kód místnosti dřív než pozvaný soupeř, může se připojit místo něj. Po spárování
  už do zápasu zasahovat nemůže (podpisy zpráv).
- Lež v odpovědi (Lodě, Logik) se pozná až po konci hry – podvodník ale prohraje celý zápas.
- Kdo nahlásí nesoulad dat, vyhrává kontumací. Upravený klient tak může soupeře falešně
  obvinit; bez rozhodčího serveru nejde zjistit, kdo lže (hra to aspoň oznámí oběma).
