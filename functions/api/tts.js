// Cloudflare Pages Function: POST /api/tts  { text, voice, rate, pitch } -> audio/mpeg
// Env (Settings -> Environment variables, ako Secrets): AZURE_KEY, AZURE_REGION

const VOICES = new Set([
  'sk-SK-LukasNeural', 'sk-SK-ViktoriaNeural',
  'cs-CZ-AntoninNeural', 'cs-CZ-VlastaNeural',
]);
const MAX_CHARS = 400;
const RATE_LIMIT = 40;          // max volaní na Azure za minútu z jednej IP (na jeden isolate)
const hits = new Map();

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const clamp = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) hits.delete(hits.keys().next().value);
  return arr.length > RATE_LIMIT;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// povoľ len požiadavky z vlastnej domény (rovnaký pôvod)
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

export async function onRequestPost({ request, env }) {
  // povoľ len vlastnú doménu
  if (!sameOrigin(request)) return json({ error: 'forbidden origin' }, 403);

  if (!env.AZURE_KEY || !env.AZURE_REGION) return json({ error: 'not configured' }, 503);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const text = String(body.text || '').trim().slice(0, MAX_CHARS);
  if (!text) return json({ error: 'empty' }, 400);
  const voice = VOICES.has(body.voice) ? body.voice : 'sk-SK-LukasNeural';
  const rate = clamp(body.rate, 0.5, 2, 1);
  const pitch = clamp(body.pitch, -50, 50, 0);   // v percentách
  const ratePct = Math.round((rate - 1) * 100);
  const sign = n => (n >= 0 ? '+' : '') + n + '%';

  // cache (rovnaká veta + hlas sa neplatí znova)
  const hash = await sha256([voice, ratePct, pitch, text].join('|'));
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/tts-cache/' + hash, request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const ip = request.headers.get('CF-Connecting-IP') || 'x';
  if (rateLimited(ip)) return json({ error: 'rate limit' }, 429);

  const lang = voice.slice(0, 5);
  const ssml = `<speak version="1.0" xml:lang="${lang}" xmlns="http://www.w3.org/2001/10/synthesis">` +
    `<voice name="${voice}"><prosody rate="${sign(ratePct)}" pitch="${sign(pitch)}">${esc(text)}</prosody></voice></speak>`;

  const r = await fetch(`https://${env.AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': env.AZURE_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'titulky-tts',
    },
    body: ssml,
  });
  if (!r.ok) return json({ error: 'upstream ' + r.status }, 502);

  const audio = await r.arrayBuffer();
  const res = new Response(audio, {
    headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=2592000' },
  });
  await cache.put(cacheKey, res.clone());
  return res;
}
