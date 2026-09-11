# WE RIDE Newsroom — Live auf eurem Stack (GitHub Pages + Supabase)

Kein Server, keine Monatsmiete. Frontend liegt auf GitHub Pages, Logik + Daten auf Supabase
(Projekt **weride-newsroom**, getrennt von Velox), Gmail-Ingest über Google Apps Script.

Projekt-URL: `https://bidomfoamvuzvwatqlsr.supabase.co`
Edge Function: `https://bidomfoamvuzvwatqlsr.supabase.co/functions/v1/api`

---

## 1. Supabase: Secrets für die Edge Function

Supabase Dashboard → Projekt **weride-newsroom** → **Edge Functions → Secrets** (bzw. Project Settings → Edge Functions). Anlegen:

| Name | Wert |
|---|---|
| `OPENAI_API_KEY` | dein frischer OpenAI-Key (Textgenerierung) |
| `ANTHROPIC_API_KEY` | dein Anthropic-Key (KIRA-Recherche/Frage) |
| `NEWSROOM_TOKEN` | Team-Passwort (frei wählbar) |
| `ADMIN_TOKEN` | nur du, für /admin (frei wählbar) |

(Optional `OPENAI_MODEL`, `KIRA_MODEL`, `USD_EUR`, `SICHTUNG_LIMIT` — sonst gelten Standards.)

Der `SUPABASE_SERVICE_ROLE_KEY` und `SUPABASE_URL` sind in Edge Functions automatisch vorhanden — nichts zu tun.

---

## 2. Google Apps Script: der Gmail-Ingest

1. `script.google.com` → **Neues Projekt**. Den Inhalt aus `newsroom-app/apps-script/Code.gs` komplett hineinkopieren.
2. **Projekteinstellungen (Zahnrad) → Skripteigenschaften** anlegen:
   - `SUPABASE_URL` = `https://bidomfoamvuzvwatqlsr.supabase.co`
   - `SERVICE_ROLE` = dein **service_role**-Key (Supabase → Project Settings → **API** → „service_role", geheim!)
   - `ANTHROPIC_KEY` = dein Anthropic-Key
   - `GMAIL_LABEL` = `Presse`
   - `LOOKBACK_DAYS` = `2`
3. Oben Funktion **`runIngest`** wählen → **Ausführen**. Beim ersten Mal Google-Berechtigung (Gmail lesen) bestätigen.
4. **Trigger (Uhr-Symbol) → Trigger hinzufügen**: Funktion `runIngest`, Ereignis „Zeitgesteuert", z. B. **stündlich** (oder alle 2 Std.).
5. **Bereitstellen → Neue Bereitstellung → Web-App**: „Ausführen als: ich", „Zugriff: Jeder mit dem Link" → **Bereitstellen** → **Web-App-URL kopieren**.
6. Diese URL in `docs/index.html` bei `APPS_SCRIPT_URL = '...'` eintragen (dann funktioniert der Button „↻ Neue Alerts holen"). Sag mir die URL, dann trage ich sie ein.

---

## 3. GitHub Pages: das Frontend

1. Die neuen Dateien committen & pushen (Ordner `docs/` = die statische Seite):
   ```bash
   git add .
   git commit -m "Newsroom auf Supabase + GitHub Pages"
   git push
   ```
2. GitHub → Repo `weride-newsroom` → **Settings → Pages** → Source: **Deploy from a branch** → Branch **main**, Ordner **/docs** → **Save**.
3. Nach ~1 Min erscheint die URL (z. B. `https://robertstrehler-boop.github.io/weride-newsroom/`).

> Hinweis: Kostenloses GitHub Pages braucht ein **öffentliches** Repo. Das ist hier unbedenklich — im Frontend stecken **keine** geheimen Keys (nur der öffentliche Supabase-anon-Key; die echten API-Keys liegen ausschließlich in den Supabase-Secrets). Wer das Repo privat lassen will, braucht GitHub Pro.

---

## 4. Zugang / Nutzung

- **Newsroom:** die Pages-URL öffnen → Team-Passwort (`NEWSROOM_TOKEN`) eingeben → Kürzel wählen (LO/AH/ZC/RS/JS).
- **Admin (nur du):** `…github.io/weride-newsroom/admin.html` → `ADMIN_TOKEN` eingeben → Kosten/Token/Calls.
- **Neue Alerts:** kommen automatisch per Apps-Script-Trigger; Button „↻ Neue Alerts holen" stößt sie sofort an (sobald APPS_SCRIPT_URL eingetragen ist).

---

## Was ist geteilt (über alle Geräte)?

Sichtung, Grid-Funde von KIRA, **Entwürfe** und **Veröffentlicht** liegen in Supabase — alle sehen dasselbe.
„Mein Stack" (Auswahl zum Bearbeiten) ist weiterhin pro Browser; das ist für den Start okay und lässt sich später serverseitig nachrüsten.

## Kosten

- GitHub Pages: kostenlos. Supabase: Free-Tier (0 €).
- Nur die API-Nutzung (OpenAI/Anthropic) nach Verbrauch — sichtbar im /admin.
