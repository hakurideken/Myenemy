# Myenemy

Webová hra – souboj 1v1 v sadě miniher. Hraje se proti AI nebo online s kódem místnosti
(hra ve dvou na jednom zařízení byla zrušena). Účet není potřeba – stačí přezdívka v prohlížeči; přihlášení (Google, Discord) je jen pro kamarády a vzájemné výsledky.

## Stav vývoje

| Fáze | Obsah                                                                          | Stav   |
| ---- | ------------------------------------------------------------------------------ | ------ |
| 1    | Návrh architektury                                                             | hotovo |
| 2    | MVP: přezdívka, menu, všechny formáty, PvE + lokální PvP, Rychlý tasec, KNP    | hotovo |
| 3    | Online PvP s kódem místnosti (InMemoryTransport → Supabase Realtime Broadcast) | hotovo |
| 4    | Zbývající minihry: reakční, tahové, skrytá informace a karetní                 | hotovo |
| 5    | Doladění UI a přístupnosti, nasazení na GitHub Pages                           | hotovo |

## Minihry

| Hra               | Typ               | Délka  | Stav   |
| ----------------- | ----------------- | ------ | ------ |
| Rychlý tasec      | reakční           | rychlá | hotovo |
| Kámen-nůžky-papír | tahová (současná) | rychlá | hotovo |
| Klikací souboj    | reakční           | rychlá | hotovo |
| Postřeh           | reakční           | rychlá | hotovo |
| Kachní hon        | reakční           | delší  | hotovo |
| Piškvorky 3×3     | tahová            | rychlá | hotovo |
| Čtyři v řadě      | tahová            | delší  | hotovo |
| Sirky (Nim)       | tahová            | rychlá | hotovo |
| Tečky a čtverečky | tahová            | delší  | hotovo |
| Lodě              | skrytá informace  | delší  | hotovo |
| Logik souboj      | skrytá informace  | delší  | hotovo |
| Hon v mlze        | skrytá informace  | delší  | hotovo |
| Prší              | karetní           | delší  | hotovo |
| Oko bere          | karetní           | rychlá | hotovo |
| Pexeso duel       | karetní           | delší  | hotovo |
| Sekvence          | paměťová          | delší  | hotovo |
| Co se změnilo     | paměťová          | rychlá | hotovo |
| Čísla na mžik     | paměťová          | rychlá | hotovo |

## Kognitivní skupiny

Příprava na statistiky hráče (do budoucna s účty a kamarády). Každá hra má jednu
**hlavní** skupinu, do které se budou počítat výsledky (nic se nepočítá dvakrát), a nanejvýš
jednu **vedlejší** jen pro informaci. Údaj je u hry v `index.ts` (`cognitive`), názvy
skupin v `src/ui/labels.ts` (`COGNITIVE_LABEL`).

| Skupina                          | Co měří                                     |
| -------------------------------- | ------------------------------------------- |
| Rychlost a postřeh (speed)       | reakční doba, pohotovost, rozlišení podnětu |
| Paměť (memory)                   | krátkodobá a pracovní paměť                 |
| Logika a dedukce (logic)         | vyvozování z informací, počítání            |
| Strategie a plánování (strategy) | dopředné myšlení, práce s prostorem         |
| Odhad a čtení soupeře (chance)   | riziko, pravděpodobnost, předvídání soupeře |

| Hra               | Hlavní                | Vedlejší              |
| ----------------- | --------------------- | --------------------- |
| Rychlý tasec      | Rychlost a postřeh    | –                     |
| Klikací souboj    | Rychlost a postřeh    | –                     |
| Postřeh           | Rychlost a postřeh    | –                     |
| Kachní hon        | Rychlost a postřeh    | –                     |
| Pexeso duel       | Paměť                 | Rychlost a postřeh    |
| Sekvence          | Paměť                 | –                     |
| Co se změnilo     | Paměť                 | Rychlost a postřeh    |
| Čísla na mžik     | Paměť                 | –                     |
| Logik souboj      | Logika a dedukce      | Paměť                 |
| Lodě              | Logika a dedukce      | Odhad a čtení soupeře |
| Sirky             | Logika a dedukce      | Strategie a plánování |
| Piškvorky 3×3     | Strategie a plánování | Paměť                 |
| Čtyři v řadě      | Strategie a plánování | –                     |
| Tečky a čtverečky | Strategie a plánování | Logika a dedukce      |
| Hon v mlze        | Strategie a plánování | Odhad a čtení soupeře |
| Kámen-nůžky-papír | Odhad a čtení soupeře | –                     |
| Oko bere          | Odhad a čtení soupeře | –                     |
| Prší              | Odhad a čtení soupeře | Strategie a plánování |

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

Hra poběží na <http://localhost:5173>. Hra proti AI funguje bez jakékoli konfigurace.

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
- **Karty (Oko bere, Prší, Pexeso) – mental poker:** balíček nezná ani hostitel. Oba hráči
  ho postupně zašifrují svým klíčem a zamíchají (SRA, komutativní šifrování x^e mod p
  s 2048bitovým prvočíslem z RFC 3526), pak každou pozici zamknou zvláštním klíčem. Kartu
  odemknou až klíče obou: k líznuté kartě pošle soupeř svůj klíč jen mně, k vyložené
  a otočené kartě oba. Stav karetní hry je veřejný, proto ji počítají oba hráči sami
  a tahy si posílají navzájem; vyloženou kartu soupeř hned ověří klíčem. Současná rozhodnutí
  (Oko bere: líznout / stát) jdou zapečetěná. Na konci si hráči pošlou všechny klíče a ověří,
  že balíček obsahoval každou kartu právě jednou. Míchání trvá asi půl vteřiny.
- **Reakční hry:** každý měří reakci lokálně (`performance.now()` od zobrazení signálu)
  a posílá změřený čas, ne okamžik doručení. Reakce pod 100 ms se počítá jako předčasná.
- **Odpojení:** po 5 s ticha se ukáže odpočet, po dalších 15 s vyhrává zbylý hráč
  kontumací. Kdo zápas opustí, prohraje hned.
- **Neaktivita:** po lhůtě na tah se zahraje automaticky; třikrát po sobě = prohra kontumací.
- **Jiná verze:** dva hráči s jiným buildem se nespojí – oba uvidí „Soupeř má jinou verzi hry –
  obnovte stránku“.
- **Výpadek serveru:** když se server do 5 s neozve (výpadek, uspaný projekt), hra to řekne
  a nabídne hru proti AI.

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

### Účty: přihlášení přes Google a Discord (krok za krokem)

Hrát jde dál bez účtu (host). Účet je jen pro kamarády a vzájemné výsledky. Hráč má
přezdívku a čtyřmístný kód (`Pepa#0042`) – přezdívky se můžou opakovat, dvojice ne.
Callback adresa níže je `https://<tvuj-projekt>.supabase.co/auth/v1/callback`
(najdeš ji i přímo v Supabase u každého poskytovatele).

1. **Databáze:** Supabase → **SQL Editor** → vlož celý soubor
   `supabase/migrations/20261107120000_accounts.sql` → **Run**. Vytvoří tabulku profilů
   (s RLS), funkce pro přezdívku s kódem, export dat a smazání účtu. Spustit znovu je
   bezpečné. Na konci souboru je kontrolní dotaz – má vrátit 0 řádků.
   Potom stejně spusť `supabase/migrations/20261108120000_friends.sql` (kamarádi, žádosti,
   vzájemné výsledky) pak `supabase/migrations/20261110120000_invites.sql` (pozvánky do hry,
   souhrn upozornění) a nakonec `supabase/migrations/20261111120000_presence.sql` (stav
   kamarádů online / ve hře). Pořadí je důležité – další soubory potřebují předchozí tabulky.
2. **Adresy:** **Authentication → URL Configuration**
   - Site URL: `https://hakurideken.github.io/Myenemy/`
   - Redirect URLs: `https://hakurideken.github.io/Myenemy/`, `http://localhost:5173/`
     a `http://localhost:4173/Myenemy/` (náhled buildu).
   - **Přesně tyto adresy, bez hvězdiček (`*`) a jiných zástupných znaků** – jinak by šlo
     podstrčit přesměrování na cizí web a ukrást přihlášení.
3. **Google:** [console.cloud.google.com](https://console.cloud.google.com) → nový projekt →
   **APIs & Services → OAuth consent screen** (External, název hry, e-mail) →
   **Credentials → Create credentials → OAuth client ID** (Web application), do
   **Authorized redirect URIs** callback adresu Supabase. Client ID a Client Secret vlož do
   Supabase → **Authentication → Sign In / Providers → Google** a zapni.
   - **Branding** (nutné pro zveřejnění, **Audience → Publish app**): App name `Myenemy`,
     User support email, App home page `https://hakurideken.github.io/Myenemy/`,
     Privacy policy `https://hakurideken.github.io/Myenemy/privacy.html`. Logo nenahrávej
     (vyžadovalo by ověření Googlem). **Authorized domains:** `hakurideken.github.io`
     a `<tvuj-projekt>.supabase.co`. Developer contact: tvůj e-mail.
   - Stránka `public/privacy.html` se generuje z textů obrazovky „Ochrana soukromí“
     (`src/ui/screens/account.ts`); test `privacy.test.ts` hlídá, že jsou stejné.
4. **Discord:** [discord.com/developers/applications](https://discord.com/developers/applications)
   → **New Application** → **OAuth2** → **Redirects**: callback adresa Supabase. Client ID
   a Client Secret vlož do Supabase → **Providers → Discord** a zapni.
5. **Ostatní způsoby přihlášení vypnout:** v **Providers** vypni **Email** a **Phone**
   a v **Authentication → Sign In / Providers** i **Anonymous sign-ins** – hra je nenabízí
   a jinak by šlo zakládat účty přímo přes API (spam, obsazování přezdívek).
6. Tajné klíče (Client Secret) patří jen do Supabase – do repozitáře ani do `.env` ne.
   Web používá jen stávající veřejné `VITE_SUPABASE_URL` a `VITE_SUPABASE_ANON_KEY`.

**Bezpečnost účtů** (kontrola agentem `security-reviewer`):

- Klient smí z databáze jen číst svůj profil; zápisy jdou přes funkce, které kontrolují
  přezdívku stejně přísně jako klient (jedna abeceda, žádné neviditelné znaky, NFKC).
- Přezdívku jde měnit nejvýš jednou za 10 minut; kód zůstává, pokud je volný.
- Nové tabulky v `public` nejsou automaticky přístupné klientům (výchozí práva odebraná).
- Přihlášení je PKCE (žádné tokeny v adrese), uložené v `localStorage`. Pozor: všechny
  GitHub Pages projekty účtu `hakurideken` sdílí jeden původ – jiná stránka na
  `hakurideken.github.io` by k přihlášení dosáhla. Do přesunu na vlastní doménu tam
  nedávej jiné weby.
- Zásady soukromí ve hře (vpravo nahoře → Přihlásit → Ochrana soukromí); účet od 15 let.

**Kamarádi a vzájemné výsledky** (vpravo nahoře účet → **Kamarádi**):

- Kamaráda přidáš celým jménem s kódem (`Pepa#0042`) – hledat jen podle přezdívky nejde.
  Druhý žádost přijme nebo odmítne; když si pošlete žádost navzájem, jste rovnou přátelé.
  Nejvýš 20 pokusů o žádost za den a 50 nevyřízených žádostí. Po odmítnutí (nebo odebrání
  z kamarádů) se stejnému hráči 30 dní nová žádost nedoručí (odesílatel vidí „odesláno“). Odesílatel
  vidí u žádosti jen jméno z doby odeslání, ne identifikátor účtu.
- Čekající žádost ukáže červená tečka na tlačítku účtu (obnoví se při návratu do menu).
- Skóre `Ty 5 : 3` se počítá jen z online zápasů, kde jsou oba přihlášení a jsou kamarádi.
  Po konci zápasu každý nahlásí výsledek pod klíčem zápasu – HMAC seedu zápasu klíčem
  odvozeným z párování (ECDH, `deriveReportKey`). Herní zprávy jsou jen podepsané, ne
  šifrované, takže seed vidí každý, kdo zná kód místnosti – klíč zápasu ale ne.
  Započte se, až se obě hlášení shodnou (jeden vyhrál, druhý prohrál); nesoulad dat se
  nehlásí, nepotvrzené hlášení se smaže asi po 2 dnech. Limity: 100 hlášení na hráče
  a 50 započtených zápasů na dvojici za den.
- Odebráním kamaráda se smaže i vaše skóre. Smazání účtu smaže všechno.
- Omezení: bez rozhodčího serveru může poražený hlášení neposlat (zápas se nezapočte)
  a dva domluvení kamarádi si můžou skóre vymyslet. Pro skóre mezi dvěma lidmi to nevadí,
  pro budoucí statistiky nebo žebříčky by `friend_matches` nestačily.
- Volitelně: pravidelný úklid přes pg_cron (návod na konci SQL souboru).

**Pozvánky do hry** (bez posílání kódu):

- V **Kamarádi** je u každého kamaráda **Pozvat do hry** → nastavení zápasu („Po založení
  místnosti dostane pozvánku Pepa#0042“) → místnost → pozvánka odejde sama. Na čekací
  obrazovce místnosti je i seznam kamarádů s tlačítkem **Pozvat**.
- Pozvaný uvidí dole na obrazovce „Pepa#0042 tě zve do hry“ s **Přijmout** (rovnou se
  připojí) / **Odmítnout**. Mimo rozehraný zápas a online místnost.
- Žádosti o přátelství i pozvánky se obnovují samy každých 15 s (jen ve viditelné
  záložce) a hned po návratu do záložky – bez obnovení stránky.
- Pozvat jde jen kamaráda; pozvánka platí 10 minut, stejnému kamarádovi nejvýš jednou za
  30 s, celkem 30 za hodinu. Zrušením místnosti bez soupeře se pozvánky do ní stáhnou.
- Omezení: kód v pozvánce nejde svázat s místností odesílatele (bez rozhodčího serveru).

**Stav kamarádů:** v Kamarádi je u každého tečka a stav – 🟢 online, 🟠 ve hře (rozehraný
zápas nebo online místnost), ⚪ offline; online kamarádi jsou nahoře a u nich je „Pozvat
do hry“ zvýrazněné. Hra se ozve (`ping`) se stejným 15s obnovováním jako pozvánky, online
= ozval se v posledních 45 s; při zavření stránky nebo odhlášení je hráč hned offline.
Čas posledního ozvání se kamarádům neukazuje. V Nastavení jde vypnout „Ukazovat
kamarádům, že jsem online“ (pak je hráč pro všechny offline a čas se neukládá).

**Výsledky při odchodu:** když hráč odejde z výsledku posledního kola (zápas je rozhodnutý),
nahlásí výsledek i tak a soupeři se místo „soupeř odešel“ ukáže výsledek zápasu – skóre
kamarádů se započte. Odchod z rozehraného zápasu se nepočítá (jinak by šlo výhru „vysedět“).

**Jak otestovat kamarády:** dva účty (třeba Google v jednom prohlížeči a Discord ve druhém) →
první pošle žádost na `Jméno#kód` druhého → druhý vidí tečku a v **Kamarádi** žádost
přijme → online zápas mezi nimi → po výsledku zápasu se u obou změní skóre (stačí znovu
otevřít Kamarádi).

**Jak otestovat:** vpravo nahoře **Přihlásit → Přihlásit přes Google / Discord**, po návratu
zvol přezdívku – v liště se ukáže `Přezdívka#1234`. Okno účtu: změna přezdívky (kód zůstane,
pokud je volný; další změna až za 10 minut), stažení dat (JSON), odhlášení, smazání účtu
(zmizí i řádek v **Table Editor → profiles**).
Lišta vpravo nahoře (jazyk, nastavení, účet) je vidět všude kromě rozehraného zápasu
a online místnosti.

## Nasazení na GitHub Pages

Hra je statický web – workflow `.github/workflows/ci.yml` ji po každém pushi do `main`
otestuje, sestaví a nasadí na `https://<uživatel>.github.io/Myenemy/`.

1. Na GitHubu otevři repozitář → **Settings → Pages** a v **Build and deployment → Source**
   zvol **GitHub Actions**. (Dokud to není zapnuté, workflow nasazení jen přeskočí
   s upozorněním a nic nespadne.)
2. Online hra: **Settings → Secrets and variables → Actions → Variables → New repository
   variable** a přidej:
   - `VITE_SUPABASE_URL` – Project URL ze Supabase (např. `https://abcd.supabase.co`),
   - `VITE_SUPABASE_ANON_KEY` – veřejný anon / publishable klíč.

   Klíč je veřejný (skončí v prohlížeči hráčů), proto stačí proměnná; když ho chceš mít
   mezi tajemstvími, workflow umí načíst i stejnojmenný **secret**. Bez těchto hodnot web
   funguje, jen online režim ukáže, že není nastavený.

3. Spusť nasazení: další push do `main`, nebo **Actions → CI a nasazení → Run workflow**.
   Adresa se ukáže u kroku **deploy** (prostředí `github-pages`).
4. Základní cesta je `/Myenemy/` (`base` ve `vite.config.ts`). Při přejmenování repozitáře
   ji uprav. Content-Security-Policy se při buildu vygeneruje z `VITE_SUPABASE_URL` – síť
   povolí jen na tvůj Supabase projekt.

Lokálně si produkční build vyzkoušíš přes `npm run build` a `npm run preview`
(http://localhost:4173/Myenemy/).

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
     s nabídkou hry proti AI.
3. **Se Supabase:** nastav `.env.local` podle návodu výše, otevři hru ve dvou prohlížečích
   (nebo v normálním a anonymním okně). Vyzkoušej kód i odkaz `?room=`, třetí okno
   („Místnost je plná“), odchod přes ✕ (soupeř vyhraje kontumací) a odvetu.

## Jak otestovat fázi 4 – reakční a tahové hry

1. `npm test` – pravidla a remízy všech šesti her, AI (těžká v Piškvorkách hraje dokonale,
   v Sirkách z vyhrané pozice vždy vyhraje, v Tečkách a čtverečcích přesně propočítá koncovku)
   a obecný kontrakt v `registry.test.ts` (platné tahy AI, pohledy projdou schématem).
2. Nejrychleji: **Proti AI → Vlastní výběr → best of 1 → Vybrat hry** a jedna konkrétní hra.
   - **Klikací souboj:** odpočet 3-2-1, pak 5 s klikání (mezerník / klepání). Držení klávesy
     se nepočítá.
   - **Postřeh:** po výzvě „zelený trojúhelník“ apod. klepni na správný cíl (klávesy 1–4).
     Cíl jde poznat podle barvy i podle tvaru. Špatný cíl = prohra kola.
   - **Piškvorky:** klávesy 1–9. Každý má na desce nejvýš 3 značky (viz níže „Úpravy po
     fázi 5“).
   - **Čtyři v řadě:** klávesy 1–7, kámen „spadne“ dolů. Těžká AI hledá 7 tahů dopředu.
   - **Sirky:** „Vzít 1/2/3“; při najetí se sirky, které bys vzal, nadzvednou. Trik: nech
     soupeři počet, který dává zbytek 1 po dělení čtyřmi.
   - **Tečky a čtverečky:** klikej na čáry mezi tečkami; kdo uzavře políčko, hraje znovu.
3. **Velký souboj** je teď dostupný (Čtyři v řadě a Tečky a čtverečky).
4. Online (`?duo` nebo Supabase): všechny nové hry fungují i po síti – hostitel posílá stav,
   reakční hry posílají lokálně změřený výsledek.

## Jak otestovat fázi 4 – skrytá informace (Lodě, Logik)

1. `npm test` – pravidla obou her, AI (těžká v Lodích střílí podle mapy pravděpodobnosti,
   v Logiku prolomí každý kód nejvýš na 7 pokusů), automatické odpovědi z tajných dat,
   a online závazky: poctivá hra, lež hosta i hostitele v odpovědích,
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
4. **Online (`?duo` nebo Supabase):** obě strany zadají lodě / kód, hra začne až po obou.
   Na konci se kódy odhalí a ověří – výsledek musí být u obou stejný, v konzoli bez varování.

## Jak otestovat fázi 4 – karetní hry (Oko bere, Prší, Pexeso)

1. `npm test` – pravidla všech tří her (sedmy se sčítají, eso zastaví, svršek mění barvu,
   otočení balíčku, limit tahů, oko a přetažení, dvojice v pexesu), síla AI (těžká
   a střední porazí lehkou), mental poker (prvočíslo, komutativita, soukromé i veřejné
   odhalení, audit, podvržený klíč, zdvojená karta) a online zápasy přes `InMemoryTransport`:
   celé Pexeso i Oko bere mezi dvěma klienty, vyložení karty bez klíče a neaktivita.
   Síťové testy běží až po ostatních a soubor po souboru (jsou citlivé na vytížené CPU).
2. **Proti AI → Vlastní výběr → best of 1 → Vybrat hry:**
   - **Oko bere:** L = líznout, S = stát. Soupeřovy karty jsou rubem nahoru, odhalí se, až
     oba stojí. Při 21, oku nebo přetažení se stojí automaticky.
   - **Prší:** klikni na zvýrazněnou kartu; svrškem zvolíš barvu (1–4). Na sedmu musíš dát
     sedmu, nebo líznout (2, 4, …), na eso dát eso, nebo stát – bez sedmy / esa se to
     provede samo. Když dojde balíček, otočí se odhazovací.
   - **Pexeso duel:** 15 dvojic (30 kartiček). Otoč dvě kartičky; dvojice = bereš a hraješ znovu. Karty z posledního
     tahu zůstanou vidět, dokud někdo neotočí další.
3. **Online (`?duo` nebo Supabase):** na začátku kola se chvíli míchá („Míchám balíček…“).
   Každá strana vidí jen svou ruku, soupeř jen počet karet. V Oko bere je vidět jen
   „rozhodnuto“, ne jak. Výsledek musí být u obou stejný, v konzoli bez chyb.

## Jak otestovat fázi 5 – UI, přístupnost, nasazení

1. **Nasazení:** podle návodu výše zapni Pages (a případně přidej proměnné Supabase),
   pak push nebo **Run workflow**. Na nasazené adrese zkus PvE a online
   (dvě okna / dva prohlížeče, odkaz `?room=` musí vést na `/Myenemy/?room=…`).
2. **Klávesnice:** celou hru jde ovládat bez myši – Tab mezi prvky (viditelný zlatý rámeček),
   Enter/mezerník, zkratky her podle úvodní nápovědy. Po přechodu na novou obrazovku je
   fokus na nadpisu.
3. **Opuštění zápasu (✕):** místo systémového okna se ukáže vlastní dialog. Výchozí je
   „Zůstat“, Escape nebo klik mimo dialog ho zavře, Tab neuteče ven a hra pod ním nereaguje
   na klávesy.
4. **Nastavení → Omezit animace:** vypne létání karet, otáčení a pulzování i bez
   systémového nastavení. Když je „Omezit pohyb“ zapnuté v systému, přepínač je zapnutý
   a zamčený.
5. **Čtečka obrazovky** (NVDA, VoiceOver): stav hry se ohlašuje (aria-live), karty a pole
   mají české popisy („srdcová sedma“, „C5: zásah“), časovač upozorní jednou na posledních
   5 sekund.
6. **Instalace:** v Chrome / Edge na nasazené adrese jde hru „nainstalovat“ (manifest).

## Úpravy po fázi 5

**Piškvorky bez remízy.** Každý hráč smí mít na desce 3×3 nejvýš 3 značky. Když položí
čtvrtou, jeho nejstarší značka zmizí. Pole, kde ještě leží, v tom tahu obsadit nejde.
Značka, která zmizí jako další, je vybledlá (s čárkovaným rámečkem) a při zmizení se
krátce rozplyne. Hraje se, dokud někdo nesloží trojici. Pojistka: po 60 tazích bez trojice
je kolo nerozhodné (rozhodující kolo, po třech remízách los).

- Těžká AI hraje dokonale. Celá hra je vyřešená retrográdní analýzou (asi 147 tisíc
  pozic, spočítá se jednou za ~0,3 s). Kdo začíná, může si vynutit výhru do 13 tahů,
  takže těžká AI jako začínající vyhraje vždy. Začínající hráč se střídá každé kolo.
- Střední AI vyhraje nebo zablokuje a hlídá, aby jí zmizelá značka neotevřela soupeři
  řadu. Lehká hraje většinou náhodně.

**Pexeso s 15 dvojicemi.** 30 kartiček v mřížce 5 × 6 a tři nové obrázky (houba, jablko,
mrak). Při lichém počtu dvojic remíza nenastane – jen po pojistce 300 otočení.

**Jak otestovat:** Proti AI → Vlastní výběr → best of 1 → Piškvorky. Polož 4 značky
a sleduj, že nejstarší (vybledlá) zmizí. Pak zkus těžkou AI, když začíná ona, a když
začínáš ty. U Pexesa zkontroluj, že je 30 kartiček a celá deska je vidět i na mobilu.

**Angličtina.** Celá hra jde přepnout do angličtiny: tlačítkem „English“ / „Čeština“
v menu nebo v Nastavení (Jazyk / Language). Volba se uloží v prohlížeči a stránka se
znovu načte. Bez uložené volby se jazyk vezme z prohlížeče (čeština a slovenština →
česky, jinak anglicky). Přeložené je všechno, co hráč vidí: menu, nastavení zápasu,
pravidla a ovládání všech her, texty během hry, popisky pro čtečky obrazovky,
výsledky i online hlášky. Online může mít každý hráč jiný jazyk: do sítě jdou jen data,
shrnutí kola si host spočítá sám ve svém jazyce.

**Jak otestovat:** Menu → „English“. Projdi menu, Nastavení, Proti AI → Vlastní výběr
a pár her (např. Prší – názvy karet „Seven of Hearts“, Logik, Lodě). Dohraj zápas až
na výsledek. Online zkus jednoho hráče česky a druhého anglicky (dva prohlížeče).
Zpět přes „Čeština“.

**Lodě: odkrytá deska po konci hry.** Jakmile hra skončí, objeví se na soupeřově moři
jeho lodě – zasažené části s ✕ a nezasažené šedě. Výsledek kola pak ukáže obě moře
vedle sebe (Odkrytá deska), takže si oba hráči v klidu prohlédnou, kam stříleli a kde
lodě opravdu byly. Proti AI zná zařízení obě flotily hned. Online se flotila
soupeře ukáže až po jejím odhalení a ověření proti závazku a odpovědím během hry.
Data, která ověřením neprojdou, se neukážou a zápas skončí jako nesoulad dat.

**Jak otestovat:** Proti AI → Vlastní výběr → best of 1 → Lodě. Dohraj hru a na
výsledku kola zkontroluj obě moře: u soupeře šedé zbytky lodí, které jsi nezasáhl.
Online totéž na obou stranách.

**Hon v mlze (nová hra).** Jeden je lovec, druhý liška, hraje se na dva poločasy na stejné
mapě a role se prohodí. Les 9 × 9 se stromy (nejdou projít ani přes ně vidět) a keři (kdo
v nich stojí, je vidět jen zblízka). Lovec ujde až 2 pole rovně a vidí do vzdálenosti 2,
liška ujde 1 pole i šikmo a vidí do vzdálenosti 3; za sebou nechává stopy z posledních
2 tahů. Lovec ji chytí vstupem na její pole (i průchodem), má na to 15 kol. Vyhrává, kdo
lišku chytil v nižším kole. Po každém poločase se ukážou obě trasy.

- Vyváženost je ověřená simulací her AI proti AI: dobrý lovec chytí dobrou lišku asi
  v 80 % poločasů, nejčastěji v 8.–10. kole, lehký lovec jen asi ve 40 %.
- AI si vede pravděpodobnost, kde soupeř je (rozptyl po jeho tazích, zúžení tím, co
  viděla i neviděla, stopy). Lovec se nevrací tam, kde právě byl.
- Online polohu soupeře nezná ani jeho zařízení. Po každém tahu proběhne oběma směry
  šifrovaný průnik množin (Diffie–Hellman PSI, 1024bitová grupa): pozorovatel pošle
  zašifrované štítky polí, kam dohlédne, cíl je zašifruje i svým klíčem a přidá, čím se
  prozrazuje (poloha, stopy). Pozorovatel pozná jen shodu – tedy přesně to, co vidí.
  Po poločase oba pošlou celé tahy i klíče a soupeř přepočítá, že trasa byla platná, nikdo
  se nedíval dál, než smí, nic nezatajil a hlášení o chycení sedí. Jinak prohra kontumací.

**Jak otestovat:** Proti AI → Vlastní výběr → best of 1 → Hon v mlze. Za lovce i za lišku
zkus, že vidíš jen své okolí (zbytek je tmavý), soupeře jen v dosahu (jinak slabě, kde byl
naposledy), stopy lišky a přestávku s oběma trasami. Online stejně, ideálně ve dvou
prohlížečích (oba musí mít novou verzi – změnil se protokol).

**Zrušená hra ve dvou na jednom zařízení.** Hraje se jen proti AI nebo online. Z enginu
zmizelo předávání zařízení (`handoff`, `localLayout`, hotseat v `GameRunner`), z menu
volba „Dva hráči na jednom zařízení“ a reakční hry už nemají půlenou obrazovku.

**Kachní hon (nová hra).** Po odpočtu létají minutu kachny – bez pevného počtu (za minutu
kolem 20–30), najednou nejvýš 3, ze všech stran (z trávy, zleva, zprava i shora) a odlétají
za kterýkoli okraj; čím později, tím rychlejší a kratší let. Kachnu získá, kdo ji trefí
první (+1) – padá v jeho barvě. **Bílá holubice** (asi každý šestý pták) se nestřílí –
každý zásah holubice je −1 bod. Vyhrává víc bodů. **Rozstřel:** když je po minutě
nerozhodně, vyletí zlatá kachna – kdo ji trefí první, vyhrává; když nikdo, remíza
(rozhodující kolo). O rozstřelu se rozhodne 0,5 s po konci minuty (zpoždění sítě).
Zásah do 150 ms od vylétnutí neplatí. Po minutí se puška 0,45 s nabíjí.

- Ovládání: klik / klepnutí na kachnu; bez myši šipky posouvají zaměřovač, mezerník nebo
  Enter střílí.
- Dráhy jsou ze společného seedu – online je mají oba hráči stejné. Zásah nese čas a místo;
  logika ověří, že tam kachna v tu chvíli opravdu byla. O sporné kachně rozhodne dřívější
  čas (výsledek nezávisí na tom, v jakém pořadí zásahy dorazily).
- Online se zásahy posílají hned (`liveMoves` – bez zapečetění), takže každý vidí, co
  soupeř sestřelil. Čas zásahu měří klient střelce (stejně jako u ostatních reakčních her).
  Soupeř smí mlčet celou minutu (`untimedLimitMs`), než by přišla kontumace.
- AI míří na kachny podle pořadí, holubice se snaží vynechat (lehká se splete asi u třetiny,
  těžká u 3 %) a po minutě zkusí zlatou kachnu (když nerozhodně není, nic tím nezmění).

**Jak otestovat:** Proti AI → Vlastní výběr → best of 1 → Vybrat hry → Kachní hon. Střílej
na kachny, zkus minout (zaměřovač se na chvíli zašedí, „Nabíjím…“) a ovládání šipkami.
Online (`?duo` nebo dva prohlížeče): zásah v jedné polovině se hned ukáže v druhé (kachna
padá v barvě střelce, skóre nahoře) a výsledek kola je u obou stejný.

**Hudba.** Vlastní skladby v `public/music/` (MP3, celkem asi 5,6 MB):

| Soubor                   | Kdy hraje                                      |
| ------------------------ | ---------------------------------------------- |
| `friendly-rivalry.mp3`   | pořád dokola – menu, hry i výsledky kol        |
| `victory-fanfare.mp3`    | na konci zápasu, když vyhraješ (dokola, 1:32)  |
| `try-again-player-1.mp3` | na konci zápasu, když prohraješ (dokola, 0:26) |

- Výherní / prohraná skladba hraje dokola, dokud hráč neopustí výsledek zápasu (odveta,
  menu) – pak hned zase podklad. Remíza kola na hudbu nemá vliv.
- Přehrává se přes Web Audio (`src/platform/music.ts`): podklad se dekóduje celý a smyčka
  vynechá ticho, které MP3 přidává na začátek a konec – navazuje bez mezery. Skladby na
  konec zápasu se stahují až ve chvíli, kdy jsou potřeba, a po odchodu z výsledku se z paměti uvolní.
- Prohlížeč pustí zvuk až po první interakci – hudba začne po prvním kliknutí nebo klávese.
  Ve skryté záložce se zvuk pozastaví. V režimu `?duo` hraje hudba jen v levé polovině.
- **Nastavení:** „Hudba“ (zapnout / vypnout) a „Hlasitost hudby“ zvlášť od „Zvuků“
  (efekty). Volba se pamatuje v prohlížeči, starší uložená nastavení mají hudbu zapnutou
  na 50 %.

**Jak otestovat:** po přezdívce / prvním kliknutí hraje v menu podklad. V Nastavení
vypni Hudbu (zvuky efektů zůstanou) a posuvníkem změň hlasitost. Dohraj zápas proti AI
(třeba best of 1, KNP) – při výhře zazní fanfára, při prohře „Try Again“, po návratu do
menu zase podklad.

**Obnovení stránky:** obrazovka je v adrese (`#settings`, `#friends`, `#privacy`,
`#setup-pve`, `#setup-online`, `#online`) – po obnovení stránky nebo přepnutí jazyka se
hráč vrátí tam, kde byl. Rozehraný zápas ani online místnost obnovit nejde (vedou do menu).

**Animace konce zápasu** (`src/ui/components/celebration.ts`, SVG + CSS, bez obrázků):

- **Výhra:** ohňostroj (8 výbuchů v barvách hry) a panďulák v barvě vítěze přinese
  korunu, vyskočí, nasadí ji na zlatou trofej (asi 7 s) a pak mává dokola, dokud hráč obrazovku neopustí.
- **Prohra:** vybledlá trofej, tři panďuláci brečí (třesou se, kapou slzy) a dva
  v barvě soupeře chodí sem a tam, zastaví se a ukážou prostředníček – dokola.
- „Omezit animace“ (nastavení i systém) ukáže rovnou konečný obrázek bez pohybu.
  Scéna je jen dekorace (pro čtečku skrytá), tlačítka fungují hned.

**Jak otestovat:** dohraj zápas proti AI (best of 1, KNP) – jednou vyhraj, jednou prohraj.
Pak zapni Nastavení → Omezit animace a zkontroluj klidové obrázky.

**Paměťové hry (Sekvence, Co se změnilo, Čísla na mžik).** Oba hráči dostanou ze
společného seedu stejné zadání, každý hraje svým tempem a výsledek pošle až na konci
jedním tahem – online zapečetěným (commit-reveal), takže soupeř nic nevidí dřív, než
dohraje sám. Posílají se samotné odpovědi (stisky, políčka, číslice) a logika z nich
výsledek spočítá znovu; na důvěře je jen změřený čas (a upravený klient by mohl zadání
přečíst z paměti – stejné omezení jako u reakčních her).

- **Sekvence:** 4 pole (barva + tvar + tón, klávesy 1–4). Řada roste o jednu položku
  (3 → 17), po chybě nebo 6 s bez stisku konec. Víc kol vyhrává, při shodě rychlejší zadávání.
- **Co se změnilo:** 7 kol na desce 4 × 4 s obrázky z Pexesa (5 → 10 obrázků, kratší čas
  na zapamatování). Jedna změna: zmizí, přibude, nebo se vymění. Klik na místo změny (8 s).
- **Čísla na mžik:** 7 kol, číslo o 4 až 10 číslicích blikne (0,7 s + 0,26 s na číslici),
  pak se píše (0–9, Backspace, Enter nebo klávesnice na obrazovce). Bod za každou číslici
  na správném místě, nejvýš 49.
- Sekvence: AI pošle výsledek pár sekund po odpočtu (je schovaný až do konce) – dřív se
  na ni čekalo tak dlouho, jako by celý běh hrála (u těžké i minuty).
- Čísla na mžik: Enter vždy odešle odpověď, i když je fokus na tlačítku číselníku.
- **Obtížnost AI v paměťových hrách** (nastavená podle simulace, cíl: lehká pod průměrným
  hráčem, střední ≈ průměrný hráč, těžká ≈ dobrý hráč, ne nepřekonatelná):

  | Hra            | Lehká      | Střední    | Těžká      | Dřív těžká       |
  | -------------- | ---------- | ---------- | ---------- | ---------------- |
  | Sekvence (kol) | 4,6        | 6,6        | 9,1        | 12,1             |
  | Co se změnilo  | 3,5 / 7    | 4,7 / 7    | 5,8 / 7    | 6,4 / 7          |
  | Čísla na mžik  | 32,6 / 49  | 38,2 / 49  | 42,1 / 49  | 45,0 / 49        |
  | Pexeso (paměť) | 30 % karet | 50 % karet | 72 % karet | 100 % (dokonalá) |

  Čísla na mžik: AI má „rozsah paměti“ (5 / 6,2 / 7,3 číslice) – do něj skoro jistě,
  delší konec čísla hádá, jako člověk. Tempo zadávání je pomalejší než dřív.

- Oprava v Pexesu: obrázek měsíce měl dva oblouky se stejnou dráhou (nulová plocha)
  a nevykreslil se – teď je to srpek.

**Jak otestovat:** Proti AI → Vlastní výběr → best of 1 → Vybrat hry → Sekvence / Co se
změnilo / Čísla na mžik. Online stejně (`?duo` nebo dva prohlížeče) – soupeřův výsledek se
ukáže až po dohrání obou.

### Úroveň Nemožná a přehled parametrů AI

Čtvrtá obtížnost **Nemožná** (`impossible`): na hraně lidských možností, skoro nechybuje.
Tahové hry s vyřešenou strategií (Piškvorky, Sirky) na ní hrají dokonale – Těžká proto
nově občas chybuje (85 % tahů optimálně), aby se dala porazit.

Všechny laditelné parametry (soubor `src/games/<hra>/ai.ts`, reakce `src/core/ai/reaction.ts`):

| Hra                   | Parametr                            | Lehká               | Střední       | Těžká         | Nemožná        |
| --------------------- | ----------------------------------- | ------------------- | ------------- | ------------- | -------------- |
| Rychlý tasec, Postřeh | reakce průměr ± rozptyl (ms)        | 450 ± 70            | 330 ± 50      | 250 ± 35      | 150 ± 15       |
|                       | nejrychlejší reakce (ms)            | 230                 | 200           | 170           | 120            |
|                       | předčasný výstřel / zaváhání        | 8 % / 6 %           | 5 % / 4 %     | 3 % / 2 %     | 0 % / 0 %      |
| Postřeh               | výběr cíle navíc (ms) / špatný cíl  | 230 / 10 %          | 170 / 6 %     | 120 / 3 %     | 50 / 1 %       |
| Klikací souboj        | kliknutí za sekundu                 | 5,5                 | 7,2           | 9             | 13             |
| Kachní hon            | přesnost                            | 35 %                | 60 %          | 85 %          | 97 %           |
|                       | omylem holubice                     | 30 %                | 12 %          | 3 %           | 0 %            |
|                       | reakce na kachnu (ms)               | 1500–2700           | 1050–1800     | 700–1150      | 350–550        |
|                       | přemíření (ms)                      | 800–1300            | 550–900       | 350–600       | 150–250        |
| Sekvence              | dosažené kolo (průměr ± rozptyl)    | 4,5 ± 1,3           | 6,5 ± 1,5     | 9 ± 1,6       | 13 ± 1,5       |
|                       | tempo mačkání (ms na pole)          | 600                 | 480           | 400           | 150            |
| Co se změnilo         | šance (5 obrázků) / pokles na další | 65 % / 6 %          | 80 % / 5 %    | 92 % / 3,5 %  | 98 % / 1 %     |
|                       | čas odpovědi (ms)                   | 3000                | 2300          | 1700          | 900            |
| Čísla na mžik         | rozsah paměti (číslic)              | 5                   | 6,2           | 7,3           | 9,5            |
|                       | tempo psaní (ms na číslici)         | 600                 | 480           | 380           | 150            |
| Pexeso                | zapamatuje si odkrytou kartu        | 30 %                | 50 %          | 72 %          | 90 %           |
| Čtyři v řadě          | hloubka propočtu (půltahy)          | 1 (+35 % náhodně)   | 4             | 7             | 9              |
| Tečky a čtverečky     | přesná koncovka od (volných čar)    | –                   | – (12 % chyb) | 16            | 18             |
| Piškvorky             | optimální tahy                      | náhodně             | heuristika    | 85 %          | 100 %          |
| Sirky                 | optimální tahy                      | 20 %                | 60 %          | 85 %          | 100 %          |
| Kámen, nůžky, papír   | hraje proti predikci                | 0 %                 | 60 %          | 80 % (Markov) | 95 % (Markov)  |
| Hon                   | šum v rozhodování / sleduje stopy   | 30 / ne             | 3 / ne        | 1 / ano       | 0 / ano        |
| Oko bere              | strategie                           | náhodný limit 10–18 | stojí od 17   | simulace 300× | simulace 1500× |
| Lodě, Logik, Prší     | strategie                           | slabá               | rozumná       | optimální     | jako Těžká     |

Naměřeno simulací (2000 her) – paměťové hry, průměr AI:

| Hra            | Lehká     | Střední   | Těžká     | Nemožná   |
| -------------- | --------- | --------- | --------- | --------- |
| Sekvence (kol) | 4,5       | 6,5       | 9,0       | 12,9      |
| Co se změnilo  | 3,5 / 7   | 4,8 / 7   | 5,9 / 7   | 6,7 / 7   |
| Čísla na mžik  | 32,5 / 49 | 38,2 / 49 | 42,0 / 49 | 46,7 / 49 |

Lodě, Logik a Prší hrají už na Těžké nejlépe, jak to jde bez podvádění (AI nikdy nevidí
skryté karty ani lodě) – Nemožná je u nich stejná.

## Architektura

```
src/
├─ core/                    čistá logika – žádný DOM ani síť
│  ├─ MiniGame.ts           rozhraní miniher (GameLogic, MiniGameModule, MiniGame)
│  ├─ GameRunner.ts         spojí logiku, vykreslení a hráče (člověk / AI / síť)
│  ├─ match/                planMatch (formáty, losování), MatchController (skóre, remízy)
│  ├─ ai/reaction.ts        lidsky působící reakční doby AI
│  ├─ cards/                mental poker (SRA), lokální rozdávající
│  ├─ fog/                  mlha: LocalFog, šifrovaný průnik množin (psi.ts)
│  └─ util/                 RNG se seedem, hodiny, commit-reveal, kanonický JSON
├─ net/                     Transport, InMemory/Supabase, protokol (Zod), Peer, místnosti
├─ online/                  OnlineSession, RemoteRunner, commit-reveal, MentalPokerDealer, OnlineFog
├─ games/
│  ├─ registry.ts           JEDINÝ seznam miniher
│  └─ <hra>/                logic.ts · ai.ts · view.ts · index.ts · *.test.ts
├─ ui/                      router (App), MatchFlow, OnlineFlow, obrazovky, komponenty
├─ platform/                localStorage, nastavení, zvuky (WebAudio syntéza)
└─ i18n.ts                  jazyk (cs / en) a translations(cs, en)
```

- **Herní logika je čistá funkce stavu** (`setup → toMove → legal → apply → outcome → view`).
  Stejná logika běží v PvE i online; `view(state, hráč)` vrací jen to, co hráč smí
  vidět.
- **GameRunner** implementuje rozhraní `MiniGame` ze zadání (`init/start/onInput/onEnd/destroy`)
  a stará se o „přemýšlení“ AI (0,5–1,5 s), limit na tah (pak automatický tah) a online
  u hostitele o posílání stavu soupeři.
- **RemoteRunner** u online hosta logiku nespouští – jen vykresluje stav od hostitele
  (validovaný schématem pohledu) a posílá vstupy.
- **MatchController** nezná konkrétní hry: řeší best of N, remízová kola, los a kontumace.
- **Texty** má každý modul u sebe: `const t = translations({ …česky }, { …anglicky })`.
  TypeScript hlídá, že anglická verze má stejné klíče a typy jako česká. Jazyk se vybere
  při startu stránky, testy běží česky.

## Jak přidat novou minihru

1. Vytvoř složku `src/games/<id>/`.
2. `logic.ts` – implementuj `GameLogic`, Zod schéma tahu (`moveSchema`) a pohledu
   (`viewSchema`). V `outcome` definuj, co je remíza.
3. `ai.ts` – `getAIMove` pro obtížnosti `easy` / `medium` / `hard` / `impossible`. Lehká AI musí vždy vrátit
   platný tah (používá se i jako automatický tah při neaktivitě).
4. `view.ts` – vykreslení přes `h()` / `svg()` z `src/ui/dom.ts` (text nikdy přes `innerHTML`).
   Všechny texty pro hráče patří do `translations(cs, en)` (viz `src/i18n.ts`).
5. `index.ts` – `defineGame({...})` s názvem, typem, délkou, kognitivní skupinou
   (`cognitive: { primary, secondary }`, viz výše), pravidly a ovládáním. Hra se
   současným tajným tahem (jako KNP) nastaví `sealed` – online pak jde přes commit-reveal.
   Hra s tajnými daty, na která se soupeř ptá (jako Lodě nebo Logik), nastaví `hidden`:
   schéma a kontrolu dat, náhodná data, `respond` (odpověď z dat), `consistent` (ověření
   odpovědí po odhalení) a `outcome` z veřejného stavu. Logika samotná tajná data nezná.
   Karetní hra nastaví `cards`: logika pracuje jen s pozicemi v zamíchaném balíčku,
   řekne, kdo má na kterou kartu nárok (`privateFor`, `publicCards`), na co čeká
   (`pendingPublic` → `reveal`) a které karty tah tvrdí (`claims`). Karty rozdává
   lokálně `LocalDealer`, online `MentalPokerDealer`.
   Hra, ve které oba hrají průběžně a vidí tahy soupeře hned (jako Kachní hon), nastaví
   `liveMoves` – logika pak musí dát stejný stav v libovolném pořadí tahů obou hráčů.
   Hra v mlze (jako Hon v mlze) nastaví `fog`: soukromý stav hráče (poloha) a jeho krok,
   veřejnou podobu tahu a štítky „kam hráč dohlédne“ a „čím se prozrazuje“. Kdo co vidí,
   je jejich průnik – lokálně `LocalFog`, online `OnlineFog` šifrovaně s ověřením po úseku.
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
  žádné řídicí ani neviditelné znaky (ani hangulská výplň) a žádné míchání latinky, azbuky
  a řečtiny („Pаvel“ s cyrilským „а“). Kontroluje se i u přezdívky soupeře ze sítě.
- V repozitáři nejsou žádná tajemství; konfigurace Supabase jde přes `VITE_…` proměnné
  repozitáře (ne secrets – hodnoty jsou ve veřejném bundlu). Bez nich CSP povolí jen vlastní
  doménu.
- Online: hry bez tajných dat počítají oba hráči a výsledek si každý ověří sám (stejně jako
  karty a mlha), takže upravený klient hostitele vítěze nevymyslí. Karty v mental pokeru
  jsou kódované hashem – mezi zašifrovanými kartami nejdou najít vztahy.
- Spojení: po spárování nic neukončí nepodepsaná zpráva „jiná verze“ ani cizí hello;
  přehrané staré zprávy neudrží odpojeného soupeře naživu. V lobby oba vidí kontrolní kód
  spojení – když se liší, vložil se mezi ně někdo cizí. Host se ke svému klíči nejdřív jen
  zaváže (otisk v hello) a odhalí ho až po odpovědi hostitele, takže útočník nemůže klíče
  dohledávat, dokud kódy nevyjdou stejně.
- Kontumace za neaktivitu: neaktivitu počítají oba hráči a pojistný časovač mají oba. Ohlášenou
  kontumaci hráč přijme, jen když ji vidí i sám (třikrát za něj táhla automatika, nebo je na
  tahu a od posledního tahu uběhl celý limit – třeba mu hra zamrzla v záložce na pozadí),
  případně když soupeř vzdává sebe; jinak jde o podvod. Kdo se v hello zaváže a klíč
  neodhalí, místnost neblokuje – po 10 s se uvolní.
- CI: akce připnuté na konkrétní commit (SHA), checkout bez uložených přihlašovacích údajů,
  Dependabot hlídá aktualizace.
- Soukromí: online se přes Supabase posílá jen přezdívka a tahy, hra nic neukládá (informace
  je v online menu).

**Známá omezení online režimu (bez serveru, který by rozhodoval):**

- Reakční časy, časy zásahů v Kachním honu a počty kliknutí v Klikacím souboji jsou na důvěře – upravený klient může
  poslat vymyšlený (ale ≥ 100 ms) čas nebo počet.
- Při výpadku spojení nebo zamrznutí hry vidí výhru kontumací oba hráči (každý vidí, že ten
  druhý přestal hrát).
- Kdo zná kód místnosti dřív než pozvaný soupeř, může se připojit místo něj. Po spárování
  už do zápasu zasahovat nemůže (podpisy zpráv). Vložit se mezi hráče („muž uprostřed“)
  odhalí kontrolní kód v lobby – jen když si ho hráči opravdu porovnají.
- Lež v odpovědi (Lodě, Logik) se pozná až po konci hry – podvodník ale prohraje celý zápas.
- Karty: kdo si pamatuje otočené karty (pexeso, otočený balíček v Prší), může si je
  zobrazit i upravený klient – jsou to veřejně viděné karty, stejně jako ve skutečné hře.
- Kdo nahlásí nesoulad dat, vyhrává kontumací. Upravený klient tak může soupeře falešně
  obvinit; bez rozhodčího serveru nejde zjistit, kdo lže (hra to aspoň oznámí oběma).
