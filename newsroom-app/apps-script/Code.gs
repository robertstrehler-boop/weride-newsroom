/**
 * WE RIDE Newsroom — Ingest (Google Apps Script)
 * Liest das Gmail-Label "Presse", parst Google-Alerts, bewertet NEUE Meldungen
 * inkrementell mit KIRA (Anthropic Haiku) und schreibt sie nach Supabase (Tabelle "sichtung").
 *
 * EINRICHTUNG (einmalig):
 *  Projekteinstellungen -> Skripteigenschaften (Script Properties) anlegen:
 *   SUPABASE_URL   = https://bidomfoamvuzvwatqlsr.supabase.co
 *   SERVICE_ROLE   = <dein service_role Key aus Supabase: Project Settings -> API>
 *   ANTHROPIC_KEY  = <dein Anthropic API-Key>
 *   GMAIL_LABEL    = Presse
 *   LOOKBACK_DAYS  = 2
 *  Dann: Trigger einrichten (Uhr-Symbol) -> runIngest -> Zeitgesteuert (z. B. stündlich).
 *  Und: Bereitstellen -> Neue Bereitstellung -> Web-App (Zugriff: "Jeder mit Link")
 *       -> die URL in den Newsroom (APPS_SCRIPT_URL) eintragen, dann geht der Button "Neue Alerts holen".
 */

function props_() { return PropertiesService.getScriptProperties().getProperties(); }

// Web-App-Endpunkt für den "Neue Alerts holen"-Button
function doPost(_e) { const n = runIngest(); return ContentService.createTextOutput(JSON.stringify({ ok: true, neu: n })).setMimeType(ContentService.MimeType.JSON); }
function doGet(_e)  { const n = runIngest(); return ContentService.createTextOutput(JSON.stringify({ ok: true, neu: n })).setMimeType(ContentService.MimeType.JSON); }

/* ---------- Region / Thema (kompakt) ---------- */
var BUNDESLAENDER = ['Baden-Württ','Bayern','Berlin','Brandenburg','Bremen','Hamburg','Hessen','Mecklenburg','Niedersachsen','Nordrhein','Rheinland-Pfalz','Saarland','Sachsen-Anhalt','Sachsen','Schleswig','Thüringen'];
var STAEDTE = { 'München':'Bayern','Nürnberg':'Bayern','Augsburg':'Bayern','Leipzig':'Sachsen','Dresden':'Sachsen','Chemnitz':'Sachsen','Stuttgart':'Baden-Württ','Karlsruhe':'Baden-Württ','Freiburg':'Baden-Württ','Heidelberg':'Baden-Württ','Mannheim':'Baden-Württ','Köln':'Nordrhein','Düsseldorf':'Nordrhein','Dortmund':'Nordrhein','Essen':'Nordrhein','Münster':'Nordrhein','Bonn':'Nordrhein','Frankfurt':'Hessen','Wiesbaden':'Hessen','Kassel':'Hessen','Hannover':'Niedersachsen','Braunschweig':'Niedersachsen','Bremen':'Bremen','Hamburg':'Hamburg','Berlin':'Berlin','Kiel':'Schleswig','Lübeck':'Schleswig','Mainz':'Rheinland-Pfalz','Erfurt':'Thüringen','Magdeburg':'Sachsen-Anhalt','Potsdam':'Brandenburg','Saarbrücken':'Saarland','Rostock':'Mecklenburg' };
function detectRegion(t) {
  for (var city in STAEDTE) { if (t.indexOf(city) >= 0) return { land: STAEDTE[city], ort: city }; }
  for (var i = 0; i < BUNDESLAENDER.length; i++) { if (t.indexOf(BUNDESLAENDER[i]) >= 0) return { land: BUNDESLAENDER[i], ort: BUNDESLAENDER[i] }; }
  return { land: 'Bundesweit', ort: 'Bundesweit' };
}
function detectTopic(t) {
  var s = t.toLowerCase();
  if (/(minister|bundestag|gesetz|förder|politik|kommune|stadtrat|entscheid)/.test(s)) return '#Politik';
  if (/(radweg|radschnellweg|kreuzung|brücke|infrastruktur|fahrradstraße)/.test(s)) return '#Radweg';
  if (/(markt|hersteller|handel|umsatz|absatz|verkauf|e-bike|cargo|lastenrad|ziv)/.test(s)) return '#Handel';
  if (/(messe|event|rennen|tour|festival|ride)/.test(s)) return '#Event';
  if (/(diebstahl|gestohlen|polizei)/.test(s)) return '#Diebstahl';
  return '#Radverkehr';
}
function cleanTitle(t) { return (t || '').replace(/\s*[-–—]\s*(pedelecs?.*|presse-?service.*|velobiz.*|bike-?eu.*|radmarkt.*|sazbike.*|newsletter.*)$/i, '').replace(/\s+/g, ' ').trim(); }
function normKey(t) { return (t || '').toLowerCase().replace(/[^a-z0-9äöüß ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60); }

/* ---------- Google-Alert-Links auflösen ---------- */
function resolveUrl(href) {
  try { var m = href.match(/[?&]url=([^&]+)/); if (m) return decodeURIComponent(m[1]); } catch (e) {}
  return href;
}

/* ---------- Hauptlauf ---------- */
function runIngest() {
  var P = props_();
  var LABEL = P.GMAIL_LABEL || 'Presse';
  var DAYS = parseInt(P.LOOKBACK_DAYS || '2', 10);
  var threads = GmailApp.search('label:' + LABEL + ' newer_than:' + DAYS + 'd', 0, 200);
  Logger.log('Threads gefunden: ' + threads.length);
  var seen = {}; var items = [];
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var body = (msgs[j].getBody() || '').replace(/&amp;/g, '&');
      var re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g; var m;
      while ((m = re.exec(body))) {
        var href = m[1]; var text = m[2].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
        if (!text || text.length < 12) continue;
        if (!/google\.com\/url|\/url\?/.test(href)) continue;
        var url = resolveUrl(href);
        if (!/^https?:\/\//.test(url) || /google\.com/.test(url)) continue;
        var title = cleanTitle(text);
        var key = normKey(title);
        if (!key || seen[key] || seen['u:' + url]) continue;
        seen[key] = true; seen['u:' + url] = true;
        var reg = detectRegion(title);
        items.push({ key: url, title: title, url: url, source: 'Google Alert', sources: 1, land: reg.land, ort: reg.ort, topic: detectTopic(title + ' ' + url), relevance: 50, reason: '', received_at: msgs[j].getDate().toISOString() });
      }
    }
  }
  if (!items.length) { Logger.log('Keine neuen Alerts.'); return 0; }

  // Nur die neuesten N behalten (Apps-Script-Zeitlimit; Sichtung zeigt eh die neuesten)
  var MAX = parseInt(P.MAX_ITEMS || '150', 10);
  items.sort(function (a, b) { return new Date(b.received_at) - new Date(a.received_at); });
  if (items.length > MAX) items = items.slice(0, MAX);
  Logger.log('Behalten (neueste): ' + items.length);

  // Inkrementell: bereits bewertete (KIRA) aus Supabase wiederverwenden
  var cache = loadScoredCache_(P);
  var toScore = [];
  for (var k = 0; k < items.length; k++) {
    var hit = cache[items[k].url] || cache['t:' + normKey(items[k].title)];
    if (hit && hit.reason) { items[k].relevance = hit.relevance; items[k].reason = hit.reason; }
    else toScore.push(items[k]);
  }
  Logger.log('Gesamt ' + items.length + ', neu zu bewerten: ' + toScore.length);
  if (toScore.length && P.ANTHROPIC_KEY) scoreWithKira_(toScore, P);

  upsertSichtung_(items, P);
  Logger.log('Ingest fertig: ' + items.length + ' geschrieben.');
  return toScore.length;
}

/* ---------- Supabase: vorhandene Scores laden ---------- */
function loadScoredCache_(P) {
  var cache = {};
  try {
    var r = UrlFetchApp.fetch(P.SUPABASE_URL + '/rest/v1/sichtung?select=url,title,relevance,reason', {
      headers: { apikey: P.SERVICE_ROLE, Authorization: 'Bearer ' + P.SERVICE_ROLE }, muteHttpExceptions: true
    });
    var arr = JSON.parse(r.getContentText() || '[]');
    for (var i = 0; i < arr.length; i++) { if (arr[i].reason) { if (arr[i].url) cache[arr[i].url] = arr[i]; cache['t:' + normKey(arr[i].title)] = arr[i]; } }
  } catch (e) { Logger.log('Cache-Load: ' + e); }
  return cache;
}

/* ---------- KIRA-Bewertung (Anthropic Haiku) ---------- */
function scoreWithKira_(list, P) {
  var heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'd. MMMM yyyy');
  var PROFIL = 'WE RIDE NEWS: Fahrrad, nachhaltige Mobilität, Verkehrspolitik, Infrastruktur, Fahrradwirtschaft, Radsport. Relevant sind auch Branche, Produkte, Personen, Verbände (z. B. ADFC, ZIV) und Politik. Werbung/PR/Gewinnspiele niedrig.';
  for (var s = 0; s < list.length; s += 40) {
    var batch = list.slice(s, s + 40);
    var lst = batch.map(function (it, idx) { return idx + '. ' + it.title; }).join('\n');
    var sys = 'Heute ist der ' + heute + '. Du bewertest Schlagzeilen nach Relevanz für WE RIDE NEWS.\n' + PROFIL + '\nBewerte auch Aktualität: klar vergangene/abgeschlossene Ereignisse niedriger ("wirkt veraltet"). Gib je Eintrag Score 0-100 und eine sehr kurze Begründung (max 8 Wörter). Antworte NUR als JSON-Array: [{"i":0,"score":78,"reason":"..."}]';
    try {
      var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post', contentType: 'application/json',
        headers: { 'x-api-key': P.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({ model: P.KIRA_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 2000, system: sys, messages: [{ role: 'user', content: lst }] }),
        muteHttpExceptions: true
      });
      var d = JSON.parse(res.getContentText());
      var text = (d.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
      var arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
      for (var a = 0; a < arr.length; a++) { var it = batch[arr[a].i]; if (it) { it.relevance = Math.max(0, Math.min(100, parseInt(arr[a].score, 10) || 0)); it.reason = arr[a].reason || ''; } }
      // Kosten mitloggen
      if (d.usage) logUsage_(P, 'Ingest-Scoring', P.KIRA_MODEL || 'claude-haiku-4-5-20251001', d.usage.input_tokens || 0, d.usage.output_tokens || 0);
    } catch (e) { Logger.log('KIRA-Batch-Fehler: ' + e); }
  }
}

/* ---------- Supabase: Upsert Sichtung ---------- */
function upsertSichtung_(rows, P) {
  var r = UrlFetchApp.fetch(P.SUPABASE_URL + '/rest/v1/sichtung', {
    method: 'post', contentType: 'application/json',
    headers: { apikey: P.SERVICE_ROLE, Authorization: 'Bearer ' + P.SERVICE_ROLE, Prefer: 'resolution=merge-duplicates' },
    payload: JSON.stringify(rows), muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) Logger.log('Upsert-Fehler ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
}

/* ---------- Supabase: Usage loggen ---------- */
function logUsage_(P, kind, model, input, output) {
  var rates = { 'claude-haiku-4-5-20251001': { i: 1, o: 5 } };
  var rr = rates[model] || { i: 1, o: 5 };
  var cost = (input * rr.i + output * rr.o) / 1e6;
  try {
    UrlFetchApp.fetch(P.SUPABASE_URL + '/rest/v1/usage', {
      method: 'post', contentType: 'application/json',
      headers: { apikey: P.SERVICE_ROLE, Authorization: 'Bearer ' + P.SERVICE_ROLE },
      payload: JSON.stringify([{ kind: kind, model: model, input: input, output: output, cost_usd: cost, editor: 'ingest' }]), muteHttpExceptions: true
    });
  } catch (e) {}
}
