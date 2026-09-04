// Admin dashboard — talks to the same origin's /api routes.
// If you host the admin panel separately from the API, set API_BASE below.
const API_BASE = ''; // e.g. 'https://tranquility-inn-api.onrender.com'

let TOKEN = localStorage.getItem('ti_admin_token') || null;

const $ = (sel) => document.querySelector(sel);
const loginView = $('#login-view');
const dashView = $('#dash-view');

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => (el.style.display = 'none'), 2600);
}

function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// --- CAPTCHA ---
let captchaToken = null;

async function loadCaptcha() {
  try {
    const data = await api('/api/auth/captcha');
    captchaToken = data.token;
    $('#captcha-img').innerHTML = data.svg;
    $('#captcha-input').value = '';
  } catch (err) {
    $('#login-error').textContent = 'Could not load security code — refresh the page.';
  }
}
$('#captcha-refresh').addEventListener('click', loadCaptcha);

// --- Auth ---
$('#login-btn').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const captchaText = $('#captcha-input').value.trim();
  $('#login-error').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, captchaToken, captchaText }),
    });
    TOKEN = data.token;
    localStorage.setItem('ti_admin_token', TOKEN);
    showDashboard();
  } catch (err) {
    $('#login-error').textContent = err.message;
    loadCaptcha(); // a wrong/expired code needs a fresh one
  }
});

loadCaptcha();

$('#logout-btn').addEventListener('click', () => {
  TOKEN = null;
  localStorage.removeItem('ti_admin_token');
  loginView.classList.remove('hidden');
  dashView.classList.add('hidden');
});

async function showDashboard() {
  loginView.classList.add('hidden');
  dashView.classList.remove('hidden');
  await Promise.all([loadAnalytics(), loadBookings(), loadReviews(), loadPromos()]);
}

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// --- Analytics ---
async function loadAnalytics() {
  try {
    const data = await api('/api/bookings/analytics');
    $('#stat-revenue').textContent = money(data.totalRevenue);
    $('#stat-bookings').textContent = data.totalBookings;
    $('#stat-rooms').textContent = data.totalRoomUnits;

    const occBody = $('#occupancy-body');
    occBody.innerHTML = '';
    if (!data.occupancyByRoom.length) $('#occupancy-empty').classList.remove('hidden');
    else {
      $('#occupancy-empty').classList.add('hidden');
      data.occupancyByRoom.forEach((r) => {
        occBody.insertAdjacentHTML('beforeend', `<tr><td>${r._id}</td><td>${r.bookings}</td><td>${money(r.revenue)}</td></tr>`);
      });
    }
  } catch (err) { toast(err.message); }
}

// --- Bookings ---
async function loadBookings() {
  try {
    const bookings = await api('/api/bookings');
    const body = $('#bookings-body');
    body.innerHTML = '';
    if (!bookings.length) { $('#bookings-empty').classList.remove('hidden'); return; }
    $('#bookings-empty').classList.add('hidden');
    bookings.forEach((b) => {
      const dates = `${new Date(b.checkIn).toLocaleDateString('en-IN')} → ${new Date(b.checkOut).toLocaleDateString('en-IN')}`;
      body.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${b.bookingRef}</td>
          <td>${b.guestFirstName} ${b.guestLastName}<br/><span style="color:var(--ink-soft);font-size:.76rem;">${b.guestEmail}</span></td>
          <td>${b.roomName}</td>
          <td>${dates}<br/><span style="color:var(--ink-soft);font-size:.76rem;">${b.nights} night(s)</span></td>
          <td>${money(b.totalAmount)}</td>
          <td><span class="badge ${b.paymentStatus}">${b.paymentStatus}</span></td>
          <td><span class="badge ${b.status}">${b.status}</span></td>
          <td class="row-actions">${b.status === 'confirmed' ? `<button onclick="cancelBooking('${b._id}')">Cancel</button>` : ''}</td>
        </tr>`);
    });
  } catch (err) { toast(err.message); }
}

async function cancelBooking(id) {
  if (!confirm('Cancel this booking?')) return;
  try {
    await api(`/api/bookings/${id}/cancel`, { method: 'PATCH' });
    toast('Booking cancelled.');
    loadBookings(); loadAnalytics();
  } catch (err) { toast(err.message); }
}

// --- Reviews ---
async function loadReviews() {
  try {
    const reviews = await api('/api/reviews/all');
    $('#stat-reviews').textContent = reviews.filter((r) => r.status === 'pending').length;
    const body = $('#reviews-body');
    body.innerHTML = '';
    if (!reviews.length) { $('#reviews-empty').classList.remove('hidden'); return; }
    $('#reviews-empty').classList.add('hidden');
    reviews.forEach((r) => {
      body.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${r.reviewerName}</td>
          <td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
          <td style="max-width:320px;">${r.text}</td>
          <td>${r.source}</td>
          <td><span class="badge ${r.status}">${r.status}</span></td>
          <td class="row-actions">
            ${r.status !== 'approved' ? `<button onclick="setReviewStatus('${r._id}','approved')">Approve</button>` : ''}
            ${r.status !== 'rejected' ? `<button onclick="setReviewStatus('${r._id}','rejected')">Reject</button>` : ''}
          </td>
        </tr>`);
    });
  } catch (err) { toast(err.message); }
}

async function setReviewStatus(id, status) {
  try {
    await api(`/api/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast('Review updated.');
    loadReviews();
  } catch (err) { toast(err.message); }
}

// --- Promo codes ---
async function loadPromos() {
  try {
    const promos = await api('/api/promos');
    const body = $('#promos-body');
    body.innerHTML = '';
    if (!promos.length) { $('#promos-empty').classList.remove('hidden'); return; }
    $('#promos-empty').classList.add('hidden');
    promos.forEach((p) => {
      body.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${p.code}</td>
          <td>${p.label}</td>
          <td>${p.discountPct}%</td>
          <td>${p.minNights}</td>
          <td>${new Date(p.validTo).toLocaleDateString('en-IN')}</td>
          <td><span class="badge ${p.active ? 'approved' : 'rejected'}">${p.active ? 'active' : 'inactive'}</span></td>
          <td class="row-actions"><button onclick="togglePromo('${p._id}', ${!p.active})">${p.active ? 'Deactivate' : 'Activate'}</button></td>
        </tr>`);
    });
  } catch (err) { toast(err.message); }
}

async function togglePromo(id, active) {
  try {
    await api(`/api/promos/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    toast('Promo updated.');
    loadPromos();
  } catch (err) { toast(err.message); }
}

$('#promo-add-btn').addEventListener('click', async () => {
  const code = $('#promo-code').value.trim();
  const label = $('#promo-label').value.trim();
  const discountPct = Number($('#promo-pct').value);
  const minNights = Number($('#promo-nights').value) || 1;
  const validTo = $('#promo-valid').value;
  if (!code || !label || !discountPct || !validTo) return toast('Fill in all promo fields.');
  try {
    await api('/api/promos', { method: 'POST', body: JSON.stringify({ code, label, discountPct, minNights, validTo }) });
    toast('Promo code added.');
    $('#promo-code').value = ''; $('#promo-label').value = ''; $('#promo-pct').value = ''; $('#promo-valid').value = '';
    loadPromos();
  } catch (err) { toast(err.message); }
});

// --- Boot ---
if (TOKEN) showDashboard();
