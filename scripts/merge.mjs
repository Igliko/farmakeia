// Ενώνει τα φαρμακεία από OpenStreetMap (data/osm.json) και Overture Maps (data/overture.json) -> data/all.json
// Διπλά: ίδιο σημείο (< 35 μ.), ή κοντά (< 150 μ.) με παρόμοιο όνομα. Το OpenStreetMap έχει προτεραιότητα (έχει ωράρια).
import { readFile, writeFile } from 'node:fs/promises';

const D = new URL('../data/', import.meta.url);
const read = async f => { try { return JSON.parse(await readFile(new URL(f, D), 'utf8')); } catch { return null; } };

function m(a, b) { const dy = (a[0] - b[0]) * 111320, dx = (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180); return Math.hypot(dx, dy); }
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/φαρμακει[οα]|pharmacy|farmakeio|φαρμακοποιος|\bοε\b|\bεε\b|\bικε\b|[^a-zα-ω0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
function sameName(a, b) { const A = norm(a), B = new Set(norm(b)); if (!A.length || !B.size) return false; return A.some(w => B.has(w)); }

export async function merge() {
  const osm = await read('osm.json'), ov = await read('overture.json');
  if (!osm && !ov) return;
  const out = [], grid = new Map(), K = 1 / 500; // κελιά ~200 μ.
  const key = (lat, lng) => Math.floor(lat / K) + ':' + Math.floor(lng / K);
  const near = it => { const a = Math.floor(it[0] / K), b = Math.floor(it[1] / K); const r = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const x of grid.get((a + i) + ':' + (b + j)) || []) r.push(x); return r; };
  const add = it => { out.push(it); const k = key(it[0], it[1]); (grid.get(k) || grid.set(k, []).get(k)).push(it); };
  let dup = 0;
  for (const it of osm?.items || []) add(it);
  for (const it of ov?.items || []) {
    const isDup = near(it).some(o => { const d = m(o, it); return d < 35 || (d < 150 && sameName(o[2], it[2])); });
    if (isDup) { dup++; continue; }
    add(it);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const src = ['OpenStreetMap', ov ? 'Overture Maps' : ''].filter(Boolean).join(' + ');
  const prev = await read('all.json');
  const same = prev && prev.source === src && JSON.stringify(prev.items) === JSON.stringify(out);
  if (!same) await writeFile(new URL('all.json', D), JSON.stringify({ updated: new Date().toISOString(), source: src, items: out }) + '\n');
  console.log(`Σύνολο: ${out.length} φαρμακεία (OSM ${osm?.items?.length || 0}, Overture ${ov?.items?.length || 0}, διπλά ${dup})${same ? ' — καμία αλλαγή' : ''}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await merge();
