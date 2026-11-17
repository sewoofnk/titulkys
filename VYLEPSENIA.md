# Titulky z TV → slovenský dabing: plán vylepšení

## Kontext projektu

- Stránka `index.html` (jeden súbor, HTML + CSS + JS) beží v mobile. Kamerou sníma TV, na ktorej beží GTA 5 z Xboxu.
- Teraz robí toto: kamera → orez oblasti s titulkami → úprava obrazu (prah jasu) → OCR (Tesseract.js 5 z CDN) → kontrola, či ide o nový titulok (Levenshtein podobnosť + potvrdenie vo viacerých snímkach) → preklad (Google `translate_a/single?client=gtx`, záloha MyMemory) → zobrazenie + čítanie nahlas (`speechSynthesis`).
- **Hosting:** GitHub repozitár → Cloudflare Pages (HTTPS je nutné kvôli kamere).
- Nastavenia sa ukladajú do `localStorage` pod kľúčom `titulky-set`.
- UI je po slovensky, tmavá téma, optimalizované pre mobil (Android Chrome aj iPhone Safari).

### Všeobecné požiadavky
- Zachovaj všetky existujúce funkcie a nastavenia. Každá nová funkcia musí mať zálohu (fallback), keď server, kľúč alebo internet nie sú dostupné. Stránka nikdy nesmie prestať fungovať.
- API kľúče **nikdy** nedávaj do frontendu. Všetky volania na platené alebo kľúčové API idú cez **Cloudflare Pages Functions** v tom istom repozitári (`/functions/api/...`) a kľúče sú v *Settings → Environment variables* (ako secrets).
- Pred použitím konkrétnych modelov a endpointov over ich aktuálne názvy v oficiálnej dokumentácii.
- Kód môže zostať v jednom `index.html`, ale ak to sprehľadní projekt, rozdeľ ho na `index.html`, `app.js` a `style.css`.

### Navrhovaná štruktúra repozitára
```
/index.html
/app.js
/style.css
/manifest.webmanifest
/sw.js
/icons/icon-192.png, icon-512.png
/vendor/tesseract/...          (lokálne kópie knižnice a jazykových dát, bod 6)
/functions/api/tts.js          (bod 1)
/functions/api/translate.js    (bod 2)
```

---

## Odporúčané poradie
1. **Bod 7 – čierna obrazovka** (rýchle, bez servera)
2. **Bod 1 – neurónový hlas** + **Bod 2 – AI preklad** (spolu, jedna sada Pages Functions)
3. Bod 5 – automatický prah
4. Bod 4 – vyrovnanie perspektívy
5. Bod 3 – hlasy podľa postáv
6. Bod 6 – PWA

---

## 1. Prirodzený neurónový hlas (Azure Speech)

**Cieľ:** namiesto systémového hlasu použiť neurónové hlasy, ktoré znejú takmer ako človek.

- Backend `functions/api/tts.js` (POST `{ text, voice, rate, pitch }`) → vráti `audio/mpeg`.
  - Volá `https://{AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`
  - Hlavičky: `Ocp-Apim-Subscription-Key: AZURE_KEY`, `Content-Type: application/ssml+xml`, `X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3`
  - Z textu poskladaj SSML s `<prosody rate pitch>`. Text escapuj (`& < > " '`).
  - Hlasy: `sk-SK-LukasNeural`, `sk-SK-ViktoriaNeural`, `cs-CZ-AntoninNeural`, `cs-CZ-VlastaNeural` (over aktuálny zoznam).
  - Ochrana: obmedz dĺžku textu (napr. 400 znakov), povoľ len vlastnú doménu (kontrola `Origin`) a pridaj jednoduchý limit počtu požiadaviek.
  - Odpoveď cachuj cez Cache API (kľúč = hash textu + hlasu), aby sa opakované vety neplatili znova.
- Env premenné: `AZURE_KEY`, `AZURE_REGION`. Bezplatný tarif F0 má mesačný limit znakov (over aktuálnu hodnotu).
- **Frontend:**
  - V nastaveniach pribudne voľba „Hlasový engine“: *Neurónový (cloud)* / *Systémový (telefón)*. Plus výber neurónového hlasu.
  - Prehrávanie cez jeden znovupoužívaný `<audio>` element alebo Web Audio API. **Odomknutie zvuku:** pri kliknutí na Štart prehraj krátke ticho, inak iPhone ďalšie prehrávanie zablokuje.
  - Front a prerušovanie musia fungovať rovnako ako pri `speechSynthesis` (možnosť „Nový titulok preruší starý“, inak čaká iba najnovší).
  - Ak TTS zlyhá alebo trvá viac ako 3 s, automaticky použi systémový hlas a v statuse ukáž upozornenie.
  - Zobraz počet znakov spotrebovaných v tomto mesiaci (počítadlo v `localStorage`), aby bolo vidno, koľko zostáva z bezplatného limitu.

## 2. AI preklad s kontextom

**Cieľ:** prirodzený preklad slangu a nadávok z GTA, opravené chyby OCR, nepreložené mená.

- Backend `functions/api/translate.js` (POST `{ text, context: [posledných 5 viet], target: 'sk'|'cs' }`).
  - Poskytovateľ cez env premennú `AI_PROVIDER` = `gemini` (má bezplatný tarif) alebo `claude`, kľúč v `AI_KEY`. Použi rýchly a lacný model (over aktuálne názvy).
  - Prompt (systémový), približne:
    > Si prekladateľ titulkov z hry GTA V do slovenčiny (alebo češtiny). Vstup je text z OCR, môže obsahovať preklepy a nezmysly. 1) Oprav zjavné chyby OCR. 2) Prelož prirodzene a hovorovo, ako by to povedala daná postava, zachovaj slang a nadávky primerane. 3) Nemeň vlastné mená (Franklin, Michael, Trevor, Lamar, Los Santos, Vinewood…). 4) Ak vstup nie je zmysluplná veta, vráť skip=true. Odpovedz iba JSON: {"fixed": "...", "translation": "...", "skip": false}
  - Kontext predošlých viet posielaj kvôli nadväznosti dialógu.
  - Timeout 4 s. Pri chybe vráť chybu a frontend použije Google `gtx`.
  - Cache rovnako ako pri TTS.
- **Frontend:**
  - Voľba „Prekladač“: *AI (s kontextom)* / *Google (rýchly)*.
  - Ak AI vráti `skip=true`, titulok ignoruj (filtruje nezmysly z OCR).
  - Používateľský **glosár** v nastaveniach: textové pole s riadkami `originál = preklad` (napr. `Lamar = Lamar`, `homie = kámo`). Posiela sa v prompte a uloží sa do `localStorage`.
  - **Voliteľný „vision“ režim:** namiesto Tesseractu poslať orezaný obrázok (JPEG, max ~800 px šírka) priamo AI modelu, ktorý text prečíta aj preloží. Volá sa iba vtedy, keď sa obraz v oblasti titulkov zmenil (porovnanie zmenšenej verzie snímky, rozdiel > prah), aby to nebolo drahé.

## 3. Iný hlas pre každú postavu (podľa farby titulkov)

**Cieľ:** v GTA V majú titulky postáv rôzne farby (Michael svetlomodrá, Franklin zelená, Trevor oranžová, ostatní biela). Každá postava dostane vlastný hlas.

- Pred prahovaním vypočítaj v oblasti titulkov **dominantnú farbu textu**: zober svetlé pixely (jas > prah) a z ich HSV urči priemerný odtieň a sýtosť. Nízka sýtosť = biela.
- Porovnaj s tabuľkou postáv (odtieň ± tolerancia). Predvolené hodnoty nastav podľa GTA V, ale pridaj **kalibráciu**: tlačidlo „Nauč farbu“ uloží aktuálnu farbu titulku k vybranej postave.
- Mapovanie postava → { hlas, rýchlosť, výška hlasu } v nastaveniach. Slovenské neurónové hlasy sú len dva (muž/žena), preto rozlišuj postavy výškou a rýchlosťou cez SSML `prosody`, prípadne českým hlasom.
- Pri preklade zobraz meno postavy pred textom (napr. „**Franklin:** …“).
- Pri prahovaní pre OCR zohľadni aj farebné titulky. Pixel je „text“, ak je svetlý **alebo** blízko niektorej známej farby titulkov.

## 4. Vyrovnanie perspektívy (4 rohy TV)

**Cieľ:** OCR funguje dobre, aj keď mobil nie je presne oproti TV.

- Režim „Označ rohy TV“: používateľ ťukne 4 rohy obrazovky na náhľade kamery (alebo ťahá 4 úchyty). Body sa uložia v `localStorage` (v percentách).
- Vypočítaj homografiu (vlastná implementácia, DLT, riešenie 8×8 sústavy, bez OpenCV) a urob inverzné mapovanie do obdĺžnika s pomerom 16:9. Rob to **iba pre oblasť titulkov**, nie celý snímok (výkon).
- Oblasť titulkov sa potom definuje v súradniciach vyrovnaného obrazu TV. Predvolene spodných ~22 %.
- V náhľade ukáž vyrovnaný obraz, aby bolo vidno, že rohy sedia.
- Tlačidlo „Zrušiť vyrovnanie“ vráti pôvodný režim.

## 5. Automatický prah jasu

- Nový režim úpravy obrazu „Automaticky“ (predvolený): na každej snímke oblasti vypočítaj **Otsuov prah** z histogramu jasu.
- Ak je v oblasti veľmi málo svetlých pixelov (žiadny titulok), prah nemeň a OCR v tom kroku preskoč, čím ušetríš výkon.
- Voliteľne lokálny adaptívny prah (priemer okolia, integrálny obraz) pre scény s nerovnomerným svetlom.
- Pridaj aj **detekciu zmeny**: ak sa zmenšená verzia oblasti takmer nezmenila oproti minulej snímke, OCR vôbec nespúšťaj. Ušetrí to baterku a zrýchli to reakciu.

## 6. PWA (aplikácia na ploche)

- `manifest.webmanifest`: názov „Titulky z TV“, `display: fullscreen`, tmavé farby, ikony 192 a 512 px (vygeneruj jednoduchú ikonu, napr. bublina s titulkom).
- `sw.js`: cache aplikácie a **lokálne kópie Tesseractu** (`tesseract.min.js`, worker, core wasm, `eng.traineddata`) uložené v `/vendor/tesseract/`. Pri `createWorker` nastav `workerPath`, `corePath` a `langPath` na tieto cesty. Štart je rýchlejší a nezávisí od CDN.
- Banner „Pridať na plochu“ (Android: `beforeinstallprompt`, iPhone: textový návod cez Zdieľať → Pridať na plochu).

## 7. Čierna obrazovka počas čítania

**Cieľ:** displej je počas hrania čierny (nesvieti, šetrí baterku, neruší pri hraní), ale kamera, OCR, preklad a čítanie bežia ďalej.

- **Dôležité obmedzenie:** skutočné vypnutie displeja (zamknutie mobilu) prehliadač pozastaví, takže kamera aj JavaScript prestanú fungovať. Preto ide o **čiernu vrstvu cez celú obrazovku** + Wake Lock. Na OLED displeji sú čierne pixely naozaj vypnuté.
- Tlačidlo **„🌑 Čierna obrazovka“** (aktívne iba počas behu):
  - Zobrazí `position:fixed; inset:0; background:#000; z-index:9999` a zavolá `requestFullscreen()` (v try/catch, na iPhone nemusí ísť).
  - `<video>` **neskrývaj cez `display:none`** (iOS Safari môže prestať dodávať snímky). Nechaj ho pod čiernou vrstvou.
  - Wake Lock musí zostať aktívny. Po návrate do stránky (`visibilitychange`) ho znova požiadaj.
  - Zrušenie: **dvojité ťuknutie** kdekoľvek alebo dlhé podržanie (1 s). Jedno ťuknutie nič nerobí, aby sa to nezrušilo omylom.
  - Voliteľne (nastavenie): úplne čierna / malá tlmená bodka (#111), ktorá bliká pri rozpoznaní titulku / tlmené titulky (#333) v spodnej časti pre kontrolu.
  - Pri ťuknutí prvýkrát krátko ukáž „Dvakrát ťukni pre návrat“ (veľmi tmavým textom, 2 s).
- Voliteľne: po N sekundách od štartu prejsť do čiernej obrazovky automaticky (nastavenie: vyp. / 10 s / 30 s).
- Čierna obrazovka musí fungovať aj pri rozpoznávaní v pozadí, čiže slučka OCR beží ďalej bez zmeny.

---

## Testovanie (checklist)
- [ ] Android Chrome aj iPhone Safari: štart kamery, povolenie, zadná kamera, zoom.
- [ ] Čierna obrazovka: titulky sa čítajú ďalej aspoň 10 minút, displej nezhasne, dvojité ťuknutie vráti UI.
- [ ] Bez internetu / bez kľúčov: stránka spadne späť na Google preklad a systémový hlas a nezamrzne.
- [ ] Ten istý titulok sa neprečíta dvakrát. Rýchlo sa striedajúce titulky sa nezasekávajú vo fronte.
- [ ] Spotreba: zmeraj snímky/s a baterku za 30 minút s detekciou zmeny a bez nej.
- [ ] Kľúče nie sú nikde vo frontende ani v GitHub repozitári.
