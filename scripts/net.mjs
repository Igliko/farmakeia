// Λήψη σελίδων από το vrisko.gr με curl (το vrisko δέχεται μόνο αιτήματα που μοιάζουν με κανονικό browser)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HEADERS = [
  'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language: el-GR,el;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests: 1',
  'Sec-Fetch-Dest: document',
  'Sec-Fetch-Mode: navigate',
  'Sec-Fetch-Site: none',
];
export const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

export async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const args = ['-sS', '-L', '--compressed', '--max-time', '30', '-A', UA, ...HEADERS.flatMap((h) => ['-H', h]), '-w', '\n%{http_code}', url];
      const { stdout } = await run('curl', args, { maxBuffer: 20 * 1024 * 1024 });
      const cut = stdout.lastIndexOf('\n');
      const code = stdout.slice(cut + 1);
      if (code === '200') return stdout.slice(0, cut);
      if (code === '404') return null;
      console.warn('HTTP', code, url);
    } catch (e) { console.warn('fetch error', url, e.message); }
    await sleep(3000 * (i + 1));
  }
  throw new Error('Δεν απάντησε: ' + url);
}

// Ώρα Αθήνας ως "YYYY-MM-DDTHH:MM"
export function athensNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
