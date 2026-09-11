# WE RIDE Newsroom — Live stellen (Render)

Ziel: Der Newsroom läuft 24/7 unter einer festen URL, geschützt per Team-Passwort,
mit persistenten Daten und automatischem Ingest jeden Morgen.

---

## 0. Vorher (wichtig, Sicherheit)

- Der alte OpenAI-Key und der ScraperAPI-Key aus dem WordPress-Plugin müssen **widerrufen** sein
  (die lagen offen im Chat). Erzeuge frische Keys.
- Prüfe, dass **keine** `.env` ins Repo wandert (die `.gitignore` verhindert das schon).

---

## 1. Code zu GitHub

Im Ordner `Newsportal Rohling` (Repo-Wurzel — hier liegen `newsroom-prototyp.html`,
`newsroom-app/` und `render.yaml`):

```bash
cd "Newsportal Rohling"
git init
git add .
git status          # KONTROLLE: .env darf NICHT in der Liste stehen
git commit -m "WE RIDE Newsroom – erste Version"
git branch -M main
git remote add origin git@github.com:<DEIN-GITHUB>/weride-newsroom.git
git push -u origin main
```

Repo bitte **privat** anlegen.

---

## 2. Render einrichten (Blueprint)

1. Auf https://render.com einloggen (GitHub verbinden).
2. **New +  →  Blueprint**.
3. Das `weride-newsroom`-Repo auswählen. Render liest `render.yaml` automatisch und legt
   den Web-Service **+ persistente Disk** an.
4. **Apply** klicken.

---

## 3. Geheimnisse eintragen (im Render-Dashboard, nicht im Code)

Service → **Environment** → diese Werte setzen (stehen in `render.yaml` als „sync:false"):

| Variable | Wert |
|---|---|
| `ANTHROPIC_API_KEY` | dein Anthropic-Key (KIRA/Sichtung) |
| `OPENAI_API_KEY` | dein frischer OpenAI-Key (Textgenerierung) |
| `GMAIL_USER` | robert.strehler@gmail.com |
| `GMAIL_APP_PASSWORD` | frisches Gmail-App-Passwort (16-stellig) |
| `NEWSROOM_PASSWORD` | ein Passwort für die ganze Redaktion |
| `ADMIN_TOKEN` | ein geheimes Token nur für dich (Zugang zu `/admin`) |

Die übrigen Variablen (Modelle, Label, `INGEST_AT` usw.) kommen automatisch aus `render.yaml`.

Danach **Manual Deploy → Deploy latest commit**.

---

## 4. Erster Start

- Beim ersten Deploy füllt `INGEST_ON_BOOT=true` die Sichtung einmalig (dauert ein paar Minuten,
  KIRA bewertet die Meldungen). Im **Logs**-Tab siehst du `⏱ Starte automatischen Ingest …`.
- Alternativ sofort manuell: Service → **Shell** → `node ingest.js`.

---

## 5. Zugang

- URL öffnen (z. B. `https://weride-newsroom.onrender.com`).
- Der Browser fragt nach Login: **Benutzername egal**, **Passwort = `NEWSROOM_PASSWORD`**.
- Diesen Link + das Passwort an die Redaktion (LO, AH, ZC, RS, JS) geben.

---

## 6. Automatischer Ingest / Uhrzeit

- Läuft täglich um `INGEST_AT` (Standard `03:30` **UTC** ≈ 05:30 deutscher Sommerzeit).
- Andere Zeit? Variable `INGEST_AT` anpassen (immer in UTC denken: DE-Winter = UTC+1, Sommer = UTC+2).

---

## 7. Updates ausspielen

Einfach committen und pushen — Render deployt automatisch:

```bash
git add .
git commit -m "Änderung xy"
git push
```

---

## 8. Admin / Kosten-Tracking (nur du)

- Öffne `https://<deine-url>/admin`, gib dein `ADMIN_TOKEN` ein.
- Du siehst: Gesamtkosten (USD + geschätzte EUR), Anzahl API-Calls, Tokens, „Heute",
  sowie Aufschlüsselung nach Typ (Generierung / Recherche / KIRA-Frage / Ingest-Scoring),
  Modell, Redakteur und Tag.
- Die Daten liegen dauerhaft auf dem Volume (`usage.jsonl`) und überleben Neustarts.

---

## Kosten (Richtwert)

- Render Web-Service „Starter": ~7 $/Monat (immer an) + ~0,25 $/Monat für 1 GB Disk.
- API-Kosten nach Verbrauch (siehst du im Logs-Tab pro Generierung/Recherche).

## Bekannte Grenze

- Sichtung, Entwürfe und Veröffentlicht sind **serverseitig geteilt** (alle sehen dasselbe).
- „Mein Stack" und „An Kolleg:in übergeben" sind aktuell **pro Browser**. Für geräteübergreifendes
  Übergeben müsste der Stack ebenfalls serverseitig liegen — sinnvoller Folgeschritt nach dem ersten Live-Test.
