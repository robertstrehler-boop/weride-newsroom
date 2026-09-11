/**
 * WE RIDE Newsroom — Gmail-Ingest
 * Liest das Label "Presse" (Google Alerts + direkte Presse-Mails), zerlegt,
 * entdoppelt, tagt Region/Thema, vergibt einen Relevanz-Score und schreibt
 * das Ergebnis nach data/sichtung.json — die Grundlage für die Sichtung.
 *
 * Start:  node ingest.js
 * Dein App-Passwort bleibt lokal in .env. Es wird nichts nach außen gesendet.
 */
const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');

/* ---------- .env laden (ohne Zusatzpaket) ---------- */
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* ignore */ }

const USER = process.env.GMAIL_USER;
const PASS = process.env.GMAIL_APP_PASSWORD;
const LABEL = process.env.GMAIL_LABEL || 'Presse';
const LOOKBACK_HOURS = parseInt(process.env.LOOKBACK_HOURS || '48', 10);

if (!USER || !PASS) {
  console.error('\n⚠  GMAIL_USER oder GMAIL_APP_PASSWORD fehlt. Siehe .env.example.\n');
  process.exit(1);
}

/* ---------- Themen-/Regionsprofil WE RIDE ---------- */
const BIKE = ['fahrrad','rad','e-bike','ebike','pedelec','lastenrad','cargobike','radweg','radverkehr','mobilität','velo','bike'];
// Signale für echte Nachrichten (nach oben)
const NEWS_POS = ['haushalt','minister','bundestag','gesetz','förder','etat','beschluss','kommune','stadtrat','landkreis','stadt','studie','umfrage','unfall','verletzt','getötet','verbot','klage','urteil','gericht','adfc','ziv','zukunft fahrrad','verkehrswende','radentscheid','radschnellweg','fahrradstraße','infrastruktur','tempo','sicherheit','strategie','brücke','eröffn','sperrung','protest','demo','diebstahl','polizei','rückruf','insolvenz','absatz','umsatz'];
// Nur klare Werbe-/Spam-Signale (Branche/Produkte/Personen sind für WE RIDE relevant!)
const PR_NEG = ['gewinnspiel','rabatt','% sparen','gutschein',' sale ','jetzt kaufen','black friday'];
const REGIONS = {
  'Baden-Württ.': ['baden-württemberg','stuttgart','karlsruhe','mannheim','freiburg','heidelberg','ulm','heilbronn'],
  'Bayern': ['bayern','münchen','nürnberg','augsburg','regensburg','würzburg','ingolstadt','fürth'],
  'Berlin': ['berlin'],
  'Brandenburg': ['brandenburg','potsdam','cottbus'],
  'Bremen': ['bremen','bremerhaven'],
  'Hamburg': ['hamburg'],
  'Hessen': ['hessen','frankfurt','wiesbaden','kassel','darmstadt','offenbach'],
  'Meckl.-Vorp.': ['mecklenburg','rostock','schwerin'],
  'Niedersachsen': ['niedersachsen','hannover','braunschweig','osnabrück','oldenburg','göttingen'],
  'Nordrhein-Westf.': ['nordrhein-westfalen','köln','düsseldorf','dortmund','essen','duisburg','bochum','wuppertal','bielefeld','münster','aachen','bonn'],
  'Rheinland-Pfalz': ['rheinland-pfalz','mainz','ludwigshafen','koblenz','trier'],
  'Saarland': ['saarland','saarbrücken'],
  'Sachsen': ['sachsen','leipzig','dresden','chemnitz','zwickau'],
  'Sachsen-Anhalt': ['sachsen-anhalt','magdeburg','halle'],
  'Schleswig-H.': ['schleswig-holstein','kiel','lübeck','flensburg'],
  'Thüringen': ['thüringen','erfurt','jena','gera','weimar']
};
const TOPICS = {
  '#Politik': ['haushalt','minister','bundestag','gesetz','förder','etat','beschluss','kommune','stadtrat','strategie'],
  '#Radweg': ['radweg','radschnellweg','fahrradstraße','kreuzung','brücke','infrastruktur'],
  '#Handel': ['absatz','umsatz','markt','händler','hersteller','branche','jobs','insolvenz','leasing','zahlen'],
  '#Event': ['messe','event','tour','rennen','ride','départ','veranstaltung'],
  '#Diebstahl': ['diebstahl','gestohlen','klau','codierung'],
  '#Sport': ['rennen','radsport','tour de france','etappe']
};

function detectRegion(text) {
  const t = text.toLowerCase();
  for (const [region, kws] of Object.entries(REGIONS)) {
    for (const kw of kws) if (t.includes(kw)) return { land: region, ort: capitalize(kw) };
  }
  return { land: 'Bundesweit', ort: 'Bundesweit' };
}
function detectTopic(text) {
  const t = text.toLowerCase(); let best = '#Politik', bestN = 0;
  for (const [topic, kws] of Object.entries(TOPICS)) {
    const n = kws.reduce((a, kw) => a + (t.includes(kw) ? 1 : 0), 0);
    if (n > bestN) { bestN = n; best = topic; }
  }
  return best;
}
function relevance(text, local) {
  const t = text.toLowerCase();
  const isBike = BIKE.some(k => t.includes(k));
  if (!isBike) return 8; // nicht mal Fahrradbezug -> ganz unten
  const pos = NEWS_POS.reduce((a, k) => a + (t.includes(k) ? 1 : 0), 0);
  const neg = PR_NEG.reduce((a, k) => a + (t.includes(k) ? 1 : 0), 0);
  const hasNum = /\d/.test(t) ? 1 : 0;
  let s = 38 + pos * 11 - neg * 14 + (local ? 14 : 0) + hasNum * 4;
  return Math.max(6, Math.min(98, s));
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ---------- KIRA-Relevanzbewertung (gegen WE-RIDE-Profil) ---------- */
const WE_RIDE_PROFIL = 'WE RIDE NEWS ist ein journalistisches Portal für Fahrrad, nachhaltige Mobilität, Verkehrspolitik, Infrastruktur, die gesamte Fahrradwirtschaft (Marken, Produkte, Technik, Handel, Personen, Messen, Auszeichnungen, Verbände wie ADFC/ZIV) und Radsport. Relevant ist ALLES davon — auch Produkt-, Marken-, Personen-, Messe- und Auszeichnungs-News der Branche sowie lokale Radverkehrsthemen. Irrelevant: Themen ohne Fahrrad-/Mobilitätsbezug, reine Rabatt-/Gewinnspielwerbung ohne Nachrichtenwert.';
async function scoreWithKira(items) {
  const Anthropic = require('@anthropic-ai/sdk');
  const { costOf, logUsage } = require('./usage');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const MODEL = process.env.KIRA_MODEL || 'claude-haiku-4-5-20251001';
  const BATCH = 40;
  process.stdout.write('   KIRA bewertet Relevanz ');
  for (let s = 0; s < items.length; s += BATCH) {
    const batch = items.slice(s, s + BATCH);
    const list = batch.map((it, idx) => `${idx}. ${it.title}`).join('\n');
    try {
      const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
      const msg = await anthropic.messages.create({
        model: MODEL, max_tokens: 2000, temperature: 0,
        system: `Heute ist der ${heute}. Du bewertest Schlagzeilen nach Relevanz für WE RIDE NEWS.\n${WE_RIDE_PROFIL}\nBewerte auch die AKTUALITÄT: Schlagzeilen, die sich klar auf ein bereits vergangenes oder abgeschlossenes Ereignis beziehen (z. B. Vorschau/„vor" einem Rennen, das längst gelaufen ist, oder alte Rückblicke), bekommen einen deutlich niedrigeren Score und als Begründung "wirkt veraltet". Aktuelle und kommende Ereignisse zählen normal.\nGib je Eintrag einen Score 0-100 (100 = klare Top-Story fürs Publikum, 0 = irrelevant) und eine sehr kurze Begründung (max. 8 Wörter). Antworte NUR als JSON-Array, nichts sonst: [{"i":0,"score":78,"reason":"..."}]`,
        messages: [{ role: 'user', content: list }]
      });
      const u = msg.usage || {};
      logUsage({ kind: 'Ingest-Scoring', model: MODEL, input: u.input_tokens || 0, output: u.output_tokens || 0, costUsd: costOf(MODEL, u.input_tokens || 0, u.output_tokens || 0), editor: 'ingest' });
      const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
      for (const r of arr) {
        if (batch[r.i]) { batch[r.i].relevance = Math.max(0, Math.min(100, parseInt(r.score, 10) || 0)); batch[r.i].reason = r.reason || ''; }
      }
      process.stdout.write('.');
    } catch (e) { process.stdout.write('x'); }
  }
  process.stdout.write('\n');
  return items.sort((a, b) => b.relevance - a.relevance);
}

// Aggregator-/Quellen-Suffixe abschneiden (z. B. " - Pedelecs und E-Bikes")
function cleanTitle(t) {
  return (t || '')
    .replace(/\s*[-–—]\s*(pedelecs?\s*(und|&)?\s*e-?bikes?.*|presse-?service.*|velobiz.*|bike-?eu.*|radmarkt.*|sazbike.*|newsletter.*)$/i, '')
    .replace(/\s+/g, ' ').trim();
}

/* ---------- Google-Alert-Links auflösen ---------- */
function resolveGoogleUrl(href) {
  try {
    const u = new URL(href, 'https://www.google.com');
    const real = u.searchParams.get('url');
    return real || href;
  } catch { return href; }
}
function parseGoogleAlert(html) {
  const items = [];
  if (!html) return items;
  const $ = cheerio.load(html);
  $('a').each((_, a) => {
    const href = $(a).attr('href') || '';
    const title = $(a).text().trim();
    if (href.includes('google.com/url') && title.length > 12 && !/unsubscribe|abbestellen|feed/i.test(title)) {
      const url = resolveGoogleUrl(href);
      if (url.startsWith('http') && !url.includes('google.com')) {
        items.push({ title, url });
      }
    }
  });
  return items;
}

/* ---------- Dedupe ---------- */
function normKey(it) {
  const t = cleanTitle(it.title).toLowerCase().replace(/[^a-z0-9äöüß ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 55);
  return t; // nur nach (bereinigtem) Titel entdoppeln — clustert dieselbe Meldung über mehrere Quellen
}

/* ---------- Hauptlauf ---------- */
(async () => {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: USER, pass: PASS }, logger: false
  });
  const raw = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock(LABEL);
    try {
      const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000);
      for await (const msg of client.fetch({ since }, { source: true, envelope: true })) {
        try {
          const mail = await simpleParser(msg.source);
          const from = (mail.from && mail.from.text) || '';
          const date = mail.date || new Date();
          if (/googlealerts-noreply@google\.com/i.test(from)) {
            for (const hit of parseGoogleAlert(mail.html || '')) {
              raw.push({ ...hit, date, source: 'Google Alert' });
            }
          } else {
            // direkte Presse-Mail
            let url = '';
            const $ = cheerio.load(mail.html || '');
            const firstLink = $('a[href^="http"]').first().attr('href');
            if (firstLink) url = firstLink;
            const domain = (from.match(/@([^>\s]+)/) || [])[1] || 'Presse';
            raw.push({ title: (mail.subject || '(ohne Betreff)').trim(), url, date, source: domain });
          }
        } catch (e) { /* eine Mail überspringen */ }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e) {
    console.error('\n⚠  Verbindung/Abruf fehlgeschlagen:', e.message,
      '\n   Prüfe GMAIL_USER, App-Passwort und dass IMAP in Gmail aktiviert ist.\n');
    process.exit(1);
  }

  // Dedupe + anreichern + 48h-Filter
  const cutoff = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const seen = new Map();
  for (const it of raw) {
    if (new Date(it.date).getTime() < cutoff) continue;
    const key = normKey(it);
    if (!seen.has(key)) seen.set(key, { ...it, count: 1 });
    else seen.get(key).count++;
  }
  let items = [...seen.values()].map((it, i) => {
    const title = cleanTitle(it.title);
    const text = title + ' ' + (it.url || '');
    const reg = detectRegion(text);
    const local = reg.land !== 'Bundesweit';
    return {
      id: i + 1,
      title,
      url: it.url,
      source: it.source,
      sources: it.count,
      land: reg.land,
      ort: reg.ort,
      topic: detectTopic(text),
      relevance: relevance(text, local),
      reason: '',
      receivedAt: new Date(it.date).toISOString()
    };
  }).sort((a, b) => b.relevance - a.relevance);

  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

  // Inkrementell: bereits (durch KIRA) bewertete Meldungen aus dem letzten Lauf wiederverwenden,
  // damit ein erneuter Ingest tagsüber nur die NEUEN Meldungen bewertet (spart Tokens).
  const cache = new Map();
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sichtung.json'), 'utf8'));
    for (const p of (prev.items || [])) {
      if (!p.reason) continue; // nur echte KIRA-Bewertungen cachen (Heuristik hat leeres reason)
      if (p.url) cache.set('u:' + p.url, { relevance: p.relevance, reason: p.reason });
      cache.set('t:' + cleanTitle(p.title).toLowerCase(), { relevance: p.relevance, reason: p.reason });
    }
  } catch (e) { /* kein Vorlauf vorhanden */ }

  const toScore = [];
  for (const it of items) {
    const hit = (it.url && cache.get('u:' + it.url)) || cache.get('t:' + cleanTitle(it.title).toLowerCase());
    if (hit) { it.relevance = hit.relevance; it.reason = hit.reason; }
    else toScore.push(it);
  }
  console.log(`   Inkrementell: ${items.length - toScore.length} aus Cache übernommen, ${toScore.length} neu zu bewerten.`);

  if (process.env.ANTHROPIC_API_KEY && toScore.length) {
    await scoreWithKira(toScore); // bewertet die neuen Meldungen in-place
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.log('   (Kein ANTHROPIC_API_KEY gesetzt — nur Stichwort-Heuristik. Für echte KIRA-Bewertung Key in .env eintragen.)');
  }
  items.sort((a, b) => b.relevance - a.relevance);

  const out = { generatedAt: new Date().toISOString(), label: LABEL, count: items.length, items };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'sichtung.json'), JSON.stringify(out, null, 2));

  const hi = items.filter(x => x.relevance >= 60).length;
  const mid = items.filter(x => x.relevance >= 40 && x.relevance < 60).length;
  const lo = items.length - hi - mid;
  console.log(`\n✅ Ingest fertig. ${items.length} Meldungen (entdoppelt) aus Label "${LABEL}", letzte ${LOOKBACK_HOURS} h.`);
  console.log(`   Relevanz:  hoch (≥60): ${hi}   mittel: ${mid}   niedrig: ${lo}`);
  console.log('   Geschrieben nach: data/sichtung.json\n');
  console.log('   TOP 20 (Score · Region · Titel · Begründung):');
  items.slice(0, 20).forEach(it => console.log(`   [${String(it.relevance).padStart(3)}] ${it.land.padEnd(16)} ${it.title.slice(0, 60)}${it.reason ? '  — ' + it.reason : ''}`));
  console.log('');
})();
