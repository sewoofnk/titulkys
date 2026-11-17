# titulkys
## Nasadenie (Cloudflare Pages)

Repozitár sa nasadzuje cez Cloudflare Pages (HTTPS je nutné kvôli kamere). Priečinok `functions/` sa nasadí automaticky.

V *Settings → Environment variables* (ako Secrets) nastav:

| Premenná | Použitie |
|---|---|
| `AZURE_KEY`, `AZURE_REGION` | neurónový hlas (`/api/tts`) |
| `AI_KEY` | AI preklad (`/api/translate`) |
| `AI_PROVIDER` | `gemini` (predvolené) alebo `claude` |
| `AI_MODEL` | voliteľne názov modelu (over aktuálny názov v dokumentácii poskytovateľa) |

Bez týchto premenných stránka funguje ďalej so systémovým hlasom a prekladom cez Google.
Číslo verzie je vo `version.js` a zvyšuje sa automaticky pri každom commite (git hook v `.githooks`). Po naklonovaní spusti raz `git config core.hooksPath .githooks`.
