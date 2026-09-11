# Rohling — lokaler News-Generator

Ein Ghostwriter für deine Redaktion, der komplett auf deinem Rechner läuft.
Du gibst Links oder ein Thema ein, wählst den Kunden — Rohling schreibt daraus einen
Artikel im Stil dieses Kunden, mit Quellen und Faktencheck.

---

## Einmalig einrichten (ca. 5 Minuten)

### 1. Node.js installieren
Falls noch nicht vorhanden: [nodejs.org](https://nodejs.org) → Version „LTS" laden und installieren.
Prüfen im Terminal:
```
node -v
```
(sollte eine Zahl ≥ 18 zeigen)

### 2. In den App-Ordner wechseln
```
cd "Pfad/zu/rohling-app"
```
Tipp: `cd ` (mit Leerzeichen) tippen und den Ordner ins Terminal ziehen.

### 3. Abhängigkeiten installieren
```
npm install
```

### 4. API-Key hinterlegen
Hol dir einen Schlüssel unter [console.anthropic.com](https://console.anthropic.com) → **API Keys**.
Dann die Datei `.env.example` zu `.env` kopieren und den Key eintragen:
```
cp .env.example .env
```
`.env` öffnen und `sk-ant-…` durch deinen echten Key ersetzen.

---

## Starten
```
npm start
```
Dann im Browser öffnen: **http://localhost:4000**

Zum Beenden im Terminal `Strg + C`.

---

## Bedienung

1. **Kunde wählen** im Composer (WE RIDE ist als Beispiel angelegt).
2. **Aus Quellen:** Links einfügen (einer pro Zeile) — werden automatisch ausgelesen.
   Zusätzlich oder alternativ Text/Notizen einfügen.
3. **Aus Idee:** Thema + Blickwinkel eingeben.
4. **✦ Erstellen** → echter Artikel mit Überschrift-Varianten, Teaser, Quellen und Faktencheck.
5. **🔍 Prompt-Vorschau** zeigt vorab, was genau ans Modell geht.

Kundenprofile (Perspektive, Dokumente, Stilvorlagen) werden lokal in
`data/clients.json` gespeichert und bleiben erhalten.

---

## Nach einem Update

Wenn neue Funktionen dazukommen (z. B. Dokument-Auslesen), einmal die Pakete nachziehen und neu starten:
```
npm install
npm start
```

## Neu in dieser Version

- **Vier Farbschemata** (Aureolin, Cherry, Violet, Newspaper) — unten links in der Seitenleiste umschaltbar, Auswahl bleibt gespeichert.
- **Onboarding** beim ersten Start (Theme wählen).
- **Dokumente werden echt ausgelesen** (PDF, Word, TXT) und fließen in den Kontext ein — mit Anzeige der erkannten Wortzahl.
- **„Prompt entwickeln"** — aus ein paar Stichworten baut Rohling ein sauberes Stilprofil für den Kunden.
- **Zwei Textvarianten** pro Auftrag, je einzeln als unformatierter Text herunterladbar.

## Gut zu wissen

- **Stilvorlagen** sind der stärkste Qualitätshebel: pro Kunde 2–3 echte Artikel als
  Volltext einfügen („＋ Beispielartikel"). Das Modell übernimmt daraus den Ton.
- **Idee-Modus** recherchiert (noch) nicht live im Web — er entwirft und markiert
  offene Belege. Live-Websuche lässt sich später über einen Such-API-Key ergänzen.
- **Dokument-Upload** vermerkt aktuell nur den Dateinamen. Automatisches Auslesen von
  PDF/Word ist ein sinnvoller nächster Ausbauschritt.
- **Modell:** Standard ist `claude-opus-4-8` (Artikelqualität). Falls die API den Namen
  ablehnt, in `.env` `ROHLING_MODEL` auf ein aktuelles Modell setzen.

---

## Ordnerstruktur
```
rohling-app/
├─ server.js            Backend: Prompt-Assembly, Modell-Aufruf, Link-Auslesen
├─ package.json         Abhängigkeiten
├─ .env.example         Vorlage für den API-Key
├─ data/clients.json    deine Kundenprofile (lokal)
└─ public/index.html    die Oberfläche
```
