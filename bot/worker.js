// Telegram bot «Εφημερίες Φαρμακείων» — τρέχει στο Cloudflare Workers.
// Παίρνει τα δεδομένα από το σάιτ (GitHub Pages), δεν διαβάζει ποτέ το vrisko.
// Αποθηκεύει (KV) μόνο: τελευταία τοποθεσία (για «Ειδοποίησέ με») και τη συνδρομή στις βραδινές ειδοποιήσεις.

const SITE = 'https://igliko.github.io/farmakeia/';
const BTN_LOC = '📍 Στείλε τοποθεσία';
const BTN_SUB = '🔔 Ειδοποίησέ με κάθε βράδυ';
const BTN_UNSUB = '🔕 Σταμάτα τις ειδοποιήσεις';

// ---------- χρόνος (ώρα Ελλάδας) ----------
function athensNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const mins = (s) => { const [d, t] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, h, mi) / 60000; };
const hhmm = (s) => s.slice(11, 16);

export function status(p, n) {
  const cur = p.slots.filter((s) => s.from <= n && n < s.to).sort((a, b) => b.to.localeCompare(a.to))[0];
  if (cur) return { k: 'open', left: mins(cur.to) - mins(n), until: hhmm(cur.to) };
  const nx = p.slots.filter((s) => s.from > n).sort((a, b) => a.from.localeCompare(b.from))[0];
  if (nx) return { k: 'later', inM: mins(nx.from) - mins(n), from: hhmm(nx.from), until: hhmm(nx.to) };
  return { k: 'off' };
}

// ---------- απόσταση ----------
export function km(a, b) { const R = 6371, t = (x) => x * Math.PI / 180, dl = t(b[0] - a[0]), dn = t(b[1] - a[1]); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) * 1.3; }
const distText = (d) => (d < 1 ? Math.round(d * 100) * 10 + ' μ.' : d.toFixed(1).replace('.', ',') + ' χλμ');
const travel = (d) => (d <= 2 ? { t: Math.max(1, Math.ceil(d * 1000 / 80)), how: 'με τα πόδια' } : { t: Math.max(3, Math.ceil(d * 2.4 + 2)), how: 'με αμάξι' });
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ').trim();

// ---------- δεδομένα από το σάιτ ----------
async function getJson(name) {
  const r = await fetch(SITE + 'data/' + name, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return r.json();
}
export async function loadPharmacies(fetchJson = getJson) {
  const [pa, gr] = await Promise.allSettled([fetchJson('patra.json'), fetchJson('greece.json')]);
  const seen = new Set(), list = [];
  for (const p of pa.value?.pharmacies || []) if (p.lat != null) { seen.add(p.id); list.push({ ...p, town: 'Πάτρα' }); }
  for (const p of gr.value?.pharmacies || []) if (p.lat != null && !seen.has(p.id)) { seen.add(p.id); list.push(p); }
  return list;
}

// Τα κοντινότερα ανοιχτά (ή όσα ανοίγουν σύντομα) γύρω από ένα σημείο
export function nearest(list, at, n, { tonight = false } = {}) {
  const now = athensNow();
  const rows = list.map((p) => ({ p, d: km(at, [p.lat, p.lng]), st: status(p, now) })).filter((x) => x.d < 40);
  if (tonight) {
    // απόψε: όσα είναι ανοιχτά στις 22:00 σήμερα
    const t = now.slice(0, 10) + 'T22:00';
    return rows.filter((x) => x.p.slots.some((s) => s.from <= t && t < s.to)).sort((a, b) => a.d - b.d).slice(0, n);
  }
  const open = rows.filter((x) => x.st.k === 'open').sort((a, b) => a.d - b.d).slice(0, n);
  const later = rows.filter((x) => x.st.k === 'later' && x.st.inM <= 12 * 60).sort((a, b) => a.st.inM - b.st.inM || a.d - b.d).slice(0, Math.max(0, n - open.length));
  return [...open, ...later];
}

export function formatRow({ p, d, st }, { tonight = false } = {}) {
  const tr = travel(d);
  let line;
  if (tonight) {
    const s = p.slots.find((x) => x.from <= athensNow().slice(0, 10) + 'T22:00' && athensNow().slice(0, 10) + 'T22:00' < x.to);
    line = s ? `🌙 ${hhmm(s.from)} – ${hhmm(s.to)}` : '';
  } else if (st.k === 'open') {
    const ok = tr.t <= st.left - 3;
    line = `🟢 Ανοιχτό ως ${st.until} · ${ok ? `✓ προλαβαίνεις (${tr.t}′ ${tr.how})` : `✕ δεν προλαβαίνεις (${tr.t}′ ${tr.how}, κλείνει σε ${st.left}′)`}`;
  } else {
    line = `🟠 Ανοίγει ${st.from} (σε ${st.inM >= 60 ? Math.floor(st.inM / 60) + ' ώρ. ' : ''}${st.inM % 60}′)`;
  }
  const parts = [];
  for (const x of [p.address, p.area, p.town]) if (x && !parts.some((y) => y.includes(x))) parts.push(x);
  // το Telegram κάνει μόνο του τα τηλέφωνα «πατήσιμα»
  return `💊 <b>${esc(p.name)}</b>\n${esc(parts.join(', '))}\n${line} · ${distText(d)}${p.phone ? `\n📞 ${p.phone}` : ''}`;
}

const dirBtn = ({ p }, i) => ({ text: `🧭 Οδηγίες ${i + 1}`, url: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` });
const keyboard = (subscribed) => ({
  keyboard: [[{ text: BTN_LOC, request_location: true }], [{ text: subscribed ? BTN_UNSUB : BTN_SUB }]],
  resize_keyboard: true, is_persistent: true,
});

// ---------- Telegram ----------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}
const send = (env, chat, text, extra = {}) => tg(env, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

async function answerFor(env, chat, at, label) {
  const rows = nearest(await loadPharmacies(), at, 3);
  if (!rows.length) return send(env, chat, `Δεν βρήκα ανοιχτό φαρμακείο ${label} σε απόσταση 40 χλμ.\nΔες τον χάρτη: ${SITE}`);
  const head = `Τα πιο κοντινά φαρμακεία ${label} τώρα (${athensNow().slice(11)}):\n\n`;
  const text = head + rows.map((r) => formatRow(r)).join('\n\n') + `\n\n<i>Οι εφημερίες αλλάζουν καμιά φορά. Πάρε τηλέφωνο πριν πας.</i>`;
  return send(env, chat, text, { reply_markup: { inline_keyboard: [rows.map(dirBtn), [{ text: '🗺️ Άνοιξε τον χάρτη', url: SITE }]] } });
}

export async function handleUpdate(env, u) {
  const m = u.message || u.edited_message;
  if (!m || !m.chat) return;
  const chat = m.chat.id;
  const subKey = 'sub:' + chat, locKey = 'loc:' + chat;
  const subscribed = !!(await env.KV.get(subKey));

  if (m.location) {
    const at = [m.location.latitude, m.location.longitude];
    await env.KV.put(locKey, JSON.stringify(at), { expirationTtl: 60 * 60 * 24 * 30 });
    if (subscribed) await env.KV.put(subKey, JSON.stringify(at));
    return answerFor(env, chat, at, 'κοντά σου');
  }
  const text = (m.text || '').trim();
  if (!text || /^\/(start|help)\b/.test(text)) {
    return send(env, chat,
      'Γεια! 👋 Σου βρίσκω <b>ανοιχτά φαρμακεία</b> κοντά σου, σε όλη την Ελλάδα.\n\n' +
      '• Πάτα <b>📍 Στείλε τοποθεσία</b> για τα πιο κοντινά τώρα\n' +
      '• Ή γράψε μια <b>πόλη</b>, π.χ. <i>Αίγιο</i>\n' +
      '• Πάτα <b>🔔 Ειδοποίησέ με</b> και θα σου στέλνω κάθε βράδυ στις 20:30 ποια εφημερεύουν κοντά σου\n\n' +
      `Χάρτης: ${SITE}`, { reply_markup: keyboard(subscribed) });
  }
  if (text === BTN_SUB || text === '/notify') {
    const loc = await env.KV.get(locKey);
    if (!loc) return send(env, chat, 'Πρώτα στείλε μου την τοποθεσία σου (κουμπί 📍), για να ξέρω ποια φαρμακεία είναι κοντά σου.', { reply_markup: keyboard(false) });
    await env.KV.put(subKey, loc);
    return send(env, chat, '🔔 Έγινε! Κάθε βράδυ στις 20:30 θα σου στέλνω ποια φαρμακεία εφημερεύουν απόψε κοντά σου.\nΓια να σταματήσει, πάτα 🔕.', { reply_markup: keyboard(true) });
  }
  if (text === BTN_UNSUB || text === '/stop') {
    await env.KV.delete(subKey);
    await env.KV.delete(locKey);
    return send(env, chat, '🔕 Σταμάτησαν οι ειδοποιήσεις και σβήστηκε η τοποθεσία σου.', { reply_markup: keyboard(false) });
  }
  // αναζήτηση πόλης
  const towns = await getJson('towns.json').catch(() => []);
  const q = norm(text.replace(/^\//, ''));
  const hit = towns.filter((t) => norm(t.n).includes(q)).sort((a, b) => norm(a.n).indexOf(q) - norm(b.n).indexOf(q) || a.n.length - b.n.length)[0];
  if (!hit || q.length < 2) return send(env, chat, `Δεν βρήκα πόλη «${esc(text)}». Δοκίμασε άλλο όνομα ή στείλε την τοποθεσία σου 📍.`, { reply_markup: keyboard(subscribed) });
  return answerFor(env, chat, hit.c, `στην περιοχή <b>${esc(hit.n)}</b>`);
}

// Βραδινές ειδοποιήσεις (το cron τρέχει 17:30 και 18:30 UTC· στέλνουμε όταν στην Ελλάδα είναι 20:xx)
export async function nightly(env, force = false) {
  if (!force && athensNow().slice(11, 13) !== '20') return 0;
  const list = await loadPharmacies();
  let cursor, sent = 0;
  do {
    const page = await env.KV.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const at = JSON.parse((await env.KV.get(k.name)) || 'null');
      if (!at) continue;
      const rows = nearest(list, at, 3, { tonight: true });
      const chat = k.name.slice(4);
      const text = rows.length
        ? '🌙 <b>Απόψε εφημερεύουν κοντά σου:</b>\n\n' + rows.map((r) => formatRow(r, { tonight: true })).join('\n\n')
        : '🌙 Απόψε δεν βρήκα εφημερεύον φαρμακείο κοντά σου στα δεδομένα μου. Δες τον χάρτη για περισσότερα.';
      const res = await send(env, chat, text, { reply_markup: { inline_keyboard: [rows.map(dirBtn), [{ text: '🗺️ Χάρτης', url: SITE }]].filter((r) => r.length) } });
      if (res && res.error_code === 403) await env.KV.delete(k.name); // ο χρήστης έκλεισε το bot
      sent++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return sent;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/telegram') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const u = await request.json();
      try { await handleUpdate(env, u); } catch (e) { console.error(e); }
      return new Response('ok');
    }
    return new Response('Εφημερίες Φαρμακείων · Telegram bot. Χάρτης: ' + SITE, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightly(env));
  },
};
