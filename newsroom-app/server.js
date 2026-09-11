/**
 * WE RIDE Newsroom — lokaler Server
 * Serviert die Oberfläche, liefert die Sichtung und macht die Arbeitsmaske echt:
 * KIRA-Recherche + Generierung von zwei WE-RIDE-Fassungen.
 * Start:  npm start   →   http://localhost:4100
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

/* ---------- .env laden ---------- */
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
app.use(express.json({ limit: '2mb' }));
const PORT = process.env.PORT || process.env.NEWSROOM_PORT || 4100;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }

// Optionaler Team-Passwortschutz — nur aktiv, wenn NEWSROOM_PASSWORD gesetzt ist.
const SITE_PW = process.env.NEWSROOM_PASSWORD || '';
if (SITE_PW) {
  app.use((req, res, next) => {
    const [, b64] = (req.headers.authorization || '').split(' ');
    const [, pw] = Buffer.from(b64 || '', 'base64').toString().split(':');
    if (pw === SITE_PW) return next();
    res.set('WWW-Authenticate', 'Basic realm="WE RIDE Newsroom"').status(401).send('Zugang nur fürs Team.');
  });
}
const RES_MODEL = process.env.KIRA_MODEL || 'claude-haiku-4-5-20251001';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// Generierung über OpenAI (erzwungenes JSON = zuverlässig)
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEN_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/* ---------- Token-/Kostenerfassung ---------- */
const RATES = { // USD pro 1 Mio. Tokens (in/out)
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o': { in: 2.5, out: 10 }
};
const { logUsage, readUsage } = require('./usage');
let sessCost = 0, sessCalls = 0;
function account(model, inTok, outTok, label, editor) {
  const r = RATES[model] || { in: 1, out: 5 };
  const cost = (inTok * r.in + outTok * r.out) / 1e6;
  sessCost += cost; sessCalls++;
  console.log(`  ${label}: in ${inTok} / out ${outTok} Tok · ca. $${cost.toFixed(4)}  |  Session: ${sessCalls} Calls · $${sessCost.toFixed(2)}`);
  logUsage({ kind: label, model, input: inTok, output: outTok, costUsd: cost, editor: editor || '' });
  return { input: inTok, output: outTok, costUsd: cost, sessionCostUsd: sessCost, sessionCalls: sessCalls };
}

/* ---------- WE-RIDE-Profil (aus der rohling-app wiederverwenden) ---------- */
function getWeRide() {
  const candidates = [
    path.join(__dirname, 'we-ride-profile.json'),                       // gebündeltes Einzelprofil (Hosting)
    path.join(__dirname, '..', 'rohling-app', 'data', 'clients.json')   // lokale Entwicklung
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(raw)) return raw.find(c => c.id === 1) || raw[0];
      return raw;
    } catch { /* nächster Kandidat */ }
  }
  return { name: 'WE RIDE', context: '', examples: [], files: [] };
}
function buildStyle(client) {
  let block = `KUNDEN-STILBLOCK\nKunde: ${client.name}\n${client.context || ''}`;
  const ex = (client.examples || []).filter(e => (e.text || '').trim());
  if (ex.length) {
    block += `\n\nSTILVORLAGEN — schreibe im selben Ton wie diese echten WE-RIDE-Artikel. Übernimm Rhythmus, Satzbau und Ansprache, NICHT die Inhalte.\n`;
    ex.forEach((e, i) => { block += `\n<beispiel_${i + 1}>\n${(e.text || '').slice(0, 3500)}\n</beispiel_${i + 1}>\n`; });
  }
  return block;
}

const SYSTEM_PROMPT = `Du bist der Schreib-Motor von WE RIDE NEWS. Arbeite wie ein Redakteur, nicht wie ein Textgenerator: Recherche und Gewichtung vor Formulierung.
OBERSTE REGEL: Substanz vor Stil. Jede Tatsache muss durch das gelieferte Material gedeckt sein. Erfinde nichts (keine Zahlen, Namen, Zitate, Daten). Fehlt etwas, trage es in "offene_fragen" ein. Zitate nur wörtlich aus dem Material.
JOURNALISTISCH: Lede beantwortet die W-Fragen, invertierte Pyramide, jede Aussage attribuiert, Fakt/Analyse/Prognose sauber trennen, Zahlen einordnen (Vorjahr, Prozent, absolut), Pressekodex beachten (keine Vorverurteilung).
MENSCHLICHE HANDSCHRIFT: Satz- und Absatzlänge variieren, sparsam mit Doppelpunkten/Gedankenstrichen, keine immer gleichen Übergänge, keine Mini-Zusammenfassung nach jedem Absatz, keine Buzzwords/Werbefloskeln.
MODUS & LÄNGE (verbindlich): KURZ 250–300 Wörter, NEWS 650–900, ANALYSE 900–1200. Schöpfe die Wortzahl aus — der Body jeder Fassung hat mehrere voll ausgearbeitete Absätze (bei NEWS/ANALYSE mindestens 5) samt aussagekräftiger Zwischenüberschriften, die du als eigene kurze Absätze in den Body schreibst. Nutze das gelieferte Material vollständig aus. Nicht mit Floskeln strecken, aber auch nicht unter die Untergrenze fallen.
AUSGABE: Liefere ZWEI eigenständige Fassungen (A und B, unterschiedlicher Einstieg/Schwerpunkt), je mit genau 3 Takeaways (separat, nicht im Fließtext). Bestimme ein Fokus-Schlüsselwort. Antworte NUR mit gültigem JSON, kein Text drumherum, keine Code-Fences:
{"variante_a":{"titel":"","teaser":"","body":["",""],"takeaways":["","",""]},"variante_b":{"titel":"","teaser":"","body":["",""],"takeaways":["","",""]},"quellen":[{"nr":1,"titel":"","url":""}],"faktencheck":[{"aussage":"","beleg":"","status":"gedeckt"}],"seo":{"fokus_keyword":"","title":"","meta":"","slug":""},"offene_fragen":[""]}`;

/* ---------- Quelle laden (leichtgewichtig) ---------- */
async function fetchArticle(url) {
  if (!url) return '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RohlingBot/0.1)' }, redirect: 'follow' });
    const html = await r.text();
    try {
      const dom = new JSDOM(html, { url });
      const art = new Readability(dom.window.document).parse();
      if (art && art.textContent && art.textContent.trim().length > 200) {
        const head = art.title ? art.title + '\n\n' : '';
        return (head + art.textContent).replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
      }
    } catch { /* Readability fehlgeschlagen -> Fallback */ }
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 8000);
  } catch { return ''; }
}
function extractJson(text) {
  let t = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a !== -1 && b !== -1) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

/* ---------- API: Sichtung ---------- */
app.get('/api/sichtung', (_req, res) => {
  try {
    const p = path.join(DATA_DIR, 'sichtung.json');
    if (!fs.existsSync(p)) return res.json({ items: [], count: 0, total: 0 });
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const all = data.items || [];
    const limit = parseInt(process.env.SICHTUNG_LIMIT || '30', 10);
    let items = all;
    if (limit > 0) items = [...all].sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0)).slice(0, limit);
    res.json({ items, count: items.length, total: all.length });
  } catch (e) { res.status(500).json({ error: e.message, items: [] }); }
});

/* ---------- API: Themen finden (KIRA-Web-Recherche — zwingend mit Quelle) ----------
   Kaskade: (1) aktuelle Web-Treffer → (2) letzte Meldung zum Thema (auch älter)
   → (3) Ingest-Pool als absoluter Fallback → (4) leer ist auch okay. */
function decodeEntities(s) { return (s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function stripTags(s) { return decodeEntities((s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).trim(); }
async function resolveNewsUrl(link) {
  try {
    const r = await fetch(link, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
    if (r.url && !/news\.google\.com/.test(r.url)) return r.url;
    const html = await r.text();
    const m = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)
      || html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)
      || html.match(/<a[^>]+href="(https?:\/\/(?!news\.google)[^"]+)"/i);
    if (m && m[1]) return m[1];
  } catch (e) { /* Timeout/Redirect fehlgeschlagen */ }
  return link;
}
async function googleNews(q, max) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=de&gl=DE&ceid=DE:de`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
  const xml = await r.text();
  const items = []; const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const b = m[1];
    const title = stripTags((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = ((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const pub = ((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    const source = stripTags((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
    if (title && link) items.push({ title: title.replace(/\s+-\s+[^-]+$/, ''), link, pub, source });
  }
  return items;
}
async function bingNews(q, max) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&setlang=de&cc=DE`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
  const xml = await r.text();
  const items = []; const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const b = m[1];
    const title = stripTags((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = ((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const pub = ((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, pub, source: '' });
  }
  return items;
}
function hostOf(u) { const m = (u || '').match(/^https?:\/\/(www\.)?([^\/]+)/); return m ? m[2] : ''; }
app.get('/api/discover', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const queries = q ? [q] : ['Radverkehr Deutschland', 'Fahrrad Verkehrspolitik', 'Radweg Kommune', 'E-Bike Markt', 'Bundesministerium Verkehr Radverkehr'];
  try {
    let picked = [];
    for (const query of queries) {
      let items = [];
      try { items = await bingNews(query, 10); } catch (e) { /* weiter */ }
      if (!items.length) { try { items = await googleNews(query, 10); } catch (e) { /* weiter */ } }
      if (items.length) {
        const now = Date.now();
        const withTs = items.map(it => ({ ...it, ts: Date.parse(it.pub) || 0 }));
        const recent = withTs.filter(it => it.ts && (now - it.ts) < 14 * 864e5);   // aktuell = 14 Tage
        picked.push(...(recent.length ? recent : withTs).slice(0, q ? 8 : 2));       // sonst: die letzten Meldungen
      }
      if (q) break;
    }
    // Google-Redirects auflösen (direkte Links unangetastet lassen) + dedupe
    const resolved = await Promise.all(picked.slice(0, 10).map(async it => ({ ...it, real: /news\.google\.com/.test(it.link) ? await resolveNewsUrl(it.link) : it.link })));
    const seen = new Set(); const out = [];
    for (const it of resolved) {
      const u = it.real || it.link; if (!u || seen.has(u)) continue; seen.add(u);
      const dt = it.ts ? new Date(it.ts).toLocaleDateString('de-DE') : '';
      const src = it.source || hostOf(u);
      out.push({
        title: it.title, url: u, source: src, pub: it.pub || '',
        land: 'Bundesweit', ort: 'Bundesweit', topic: '#Radverkehr', sources: 1, relevance: null,
        reason: (src ? 'Quelle: ' + src : 'Web-Fund') + (dt ? ' · ' + dt : '')
      });
      if (out.length >= (q ? 8 : 6)) break;
    }
    if (out.length) { console.log(`  ✦ Discover "${q || 'WE-RIDE'}": ${out.length} Web-Treffer`); return res.json({ items: out, count: out.length, mode: 'web', query: q || 'WE-RIDE-Themen' }); }
    // Fallback: Ingest-Pool
    const p = path.join(DATA_DIR, 'sichtung.json');
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      const items = (d.items || []).filter(it => it.url).sort((a, b) => (b.relevance || 0) - (a.relevance || 0)).slice(0, 6)
        .map(it => ({ title: it.title, url: it.url, land: it.land || 'Bundesweit', ort: it.ort || 'Bundesweit', topic: it.topic || '#Radverkehr', sources: it.sources || 1, relevance: it.relevance, reason: (it.reason || '') + ' · aus dem Ingest' }));
      if (items.length) { console.log(`  ✦ Discover "${q}": Web leer → ${items.length} aus Ingest`); return res.json({ items, count: items.length, mode: 'ingest', query: q }); }
    }
    console.log(`  ✦ Discover "${q}": nichts gefunden`);
    res.json({ items: [], count: 0, mode: 'leer', query: q });
  } catch (e) { res.status(500).json({ error: e.message, items: [] }); }
});

/* ---------- API: Entwürfe (geteilt, für alle Redakteure sichtbar) ---------- */
const DRAFTS_PATH = path.join(DATA_DIR, 'drafts.json');
function readDrafts() { try { return JSON.parse(fs.readFileSync(DRAFTS_PATH, 'utf8')); } catch { return { items: [] }; } }
function writeDrafts(d) { try { fs.mkdirSync(path.dirname(DRAFTS_PATH), { recursive: true }); fs.writeFileSync(DRAFTS_PATH, JSON.stringify(d, null, 2)); } catch (e) { console.error('  ✗ drafts write:', e.message); } }
app.get('/api/drafts', (_req, res) => { res.json(readDrafts()); });
app.post('/api/drafts', (req, res) => {
  const d = readDrafts(); const b = req.body || {};
  if (!b.draftId) b.draftId = 'd' + Date.now();
  b.when = new Date().toISOString();
  const i = d.items.findIndex(x => x.draftId === b.draftId);
  if (i > -1) d.items[i] = b; else d.items.unshift(b);
  writeDrafts(d);
  console.log(`  ✎ Entwurf gespeichert von ${b.editor || '?'}: "${(b.title || '').slice(0, 50)}" · ${d.items.length} gesamt`);
  res.json({ ok: true, draftId: b.draftId, count: d.items.length });
});
app.delete('/api/drafts/:id', (req, res) => { const d = readDrafts(); d.items = d.items.filter(x => x.draftId !== req.params.id); writeDrafts(d); res.json({ ok: true, count: d.items.length }); });

/* ---------- API: Veröffentlicht (geteilte Historie, dauerhaft) ---------- */
const PUB_PATH = path.join(DATA_DIR, 'published.json');
function readPub() { try { return JSON.parse(fs.readFileSync(PUB_PATH, 'utf8')); } catch { return { items: [] }; } }
function writePub(d) { try { fs.mkdirSync(path.dirname(PUB_PATH), { recursive: true }); fs.writeFileSync(PUB_PATH, JSON.stringify(d, null, 2)); } catch (e) { console.error('  ✗ published write:', e.message); } }
app.get('/api/published', (_req, res) => { res.json(readPub()); });
app.post('/api/published', (req, res) => {
  const d = readPub(); const b = req.body || {};
  if (!b.pubId) b.pubId = 'p' + Date.now();
  b.when = new Date().toISOString();
  const i = d.items.findIndex(x => x.pubId === b.pubId);
  if (i > -1) d.items[i] = b; else d.items.unshift(b);
  writePub(d);
  console.log(`  ✓ Veröffentlicht von ${b.editor || '?'}: "${(b.title || '').slice(0, 50)}" · ${d.items.length} gesamt`);
  res.json({ ok: true, pubId: b.pubId, count: d.items.length });
});

/* ---------- API: KIRA-Recherche ---------- */
app.post('/api/research', async (req, res) => {
  try {
    const { title, url } = req.body || {};
    const src = await fetchArticle(url);
    const msg = await anthropic.messages.create({
      model: RES_MODEL, max_tokens: 1200,
      system: `Du bist KIRA, Rechercheassistentin für WE RIDE NEWS (Fahrrad, Mobilität, Verkehrspolitik, Branche). Analysiere die Quelle zu einer Meldung und erfinde nichts. Liegt kein Volltext vor, arbeite mit dem Titel und markiere Unsicherheiten. Trage bei jeder Quelle den zugehörigen Link ein, wenn er dir vorliegt (die gelieferte URL gehört zur Primärquelle); erfinde keine Links, lass "url" sonst leer. Gib zu jeder Quelle einen kurzen Hinweis (2–6 Wörter), was das für eine Quelle ist, z. B. "Webseite der Stadt Dortmund", "Pressestelle des BMV", "Fachmagazin Radverkehr". Antworte NUR als JSON: {"sources":[{"nm":"","cr":"Primär|Hoch|Mittel","url":"","hinweis":""}],"facts":[{"t":"","status":"gedeckt|unsicher|widerspruch","src":""}],"angles":["","",""],"offen":""}`,
      messages: [{ role: 'user', content: `TITEL: ${title}\nURL: ${url || '-'}\n\nQUELLENTEXT:\n${src || '(kein Volltext verfügbar)'}` }]
    });
    const u = msg.usage || {}; account(RES_MODEL, u.input_tokens || 0, u.output_tokens || 0, 'Recherche', req.body && req.body.editor);
    const raw = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json(extractJson(raw));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- API: Frag KIRA (freie Rückfrage) ---------- */
app.post('/api/ask', async (req, res) => {
  try {
    const { title, url, question } = req.body || {};
    if (!(question || '').trim()) return res.status(400).json({ error: 'Keine Frage' });
    const src = await fetchArticle(url);
    const msg = await anthropic.messages.create({
      model: RES_MODEL, max_tokens: 800,
      system: `Du bist KIRA, Rechercheassistentin für WE RIDE NEWS (Fahrrad, Mobilität, Verkehrspolitik, Branche). Beantworte die Redakteursfrage knapp, sachlich, auf Deutsch. Stütze dich auf den gelieferten Quellentext und erfinde nichts. Steht die Antwort nicht im Material, sag das klar und nenne, wo man es prüfen könnte (z. B. Primärquelle, Ministerium, Kommune). Kein JSON, nur die Antwort in 2–5 Sätzen.`,
      messages: [{ role: 'user', content: `MELDUNG: ${title}\nQUELLE (${url || '-'}):\n${src || '(kein Volltext verfügbar)'}\n\nFRAGE DES REDAKTEURS: ${question}` }]
    });
    const u = msg.usage || {}; account(RES_MODEL, u.input_tokens || 0, u.output_tokens || 0, 'KIRA-Frage', req.body && req.body.editor);
    const answer = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.json({ answer, hatQuelle: !!src });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- API: Generierung zwei Fassungen (OpenAI, erzwungenes JSON) ---------- */
app.post('/api/generate', async (req, res) => {
  try {
    if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY fehlt in .env' });
    const { title, url, ort, topic, modus, angle, notes } = req.body || {};
    const src = await fetchArticle(url);
    const client = getWeRide();
    const user = `AUFTRAG
Textmodus: ${modus || 'NEWS'}
Region: ${ort || '-'} · Thema: ${topic || '-'}
Blickwinkel: ${angle || '(offen — wähle den stärksten)'}

THEMA / TITEL: ${title}

QUELLE (${url || 'kein Link'}):
${src || '(kein Volltext verfügbar — schreibe nur, was belegbar ist, und markiere fehlende Belege in offene_fragen)'}

NOTIZEN: ${notes || '(keine)'}`;
    console.log(`→ /api/generate: "${(title || '').slice(0, 50)}" · Modell ${GEN_MODEL} · Quelle ${src ? src.length + ' Zeichen' : 'kein Volltext'}`);
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      body: JSON.stringify({
        model: GEN_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\n' + buildStyle(client) },
          { role: 'user', content: user }
        ],
        temperature: 0.3,
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      })
    });
    const data = await r.json();
    if (data.error) { console.error('  ✗ OPENAI-FEHLER:', data.error.message); return res.status(502).json({ error: data.error.message }); }
    const content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    let json; try { json = JSON.parse(content); } catch { console.error('  JSON-Fehler trotz json_object. Anfang:', (content || '').slice(0, 300)); return res.status(502).json({ error: 'Antwort war kein gültiges JSON.' }); }
    const u = data.usage || {};
    const meta = account(GEN_MODEL, u.prompt_tokens || 0, u.completion_tokens || 0, 'Generierung', req.body && req.body.editor);
    json._meta = meta;
    res.json(json);
  } catch (e) { console.error('  ✗ GENERATE-FEHLER:', e.message); res.status(500).json({ error: e.message }); }
});

/* ---------- Ingest (im selben Prozess, teilt sich DATA_DIR) ---------- */
let ingestRunning = false, ingestLast = null;
function triggerIngest(reason) {
  if (ingestRunning) return false;
  ingestRunning = true;
  console.log(`  ⏱  Starte Ingest (${reason}) …`);
  const { fork } = require('child_process');
  const child = fork(path.join(__dirname, 'ingest.js'), [], { env: process.env });
  child.on('exit', c => { ingestRunning = false; ingestLast = { at: new Date().toISOString(), code: c }; console.log(`  ⏱  Ingest beendet (Code ${c}).`); });
  child.on('error', e => { ingestRunning = false; console.error('  ✗ Ingest-Fehler:', e.message); });
  return true;
}
// Auf Abruf (Aktualisieren-Button in der Oberfläche)
app.post('/api/ingest', (_req, res) => { const started = triggerIngest('manuell'); res.json({ started, running: ingestRunning, already: !started }); });
app.get('/api/ingest/status', (_req, res) => res.json({ running: ingestRunning, last: ingestLast }));
// Täglich zur festen Uhrzeit
const INGEST_AT = process.env.INGEST_AT || '';   // "03:30" (Serverzeit = UTC auf Render)
if (/^\d{1,2}:\d{2}$/.test(INGEST_AT)) {
  const [hh, mm] = INGEST_AT.split(':').map(Number);
  (function schedule() {
    const now = new Date(); const next = new Date(now);
    next.setHours(hh, mm, 0, 0); if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next - now;
    console.log(`  ⏱  Nächster Auto-Ingest: ${next.toISOString()} (in ${Math.round(ms / 60000)} min)`);
    setTimeout(() => { triggerIngest('Zeitplan'); schedule(); }, ms);
  })();
}
// Zusätzlich alle N Minuten (für tagsüber; inkrementell = günstig)
const EVERY = parseInt(process.env.INGEST_EVERY_MIN || '0', 10);
if (EVERY > 0) { console.log(`  ⏱  Auto-Ingest alle ${EVERY} min aktiv.`); setInterval(() => triggerIngest('Intervall'), EVERY * 60000); }
// Erst-Befüllung nach frischem Deploy
if (process.env.INGEST_ON_BOOT === 'true' && !fs.existsSync(path.join(DATA_DIR, 'sichtung.json'))) triggerIngest('Boot');

/* ---------- Admin: Kosten-/Token-/Call-Tracking ---------- */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
function requireAdmin(req, res) {
  const t = req.query.token || req.headers['x-admin-token'] || '';
  if (!ADMIN_TOKEN || t !== ADMIN_TOKEN) { res.status(403).json({ error: 'Kein Admin-Zugang. Token fehlt oder falsch.' }); return false; }
  return true;
}
app.get('/api/admin/usage', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = readUsage();
  const rate = parseFloat(process.env.USD_EUR || '0.92');
  const sum = { calls: 0, input: 0, output: 0, cost: 0 };
  const byKind = {}, byModel = {}, byDay = {}, byEditor = {};
  const todayKey = new Date().toISOString().slice(0, 10); let todayCost = 0, todayCalls = 0;
  const bump = (o, k, r) => { o[k] = o[k] || { calls: 0, cost: 0, input: 0, output: 0 }; o[k].calls++; o[k].cost += r.costUsd || 0; o[k].input += r.input || 0; o[k].output += r.output || 0; };
  for (const r of rows) {
    sum.calls++; sum.input += r.input || 0; sum.output += r.output || 0; sum.cost += r.costUsd || 0;
    bump(byKind, r.kind || '?', r); bump(byModel, r.model || '?', r); bump(byEditor, r.editor || '—', r);
    const d = (r.ts || '').slice(0, 10); if (d) { bump(byDay, d, r); if (d === todayKey) { todayCost += r.costUsd || 0; todayCalls++; } }
  }
  res.json({ rate, sum, today: { cost: todayCost, calls: todayCalls }, byKind, byModel, byDay, byEditor });
});
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

/* ---------- Oberfläche ---------- */
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'newsroom-prototyp.html')));

app.listen(PORT, () => {
  console.log(`\n✅ WE RIDE Newsroom läuft:  http://localhost:${PORT}`);
  console.log(`   Sichtung aus data/sichtung.json · Generierung: ${GEN_MODEL} · Recherche: ${RES_MODEL}\n`);
});
