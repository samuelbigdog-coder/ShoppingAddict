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
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS kv (user TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user, key))'),
    db.prepare('CREATE TABLE IF NOT EXISTS deals (id TEXT PRIMARY KEY, who TEXT, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'live\', added INTEGER, checked INTEGER, by TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS retired (id TEXT PRIMARY KEY, reason TEXT, at INTEGER, by TEXT)'),
  ]);
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


// ---------- deal checker: opens a product page and reads photo, price, stock and title ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
async function md5id(store, name) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(store + '|' + name));
  return 'r' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
}
function absUrl(u, base) { try { return u ? new URL(u, base).toString() : null; } catch (e) { return null; } }
function pickLd(blocks) {
  const out = {};
  const visit = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(visit);
    if (o['@graph']) visit(o['@graph']);
    const t = [].concat(o['@type'] || []);
    if (t.includes('Product') || t.includes('ProductGroup')) {
      if (!out.name && o.name) out.name = String(o.name);
      if (!out.image && o.image) { const im = [].concat(o.image)[0]; out.image = typeof im === 'string' ? im : (im && (im.url || im.contentUrl)); }
      let of = [].concat(o.offers || (o.hasVariant && o.hasVariant[0] && o.hasVariant[0].offers) || [])[0];
      if (of && of.offers) of = [].concat(of.offers)[0];
      if (of) {
        if (out.price == null) out.price = of.price ?? of.lowPrice ?? (of.priceSpecification && of.priceSpecification.price);
        if (!out.avail && of.availability) out.avail = String(of.availability).split('/').pop();
      }
    }
  };
  for (const b of blocks) { try { visit(JSON.parse(b)); } catch (e) {} }
  return out;
}
async function inspect(url) {
  const res = { url, state: 'error' };
  let u; try { u = new URL(url); } catch (e) { res.state = 'bad_link'; return res; }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) { res.state = 'bad_link'; return res; }
  let r;
  try {
    r = await fetch(u.toString(), { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' } });
  } catch (e) { res.state = 'blocked'; res.note = 'Could not reach the store'; return res; }
  res.status = r.status; res.final = r.url;
  if (r.status === 404 || r.status === 410) { res.state = 'dead'; return res; }
  if (r.status === 403 || r.status === 429 || r.status === 503 || r.status === 202 || r.status >= 500) { res.state = 'blocked'; return res; }
  if (!r.ok) { res.state = 'blocked'; return res; }
  const meta = {}; const ld = []; let cur = ''; let title = '';
  const rw = new HTMLRewriter()
    .on('meta', { element(e) { const k = (e.getAttribute('property') || e.getAttribute('name') || e.getAttribute('itemprop') || '').toLowerCase(); const v = e.getAttribute('content'); if (k && v && !(k in meta)) meta[k] = v; } })
    .on('script[type="application/ld+json"]', { text(t) { if (cur.length < 300000) cur += t.text; if (t.lastInTextNode) { ld.push(cur); cur = ''; } } })
    .on('title', { text(t) { if (title.length < 300) title += t.text; } });
  await rw.transform(r).arrayBuffer();
  const p = pickLd(ld);
  const t = (title || '').trim();
  if (/access denied|just a moment|attention required|are you a robot|captcha|pardon our interruption|request blocked|client challenge|security check|verify you are human|one more step|robot check|robot or human|are you a human|bot detection|incapsula|perimeterx/i.test(t)) { res.state = 'blocked'; return res; }
  res.title = (meta['og:title'] || p.name || t).slice(0, 200);
  const looksGeneric = v => !v || /logo|placeholder|default[-_]?image|social|share[-_]?image|favicon|sprite/i.test(v);
  const cands = [meta['og:image'], meta['og:image:secure_url'], meta['twitter:image'], p.image, meta['image']];
  res.img = absUrl(cands.find(v => v && !looksGeneric(v)) || null, r.url);
  const pr = meta['product:price:amount'] || meta['og:price:amount'] || p.price || meta['price'];
  res.price = pr != null && !isNaN(parseFloat(pr)) ? parseFloat(pr) : null;
  const av = p.avail || meta['product:availability'] || meta['og:availability'] || '';
  res.avail = av;
  if (/outofstock|soldout|discontinued|out of stock/i.test(av)) { res.state = 'sold_out'; return res; }
  const path = new URL(r.url).pathname;
  if ((path === '/' || path === '') && u.pathname.length > 1) { res.state = 'dead'; res.note = 'Link now goes to the home page'; return res; }
  res.state = 'ok';
  return res;
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

  if (path === 'check' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 6);
    const out = await Promise.all(items.map(async it => {
      const r = it.url ? await inspect(String(it.url)) : { state: 'bad_link' };
      if (it.store && it.name) r.id = await md5id(String(it.store), String(it.name));
      r.key = it.key; return r;
    }));
    return json({ results: out });
  }

  if (path === 'deals' && request.method === 'GET') {
    const [d, r] = await env.DB.batch([
      env.DB.prepare("SELECT data FROM deals WHERE status = 'live'"),
      env.DB.prepare('SELECT r.id, r.reason, r.at, d.data FROM retired r LEFT JOIN deals d ON d.id = r.id'),
    ]);
    const deals = (d.results || []).map(x => { try { return JSON.parse(x.data); } catch (e) { return null; } }).filter(Boolean);
    const hidden = (r.results || []).map(x => { let dd = null; try { dd = x.data ? JSON.parse(x.data) : null; } catch (e) {} return { id: x.id, reason: x.reason, at: x.at, deal: dd }; });
    return json({ deals, retired: hidden.map(x => x.id), hidden });
  }

  if (path === 'deals' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
    const deals = (Array.isArray(body.deals) ? body.deals : []).slice(0, 60);
    const now = Date.now();
    const stmts = deals.filter(x => x && /^r[0-9a-f]{8}$/.test(x.id) && x.who && x.name).map(x => {
      const data = JSON.stringify(x); if (data.length > 20000) return null;
      return env.DB.prepare('INSERT INTO deals (id, who, data, status, added, checked, by) VALUES (?, ?, ?, \'live\', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, status = \'live\', checked = excluded.checked')
        .bind(x.id, String(x.who), data, now, now, me);
    }).filter(Boolean);
    deals.forEach(x => { if (x && /^r[0-9a-f]{8}$/.test(x.id)) stmts.push(env.DB.prepare('DELETE FROM retired WHERE id = ?').bind(x.id)); });
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, saved: stmts.length });
  }

  if (path === 'retire' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
    const list = (Array.isArray(body.items) ? body.items : []).slice(0, 200).filter(x => x && /^r[0-9a-f]{8}$/.test(x.id));
    const now = Date.now(), stmts = [];
    for (const x of list) {
      stmts.push(env.DB.prepare('INSERT INTO retired (id, reason, at, by) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, at = excluded.at').bind(x.id, String(x.reason || '').slice(0, 120), now, me));
      stmts.push(env.DB.prepare("UPDATE deals SET status = 'retired' WHERE id = ?").bind(x.id));
    }
    if (body.restore) { const ids = (Array.isArray(body.restore) ? body.restore : []).filter(i => /^r[0-9a-f]{8}$/.test(i)).slice(0, 200); for (const i of ids) { stmts.push(env.DB.prepare('DELETE FROM retired WHERE id = ?').bind(i)); stmts.push(env.DB.prepare("UPDATE deals SET status = 'live' WHERE id = ?").bind(i)); } }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, retired: list.length });
  }

  return json({ error: 'Not found' }, 404);
}
