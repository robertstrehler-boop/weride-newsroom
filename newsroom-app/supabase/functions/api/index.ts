// WE RIDE Newsroom — API (Supabase Edge Function, Deno)
// Bündelt: generate, research, ask, discover, sichtung, stories, admin-usage.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI = Deno.env.get('OPENAI_API_KEY') || '';
const ANTHROPIC = Deno.env.get('ANTHROPIC_API_KEY') || '';
const TEAM = Deno.env.get('NEWSROOM_TOKEN') || '';
const ADMIN = Deno.env.get('ADMIN_TOKEN') || '';
const GEN_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
const RES_MODEL = Deno.env.get('KIRA_MODEL') || 'claude-haiku-4-5-20251001';
const USD_EUR = parseFloat(Deno.env.get('USD_EUR') || '0.92');
const SICHTUNG_LIMIT = parseInt(Deno.env.get('SICHTUNG_LIMIT') || '30', 10);

const db = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-newsroom-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---------- Kosten / Usage ---------- */
const RATES: Record<string, { i: number; o: number }> = {
  'claude-sonnet-5': { i: 3, o: 15 }, 'claude-opus-4-8': { i: 5, o: 25 },
  'claude-haiku-4-5-20251001': { i: 1, o: 5 }, 'gpt-4o-mini': { i: 0.15, o: 0.60 }, 'gpt-4o': { i: 2.5, o: 10 },
};
const costOf = (m: string, i: number, o: number) => { const r = RATES[m] || { i: 1, o: 5 }; return (i * r.i + o * r.o) / 1e6; };
async function logUsage(kind: string, model: string, input: number, output: number, editor: string) {
  try { await db.from('usage').insert({ kind, model, input, output, cost_usd: costOf(model, input, output), editor: editor || '' }); } catch (_) { /* nie blockieren */ }
}

/* ---------- WE-RIDE-Stil ---------- */
async function styleBlock() {
  const { data } = await db.from('config').select('value').eq('key', 'we-ride-context').maybeSingle();
  const ctx = data?.value || '';
  return `KUNDEN-STILBLOCK\nKunde: WE RIDE\n${ctx}`;
}

const SYSTEM_PROMPT = `Du bist der Schreib-Motor von WE RIDE NEWS. Arbeite wie ein Redakteur, nicht wie ein Textgenerator: Recherche und Gewichtung vor Formulierung.
OBERSTE REGEL: Substanz vor Stil. Jede Tatsache muss durch das gelieferte Material gedeckt sein. Erfinde nichts (keine Zahlen, Namen, Zitate, Daten). Fehlt etwas, trage es in "offene_fragen" ein. Zitate nur wörtlich aus dem Material.
JOURNALISTISCH: Lede beantwortet die W-Fragen, invertierte Pyramide, jede Aussage attribuiert, Fakt/Analyse/Prognose sauber trennen, Zahlen einordnen (Vorjahr, Prozent, absolut), Pressekodex beachten (keine Vorverurteilung).
MENSCHLICHE HANDSCHRIFT: Satz- und Absatzlänge variieren, sparsam mit Doppelpunkten/Gedankenstrichen, keine immer gleichen Übergänge, keine Mini-Zusammenfassung nach jedem Absatz, keine Buzzwords/Werbefloskeln.
MODUS & LÄNGE (verbindlich): KURZ 250–300 Wörter, NEWS 650–900, ANALYSE 900–1200. Schöpfe die Wortzahl aus — der Body jeder Fassung hat mehrere voll ausgearbeitete Absätze (bei NEWS/ANALYSE mindestens 5) samt aussagekräftiger Zwischenüberschriften, die du als eigene kurze Absätze in den Body schreibst. Nutze das gelieferte Material vollständig aus. Nicht mit Floskeln strecken, aber auch nicht unter die Untergrenze fallen.
AUSGABE: Liefere ZWEI eigenständige Fassungen (A und B, unterschiedlicher Einstieg/Schwerpunkt), je mit genau 3 Takeaways (separat, nicht im Fließtext). Bestimme ein Fokus-Schlüsselwort. Antworte NUR mit gültigem JSON, kein Text drumherum, keine Code-Fences:
{"variante_a":{"titel":"","teaser":"","body":["",""],"takeaways":["","",""]},"variante_b":{"titel":"","teaser":"","body":["",""],"takeaways":["","",""]},"quellen":[{"nr":1,"titel":"","url":""}],"faktencheck":[{"aussage":"","beleg":"","status":"gedeckt"}],"seo":{"fokus_keyword":"","title":"","meta":"","slug":""},"offene_fragen":[""]}`;

/* ---------- Quelle laden (leichtgewichtig) ---------- */
async function fetchArticle(url: string) {
  if (!url) return '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RohlingBot/0.1)' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const html = await r.text();
    const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
    const text = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 8000);
  } catch { return ''; }
}
function extractJson(t: string) {
  let s = (t || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

/* ---------- Anthropic / OpenAI ---------- */
async function anthropic(system: string, user: string, maxTokens: number) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: RES_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'Anthropic-Fehler');
  const text = (d.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const u = d.usage || {};
  return { text, input: u.input_tokens || 0, output: u.output_tokens || 0 };
}

/* ---------- Discover: Web-Recherche ---------- */
function decodeEntities(s: string) { return (s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function stripTags(s: string) { return decodeEntities((s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '')).trim(); }
function hostOf(u: string) { const m = (u || '').match(/^https?:\/\/(www\.)?([^\/]+)/); return m ? m[2] : ''; }
async function rss(url: string, max: number) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
  const xml = await r.text();
  const items: any[] = []; const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml)) && items.length < max) {
    const b = m[1];
    const title = stripTags((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = ((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const pub = ((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim();
    const source = stripTags((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
    if (title && /^https?:\/\//.test(link)) items.push({ title: title.replace(/\s+-\s+[^-]+$/, ''), link, pub, source });
  }
  return items;
}
async function discover(q: string) {
  const queries = q ? [q] : ['Radverkehr Deutschland', 'Fahrrad Verkehrspolitik', 'Radweg Kommune', 'E-Bike Markt', 'Bundesministerium Verkehr Radverkehr'];
  let picked: any[] = [];
  for (const query of queries) {
    let items: any[] = [];
    try { items = await rss(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=RSS&setlang=de&cc=DE`, 10); } catch (_) { /* */ }
    if (!items.length) { try { items = await rss(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=de&gl=DE&ceid=DE:de`, 10); } catch (_) { /* */ } }
    if (items.length) {
      const now = Date.now();
      const withTs = items.map((it) => ({ ...it, ts: Date.parse(it.pub) || 0 }));
      const recent = withTs.filter((it) => it.ts && (now - it.ts) < 14 * 864e5);
      picked.push(...(recent.length ? recent : withTs).slice(0, q ? 8 : 2));
    }
    if (q) break;
  }
  const seen = new Set<string>(); const out: any[] = [];
  for (const it of picked) {
    const u = it.link; if (!u || seen.has(u) || /news\.google\.com/.test(u)) { if (/news\.google\.com/.test(u)) { seen.add(u); } continue; }
    seen.add(u);
    const dt = it.ts ? new Date(it.ts).toLocaleDateString('de-DE') : '';
    const src = it.source || hostOf(u);
    out.push({ title: it.title, url: u, land: 'Bundesweit', ort: 'Bundesweit', topic: '#Radverkehr', sources: 1, kira: true, reason: (src ? 'Quelle: ' + src : 'Web-Fund') + (dt ? ' · ' + dt : '') });
    if (out.length >= (q ? 8 : 6)) break;
  }
  return out;
}

/* ---------- Router ---------- */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
  const action = (url.searchParams.get('action') || body.action || '').toString();

  // Team-Gate (Admin-Route zusätzlich per Admin-Token)
  const tok = req.headers.get('x-newsroom-token') || '';
  if (action !== 'admin-usage') {
    if (TEAM && tok !== TEAM) return json({ error: 'Kein Zugang' }, 401);
  }

  try {
    /* ----- Sichtung ----- */
    if (action === 'sichtung') {
      const { data } = await db.from('sichtung').select('*').order('relevance', { ascending: false }).order('received_at', { ascending: false }).limit(SICHTUNG_LIMIT * 3);
      const { data: usedRows } = await db.from('stories').select('url');
      const used = new Set((usedRows || []).map((r: any) => r.url).filter(Boolean));
      const fresh = (data || []).filter((r: any) => !r.url || !used.has(r.url)).slice(0, SICHTUNG_LIMIT);
      const { count } = await db.from('sichtung').select('*', { count: 'exact', head: true });
      const items = fresh.map((r: any, i: number) => ({ id: 1000 + i, title: r.title, url: r.url, land: r.land, ort: r.ort, topic: r.topic, sources: r.sources, relevance: r.relevance, reason: r.reason }));
      return json({ items, count: items.length, total: count || items.length });
    }

    /* ----- Stories (Grid/Stack/Entwurf/Veröffentlicht) ----- */
    if (action === 'stories') {
      const status = url.searchParams.get('status') || 'grid';
      let q = db.from('stories').select('*').eq('status', status).order('updated_at', { ascending: false });
      const { data } = await q;
      return json({ items: data || [] });
    }
    if (action === 'story.create') {
      const s = body.story || {};
      if (!s.story_id) s.story_id = s.url || ('own-' + Date.now() + '-' + Math.floor(Math.random() * 1e4));
      const row = { story_id: s.story_id, title: s.title, url: s.url || null, land: s.land, ort: s.ort, topic: s.topic, sources: s.sources || 1, img: s.img || 'p1', reason: s.reason || '', kira: !!s.kira, eigen: !!s.eigen, top: !!s.top, status: s.status || 'grid', owner: s.owner || null, variant: s.variant || 'A', laenge: s.laenge || 'News', article: s.article || null, research: s.research || null, updated_at: new Date().toISOString() };
      const { error } = await db.from('stories').upsert(row, { onConflict: 'story_id', ignoreDuplicates: false });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, story_id: s.story_id });
    }
    if (action === 'story.update') {
      const patch = { ...(body.patch || {}), updated_at: new Date().toISOString() };
      const { error } = await db.from('stories').update(patch).eq('story_id', body.story_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (action === 'story.delete') {
      const { error } = await db.from('stories').delete().eq('story_id', body.story_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ----- Discover (Web) — legt Funde direkt als geteilte Grid-Stories an ----- */
    if (action === 'discover') {
      const q = (url.searchParams.get('q') || '').trim();
      const found = await discover(q);
      let mode = found.length ? 'web' : 'leer';
      let out = found;
      if (!found.length) {
        // Fallback: neueste Sichtung
        const { data } = await db.from('sichtung').select('*').order('received_at', { ascending: false }).limit(6);
        out = (data || []).filter((r: any) => r.url).map((r: any) => ({ title: r.title, url: r.url, land: r.land, ort: r.ort, topic: r.topic, sources: r.sources, kira: true, reason: (r.reason || '') + ' · aus dem Ingest' }));
        mode = out.length ? 'ingest' : 'leer';
      }
      // bereits übernommene/verworfene Themen (irgendein Status) ausblenden
      const urls = out.map((o: any) => o.url).filter(Boolean);
      if (urls.length) {
        const { data: ex } = await db.from('stories').select('url').in('url', urls);
        const have = new Set((ex || []).map((r: any) => r.url));
        out = out.filter((o: any) => !have.has(o.url));
      }
      return json({ items: out, count: out.length, mode, query: q || 'WE-RIDE-Themen' });
    }

    /* ----- KIRA-Recherche ----- */
    if (action === 'research') {
      const { title, url: srcUrl, editor } = body;
      const src = await fetchArticle(srcUrl || '');
      const sys = `Du bist KIRA, Rechercheassistentin für WE RIDE NEWS (Fahrrad, Mobilität, Verkehrspolitik, Branche). Analysiere die Quelle zu einer Meldung und erfinde nichts. Liegt kein Volltext vor, arbeite mit dem Titel und markiere Unsicherheiten. Trage bei jeder Quelle den zugehörigen Link ein, wenn er dir vorliegt (die gelieferte URL gehört zur Primärquelle); erfinde keine Links, lass "url" sonst leer. Gib zu jeder Quelle einen kurzen Hinweis (2–6 Wörter), was das für eine Quelle ist, z. B. "Webseite der Stadt Dortmund", "Pressestelle des BMV". Antworte NUR als JSON: {"sources":[{"nm":"","cr":"Primär|Hoch|Mittel","url":"","hinweis":""}],"facts":[{"t":"","status":"gedeckt|unsicher|widerspruch","src":""}],"angles":["","",""],"offen":""}`;
      const { text, input, output } = await anthropic(sys, `TITEL: ${title}\nURL: ${srcUrl || '-'}\n\nQUELLENTEXT:\n${src || '(kein Volltext verfügbar)'}`, 1200);
      await logUsage('Recherche', RES_MODEL, input, output, editor || '');
      return json(extractJson(text));
    }

    /* ----- Frag KIRA ----- */
    if (action === 'ask') {
      const { title, url: srcUrl, question, editor } = body;
      if (!(question || '').trim()) return json({ error: 'Keine Frage' }, 400);
      const src = await fetchArticle(srcUrl || '');
      const sys = `Du bist KIRA, Rechercheassistentin für WE RIDE NEWS (Fahrrad, Mobilität, Verkehrspolitik, Branche). Beantworte die Redakteursfrage knapp, sachlich, auf Deutsch. Stütze dich auf den gelieferten Quellentext und erfinde nichts. Steht die Antwort nicht im Material, sag das klar und nenne, wo man es prüfen könnte. Kein JSON, nur die Antwort in 2–5 Sätzen.`;
      const { text, input, output } = await anthropic(sys, `MELDUNG: ${title}\nQUELLE (${srcUrl || '-'}):\n${src || '(kein Volltext verfügbar)'}\n\nFRAGE: ${question}`, 800);
      await logUsage('KIRA-Frage', RES_MODEL, input, output, editor || '');
      return json({ answer: text.trim() });
    }

    /* ----- Generierung (OpenAI, erzwungenes JSON) ----- */
    if (action === 'generate') {
      if (!OPENAI) return json({ error: 'OPENAI_API_KEY fehlt' }, 500);
      const { title, url: srcUrl, ort, topic, modus, angle, notes, editor } = body;
      const src = await fetchArticle(srcUrl || '');
      const user = `AUFTRAG
Textmodus: ${modus || 'NEWS'}
Region: ${ort || '-'} · Thema: ${topic || '-'}
Blickwinkel: ${angle || '(offen — wähle den stärksten)'}

THEMA / TITEL: ${title}

QUELLE (${srcUrl || 'kein Link'}):
${src || '(kein Volltext verfügbar — schreibe nur, was belegbar ist, und markiere fehlende Belege in offene_fragen)'}

NOTIZEN: ${notes || '(keine)'}`;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI },
        body: JSON.stringify({ model: GEN_MODEL, messages: [{ role: 'system', content: SYSTEM_PROMPT + '\n\n' + (await styleBlock()) }, { role: 'user', content: user }], temperature: 0.3, max_tokens: 8000, response_format: { type: 'json_object' } }),
      });
      const data = await r.json();
      if (data.error) return json({ error: data.error.message }, 502);
      const content = data.choices?.[0]?.message?.content || '';
      let out: any; try { out = JSON.parse(content); } catch { return json({ error: 'Antwort war kein gültiges JSON.' }, 502); }
      const u = data.usage || {};
      await logUsage('Generierung', GEN_MODEL, u.prompt_tokens || 0, u.completion_tokens || 0, editor || '');
      out._meta = { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, costUsd: costOf(GEN_MODEL, u.prompt_tokens || 0, u.completion_tokens || 0) };
      return json(out);
    }

    /* ----- Admin: Kosten/Usage ----- */
    if (action === 'admin-usage') {
      const t = url.searchParams.get('token') || req.headers.get('x-admin-token') || '';
      if (!ADMIN || t !== ADMIN) return json({ error: 'Kein Admin-Zugang' }, 403);
      const { data } = await db.from('usage').select('*');
      const rows = data || [];
      const sum = { calls: 0, input: 0, output: 0, cost: 0 };
      const byKind: any = {}, byModel: any = {}, byDay: any = {}, byEditor: any = {};
      const todayKey = new Date().toISOString().slice(0, 10); let todayCost = 0, todayCalls = 0;
      const bump = (o: any, k: string, r: any) => { o[k] = o[k] || { calls: 0, cost: 0, input: 0, output: 0 }; o[k].calls++; o[k].cost += Number(r.cost_usd) || 0; o[k].input += r.input || 0; o[k].output += r.output || 0; };
      for (const r of rows) {
        sum.calls++; sum.input += r.input || 0; sum.output += r.output || 0; sum.cost += Number(r.cost_usd) || 0;
        bump(byKind, r.kind || '?', r); bump(byModel, r.model || '?', r); bump(byEditor, r.editor || '—', r);
        const d = (r.ts || '').slice(0, 10); if (d) { bump(byDay, d, r); if (d === todayKey) { todayCost += Number(r.cost_usd) || 0; todayCalls++; } }
      }
      return json({ rate: USD_EUR, sum, today: { cost: todayCost, calls: todayCalls }, byKind, byModel, byDay, byEditor });
    }

    return json({ error: 'Unbekannte Aktion: ' + action }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
