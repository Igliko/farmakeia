// Όλη η Ελλάδα: διαβάζει κάθε περιοχή του vrisko.gr και γράφει το data/greece.json.
// Τρέχει λίγες φορές τη μέρα. Η Πάτρα ενημερώνεται χωριστά κάθε 30' (update.mjs).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { get, sleep, athensNow } from './net.mjs';
import { parseList, parseCoords, merge, clean } from './parse.mjs';
import { geocode } from './geocode.mjs';

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
  const prefs = [...new Set([...home.matchAll(/href=["']?([^"'\s>]*SelectedPrefecture=[^"'\s>]+)/g)].map((m) => m[1].replace(/&amp;/g, '&')))]
    .map((u) => (u.startsWith('http') ? u : BASE + u));
  const items = [];
  for (const u of prefs) {
    const pref = decodeURIComponent(u.split('SelectedPrefecture=')[1]).replace(/\+/g, ' ');
    const h = await get(u);
    for (const m of (h || '').matchAll(/class="RegionDescription">\s*<a href=["']?(?:https:\/\/www\.vrisko\.gr)?\/efimeries-farmakeion\/([^"'\/\s>]+)\/?["']?>([\s\S]*?)<\/a>/g)) {
      if (!items.some((x) => x.slug === m[1])) items.push({ slug: m[1], name: clean(m[2]), pref });
    }
    await sleep(800);
  }
  if (items.length < 50) throw new Error('Βρέθηκαν μόνο ' + items.length + ' περιοχές: μάλλον άλλαξε το vrisko.');
  areas = { built: new Date().toISOString(), items };
  await save('areas.json', areas);
  console.log('Περιοχές:', items.length, 'σε', prefs.length, 'νομούς');
}

// 2) Συντεταγμένες ΠΡΩΤΑ, όσο το vrisko είναι «φρέσκο» (μετά από πολλές σελίδες σταματάει να τις δίνει).
//    Για φαρμακεία που ξέρουμε από την προηγούμενη φορά· τα καινούργια παίρνουν θέση στην επόμενη.
const old = await readJson('greece.json', { pharmacies: [] });
const geo = await readJson('geo-gr.json', {});
const patraGeo = await readJson('geo.json', {});
let found = 0, tries = 0, misses = 0;
const MAX_GEO = +process.env.MAX_GEO || 30;
// παλιές αποτυχίες (0) τις ξαναδοκιμάζουμε
for (const k of Object.keys(geo)) if (!geo[k]) delete geo[k];
for (const p of old.pharmacies || []) {
  if (geo[p.id] || patraGeo[p.id]) continue;
  if (!p.mapUrl) continue;
  if (tries >= MAX_GEO) break;
  tries++;
  try {
    const h = await get(p.mapUrl, 1);
    const c = h ? parseCoords(h) : null;
    if (c) { geo[p.id] = c; found++; misses = 0; }
    else if (++misses >= 8) { console.warn('Το vrisko σταμάτησε να δίνει θέσεις, συνεχίζω την επόμενη φορά.'); break; }
  } catch { if (++misses >= 8) break; }
  if (found && found % 50 === 0) await save('geo-gr.json', geo);
  await sleep(1500);
  if (tries % 25 === 0) console.log(`  vrisko θέσεις: ${found}/${tries}`);
}
await save('geo-gr.json', geo);
console.log(`Νέες θέσεις από vrisko: ${found} (από ${tries} δοκιμές)`);

// 3) Φαρμακεία ανά περιοχή
const now = athensNow();
const oldByArea = new Map();
for (const p of old.pharmacies || []) { if (!oldByArea.has(p.r)) oldByArea.set(p.r, []); oldByArea.get(p.r).push(p); }

// Το vrisko δίνει άδειες σελίδες μετά από ~150-180 αιτήματα. Γι' αυτό κάθε ενημέρωση διαβάζει
// ένα κομμάτι των περιοχών (από εκεί που σταμάτησε η προηγούμενη) και για τις υπόλοιπες κρατά τα παλιά.
const PER_RUN = +process.env.AREAS_PER_RUN || 120;
const cur = await readJson('cursor.json', { next: 0 });
const list0 = areas.items.filter((a) => !SKIP.has(a.slug));
const start = (cur.next || 0) % list0.length;
const order = [...list0.slice(start), ...list0.slice(0, start)];
const fresh = new Set();
let ok = 0, blocked = 0, read = 0;
for (const a of order) {
  if (read >= PER_RUN || blocked >= 3 || timeLeft() < 15 * 60000) break;
  read++;
  try {
    const h = await get(`${BASE}/efimeries-farmakeion/${a.slug}/`, 2);
    if (h === null) { fresh.add(a.slug); ok++; oldByArea.set(a.slug, []); continue; }
    if (!h.includes('DutiesResults')) { blocked++; read--; console.warn('Άδεια/μπλοκαρισμένη σελίδα:', a.slug); continue; }
    blocked = 0; ok++; fresh.add(a.slug);
    oldByArea.set(a.slug, merge(parseList(h)));
  } catch (e) { blocked++; }
  await sleep(2000);
}
await save('cursor.json', { next: (start + read) % list0.length, at: now });
console.log(`Περιοχές: διαβάστηκαν ${ok} (από τη θέση ${start}), μπλοκαρίσματα: ${blocked}`);

const all = new Map();
for (const a of areas.items) {
  if (SKIP.has(a.slug)) continue;
  for (const p of oldByArea.get(a.slug) || []) {
    if (all.has(p.id)) { const q = all.get(p.id); for (const s of p.slots) if (!q.slots.some((x) => x.from === s.from && x.to === s.to)) q.slots.push(s); continue; }
    all.set(p.id, { ...p, r: a.slug });
  }
}

// 3β) Όσα δεν πήραν θέση από το vrisko: από τη διεύθυνση, μέσω OpenStreetMap
const townOf = Object.fromEntries(areas.items.map((a) => [a.slug, a.name]));
let osm = 0, osmTried = 0;
const MAX_OSM = +process.env.MAX_OSM || 250;
for (const p of all.values()) {
  if (geo[p.id] || patraGeo[p.id] || osmTried >= MAX_OSM || timeLeft() < 6 * 60000) continue;
  osmTried++;
  try { const c = await geocode(p, townOf[p.r]); if (c) { geo[p.id] = c; osm++; } }
  catch (e) { console.warn('OpenStreetMap:', e.message); if (/429|403/.test(e.message)) break; }
  if (osmTried % 25 === 0) console.log(`  OpenStreetMap: ${osm}/${osmTried}`);
  if (osm && osm % 50 === 0) await save('geo-gr.json', geo);
}
await save('geo-gr.json', geo);
console.log(`Θέσεις από OpenStreetMap: ${osm} από ${osmTried}`);

// 4) Αρχείο για το σάιτ (σύντομα ονόματα πεδίων για μικρό μέγεθος)
const names = Object.fromEntries(areas.items.map((a) => [a.slug, a.name]));
const pharmacies = [...all.values()]
  .map((p) => {
    const c = geo[p.id] || patraGeo[p.id];
    return { id: p.id, name: p.name, address: p.address, area: p.area !== 'Πάτρα' ? p.area : '', town: names[p.r] || '', zip: p.zip, phone: p.phone, mapUrl: p.mapUrl, r: p.r,
      lat: c ? c[0] : null, lng: c ? c[1] : null, ap: c && c[2] ? 1 : undefined, slots: p.slots.filter((s) => s.to > now).sort((x, y) => x.from.localeCompare(y.from)) };
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
