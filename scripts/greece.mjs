// Όλη η Ελλάδα: διαβάζει κάθε περιοχή του vrisko.gr και γράφει το data/greece.json.
// Τρέχει λίγες φορές τη μέρα. Η Πάτρα ενημερώνεται χωριστά κάθε 30' (update.mjs).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { get, sleep, athensNow } from './net.mjs';
import { parseList, parseCoords, merge, clean } from './parse.mjs';

const BASE = 'https://www.vrisko.gr';
const f = (p) => new URL('../data/' + p, import.meta.url);
const readJson = async (p, d) => { try { return JSON.parse(await readFile(f(p), 'utf8')); } catch { return d; } };
const save = (p, d) => writeFile(f(p), JSON.stringify(d) + '\n');
const START = Date.now();
const BUDGET = (+process.env.TIME_BUDGET_MIN || 300) * 60000; // πόσο το πολύ να τρέξει
const timeLeft = () => BUDGET - (Date.now() - START);
const SKIP = new Set(['patra']); // η Πάτρα έχει δικό της αρχείο

await mkdir(f(''), { recursive: true });

// 1) Λίστα περιοχών (ξαναχτίζεται μία φορά την εβδομάδα)
let areas = await readJson('areas.json', null);
if (!areas || !areas.items?.length || Date.now() - new Date(areas.built).getTime() > 7 * 864e5) {
  const home = await get(BASE + '/efimeries-farmakeion/');
  const prefs = [...new Set([...home.matchAll(/href="([^"]*SelectedPrefecture=[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))]
    .map((u) => (u.startsWith('http') ? u : BASE + u));
  const items = [];
  for (const u of prefs) {
    const pref = decodeURIComponent(u.split('SelectedPrefecture=')[1]).replace(/\+/g, ' ');
    const h = await get(u);
    for (const m of (h || '').matchAll(/<div class="RegionDescription">\s*<a href="(?:https:\/\/www\.vrisko\.gr)?\/efimeries-farmakeion\/([^"/]+)\/?">([\s\S]*?)<\/a>/g)) {
      if (!items.some((x) => x.slug === m[1])) items.push({ slug: m[1], name: clean(m[2]), pref });
    }
    await sleep(800);
  }
  if (items.length < 50) throw new Error('Βρέθηκαν μόνο ' + items.length + ' περιοχές: μάλλον άλλαξε το vrisko.');
  areas = { built: new Date().toISOString(), items };
  await save('areas.json', areas);
  console.log('Περιοχές:', items.length, 'σε', prefs.length, 'νομούς');
}

// 2) Φαρμακεία ανά περιοχή
const now = athensNow();
const old = await readJson('greece.json', { pharmacies: [] });
const oldByArea = new Map();
for (const p of old.pharmacies || []) { if (!oldByArea.has(p.r)) oldByArea.set(p.r, []); oldByArea.get(p.r).push(p); }

const all = new Map();
let ok = 0, failed = 0;
for (const a of areas.items) {
  if (SKIP.has(a.slug)) continue;
  let entries = null;
  if (timeLeft() > 20 * 60000) {
    try { const h = await get(`${BASE}/efimeries-farmakeion/${a.slug}/`, 2); entries = h ? merge(parseList(h)) : []; ok++; } catch (e) { failed++; }
    await sleep(900);
  }
  // αν απέτυχε, κράτα τα παλιά που ισχύουν ακόμα
  const list = entries ?? (oldByArea.get(a.slug) || []).map((p) => ({ ...p, slots: p.slots }));
  for (const p of list) {
    if (all.has(p.id)) { const q = all.get(p.id); for (const s of p.slots) if (!q.slots.some((x) => x.from === s.from && x.to === s.to)) q.slots.push(s); continue; }
    all.set(p.id, { ...p, r: a.slug });
  }
}
console.log(`Περιοχές OK: ${ok}, αποτυχίες: ${failed}`);

// 3) Συντεταγμένες (μία φορά για κάθε φαρμακείο, μετά τις θυμάται)
const geo = await readJson('geo-gr.json', {});
const patraGeo = await readJson('geo.json', {});
let found = 0;
for (const p of all.values()) {
  if (geo[p.id] || patraGeo[p.id]) continue;
  if (timeLeft() < 8 * 60000) break;
  if (!p.mapUrl) continue;
  try { const c = parseCoords(await get(p.mapUrl, 2)); geo[p.id] = c || 0; if (c) found++; } catch { /* ξανά την επόμενη φορά */ }
  if (found % 50 === 0) await save('geo-gr.json', geo);
  await sleep(700);
}
await save('geo-gr.json', geo);

// 4) Αρχείο για το σάιτ (σύντομα ονόματα πεδίων για μικρό μέγεθος)
const names = Object.fromEntries(areas.items.map((a) => [a.slug, a.name]));
const pharmacies = [...all.values()]
  .map((p) => {
    const c = geo[p.id] || patraGeo[p.id];
    return { id: p.id, name: p.name, address: p.address, area: p.area !== 'Πάτρα' ? p.area : '', town: names[p.r] || '', zip: p.zip, phone: p.phone, mapUrl: p.mapUrl, r: p.r,
      lat: c ? c[0] : null, lng: c ? c[1] : null, slots: p.slots.filter((s) => s.to > now).sort((x, y) => x.from.localeCompare(y.from)) };
  })
  .filter((p) => p.slots.length);
await save('greece.json', { updated: now, source: BASE + '/efimeries-farmakeion/', pharmacies });

// Κέντρο κάθε περιοχής, για την αναζήτηση πόλης
const sums = {};
for (const p of pharmacies) if (p.lat) { const s = (sums[p.r] ||= [0, 0, 0]); s[0] += p.lat; s[1] += p.lng; s[2]++; }
const towns = areas.items.filter((a) => sums[a.slug]).map((a) => ({ n: a.name, p: a.pref, c: [+(sums[a.slug][0] / sums[a.slug][2]).toFixed(4), +(sums[a.slug][1] / sums[a.slug][2]).toFixed(4)] }));
if (!towns.some((t) => t.n === 'Πάτρα')) towns.push({ n: 'Πάτρα', p: 'ΑΧΑΪΑΣ', c: [38.2466, 21.7346] });
const prevTowns = await readJson('towns.json', []);
for (const t of prevTowns) if (!towns.some((x) => x.n === t.n && x.p === t.p)) towns.push(t);
await save('towns.json', towns.sort((a, b) => a.n.localeCompare(b.n, 'el')));
console.log(`OK: ${pharmacies.length} φαρμακεία, ${pharmacies.filter((p) => p.lat).length} με θέση, ${found} νέες θέσεις, ${towns.length} πόλεις.`);
