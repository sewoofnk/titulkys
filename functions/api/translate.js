// Cloudflare Pages Function: POST /api/translate
//   { text, context: [posledných ~5 viet], target: 'sk'|'cs', source, glossary, image? } -> { fixed, translation, skip }
// Ak je zadaný `image` (base64 JPEG), AI text z obrázka najprv prečíta (vision režim).
// Env (Secrets): AI_KEY
//   AI_PROVIDER = 'gemini' (predvolené) | 'claude'
//   AI_MODEL    = voliteľne názov modelu (over aktuálne názvy v dokumentácii poskytovateľa)

const DEFAULT_MODEL = { gemini: 'gemini-2.5-flash', claude: 'claude-haiku-5-5' };
const MAX_TEXT = 600, MAX_IMAGE = 400000, MAX_GLOSSARY = 2000;
const RATE_LIMIT = 60;
const TIMEOUT_MS = 4000;
const hits = new Map();

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const LANG = { sk: 'slovenčiny', cs: 'češtiny' };

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

function systemPrompt(target, glossary, vision) {
  return `Si prekladateľ titulkov z hry GTA V do ${LANG[target]}. ` +
    (vision
      ? 'Vstup je obrázok z TV s oblasťou titulkov. Najprv text z obrázka prečítaj (pole "fixed"). Ak v obraze nie je titulok alebo zmysluplná veta, vráť skip=true. '
      : 'Vstup je text z OCR, môže obsahovať preklepy a nezmysly. ') +
    '1) Oprav zjavné chyby OCR (pole "fixed" je opravený pôvodný text). ' +
    `2) Prelož prirodzene a hovorovo do ${LANG[target]}, ako by to povedala daná postava, zachovaj slang a nadávky primerane. ` +
    '3) Nemeň vlastné mená (Franklin, Michael, Trevor, Lamar, Los Santos, Vinewood…). ' +
    '4) Ak vstup nie je zmysluplná veta, vráť skip=true. ' +
    'Predošlé vety dostaneš v poli "context" kvôli nadväznosti dialógu; neprekladaj ich znova. ' +
    (glossary ? 'Povinný glosár (originál = preklad), drž sa ho:\n' + glossary + '\n' : '') +
    'Odpovedz iba JSON bez ďalšieho textu: {"fixed": "...", "translation": "...", "skip": false}';
}

async function callGemini(env, system, userText, image, signal) {
  const model = env.AI_MODEL || DEFAULT_MODEL.gemini;
  const parts = [{ text: userText }];
  if (image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.AI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 400 },
    }),
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

async function callClaude(env, system, userText, image, signal) {
  const model = env.AI_MODEL || DEFAULT_MODEL.claude;
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } });
  content.push({ type: 'text', text: userText });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': env.AI_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 400, temperature: 0.3, system, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error('claude ' + r.status);
  const j = await r.json();
  return (j.content || []).map(c => c.text || '').join('');
}

function parseJson(t) {
  const m = String(t).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('bad ai json');
  const o = JSON.parse(m[0]);
  return {
    fixed: String(o.fixed || '').slice(0, MAX_TEXT),
    translation: String(o.translation || '').slice(0, MAX_TEXT),
    skip: o.skip === true || !String(o.translation || '').trim(),
  };
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
  if (!sameOrigin(request)) return json({ error: 'forbidden origin' }, 403);
  if (!env.AI_KEY) return json({ error: 'not configured' }, 503);

  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const target = b.target === 'cs' ? 'cs' : 'sk';
  const text = String(b.text || '').trim().slice(0, MAX_TEXT);
  const image = typeof b.image === 'string' && b.image.length < MAX_IMAGE && /^[A-Za-z0-9+/=]+$/.test(b.image) ? b.image : '';
  if (!text && !image) return json({ error: 'empty' }, 400);
  const context = (Array.isArray(b.context) ? b.context : []).slice(-5).map(s => String(s).slice(0, 300));
  const glossary = String(b.glossary || '').slice(0, MAX_GLOSSARY);
  const source = String(b.source || '').slice(0, 20);

  const provider = (env.AI_PROVIDER || 'gemini').toLowerCase();
  const ip = request.headers.get('CF-Connecting-IP') || 'x';

  // cache (iba textový režim)
  const cache = caches.default;
  let cacheKey = null;
  if (!image) {
    const hash = await sha256([provider, env.AI_MODEL || '', target, source, glossary, context.join('\n'), text].join('|'));
    cacheKey = new Request(new URL('/api/translate-cache/' + hash, request.url).toString());
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  if (rateLimited(ip)) return json({ error: 'rate limit' }, 429);

  const userText = JSON.stringify({ source_language: source || 'neznámy', context, text: image ? '(pozri obrázok)' : text });
  const system = systemPrompt(target, glossary, !!image);
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const raw = provider === 'claude'
      ? await callClaude(env, system, userText, image, ac.signal)
      : await callGemini(env, system, userText, image, ac.signal);
    const out = parseJson(raw);
    const res = json(out);
    if (cacheKey) {
      const c = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=2592000' } });
      await cache.put(cacheKey, c);
    }
    return res;
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  } finally { clearTimeout(to); }
}

// GET: či je služba nastavená (frontend sa podľa toho rozhodne hneď pri načítaní)
export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({ configured: !!env.AI_KEY }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
