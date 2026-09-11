/**
 * Gemeinsames Usage-Log für Server und Ingest.
 * Schreibt eine JSON-Zeile pro API-Call nach DATA_DIR/usage.jsonl.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'usage.jsonl');

// USD pro 1 Mio. Tokens (in/out) — zentral, damit Server und Ingest gleich rechnen.
const RATES = {
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o': { in: 2.5, out: 10 }
};
function costOf(model, inTok, outTok) {
  const r = RATES[model] || { in: 1, out: 5 };
  return (inTok * r.in + outTok * r.out) / 1e6;
}
function logUsage(rec) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
  } catch (e) { /* Logging darf nie den Betrieb stören */ }
}
function readUsage() {
  try {
    return fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}
module.exports = { RATES, costOf, logUsage, readUsage };
