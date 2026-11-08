// Deal Command sync API (Cloudflare Pages Function + D1).
// Who you are comes from Cloudflare Access (email sign in). Only emails listed in USERS get in.
// Env vars: USERS = "sam:you@mail.com,rachel:her@mail.com", TEAM_DOMAIN = "yourteam.cloudflareaccess.com",
//           POLICY_AUD = the Access application's audience tag. D1 binding: DB.

const KEY_OK = /^dc4_(saved|rachel|capsule|gifts|setup|tryon|cart_[a-z]+|dnb|wish|claims)$/;
const SHARED_KEYS = ['dc4_saved', 'dc4_dnb', 'dc4_wish'];
const NAMES = { sam: 'Sam', rachel: 'Rachel' };
let schemaReady = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function b64urlBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJson(s) { return JSON.parse(new TextDecoder().decode(b64urlBytes(s))); }

let certCache = { at: 0, keys: [] };
async function accessEmail(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/CF_Authorization=([^;]+)/);
  const token = request.headers.get('cf-access-jwt-assertion') || (m && m[1]);
  if (!token || !env.TEAM_DOMAIN || !env.POLICY_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch (e) { return null; }
  if (Date.now() - certCache.at > 3600e3) {
    const r = await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`);
    if (!r.ok) return null;
    certCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = certCache.keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok || !payload.exp || payload.exp * 1000 < Date.now()) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.POLICY_AUD)) return null;
  return (payload.email || '').toLowerCase() || null;
}
function userMap(env) {
  const map = {};
  String(env.USERS || '').split(',').forEach(pair => {
    const [u, e] = pair.split(':').map(x => (x || '').trim());
    if (u && e && NAMES[u]) map[e.toLowerCase()] = u;
  });
  return map;
}
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS kv (user TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user, key))').run();
  schemaReady = true;
}
// Gifts stay secret: anything the other person saved, flagged or wished FOR you is hidden from you.
function hideGiftsFor(me, key, raw) {
  let v; try { v = JSON.parse(raw); } catch (e) { return null; }
  if (key === 'dc4_saved' && Array.isArray(v)) return v.filter(s => s && s.for !== me);
  if (key === 'dc4_wish' && Array.isArray(v)) return v.filter(w => w && w.for !== me);
  if (key === 'dc4_dnb' && v && typeof v === 'object') return v;
  return null;
}

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path || []).join('/');
  if (!env.DB) return json({ error: 'Database is not connected yet (D1 binding DB missing).' }, 503);
  const email = await accessEmail(request, env);
  if (!email) return json({ error: 'Not signed in.' }, 401);
  const me = userMap(env)[email];
  if (!me) return json({ error: 'This email is not on the list.' }, 403);
  const other = me === 'sam' ? 'rachel' : 'sam';
  await ensureSchema(env.DB);

  if (path === 'me') return json({ user: me, other, name: NAMES[me], otherName: NAMES[other] });

  if (path === 'state' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT key, value, updated FROM kv WHERE user = ?').bind(me).all();
    const out = {};
    (results || []).forEach(r => { out[r.key] = { v: r.value, t: r.updated }; });
    return json({ user: me, items: out });
  }

  if (path === 'state' && request.method === 'PUT') {
    let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
    const items = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
    const stmts = [];
    for (const it of items) {
      if (!it || !KEY_OK.test(it.k) || typeof it.v !== 'string' || it.v.length > 400000) continue;
      const t = Math.min(Number(it.t) || Date.now(), Date.now() + 60000);
      stmts.push(env.DB.prepare(
        'INSERT INTO kv (user, key, value, updated) VALUES (?, ?, ?, ?) ON CONFLICT(user, key) DO UPDATE SET value = excluded.value, updated = excluded.updated WHERE excluded.updated >= kv.updated'
      ).bind(me, it.k, it.v, t));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, saved: stmts.length });
  }

  if (path === 'shared' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT key, value, updated FROM kv WHERE user = ? AND key IN (${SHARED_KEYS.map(() => '?').join(',')})`
    ).bind(other, ...SHARED_KEYS).all();
    const out = { user: other, name: NAMES[other], saved: [], dnb: {}, wish: [], updated: 0 };
    (results || []).forEach(r => {
      const v = hideGiftsFor(me, r.key, r.value);
      if (v == null) return;
      out[r.key.replace('dc4_', '')] = v;
      out.updated = Math.max(out.updated, r.updated);
    });
    return json(out);
  }

  return json({ error: 'Not found' }, 404);
}
