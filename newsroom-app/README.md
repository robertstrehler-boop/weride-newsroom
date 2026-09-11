# WE RIDE Newsroom — Gmail-Ingest

Liest das Gmail-Label **„Presse"** aus und erzeugt daraus die Sichtungs-Liste
(`data/sichtung.json`): Google-Alert-Mails werden in Einzeltreffer zerlegt, direkte
Presse-Mails als Einzeleintrag übernommen, Dubletten entfernt, Region und Thema
getaggt und ein Relevanz-Score vergeben.

Dein App-Passwort bleibt lokal in `.env`. Der Ingest sendet nichts nach außen —
er liest nur dein Gmail-Label und schreibt eine Datei.

## Einmalig einrichten

1. **App-Passwort erzeugen** (falls noch nicht geschehen):
   Google-Konto → Sicherheit → Bestätigung in zwei Schritten → **App-Passwörter** →
   neues Passwort „Newsroom". Google zeigt einen 16-stelligen Code.

2. **IMAP in Gmail aktivieren:** Gmail → Einstellungen → „Weiterleitung und POP/IMAP"
   → IMAP aktivieren.

3. **Konfigurieren:**
   ```
   cd newsroom-app
   cp .env.example .env
   ```
   In `.env` eintragen: deine Gmail-Adresse und das App-Passwort.

4. **Pakete installieren:**
   ```
   npm install
   ```

## Ausführen
```
npm run ingest
```
Der Ingest verbindet sich, liest das Label „Presse" der letzten 48 Stunden, und
schreibt `data/sichtung.json`. Im Terminal siehst du eine Übersicht der gefundenen
Meldungen mit Relevanz-Score.

Zum regelmäßigen Laufen später per Cron/Scheduler (z. B. alle 15 Min).

## Ergebnis
`data/sichtung.json` enthält pro Meldung: Titel, URL, Quelle, Region, Thema,
Relevanz-Score und Eingangszeit. Diese Datei ist die Grundlage für die **Sichtung**
im Newsroom — der nächste Schritt ist, die Newsroom-Oberfläche diese Datei laden zu
lassen (statt der Beispieldaten).

## Hinweise
- Findet der Ingest 0 Meldungen: prüfe, ob das Label wirklich „Presse" heißt
  (Groß-/Kleinschreibung) und ob schon Mails eingelaufen sind.
- Der Relevanz-Score ist zunächst eine Stichwort-Heuristik. Später lässt er sich
  auf eine KI-Bewertung (KIRA) heben — dann wird die Vorfilterung deutlich feiner.
- Volltext der Artikel wird hier noch nicht geladen; das passiert im nächsten
  Schritt beim Verarbeiten (die Readability-Funktion steckt schon in der rohling-app).
