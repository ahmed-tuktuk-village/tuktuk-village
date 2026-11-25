const $ = s => document.querySelector(s), app = $('#app');
let cfg, token = localStorage.getItem('tt_token'), me = null, state = { role: 'rider', placeId: null, err: '', pos: null };
const STATUS = { requested: 'بندور على سواق...', accepted: 'السواق جاي لك', arrived: 'السواق وصل عندك', started: 'في الطريق', completed: 'خلص المشوار', cancelled: 'اتلغى', expired: 'محدش رد، جرّب تاني' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', 'x-token': token || '' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'حصل خطأ'), { status: r.status });
  return j;
}
function locate() {
  return new Promise(res => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { state.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; res(state.pos); }, () => res(null), { timeout: 6000, maximumAge: 30000 }) : res(null));
}
function renderRegister() {
  app.innerHTML = `<div class="card"><h2>أهلاً بيك</h2>
  <div class="seg"><button data-r="rider" class="${state.role === 'rider' ? 'on' : ''}">أنا راكب</button><button data-r="driver" class="${state.role === 'driver' ? 'on' : ''}">أنا سواق</button></div>
  <label>الاسم</label><input id="name" autocomplete="name"><label>رقم التليفون</label><input id="phone" inputmode="tel" placeholder="01xxxxxxxxx">
  <button id="reg">ابدأ</button><div class="err">${esc(state.err)}</div></div>`;
  app.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { state.role = b.dataset.r; renderRegister(); });
  $('#reg').onclick = async () => {
    try { const j = await api('/register', 'POST', { name: $('#name').value, phone: $('#phone').value, role: state.role }); token = j.token; localStorage.setItem('tt_token', token); state.err = ''; tick(); }
    catch (e) { state.err = e.message; renderRegister(); }
  };
}
function riderView(active) {
  if (active) {
    const r = active;
    app.innerHTML = `<div class="card"><span class="badge">${STATUS[r.status]}</span>
    <p>الوجهة: <b>${esc(r.placeName)}</b></p><p class="price">${r.fare} جنيه</p>
    ${r.driver ? `<p>السواق: <b>${esc(r.driver.name)}</b></p><a class="call" href="tel:${esc(r.driver.phone)}">📞 اتصل بالسواق</a>` : ''}
    ${r.status !== 'started' ? '<button class="bad" id="cancel">إلغاء</button>' : ''}</div>`;
    const c = $('#cancel'); if (c) c.onclick = () => api('/rides/' + r.id + '/status', 'POST', { status: 'cancelled' }).then(tick);
    return;
  }
  const places = cfg.places;
  if (!state.placeId) state.placeId = places[0].id;
  const sel = places.find(p => p.id === state.placeId);
  app.innerHTML = `<div class="card"><h2>رايح فين؟</h2>
  <div class="seg" style="flex-wrap:wrap">${places.map(p => `<button data-p="${p.id}" class="${p.id === state.placeId ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>
  <p class="price">${sel.fare} جنيه <span class="muted">سعر ثابت</span></p>
  <label>مكانك (اسم الشارع أو علامة مميزة)</label><input id="note" placeholder="مثلاً: جنب المسجد الكبير">
  <button class="alt" id="loc">📍 استخدم موقعي ${state.pos ? '✓' : ''}</button>
  <button class="go" id="req">اطلب توك توك</button><div class="err">${esc(state.err)}</div></div>`;
  app.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { state.placeId = b.dataset.p; const n = $('#note').value; riderView(null); $('#note').value = n; });
  $('#loc').onclick = async () => { await locate(); $('#loc').textContent = state.pos ? '📍 تم تحديد موقعك ✓' : '📍 مقدرتش أحدد الموقع'; };
  $('#req').onclick = async () => {
    try { await api('/rides', 'POST', { placeId: state.placeId, pickupNote: $('#note').value, ...(state.pos || {}) }); state.err = ''; tick(); }
    catch (e) { state.err = e.message; $('#req').nextElementSibling.textContent = e.message; }
  };
}
async function driverView(active) {
  if (active) {
    const r = active, next = { accepted: ['arrived', 'وصلت عند الراكب'], arrived: ['started', 'بدأنا المشوار'], started: ['completed', 'خلصنا المشوار'] }[r.status];
    app.innerHTML = `<div class="card"><span class="badge">${STATUS[r.status].replace('السواق جاي لك', 'روح للراكب')}</span>
    <p>الراكب: <b>${esc(r.rider.name)}</b></p><p>مكانه: ${esc(r.pickupNote || 'على الخريطة')}</p><p>الوجهة: <b>${esc(r.placeName)}</b></p><p class="price">${r.fare} جنيه</p>
    <a class="call" href="tel:${esc(r.rider.phone)}">📞 اتصل بالراكب</a>
    ${r.lat != null ? `<a class="call" href="https://www.google.com/maps?q=${r.lat},${r.lng}">🗺️ افتح موقع الراكب</a>` : ''}
    ${next ? `<button class="go" id="next">${next[1]}</button>` : ''}${r.status !== 'started' ? '<button class="bad" id="cancel">إلغاء</button>' : ''}</div>`;
    if (next) $('#next').onclick = () => api('/rides/' + r.id + '/status', 'POST', { status: next[0] }).then(tick);
    const c = $('#cancel'); if (c) c.onclick = () => api('/rides/' + r.id + '/status', 'POST', { status: 'cancelled' }).then(tick);
    return;
  }
  const q = state.pos ? `?lat=${state.pos.lat}&lng=${state.pos.lng}` : '';
  const { rides, available } = await api('/rides/open' + q);
  app.innerHTML = `<div class="card"><div class="row"><b>${available ? '🟢 متاح' : '🔴 مش متاح'}</b></div>
  <button id="av" class="${available ? 'bad' : 'go'}">${available ? 'وقّف الطلبات' : 'أنا متاح'}</button></div>
  ${available ? (rides.length ? rides.map(r => `<div class="card"><div class="row"><b>${esc(r.placeName)}</b><span class="price">${r.fare} جنيه</span></div>
  <p class="muted">${esc(r.pickupNote || 'الموقع على الخريطة')}${r.distance != null ? ' · ' + Math.round(r.distance) + ' متر' : ''}</p><button class="go" data-a="${r.id}">اقبل المشوار</button></div>`).join('') : '<p class="muted">مفيش طلبات دلوقتي...</p>') : ''}
  <div class="err">${esc(state.err)}</div>`;
  $('#av').onclick = async () => { await locate(); await api('/driver/available', 'POST', { available: !available, ...(state.pos || {}) }); tick(); };
  app.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { try { await api('/rides/' + b.dataset.a + '/accept', 'POST'); state.err = ''; } catch (e) { state.err = e.message; } tick(); });
}
let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    if (!cfg) { cfg = await api('/config'); $('#vname').textContent = cfg.villageName; }
    if (!token) return renderRegister();
    const j = await api('/me'); me = j.user; $('#who').textContent = me.name + (me.role === 'driver' ? ' (سواق)' : '');
    if (me.role === 'rider') riderView(j.active); else await driverView(j.active);
  } catch (e) { if (e.status === 401) { token = null; localStorage.removeItem('tt_token'); renderRegister(); } else if (!(e instanceof TypeError)) {} }
  finally { busy = false; }
}
// Don't re-render the rider form while typing: poll only when a ride is active, driver always.
setInterval(() => { if (!me) return; if (me.role === 'driver' || app.querySelector('.badge')) { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') tick(); } }, 3000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
tick();
