// Τρέχει στο GitHub Actions: διαβάζει το vrisko.gr και γράφει το data/patra.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseList, parseCoords, merge } from './parse.mjs';

const LIST_URL = 'https://www.vrisko.gr/efimeries-farmakeion/patra/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DATA = new URL('../data/patra.json', import.meta.url);
const GEO = new URL('../data/geo.json', import.meta.url);

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'el-GR,el;q=0.9' } });
      if (r.ok) return await r.text();
      console.warn('HTTP', r.status, url);
    } catch (e) { console.warn('fetch error', url, e.message); }
    await new Promise((s) => setTimeout(s, 3000 * (i + 1)));
  }
  throw new Error('Δεν απάντησε: ' + url);
}
const readJson = async (u, d) => { try { return JSON.parse(await readFile(u, 'utf8')); } catch { return d; } };

// Ώρα Αθήνας ως "YYYY-MM-DDTHH:MM"
function athensNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const html = await get(LIST_URL);
const fresh = merge(parseList(html));
if (!fresh.length) throw new Error('Δεν βρέθηκαν φαρμακεία: μάλλον άλλαξε η σελίδα του vrisko.');

const geo = await readJson(GEO, {});
for (const p of fresh) {
  if (geo[p.id] || !p.mapUrl) continue;
  try { const c = parseCoords(await get(p.mapUrl)); if (c) geo[p.id] = c; } catch (e) { console.warn(e.message); }
  await new Promise((s) => setTimeout(s, 700));
}

// Κρατάμε και παλιότερες εγγραφές που δεν έχουν λήξει ακόμα (αν το vrisko τις κρύψει νωρίτερα)
const now = athensNow();
const old = await readJson(DATA, { pharmacies: [] });
const byId = new Map(fresh.map((p) => [p.id, p]));
for (const o of old.pharmacies || []) {
  const live = (o.slots || []).filter((s) => s.to > now);
  if (!live.length) continue;
  const p = byId.get(o.id);
  if (!p) { byId.set(o.id, { ...o, slots: live }); continue; }
  for (const s of live) if (!p.slots.some((x) => x.from === s.from && x.to === s.to)) p.slots.push(s);
  p.slots.sort((a, b) => a.from.localeCompare(b.from));
}

const pharmacies = [...byId.values()]
  .map((p) => ({ ...p, slots: p.slots.filter((s) => s.to > now), lat: geo[p.id]?.[0] ?? null, lng: geo[p.id]?.[1] ?? null }))
  .filter((p) => p.slots.length)
  .sort((a, b) => a.slots[0].from.localeCompare(b.slots[0].from) || a.name.localeCompare(b.name, 'el'));

const strip = (d) => JSON.stringify(d.pharmacies);
const out = { updated: strip(old) === strip({ pharmacies }) ? old.updated || now : now, source: LIST_URL, pharmacies };
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(DATA, JSON.stringify(out, null, 1) + '\n');
await writeFile(GEO, JSON.stringify(geo, null, 1) + '\n');
console.log(`OK: ${pharmacies.length} φαρμακεία, ${pharmacies.filter((p) => p.lat).length} με θέση.`);
