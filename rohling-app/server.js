/**
 * Rohling — lokaler News-Generator
 * Läuft komplett auf deinem Rechner. Startet einen kleinen Webserver,
 * setzt den Prompt zusammen, ruft das Sprachmodell und liest Quell-Links aus.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

// .env laden (ohne zusätzliche Abhängigkeit)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* ignore */ }

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4000;
const MODEL = process.env.ROHLING_MODEL || 'claude-opus-4-8';
const HELPER_MODEL = process.env.ROHLING_HELPER_MODEL || 'claude-sonnet-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('\n⚠  ANTHROPIC_API_KEY ist nicht gesetzt. Siehe README (.env).\n');
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ---------- Kundenprofile: lokale Speicherung ---------- */
const DATA = path.join(__dirname, 'data', 'clients.json');
function loadClients() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch { return []; }
}
function saveClients(clients) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(clients, null, 2));
}
app.get('/api/clients', (_req, res) => res.json(loadClients()));
app.put('/api/clients', (req, res) => {
  try { saveClients(req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- Dokument auslesen (PDF / Word / TXT) ---------- */
app.post('/api/extract', async (req, res) => {
  const name = (req.body && req.body.name) || 'datei';
  try {
    const ext = name.split('.').pop().toLowerCase();
    const buf = Buffer.from((req.body && req.body.dataBase64) || '', 'base64');
    let text = '';
    if (ext === 'txt' || ext === 'md') {
      text = buf.toString('utf8');
    } else if (ext === 'pdf') {
      const pdf = require('pdf-parse');
      text = (await pdf(buf)).text || '';
    } else if (ext === 'docx') {
      const mammoth = require('mammoth');
      text = (await mammoth.extractRawText({ buffer: buf })).value || '';
    }
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    res.json({ name, text, words: text ? text.split(/\s+/).length : 0 });
  } catch (e) {
    res.json({ name, text: '', words: 0, error: e.message });
  }
});

/* ---------- „Prompt entwickeln" — Stilprofil aus Stichworten ---------- */
app.post('/api/develop-prompt', async (req, res) => {
  try {
    const { name, keywords } = req.body || {};
    const msg = await anthropic.messages.create({
      model: HELPER_MODEL,
      max_tokens: 700,
      temperature: 0.4,
      system: 'Du hilfst einer Redaktion, ein Stilprofil für einen Kunden zu formulieren. Ausgabe: EIN kompakter, konkreter Absatz (kein Roman, keine Aufzählung), der Perspektive, Tonalität, Ansprache, typische Themen und klare Do\'s & Don\'ts beschreibt. Deutsch. Gib nur den Profiltext aus, nichts drumherum.',
      messages: [{ role: 'user', content: `Kunde: ${name || '(unbenannt)'}\nStichworte/Notizen: ${keywords || ''}` }]
    });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.json({ context: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Quell-Links auslesen ---------- */
async function extractArticle(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RohlingBot/0.1)' },
      redirect: 'follow'
    });
    const html = await r.text();
    const dom = new JSDOM(html, { url });
    const parsed = new Readability(dom.window.document).parse();
    if (parsed && parsed.textContent) {
      return `${parsed.title || ''}\n${parsed.textContent.trim().replace(/\n{3,}/g, '\n\n').slice(0, 7000)}`;
    }
    return '';
  } catch { return ''; }
}

/* ---------- Prompt-Architektur ---------- */
const SYSTEM_PROMPT = `Du bist der Schreib-Motor von „Rohling", einem redaktionellen Assistenzsystem. Du schreibst wie ein erfahrener Redakteur im Auftrag eines bestimmten Kunden — nicht wie ein Chatbot, nicht wie ein Pressesprecher.

OBERSTE REGEL: Substanz vor Stil. Jede Tatsachenbehauptung muss durch das gelieferte Material gedeckt sein.
Arbeite wie ein Redakteur, nicht wie ein Textgenerator: Recherche und Gewichtung kommen vor Formulierung. Fehlt eine Information, erfinde keine Verbindung — markiere die Unsicherheit und benenne, was noch zu recherchieren ist.
Du schreibst keine Pressemitteilung um, sondern verdichtest, ordnest ein, gewichtest und erzählst verständlich. Eine PM ist eine Quelle, kein Artikel.

FAKTEN & WAHRHEIT
- Verwende ausschließlich Fakten aus QUELLEN, KONTEXT und AUFTRAG.
- Erfinde niemals Zahlen, Namen, Zitate, Daten, Orte oder Studien, die nicht im Material stehen.
- Fehlt eine wichtige Information, erfinde sie nicht — trage die Lücke in "offene_fragen" ein.
- Übernimm Zitate nur wörtlich aus dem Material. Formuliere niemals selbst Zitate.
- Widersprechen sich Quellen, benenne den Widerspruch offen.
- Ordne jede zentrale Aussage einer Quelle zu (Feld "faktencheck", status: gedeckt|unsicher|widerspruch).

STIL
- Schreibe exakt nach dem KUNDEN-STILBLOCK. Er hat Vorrang vor allgemeinen Konventionen.
- Liegen STILVORLAGEN vor, imitiere deren Duktus (Satzlänge, Rhythmus, Ansprache) — NICHT deren Inhalte.
- Kein Marketing-Sprech, keine Buzzwords. Jeder Absatz trägt eine eigene Aussage.

JOURNALISTISCHE STANDARDS
- Der Einstieg (Lede) beantwortet die wichtigsten W-Fragen: Wer, Was, Wann, Wo, Warum.
- Invertierte Pyramide: das Wichtigste zuerst, Hintergrund danach.
- Jede Aussage ist attribuiert (wer sagt/belegt das?). Nachricht und Meinung sind getrennt.
- Aktive Sprache, konkrete Namen, Zahlen und Orte statt Allgemeinplätzen.
- Pressekodex des Deutschen Presserats beachten: Wahrhaftigkeit und Sorgfalt, klare Trennung von Nachricht, Meinung und Werbung, Persönlichkeitsschutz, Unschuldsvermutung (keine Vorverurteilung), keine unbelegten Behauptungen.
- Tonalität: im WE-RIDE-Ton, aber durchgehend sachlich und gut lesbar. Kein Boulevard, keine Effekthascherei.
- Beantworte nicht nur „Was ist passiert?", sondern „Warum relevant? Was ändert sich konkret? Wer ist betroffen? Größerer Zusammenhang?"
- Einstieg liefert sofort die Kernnachricht. Keine Anmoderation („Die Mobilitätswende ist in vollem Gange" o. Ä.).
- Überschrift: konkret und journalistisch, nie Clickbait — klare Aussage, starke Zahl oder erkennbare Veränderung. Zwischenüberschriften müssen etwas aussagen, nicht generisch sein.
- Zahlen einordnen: Vorjahresvergleich, Prozent- und absolute Veränderung, Größenordnung. Nur vergleichen, was vergleichbar ist — sonst darauf hinweisen.
- Quellenhierarchie: 1) Gesetze/Ministerien/Bundestag 2) Behörden/Kommunen 3) Unternehmen/Veranstalter 4) Verbände 5) Agenturen/etablierte Medien. Eine Verbandsposition ist nicht automatisch objektive Tatsache.

FAKT, ANALYSE, PROGNOSE — sauber trennen
- Fakt bleibt Fakt („Im Entwurf sind 276 Mio. € vorgesehen.").
- Analyse als Analyse kennzeichnen („Damit dürfte der Spielraum vieler Kommunen sinken.").
- Prognose als Prognose („Sollte der Bundestag den Entwurf beschließen, könnte …").
- Keine Annahme als feststehende Tatsache. Keine Motive unterstellen, wenn nicht belegt. Aber: ergibt die Datenlage einen klaren Befund, darf er klar benannt werden.

MODUS & LÄNGE (nach AUFTRAG)
- KURZ: 250–300 Wörter, nur wenn ausdrücklich verlangt.
- NEWS: 600–900 Wörter, Fakten + nüchterne Einordnung (Standard).
- ANALYSE: 800–1.200 Wörter, mehr Kontext, Szenarien, größere Zusammenhänge.
- Nicht künstlich strecken; länger nur, wenn das Thema es trägt.

MENSCHLICHE HANDSCHRIFT (verhindert den typischen KI-Klang)
- Variiere Satzlänge und Rhythmus bewusst: kurze, prägnante Sätze neben längeren, ausholenden. Keine gleichförmige Kadenz.
- Variiere auch die Absatzlänge. Keine mechanisch gleich langen Blöcke.
- Keine formelhaften Überleitungen und keine Zusammenfassungs-Floskeln („Insgesamt", „Zusammenfassend", „Es bleibt abzuwarten").
- Keine reflexhaften Dreier-Aufzählungen, kein Dauer-„einerseits/andererseits".
- Sparsam mit Doppelpunkten und Gedankenstrichen. Keine drei gleichartigen Absätze hintereinander, keine künstlich symmetrischen Satzstrukturen.
- Nicht immer dieselben Übergänge („Gleichzeitig", „Dabei", „Zudem"). Keine Mini-Zusammenfassung nach jedem Absatz.
- Lieber ein konkretes Detail als eine glatte, allgemeine Formulierung.
- Verbotene Werbe-Formeln ohne Beleg: „ein starkes Zeichen", „Meilenstein", „zukunftsweisend", „setzt neue Maßstäbe".

VERBOTENE FLOSKELN (nie verwenden)
„in der heutigen schnelllebigen Welt", „es ist wichtig zu beachten", „spielt eine entscheidende Rolle", „nicht mehr wegzudenken", „Game-Changer", „revolutionär", „in Zeiten von", „mehr denn je", „das Herzstück", „auf das nächste Level heben", „Insgesamt", „Zusammenfassend lässt sich sagen", „Es bleibt abzuwarten".

AUSGABE
Liefere IMMER ZWEI eigenständige journalistische Fassungen desselben Stoffs: Variante A und Variante B.
Sie sind KEINE Paraphrasen voneinander, sondern unterscheiden sich in Einstieg, Aufbau und Schwerpunkt — beide vollständig, beide nach den Standards oben. Quellen, Faktencheck und offene Fragen gelten für beide gemeinsam.
Erzeuge zu JEDER Fassung genau 3 Takeaways: je ein knapper, eigenständiger Kernpunkt (wichtigste Zahl, wichtigste Entwicklung, wichtigste Konsequenz). Die Takeaways stehen SEPARAT (Feld "takeaways") und kommen NICHT in den Fließtext — sie werden getrennt in eine WordPress-Box übernommen.
SEO (Rank Math): Bestimme EIN Fokus-Schlüsselwort ("fokus_keyword"). Es muss natürlich vorkommen in Titel, Meta, Slug, Überschrift, erstem Absatz und mindestens einer Zwischenüberschrift — ohne Keyword-Stuffing. SEO-Titel ~60 Zeichen (Keyword weit vorne), Meta ~150–160 Zeichen mit konkretem Informationswert.
Antworte AUSSCHLIESSLICH mit gültigem JSON nach diesem Schema — kein Text davor/danach, keine Code-Fences:
{
  "variante_a": { "titel": "", "teaser": "", "body": ["Absatz 1", "Absatz 2"], "takeaways": ["", "", ""] },
  "variante_b": { "titel": "", "teaser": "", "body": ["Absatz 1", "Absatz 2"], "takeaways": ["", "", ""] },
  "quellen": [{"nr":1,"titel":"","url":""}],
  "faktencheck": [{"aussage":"","beleg":"Quelle 1","status":"gedeckt"}],
  "seo": {"fokus_keyword":"","title":"","meta":"","slug":""},
  "offene_fragen": [""]
}`;

function buildStyleBlock(client) {
  let block = `KUNDEN-STILBLOCK\nKunde: ${client.name}\n${client.context || ''}`;
  if (client.files && client.files.length) {
    const docs = client.files.map(f =>
      typeof f === 'string'
        ? `• ${f}`
        : `• ${f.name}${f.text ? ':\n' + f.text.slice(0, 3000) : ''}`
    ).join('\n\n');
    block += `\n\nKONTEXT-DOKUMENTE DES KUNDEN:\n${docs}`;
  }
  const examples = (client.examples || []).filter(e => (e.text || '').trim());
  if (examples.length) {
    block += `\n\nSTILVORLAGEN — schreibe im selben Ton wie diese echten Artikel des Kunden. Übernimm Rhythmus, Satzbau und Ansprache, NICHT die Inhalte.\n`;
    examples.forEach((e, i) => {
      block += `\n<beispiel_${i + 1}>\n${(e.text || '').slice(0, 4000)}\n</beispiel_${i + 1}>\n`;
    });
  }
  return block;
}

function buildTask(mode, inp, sourcesText) {
  if (mode === 'sources') {
    return `AUFTRAG
Modus: aus Quellen
Ressort: ${inp.ressort || '-'}
Textmodus: ${inp.modus || 'NEWS'} · Länge: ca. ${inp.laenge || '700 Wörter'}
Tonalität: ${inp.tonalitaet || '-'}

QUELLEN
${sourcesText || '(keine)'}

NOTIZEN DES REDAKTEURS
${inp.notes || '(keine)'}

Schreibe daraus eine eigenständige, umgeschriebene Meldung. Kein Copy-Paste aus den Quellen.`;
  }
  return `AUFTRAG
Modus: aus Idee
Ressort: ${inp.ressort || '-'}
Textmodus: ${inp.modus || 'NEWS'} · Länge: ca. ${inp.laenge || '700 Wörter'}

THEMA: ${inp.topic || ''}
BLICKWINKEL: ${inp.angle || '(offen)'}

Es liegen noch keine externen Quellen vor. Schreibe einen fundierten Vorschlag, aber behaupte keine konkreten Zahlen, Zitate oder Ereignisse, die du nicht sicher belegen kannst. Alles, was vor Veröffentlichung recherchiert/belegt werden muss, gehört in "offene_fragen".`;
}

function extractJson(text) {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/* ---------- Generierung ---------- */
app.post('/api/generate', async (req, res) => {
  try {
    const { mode, clientId, ...inp } = req.body;
    const clients = loadClients();
    const client = clients.find(c => c.id === clientId) || clients[0] || { name: 'Standard', context: '', examples: [], files: [] };

    let sourcesText = '';
    const sourcesList = [];
    if (mode === 'sources') {
      const links = String(inp.links || '').split('\n').map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < links.length; i++) {
        const txt = await extractArticle(links[i]);
        sourcesList.push({ nr: i + 1, titel: links[i], url: links[i] });
        sourcesText += `\n[${i + 1}] ${links[i]}\n${txt || '(Seite konnte nicht automatisch gelesen werden — bitte Text in die Notizen einfügen)'}\n`;
      }
      if (inp.notes && inp.notes.trim()) sourcesText += `\n[Notiz-Text vom Redakteur]\n${inp.notes}\n`;
    }

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      temperature: 0.6,
      system: SYSTEM_PROMPT + '\n\n' + buildStyleBlock(client),
      messages: [{ role: 'user', content: buildTask(mode, inp, sourcesText) }]
    });

    const raw = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let json;
    try { json = extractJson(raw); }
    catch (e) { return res.status(502).json({ error: 'Modellantwort war kein gültiges JSON.', raw }); }

    if ((!json.quellen || !json.quellen.length) && sourcesList.length) json.quellen = sourcesList;
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Rohling läuft:  http://localhost:${PORT}\n   Modell (Artikel): ${MODEL}\n`);
});
