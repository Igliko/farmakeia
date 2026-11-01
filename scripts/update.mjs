// Τρέχει στο GitHub Actions: διαβάζει το vrisko.gr και γράφει το data/patra.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { get, athensNow } from './net.mjs';
import { parseList, parseCoords, merge } from './parse.mjs';

const LIST_URL = 'https://www.vrisko.gr/efimeries-farmakeion/patra/';
const DATA = new URL('../data/patra.json', import.meta.url);
const GEO = new URL('../data/geo.json', import.meta.url);

const readJson = async (u, d) => { try { return JSON.parse(await readFile(u, 'utf8')); } catch { return d; } };

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
