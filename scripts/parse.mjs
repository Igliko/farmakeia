// Καθαρές συναρτήσεις: διαβάζουν το HTML του vrisko.gr (χωρίς εξαρτήσεις).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (ENT[e] !== undefined) return ENT[e];
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
const pad = (n) => String(n).padStart(2, '0');
function addDay(y, m, d, k) {
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Επιστρέφει [{name, type, tags, address, area, zip, phone, mapUrl, id, day, slots:[{from,to}]}]
export function parseList(html) {
  const out = [];
  const parts = html.split(/<section class="DutiesResult"/).slice(1);
  for (let raw of parts) {
    raw = raw.split('</section>')[0];
    const name = clean((raw.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1]);
    if (!name) continue;
    const tags = [...raw.matchAll(/<span class="operation\w*Tag">([\s\S]*?)<\/span>/g)].map((m) => clean(m[1]));
    const type = tags.some((t) => /Διευρυμ/.test(t)) ? 'extended' : 'duty';
    const addrFull = clean((raw.match(/pharmacies-card-address">\s*<span>([\s\S]*?)<\/span>/) || [])[1]);
    const phone = (clean((raw.match(/pharmacies-phone-icon"><\/div>([\s\S]*?)<\/div>/) || [])[1]).match(/[\d ]{10,}/) || [''])[0].replace(/\s/g, '');
    const mapUrl = (raw.match(/href="(https:\/\/www\.vrisko\.gr\/(?:adv)?details\/map\/[^"]+)"/) || [])[1] || '';
    const id = mapUrl.split('/').pop() || name;
    const dayTxt = clean((raw.match(/class="DutyDay">([\s\S]*?)<\/div>\s*<\/div>/) || [])[1]);
    const dm = dayTxt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!dm) continue;
    const [D, M, Y] = [+dm[1], +dm[2], +dm[3]];
    const day = addDay(Y, M, D, 0);
    const timesTxt = clean((raw.match(/class="DutyTimes">([\s\S]*?)<\/div>\s*(?:<\/div>\s*)?<\/div>\s*$/) || raw.match(/class="DutyTimes">([\s\S]*)/) || [])[1]);
    const slots = [];
    for (const t of timesTxt.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
      const a = +t[1] * 60 + +t[2], b = +t[3] * 60 + +t[4];
      const next = b <= a ? 1 : 0;
      slots.push({ from: `${day}T${pad(t[1])}:${t[2]}`, to: `${addDay(Y, M, D, next)}T${pad(t[3])}:${t[4]}` });
    }
    if (!slots.length) continue;
    // "Οδός 1, Πάτρα - Αγυιά, 26442, ΑΧΑΪΑΣ" -> address / area / zip
    const bits = addrFull.split(',').map((s) => s.trim()).filter(Boolean);
    if (bits.length && /^[Ά-Ϋ\s]+$/.test(bits[bits.length - 1]) && bits[bits.length - 1] === bits[bits.length - 1].toUpperCase()) bits.pop();
    let zip = '';
    if (bits.length && /^\d{5}$/.test(bits[bits.length - 1])) zip = bits.pop();
    let area = 'Πάτρα';
    const ai = bits.findIndex((b, i) => i > 0 && /^Πάτρα/.test(b));
    if (ai > 0) { area = bits[ai].replace(/^Πάτρα\s*-\s*/, '') || 'Πάτρα'; bits.splice(ai, 1); }
    const address = bits.join(', ');
    out.push({ id, name, type, tags, address, area, zip, phone, mapUrl, day, slots });
  }
  return out;
}

export function parseCoords(html) {
  const m = html.match(/"latitude"\s*:\s*"?(-?\d+\.\d+)"?[\s\S]{0,80}?"longitude"\s*:\s*"?(-?\d+\.\d+)/)
    || html.match(/DecLatitude"?\s*:\s*(-?\d+\.\d+)[\s\S]{0,80}?DecLongitude"?\s*:\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return lat > 34 && lat < 42 && lng > 19 && lng < 30 ? [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6] : null;
}

// Ενώνει τις εγγραφές ανά φαρμακείο
export function merge(entries) {
  const by = new Map();
  for (const e of entries) {
    let p = by.get(e.id);
    if (!p) { p = { id: e.id, name: e.name, address: e.address, area: e.area, zip: e.zip, phone: e.phone, mapUrl: e.mapUrl, slots: [] }; by.set(e.id, p); }
    for (const s of e.slots) if (!p.slots.some((x) => x.from === s.from && x.to === s.to)) p.slots.push({ ...s, type: e.type });
  }
  for (const p of by.values()) p.slots.sort((a, b) => a.from.localeCompare(b.from));
  return [...by.values()];
}
