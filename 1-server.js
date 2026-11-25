// Tuk-tuk village ride server. No dependencies. Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');
let db = { users: {}, rides: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db));
const id = () => crypto.randomBytes(6).toString('hex');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.css': 'text/css' };
const ACTIVE = ['requested', 'accepted', 'arrived', 'started'];
const dist = (a, b) => (a.lat == null || b.lat == null) ? null : Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos(a.lat * Math.PI / 180));

function expire() { // unaccepted requests die after 10 min
  const now = Date.now();
  for (const r of Object.values(db.rides)) if (r.status === 'requested' && now - r.createdAt > 600000) r.status = 'expired';
}
function rideView(r) {
  const d = r.driverId && db.users[r.driverId], p = db.users[r.riderId];
  return { ...r, driver: d && { name: d.name, phone: d.phone }, rider: p && { name: p.name, phone: p.phone } };
}
function body(req) { return new Promise(res => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } }); }); }
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    let f = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.normalize(path.join(__dirname, 'public', f));
    if (!full.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(full)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    return fs.createReadStream(full).pipe(res);
  }
  expire();
  const b = req.method === 'POST' ? await body(req) : {};
  const user = db.users[req.headers['x-token'] || ''];
  const p = url.pathname;
  if (p === '/api/config') return send(res, 200, cfg);
  if (p === '/api/register' && req.method === 'POST') {
    const name = String(b.name || '').trim().slice(0, 40), phone = String(b.phone || '').trim().slice(0, 20);
    if (!name || !/^[0-9+]{6,15}$/.test(phone)) return send(res, 400, { error: 'الاسم أو رقم التليفون مش صحيح' });
    if (!['rider', 'driver'].includes(b.role)) return send(res, 400, { error: 'نوع الحساب غلط' });
    const token = id() + id();
    db.users[token] = { name, phone, role: b.role, available: false, lat: null, lng: null };
    save(); return send(res, 200, { token, user: db.users[token] });
  }
  if (!user) return send(res, 401, { error: 'سجّل الأول' });
  const uid = req.headers['x-token'];
  if (p === '/api/me') {
    const active = Object.values(db.rides).find(r => ACTIVE.includes(r.status) && (r.riderId === uid || r.driverId === uid));
    return send(res, 200, { user, active: active ? rideView(active) : null });
  }
  if (p === '/api/rides' && req.method === 'POST') {
    if (user.role !== 'rider') return send(res, 403, { error: 'للراكب بس' });
    if (Object.values(db.rides).some(r => r.riderId === uid && ACTIVE.includes(r.status))) return send(res, 409, { error: 'عندك مشوار شغال بالفعل' });
    const place = cfg.places.find(x => x.id === b.placeId);
    if (!place) return send(res, 400, { error: 'اختار الوجهة' });
    const note = String(b.pickupNote || '').slice(0, 120);
    const lat = typeof b.lat === 'number' ? b.lat : null, lng = typeof b.lng === 'number' ? b.lng : null;
    if (!note && lat == null) return send(res, 400, { error: 'اكتب مكانك أو فعّل الموقع' });
    const r = { id: id(), riderId: uid, driverId: null, status: 'requested', placeId: place.id, placeName: place.name, fare: place.fare, pickupNote: note, lat, lng, createdAt: Date.now() };
    db.rides[r.id] = r; save(); return send(res, 200, rideView(r));
  }
  if (p === '/api/driver/available' && req.method === 'POST') {
    if (user.role !== 'driver') return send(res, 403, { error: 'للسواق بس' });
    user.available = !!b.available;
    if (typeof b.lat === 'number') { user.lat = b.lat; user.lng = b.lng; }
    save(); return send(res, 200, { user });
  }
  if (p === '/api/rides/open') {
    if (user.role !== 'driver') return send(res, 403, { error: 'للسواق بس' });
    if (typeof url.searchParams.get('lat') === 'string' && url.searchParams.get('lat')) { user.lat = +url.searchParams.get('lat'); user.lng = +url.searchParams.get('lng'); }
    const list = Object.values(db.rides).filter(r => r.status === 'requested').map(r => ({ ...rideView(r), distance: dist(user, r) }))
      .sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9) || a.createdAt - b.createdAt);
    return send(res, 200, { rides: list, available: user.available });
  }
  const m = p.match(/^\/api\/rides\/([0-9a-f]+)(?:\/(accept|status))?$/);
  if (m) {
    const r = db.rides[m[1]];
    if (!r) return send(res, 404, { error: 'المشوار مش موجود' });
    if (r.riderId !== uid && r.driverId !== uid && user.role !== 'driver') return send(res, 403, { error: 'مش مشوارك' });
    if (!m[2]) return send(res, 200, rideView(r));
    if (m[2] === 'accept') {
      if (user.role !== 'driver') return send(res, 403, { error: 'للسواق بس' });
      if (r.status !== 'requested') return send(res, 409, { error: 'سواق تاني خد المشوار ده' });
      if (Object.values(db.rides).some(x => x.driverId === uid && ACTIVE.includes(x.status))) return send(res, 409, { error: 'عندك مشوار شغال بالفعل' });
      r.status = 'accepted'; r.driverId = uid; r.acceptedAt = Date.now(); user.available = false;
      save(); return send(res, 200, rideView(r));
    }
    const s = b.status;
    const ok = (s === 'arrived' && r.driverId === uid && r.status === 'accepted') ||
      (s === 'started' && r.driverId === uid && r.status === 'arrived') ||
      (s === 'completed' && r.driverId === uid && r.status === 'started') ||
      (s === 'cancelled' && ACTIVE.includes(r.status) && (r.riderId === uid || r.driverId === uid) && r.status !== 'started');
    if (!ok) return send(res, 409, { error: 'الحركة دي مش متاحة دلوقتي' });
    r.status = s; r.updatedAt = Date.now();
    if (['completed', 'cancelled'].includes(s) && r.driverId) db.users[r.driverId].available = true;
    save(); return send(res, 200, rideView(r));
  }
  send(res, 404, { error: 'not found' });
});
if (require.main === module) server.listen(process.env.PORT || 3000, () => console.log('tuk-tuk server on :' + (process.env.PORT || 3000)));
module.exports = server;
