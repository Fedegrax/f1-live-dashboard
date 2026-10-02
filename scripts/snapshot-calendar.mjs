// Saves meetings + sessions (2023..current year) to docs/data/calendar.json.
// The dashboard uses it as a fallback when OpenF1 refuses unauthenticated calls during live sessions.
import { writeFileSync, mkdirSync } from 'node:fs';

const thisYear = new Date().getFullYear();
const out = { generated: new Date().toISOString(), meetings: [], sessions: [] };
for (let y = 2023; y <= thisYear; y++) {
  for (const [ep, key] of [['meetings', 'meetings'], ['sessions', 'sessions']]) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(`https://api.openf1.org/v1/${ep}?year=${y}`);
    if (!res.ok) throw new Error(`${ep} ${y}: ${res.status}`);
    out[key].push(...(await res.json()));
  }
}
const slim = s => { delete s.country_flag; delete s.circuit_image; delete s.circuit_info_url; return s; };
out.meetings.forEach(slim);
mkdirSync(new URL('../docs/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/data/calendar.json', import.meta.url), JSON.stringify(out));
console.log(`meetings ${out.meetings.length}, sessions ${out.sessions.length}`);
