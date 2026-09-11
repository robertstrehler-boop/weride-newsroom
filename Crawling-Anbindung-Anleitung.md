# Crawling-Anbindung — Schritt für Schritt

Ziel: Die Google-Alert-Meldungen, die per Gmail reinkommen, automatisch in die
**Sichtung** des Newsrooms bringen — vorgefiltert, entdoppelt, mit Relevanz-Score.
Eure bestehende Excel-Pipeline bleibt dabei unangetastet; der Newsroom hängt
parallel am selben Postfach.

## Der Fluss auf einen Blick
```
Google Alerts  →  Gmail-Label "Alerts"  →  Newsroom-Ingest
   (E-Mails)         (Filter sortiert)        ↓ liest, parst, entdoppelt
                                              ↓ lädt Volltext (Readability)
                                              ↓ Vorfilter: Relevanz-Score
                                          →  Sichtung  →  (Redakteur)  →  Newsroom-Grid
```

---

## Teil A — Gmail-Label (bei dir schon erledigt)

Du hast bereits ein Label, in das alle Meldungen einlaufen: **„Presse"**.
Damit ist dieser Teil erledigt — wir hängen den Ingest direkt an dieses Label.
Kein neuer Filter nötig.

> Hinweis: Im „Presse"-Label liegen vermutlich zweierlei Mails — echte
> **Google-Alert-Mails** (mit mehreren Treffern pro Mail) und **direkte
> Presse-/PR-Mails**. Der Ingest behandelt beide: Alert-Mails werden in ihre
> einzelnen Treffer zerlegt; eine direkte Presse-Mail wird als ein Eintrag
> übernommen (Betreff = Titel, Absender = Quelle, Text = Inhalt). Der Vorfilter
> sortiert PR-lastiges anhand des Relevanz-Scores nach unten.

---

## Teil B — Zugang für den Newsroom (eine der zwei Optionen)

### Option 1 — IMAP + App-Passwort (einfachster Weg)
**1.** Im Gmail-Konto die **Bestätigung in zwei Schritten** aktivieren
(myaccount.google.com → Sicherheit).
**2.** Danach **App-Passwörter** öffnen → neues App-Passwort „Newsroom" erstellen.
Google zeigt einen 16-stelligen Code — den einmal kopieren.
**3.** Diesen Code trägst du später in die Newsroom-Konfiguration ein
(zusammen mit der E-Mail-Adresse). Der Newsroom verbindet sich dann per IMAP
(`imap.gmail.com`, Port 993, nur Lesezugriff auf das Label `Alerts`).

> Vorteil: schnell eingerichtet. Nachteil: App-Passwort ist ein Dauerzugang,
> also gut aufbewahren und nur für dieses Alert-Konto nutzen.

### Option 2 — Gmail-API + OAuth (sauberer, etwas mehr Setup)
**1.** In der Google Cloud Console ein Projekt anlegen (console.cloud.google.com).
**2.** **Gmail API aktivieren**.
**3.** **OAuth-Zustimmungsbildschirm** einrichten (intern/Testnutzer = dein Konto).
**4.** **Anmeldedaten → OAuth-Client-ID** (Typ „Desktop") erstellen, JSON herunterladen.
**5.** Scope auf **`gmail.readonly`** beschränken. Einmalig autorisieren; der Newsroom
speichert danach ein Token und liest nur noch mit.

> Vorteil: feingranularer, kein Dauer-Passwort, jederzeit widerrufbar.
> Empfehlung: Für den Anfang Option 1, für den Dauerbetrieb später Option 2.

---

## Teil C — Was der Newsroom-Ingest automatisch tut
Sobald der Zugang steht, läuft der Ingest als Hintergrunddienst:
1. **Pollen:** alle paar Minuten das Label `Alerts` auf neue Mails prüfen.
2. **Parsen:** jede Alert-Mail enthält pro Treffer Titel, Link, Snippet, Quelle — die werden extrahiert.
3. **Entdoppeln/Clustern:** dieselbe Story über mehrere Schlagworte wird zu einem Eintrag zusammengefasst.
4. **Volltext laden:** der verlinkte Artikel wird ausgelesen (Readability), damit später faktenbasiert geschrieben wird.
5. **Vorfilter:** KIRA vergibt einen Relevanz-Score (Thema, Quellenlage, Neuheit) und tagt Region/Thema.
6. **Sichtung füllen:** die bewertete Shortlist erscheint im Newsroom unter „Sichtung". Übernimmt der Redakteur, wandert die Meldung ins Grid.

---

## Teil D — Aufräum-Regeln (Lebensdauer der Meldungen)

**48-Stunden-Regel.** Jede Meldung bekommt beim Eingang einen Zeitstempel.
Wird sie nicht verarbeitet, fliegt sie nach **48 Stunden** automatisch aus Sichtung
und Grid. So verstopft nichts Altes den Newsroom.

**Wochenend-Logik.** Die 48-Stunden-Uhr zählt nur **Werktage**. Eine Meldung von
**Freitag** überlebt also das Wochenende und liegt **Montag** noch da — sichtbar
markiert mit dem Hinweis **„Wochenende – letzte Chance"**. Wird sie Montag nicht
verarbeitet, läuft sie im Laufe des Tages ab und fliegt raus.

**Anzeige.** Meldungen kurz vor Ablauf tragen im Grid ein Label
(„Läuft heute ab" bzw. „Wochenende – letzte Chance"), damit der Redakteur sie
bewusst noch mitnehmen oder gehen lassen kann. Verarbeitete Meldungen sind von der
Regel ausgenommen — sie sind ja erledigt.

---

## Teil E — Was ich von dir brauche, um es scharf zu schalten
1. Die **E-Mail-Adresse** des Postfachs mit dem „Presse"-Label.
2. Der **Zugang**: entweder das **App-Passwort** (Option 1) oder die **OAuth-Client-JSON** (Option 2).

Das war's — das Label „Presse" steht ja schon.
Sobald der Zugang da ist, baue ich den Ingest so, dass sich die Sichtung mit euren
echten Meldungen füllt und die 48h-/Wochenend-Regel automatisch greift.

> Sicherheit: Der Newsroom liest ausschließlich das Label „Presse", nichts anderes
> im Postfach. Zugangsdaten bleiben lokal in der Newsroom-Konfiguration.
