// Όλα τα φαρμακεία της Ελλάδας από το OpenStreetMap (Overpass API) -> data/all.json
// Τρέχει μία φορά την εβδομάδα. Τα δεδομένα: © OpenStreetMap contributors (ODbL).
import { writeFile, readFile } from 'node:fs/promises';

const OUT = new URL('../data/all.json', import.meta.url);
const UA = 'farmakeia/1.0 (https://github.com/Igliko/farmakeia)';
const QUERY = `[out:json][timeout:300];
area["ISO3166-1"="GR"][admin_level=2]->.gr;
(node["amenity"="pharmacy"](area.gr);way["amenity"="pharmacy"](area.gr);relation["amenity"="pharmacy"](area.gr););
out center tags;`;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

try {
  const old = JSON.parse(await readFile(OUT, 'utf8'));
  const age = Date.now() - new Date(old.updated).getTime();
  if (age < 6.5 * 864e5 && !process.env.FORCE) { console.log('Τα φαρμακεία OSM είναι φρέσκα, δεν χρειάζεται ενημέρωση.'); process.exit(0); }
} catch { /* πρώτη φορά */ }

let data = null;
for (const s of SERVERS) {
  try {
    const r = await fetch(s, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(QUERY), signal: AbortSignal.timeout(330000) });
    if (!r.ok) { console.warn(s, r.status); continue; }
    data = await r.json();
    if (data?.elements?.length) break;
  } catch (e) { console.warn(s, e.message); }
}
if (!data?.elements?.length) throw new Error('Το OpenStreetMap δεν απάντησε.');

const t = (x, k) => (x.tags && x.tags[k]) || '';
const items = [];
for (const e of data.elements) {
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (lat == null || lon == null) continue;
  if (t(e, 'disused:amenity') || t(e, 'healthcare') === 'no') continue;
  const street = [t(e, 'addr:street'), t(e, 'addr:housenumber')].filter(Boolean).join(' ');
  const town = t(e, 'addr:city') || t(e, 'addr:place') || t(e, 'addr:suburb');
  const name = t(e, 'name:el') || t(e, 'name') || 'Φαρμακείο';
  const phone = (t(e, 'phone') || t(e, 'contact:phone')).split(';')[0].replace(/[^\d+]/g, '').replace(/^\+30/, '');
  // [lat, lng, όνομα, διεύθυνση, πόλη, τηλέφωνο, ωράριο OSM]
  items.push([+lat.toFixed(5), +lon.toFixed(5), name, street, town, phone, t(e, 'opening_hours')]);
}
items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), source: 'OpenStreetMap', items }) + '\n');
console.log(`OK: ${items.length} φαρμακεία από το OpenStreetMap.`);
