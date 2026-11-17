// Cloudflare Pages Function: GET /api/gtts?tl=sk&q=text -> audio/mpeg
// Bezplatný Google hlas (bez kľúča). Text sa rozdelí na kúsky do ~190 znakov a MP3 sa spoja.
// Prehráva sa ako bežný zvuk, takže funguje aj na iPade (aj v tichom režime), kde systémová reč často mlčí.

const LANGS = new Set(['sk', 'cs']);
const MAX_CHARS = 600;
const RATE_LIMIT = 150;
const hits = new Map();

const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

function sameOrigin(request) {
  const h = request.headers;
  if (h.get('Sec-Fetch-Site') === 'same-origin') return true;
  const hosts = new Set([new URL(request.url).host, h.get('Host'), h.get('X-Forwarded-Host')].filter(Boolean));
  for (const v of [h.get('Origin'), h.get('Referer')]) {
    if (!v) continue;
    try { if (hosts.has(new URL(v).host)) return true; } catch (e) {}
  }
  return false;
}
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) hits.delete(hits.keys().next().value);
  return arr.length > RATE_LIMIT;
}
// rozdelí text na kúsky do max dĺžky, najradšej za interpunkciou, inak za medzerou
function chunks(text, max = 190) {
  const out = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = -1;
    for (const re of [/[.!?…]\s/g, /[,;:]\s/g, /\s/g]) {
      let m; while ((m = re.exec(rest)) && m.index < max) cut = m.index + 1;
      if (cut > 0) break;
    }
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  const tl = LANGS.has(url.searchParams.get('tl')) ? url.searchParams.get('tl') : 'sk';
  if (!q) return json({ configured: true }, 200);          // test dostupnosti
  if (!sameOrigin(request)) return json({ error: 'forbidden origin' }, 403);

  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/gtts-cache?tl=' + tl + '&q=' + encodeURIComponent(q), request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  if (rateLimited(request.headers.get('CF-Connecting-IP') || 'x')) return json({ error: 'rate limit' }, 429);

  const parts = chunks(q);
  const bufs = [];
  for (let i = 0; i < parts.length; i++) {
    const g = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + tl +
      '&total=' + parts.length + '&idx=' + i + '&textlen=' + parts[i].length + '&q=' + encodeURIComponent(parts[i]);
    const r = await fetch(g, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Referer': 'https://translate.google.com/',
      },
    });
    if (!r.ok) return json({ error: 'upstream ' + r.status }, 502);
    bufs.push(new Uint8Array(await r.arrayBuffer()));
  }
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const all = new Uint8Array(total);
  let off = 0; for (const b of bufs) { all.set(b, off); off += b.length; }

  const res = new Response(all, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=2592000' } });
  await cache.put(cacheKey, res.clone());
  return res;
}
