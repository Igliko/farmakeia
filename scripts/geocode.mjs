// Θέση από διεύθυνση μέσω OpenStreetMap (Nominatim).
// Κανόνες Nominatim: το πολύ 1 αίτημα/δευτερόλεπτο, δικό μας User-Agent, αποθήκευση αποτελεσμάτων (τα κρατάμε στο geo-gr.json).
import { sleep } from './net.mjs';

const UA = 'farmakeia/1.0 (https://github.com/Igliko/farmakeia)';
let last = 0;
export let requests = 0;

async function search(params) {
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  requests++;
  const u = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'gr', 'accept-language': 'el', ...params });
  const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (r.status === 429 || r.status === 403) throw new Error('nominatim ' + r.status);
  if (!r.ok) return null;
  const j = await r.json();
  return j[0] ? [+(+j[0].lat).toFixed(6), +(+j[0].lon).toFixed(6)] : null;
}

// "Βενιζέλου Ελευθερίου 39 & Κύπρου, Πλησίον ..." -> παραλλαγές οδού + αριθμού
function variants(address) {
  const first = address.split(/[,&]/)[0].replace(/\s+/g, ' ').trim();
  const m = first.match(/^(.*?)\s+(\d+[Α-Ωα-ωA-Za-z]?(?:-\d+)?)$/);
  const street = (m ? m[1] : first).replace(/^(Λεωφόρος|Λεωφ\.|Οδός)\s+/i, '').trim();
  const num = m ? m[2].split('-')[0] : '';
  const out = [street];
  const w = street.split(' ');
  if (w.length === 2) out.push(w[1] + ' ' + w[0]); // «Βενιζέλου Ελευθερίου» -> «Ελευθερίου Βενιζέλου»
  return { streets: [...new Set(out)], num };
}

// Επιστρέφει [lat, lng] ή [lat, lng, 1] όταν είναι κατά προσέγγιση (κέντρο ταχυδρομικού κώδικα / πόλης)
export async function geocode(p, town) {
  const { streets, num } = variants(p.address || '');
  for (const s of streets) {
    const c = await search({ street: (num ? num + ' ' : '') + s, postalcode: p.zip || '', city: town || '' });
    if (c) return c;
  }
  if (p.zip) { const c = await search({ postalcode: p.zip }); if (c) return [...c, 1]; }
  return null;
}
