'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const A = {
  token: localStorage.getItem('snx_a_tk') || '',
  currentPage: 'overview',
};

let _pollTimer = null;
const GAME_IDS = ['station_1', 'station_2'];

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginForm').addEventListener('submit', onLogin);
  document.getElementById('signupForm').addEventListener('submit', onSignup);
  document.getElementById('paymentSettingsForm').addEventListener('submit', onSaveSettings);

  if (A.token) {
    checkAuthAndLoad();
  }
});

async function checkAuthAndLoad() {
  try {
    const data = await api('/api/admin/me');
    showApp(data.admin);
  } catch (_) {
    clearAdminSession();
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function toggleSignup(show) {
  document.getElementById('signupForm').classList.toggle('hidden', !show);
  document.getElementById('loginForm').classList.toggle('hidden', show);
}

async function onLogin(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const msgEl = document.getElementById('loginMsg');
  setMsg(msgEl, '');
  const btn = e.target.querySelector('[type=submit]');

  try {
    btnLoad(btn, true);
    const data = await api('/api/admin/login', {
      method: 'POST',
      json: { email: fd.get('email'), password: fd.get('password') },
    });
    A.token = data.token;
    localStorage.setItem('snx_a_tk', A.token);
    showApp(data.admin);
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  } finally {
    btnLoad(btn, false);
  }
}

async function onSignup(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const msgEl = document.getElementById('signupMsg');
  setMsg(msgEl, '');
  const btn = e.target.querySelector('[type=submit]');

  try {
    btnLoad(btn, true);
    const data = await api('/api/admin/register', {
      method: 'POST',
      json: { fullName: fd.get('fullName'), email: fd.get('email'), password: fd.get('password') },
    });
    A.token = data.token;
    localStorage.setItem('snx_a_tk', A.token);
    showApp(data.admin);
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  } finally {
    btnLoad(btn, false);
  }
}

function adminLogout() {
  clearAdminSession();
  document.getElementById('adminApp').classList.add('hidden');
  document.getElementById('adminLoginView').classList.remove('hidden');
}

function clearAdminSession() {
  localStorage.removeItem('snx_a_tk');
  A.token = '';
  stopPoll();
}

// ─── App shell ────────────────────────────────────────────────────────────────
function showApp(admin) {
  document.getElementById('adminLoginView').classList.add('hidden');
  document.getElementById('adminApp').classList.remove('hidden');
  document.getElementById('adminName').textContent = admin.fullName;
  document.getElementById('adminRole').textContent = admin.role === 'super_admin' ? 'Super Admin' : 'Staff';

  navTo('overview');
  startPoll();
  loadSettings();
  loadGameSettings();
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navTo(page) {
  closeSidebar();
  A.currentPage = page;

  document.querySelectorAll('.admin-page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    overview: 'Overview',
    payments: 'Payment Approvals',
    queue1:   'Station 1 Queue',
    queue2:   'Station 2 Queue',
    bookings: 'All Bookings',
    finance:  'Finance',
    feedback: 'Player Feedback',
    settings: 'Settings',
  };
  document.getElementById('topbarTitle').textContent = titles[page] || page;

  // Load page-specific data immediately
  if (page === 'overview')  loadOverview();
  if (page === 'payments')  loadPayments();
  if (page === 'queue1')    loadQueueStation(1);
  if (page === 'queue2')    loadQueueStation(2);
  if (page === 'bookings')  loadBookings();
  if (page === 'finance')   loadFinance();
  if (page === 'feedback')  loadFeedback();
}

// Sidebar mobile
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

// ─── Polling ──────────────────────────────────────────────────────────────────
function startPoll() {
  stopPoll();
  _pollTimer = setInterval(silentRefresh, 5000);
}
function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function silentRefresh() {
  try {
    const [dashData, payData] = await Promise.all([
      api('/api/admin/dashboard'),
      api('/api/admin/payments'),
    ]);

    // Update badges
    const pCount = payData.count || 0;
    const badge = document.getElementById('paymentsBadge');
    badge.textContent = pCount;
    badge.classList.toggle('hidden', pCount === 0);

    // Refresh current page silently
    if (A.currentPage === 'overview') renderOverview(dashData);
    if (A.currentPage === 'payments') renderPayments(payData.pending || []);
    if (A.currentPage === 'queue1')   loadQueueStation(1);
    if (A.currentPage === 'queue2')   loadQueueStation(2);
    if (A.currentPage === 'finance')  loadFinance();
  } catch (_) {}
}

// ─── Overview ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const data = await api('/api/admin/dashboard');
    renderOverview(data);
  } catch (err) { console.error(err); }
}

function renderOverview(data) {
  const s = data.stats;
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card accent-primary">
      <div class="stat-label">Pending Approvals</div>
      <div class="stat-value" style="color:var(--warning)">${s.pendingApprovals}</div>
      <div class="stat-sub">Awaiting payment review</div>
    </div>
    <div class="stat-card accent-success">
      <div class="stat-label">Currently Playing</div>
      <div class="stat-value" style="color:var(--success)">${s.currentlyPlaying}</div>
      <div class="stat-sub">Active sessions right now</div>
    </div>
    <div class="stat-card accent-accent">
      <div class="stat-label">Completed Today</div>
      <div class="stat-value" style="color:var(--accent)">${s.completedToday}</div>
      <div class="stat-sub">Sessions finished today</div>
    </div>
    <div class="stat-card accent-warning">
      <div class="stat-label">Gross Revenue</div>
      <div class="stat-value" style="color:var(--warning)">${s.grossRevenue}</div>
      <div class="stat-sub">Birr from ${s.totalApproved} approved</div>
    </div>
  `;

  const tbody = document.getElementById('recentActivityBody');
  tbody.innerHTML = '';
  if (!data.recentActivity.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-dim text-sm text-center" style="padding:20px">No activity yet.</td></tr>`;
    return;
  }
  data.recentActivity.forEach((b) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="player-avatar">${esc(b.user?.fullName?.[0] || '?')}</div>
          <div>
            <div style="font-weight:600">${esc(b.user?.fullName || '--')}</div>
            <div class="text-dim text-xs">${esc(b.user?.phoneNumber || '')}</div>
          </div>
        </div>
      </td>
      <td>${b.game?.stationNumber ? `Station ${b.game.stationNumber}` : '--'}</td>
      <td>${statusBadge(b.status)}</td>
      <td>${b.queueNumber || '--'}</td>
      <td>${b.score !== null && b.score !== undefined ? b.score : '--'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Payments ─────────────────────────────────────────────────────────────────
async function loadPayments() {
  try {
    const data = await api('/api/admin/payments');
    renderPayments(data.pending || []);
    const badge = document.getElementById('paymentsBadge');
    badge.textContent = data.count;
    badge.classList.toggle('hidden', data.count === 0);
  } catch (err) { console.error(err); }
}

function renderPayments(list) {
  const container = document.getElementById('pendingPaymentsList');
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = `<div class="section-card"><div class="section-empty">✅ All payments verified. Nothing pending.</div></div>`;
    return;
  }

  list.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'payment-item glass';
    div.innerHTML = `
      <div class="payment-item-head">
        <div class="player-avatar">${esc(item.user?.fullName?.[0] || '?')}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:1.05rem">${esc(item.user?.fullName || '--')}</div>
          <div class="text-muted text-sm">${esc(item.user?.phoneNumber || '')} ${item.user?.telegram ? '· ' + esc(item.user.telegram) : ''}</div>
          <div class="text-sm" style="margin-top:4px">
            ${statusBadge('payment_review')}
            &nbsp;&nbsp;Station ${item.game?.stationNumber || '--'} — ${esc(item.game?.name || '--')}
          </div>
        </div>
        ${item.paymentProofPath ? `<button type="button" class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="openModal('/${esc(item.paymentProofPath)}')">View Screenshot 🖼️</button>` : ''}
      </div>
      <div class="payment-item-body">
        <input class="input" type="text" id="reject_${item.id}" placeholder="Rejection reason (optional)" style="flex:1" />
        <button class="btn btn-success btn-sm" onclick="approvePayment('${item.id}')">✓ Approve</button>
        <button class="btn btn-danger btn-sm" onclick="rejectPayment('${item.id}')">✗ Reject</button>
      </div>
    `;
    container.appendChild(div);
  });
}

async function approvePayment(bookingId) {
  try {
    await api(`/api/admin/payments/${bookingId}/approve`, { method: 'POST' });
    loadPayments();
    if (A.currentPage === 'overview') loadOverview();
  } catch (err) {
    alert(err.message);
  }
}

async function rejectPayment(bookingId) {
  const reason = document.getElementById(`reject_${bookingId}`)?.value || '';
  try {
    await api(`/api/admin/payments/${bookingId}/reject`, {
      method: 'POST',
      json: { reason },
    });
    loadPayments();
  } catch (err) {
    alert(err.message);
  }
}

// ─── Queue stations ───────────────────────────────────────────────────────────
const STATION_GAME_ID = { 1: 'station_1', 2: 'station_2' };

async function loadQueueStation(num) {
  const gameId = STATION_GAME_ID[num];
  const msgEl  = document.getElementById(`q${num}ControlMsg`);
  try {
    const data = await api(`/api/admin/queue/${gameId}`);
    renderQueueStation(num, data);

    const badge = document.getElementById(`q${num}Badge`);
    badge.textContent = data.waiting.length;
    badge.classList.toggle('hidden', data.waiting.length === 0);
  } catch (err) {
    if (msgEl) setMsg(msgEl, err.message, 'error');
  }
}

function renderQueueStation(num, data) {
  const gameNameEl = document.getElementById(`q${num}GameName`);
  if (gameNameEl) gameNameEl.textContent = data.game?.name || '--';

  // Now playing
  const npEl = document.getElementById(`q${num}NowPlaying`);
  if (data.currentPlaying) {
    const b = data.currentPlaying;
    npEl.innerHTML = `
      <div class="now-playing-card">
        <div class="np-label"><div class="pulse-dot"></div> Now Playing</div>
        <div class="np-name">${esc(b.user?.fullName || '--')}</div>
        <div class="np-game">${esc(b.game?.name || '--')}</div>
        <div class="np-time">Queue #${b.queueNumber || '--'} · Started ${timeAgo(b.startedAt)}</div>
      </div>
    `;
  } else {
    npEl.innerHTML = `<div class="section-empty" style="padding:20px 0">No active player on Station ${num}</div>`;
  }

  // Waiting list
  const wlEl = document.getElementById(`q${num}WaitingList`);
  wlEl.innerHTML = '';

  if (!data.waiting.length && !data.missedPool.length) {
    wlEl.innerHTML = `<div class="section-empty">Queue is empty.</div>`;
  } else {
    [...data.waiting, ...data.missedPool].forEach((b, i) => {
      const isMissed = b.status === 'missed_waiting';
      const row = document.createElement('div');
      row.className = 'waiting-row';
      row.innerHTML = `
        <div class="waiting-num">${b.queueNumber || '?'}</div>
        <div class="waiting-info">
          <div class="waiting-name">${esc(b.user?.fullName || '--')}</div>
          <div class="waiting-msg">${isMissed ? '⚠️ Missed pool' : esc(b.queueMsg?.text || '')}</div>
        </div>
        ${isMissed ? '<span class="badge badge-warning">Missed</span>' : ''}
      `;
      wlEl.appendChild(row);
    });
  }
}

async function startNextStation(num) {
  const gameId = STATION_GAME_ID[num];
  const msgEl  = document.getElementById(`q${num}ControlMsg`);
  try {
    const data = await api(`/api/admin/queue/${gameId}/start-next`, { method: 'POST' });
    setMsg(msgEl, `Started: ${data.currentPlaying.user.fullName}`, 'success');
    loadQueueStation(num);
    if (A.currentPage === 'overview') loadOverview();
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  }
}

async function completeStation(num) {
  const gameId    = STATION_GAME_ID[num];
  const msgEl     = document.getElementById(`q${num}ControlMsg`);
  const scoreVal  = document.getElementById(`q${num}ScoreInput`).value;
  try {
    const body = {};
    if (scoreVal !== '') body.score = Number(scoreVal);
    const data = await api(`/api/admin/queue/${gameId}/complete`, { method: 'POST', json: body });
    document.getElementById(`q${num}ScoreInput`).value = '';
    setMsg(msgEl, `Completed: ${data.completed.user.fullName}${data.completed.score !== null ? ' — Score: ' + data.completed.score : ''}`, 'success');
    loadQueueStation(num);
    if (A.currentPage === 'overview') loadOverview();
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  }
}

async function missedStation(num) {
  const gameId = STATION_GAME_ID[num];
  const msgEl  = document.getElementById(`q${num}ControlMsg`);
  try {
    const data = await api(`/api/admin/queue/${gameId}/missed`, { method: 'POST' });
    setMsg(msgEl, `${data.booking.user.fullName} moved to missed pool.`, 'warning');
    loadQueueStation(num);
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  }
}

// ─── Bookings ─────────────────────────────────────────────────────────────────
async function loadBookings() {
  const status  = document.getElementById('bookingFilter')?.value || '';
  const gameId  = document.getElementById('stationFilter')?.value || '';
  const container = document.getElementById('bookingsList');
  container.innerHTML = `<div class="section-empty">Loading...</div>`;

  try {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (gameId) params.set('gameId', gameId);
    const data = await api(`/api/admin/bookings?${params}`);
    renderBookings(data.bookings || []);
  } catch (err) {
    container.innerHTML = `<div class="section-empty" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

function renderBookings(bookings) {
  const container = document.getElementById('bookingsList');
  container.innerHTML = '';

  if (!bookings.length) {
    container.innerHTML = `<div class="section-card"><div class="section-empty">No bookings found for this filter.</div></div>`;
    return;
  }

  bookings.forEach((b) => {
    const div = document.createElement('div');
    div.className = 'section-card';
    div.innerHTML = `
      <div class="section-head">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div class="player-avatar">${esc(b.user?.fullName?.[0] || '?')}</div>
          <div>
            <div style="font-weight:700">${esc(b.user?.fullName || '--')}</div>
            <div class="text-muted text-sm">${esc(b.user?.phoneNumber || '')} &nbsp;·&nbsp; Queue #${b.queueNumber || '--'} &nbsp;·&nbsp; Station ${b.game?.stationNumber || '--'}</div>
          </div>
          ${statusBadge(b.status)}
        </div>
        ${b.score !== null && b.score !== undefined ? `<span style="font-family:var(--font-brand);font-size:1.2rem;color:var(--accent)">${b.score} pts</span>` : ''}
      </div>
      <div class="section-body">
        <div class="grid-2" style="gap:12px">
          <div>
            <p class="text-dim text-xs" style="margin-bottom:6px">Game</p>
            <p>${esc(b.game?.name || '--')}</p>
          </div>
          <div>
            <p class="text-dim text-xs" style="margin-bottom:6px">Status Message</p>
            <p class="text-muted text-sm">${esc(b.queueMsg?.text || '--')}</p>
          </div>
        </div>

        ${['playing', 'completed'].includes(b.status) ? `
          <div class="divider"></div>
          <div class="score-panel">
            <label style="font-size:.82rem;color:var(--text-3);margin-bottom:0">Update Score</label>
            <input class="input" type="number" id="score_${b.id}" value="${b.score ?? ''}" placeholder="Score" style="max-width:130px" />
            <button class="btn btn-success btn-sm" onclick="saveScore('${b.id}', ${b.id ? `'${b.id}'` : 'null'})">Save Score</button>
          </div>
        ` : ''}

        ${b.status === 'completed' ? `
          <div class="divider"></div>
          <div>
            <p class="text-dim text-xs mb-12">Gameplay Media</p>
            <div class="flex gap-8 flex-wrap" id="mediaTags_${b.id}">
              ${(b.gameplayMedia || []).map((p) => `<a href="/${esc(p)}" target="_blank" class="media-tag">📹 View</a>`).join('') || '<span class="text-dim text-sm">No files yet</span>'}
            </div>
            <div class="upload-area" style="padding:14px;margin-top:10px;border-radius:var(--r-sm)" id="mediaUpload_${b.id}">
              <input type="file" id="mediaFile_${b.id}" />
              <p class="text-sm">Attach gameplay video/image</p>
            </div>
            <button class="btn btn-ghost btn-sm mt-8" onclick="uploadMedia('${b.id}')">Upload Media</button>
          </div>
        ` : ''}
      </div>
    `;
    container.appendChild(div);
  });
}

async function saveScore(bookingId) {
  const scoreInput = document.getElementById(`score_${bookingId}`);
  if (!scoreInput) return;
  try {
    await api(`/api/admin/bookings/${bookingId}/score`, {
      method: 'POST',
      json: { score: Number(scoreInput.value) },
    });
    loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

async function uploadMedia(bookingId) {
  const fileInput = document.getElementById(`mediaFile_${bookingId}`);
  if (!fileInput?.files?.[0]) { alert('Select a file first.'); return; }

  const fd = new FormData();
  fd.append('media', fileInput.files[0]);
  try {
    await apiFetchFile(`/api/admin/bookings/${bookingId}/media`, fd);
    loadBookings();
  } catch (err) {
    alert(err.message);
  }
}

// ─── Finance ──────────────────────────────────────────────────────────────────
async function loadFinance() {
  try {
    const data = await api('/api/admin/finance');
    const f = data.finance;

    document.getElementById('financeStatsGrid').innerHTML = `
      <div class="stat-card accent-success">
        <div class="stat-label">Gross Revenue</div>
        <div class="stat-value" style="color:var(--success)">${f.grossRevenue}</div>
        <div class="stat-sub">Birr total</div>
      </div>
      <div class="stat-card accent-warning">
        <div class="stat-label">Today's Revenue</div>
        <div class="stat-value" style="color:var(--warning)">${f.todayRevenue}</div>
        <div class="stat-sub">Birr today (${f.todayCompleted} sessions)</div>
      </div>
      <div class="stat-card accent-primary">
        <div class="stat-label">Total Approved</div>
        <div class="stat-value">${f.totalApproved}</div>
        <div class="stat-sub">Paid bookings</div>
      </div>
      <div class="stat-card accent-accent">
        <div class="stat-label">Completed</div>
        <div class="stat-value">${f.totalCompleted}</div>
        <div class="stat-sub">Sessions played</div>
      </div>
    `;

    const tbody = document.getElementById('financeByGame');
    tbody.innerHTML = '';
    f.byGame.forEach((g) => {
      tbody.innerHTML += `
        <tr>
          <td>Station ${g.stationNumber} — ${esc(g.gameName)}</td>
          <td>${g.bookings}</td>
          <td style="font-weight:700;color:var(--success)">${g.revenue} Birr</td>
        </tr>
      `;
    });

    document.getElementById('financeSummary').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="flex justify-between"><span class="text-muted">Ticket Price</span><strong>${f.ticketPriceBirr} Birr</strong></div>
        <div class="flex justify-between"><span class="text-muted">Pending Review</span><strong style="color:var(--warning)">${f.pendingReview}</strong></div>
        <div class="flex justify-between"><span class="text-muted">Rejected Payments</span><strong style="color:var(--danger)">${f.rejectedPayments}</strong></div>
        <div class="divider"></div>
        <div class="flex justify-between"><span class="text-muted font-bold">Gross Revenue</span><strong style="font-size:1.3rem;color:var(--success)">${f.grossRevenue} Birr</strong></div>
      </div>
    `;
  } catch (err) { console.error(err); }
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
async function loadFeedback() {
  const container  = document.getElementById('feedbackList');
  const statsGrid  = document.getElementById('feedbackStatsGrid');
  container.innerHTML = `<div class="section-empty">Loading...</div>`;

  try {
    const data = await api('/api/admin/feedback');
    const list = data.feedback || [];

    // Badge
    const badge = document.getElementById('feedbackBadge');
    badge.textContent = list.length;
    badge.classList.toggle('hidden', list.length === 0);

    // Stats
    const avgStars = data.avgRating ? '★'.repeat(Math.round(data.avgRating)) : '--';
    const byRating = [5,4,3,2,1].map((r) => ({ r, n: list.filter((f) => f.rating === r).length }));
    statsGrid.innerHTML = `
      <div class="stat-card accent-warning">
        <div class="stat-label">Total Feedback</div>
        <div class="stat-value">${data.count}</div>
      </div>
      <div class="stat-card accent-success">
        <div class="stat-label">Avg Rating</div>
        <div class="stat-value" style="color:var(--warning);font-size:1.5rem">${data.avgRating ? '⭐ ' + data.avgRating : '--'}</div>
      </div>
      <div class="stat-card col-span-2" style="grid-column:span 2">
        <div class="stat-label" style="margin-bottom:8px">Rating Breakdown</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${byRating.map(({ r, n }) => `
            <div style="display:flex;align-items:center;gap:8px;font-size:.85rem">
              <span style="color:#ffc542;min-width:40px">${'★'.repeat(r)}</span>
              <div style="flex:1;background:rgba(255,255,255,.06);border-radius:4px;height:8px;overflow:hidden">
                <div style="width:${data.count ? Math.round(n/data.count*100) : 0}%;height:100%;background:#ffc542;border-radius:4px"></div>
              </div>
              <span style="color:var(--text-3);min-width:20px">${n}</span>
            </div>`).join('')}
        </div>
      </div>
    `;

    // List
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = `<div class="section-card"><div class="section-empty">No feedback submitted yet.</div></div>`;
      return;
    }

    list.forEach((f) => {
      const isPublic   = f.type === 'public';
      const displayName = isPublic
        ? (f.guestName || 'Anonymous visitor')
        : (f.user?.fullName || 'Unknown');
      const avatar = displayName[0]?.toUpperCase() || '?';

      const div = document.createElement('div');
      div.className = 'feedback-item';
      div.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="player-avatar" style="${isPublic ? 'background:linear-gradient(135deg,#00d4ff,#7c6eff)' : ''}">${esc(avatar)}</div>
            <div>
              <div style="font-weight:700">${esc(displayName)}</div>
              <div class="fb-meta">
                ${isPublic
                  ? '<span class="badge badge-info" style="font-size:.7rem">Public Feedback</span>'
                  : `${esc(f.game?.name || '--')} · Station ${f.game?.stationNumber || '--'}`}
              </div>
            </div>
          </div>
          <div class="fb-stars">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</div>
        </div>
        ${f.comment ? `<div class="fb-comment">"${esc(f.comment)}"</div>` : ''}
        <div class="fb-meta" style="margin-top:8px">${new Date(f.createdAt).toLocaleString()}</div>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    container.innerHTML = `<div class="section-empty" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const data = await api('/api/info');
    document.getElementById('settingsHolderName').value = data.paymentMethods?.holderName || '';
    document.getElementById('settingsTelebirr').value   = data.paymentMethods?.telebirr   || '';
    document.getElementById('settingsCbe').value        = data.paymentMethods?.cbe        || '';
  } catch (_) {}
}

async function onSaveSettings(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const msgEl = document.getElementById('settingsMsg');
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      json: {
        holderName:        fd.get('holderName'),
        telebirr:          fd.get('telebirr'),
        cbe:               fd.get('cbe'),
        missedInsertEvery: fd.get('missedInsertEvery'),
      },
    });
    setMsg(msgEl, 'Settings saved successfully.', 'success');
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  }
}

async function loadGameSettings() {
  try {
    const data = await api('/api/info');
    const container = document.getElementById('gameSettingsList');
    container.innerHTML = '';

    data.games.forEach((game, idx) => {
      const div = document.createElement('div');

      const isVideo = !!game.videoPath;
      const mediaHeight = isVideo ? '200px' : '120px';
      const mediaFit    = isVideo ? 'contain' : 'cover';
      const mediaSrc    = isVideo ? game.videoPath : game.imagePath;
      const mediaEl     = isVideo
        ? `<video src="/${esc(mediaSrc)}" muted loop autoplay playsinline style="width:100%;height:100%;object-fit:${mediaFit};background:#000"></video>`
        : `<img src="/${esc(mediaSrc)}" alt="" style="width:100%;height:100%;object-fit:${mediaFit}" />`;

      const currentMediaHtml = mediaSrc ? `
        <div style="margin-bottom:12px">
          <p class="text-dim text-xs" style="margin-bottom:6px">Current Media</p>
          <div style="width:100%;height:${mediaHeight};border-radius:var(--r-sm);overflow:hidden;background:#000;border:1px solid var(--border);display:flex;align-items:center;justify-content:center">
            ${mediaEl}
          </div>
        </div>` : '';

      div.innerHTML = `
        <div style="font-weight:700;margin-bottom:12px;font-size:1rem">Station ${game.stationNumber}</div>
        ${currentMediaHtml}
        <form class="form-stack" onsubmit="saveGame(event, '${game.id}')">
          <div class="field">
            <label>Game Name</label>
            <input class="input" type="text" name="name" value="${esc(game.name)}" required />
          </div>
          <div class="field">
            <label>Description</label>
            <textarea class="input" name="description" rows="3">${esc(game.description)}</textarea>
          </div>
          <div class="field">
            <label>Cover Image <span style="color:var(--text-3);font-weight:400">(replaces current)</span></label>
            <input class="input" type="file" name="image" accept="image/*" />
          </div>
          <div class="field">
            <label>Trailer / Gameplay Video <span style="color:var(--text-3);font-weight:400">(replaces current)</span></label>
            <input class="input" type="file" name="video" accept="video/*" />
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Save Station ${game.stationNumber}</button>
        </form>
        ${idx < data.games.length - 1 ? '<div class="divider"></div>' : ''}
      `;
      container.appendChild(div);
    });
  } catch (_) {}
}

async function saveGame(e, gameId) {
  e.preventDefault();
  const fd  = new FormData(e.target);
  const btn = e.target.querySelector('[type=submit]');
  try {
    btnLoad(btn, true);
    await apiFetchFile(`/api/admin/games/${gameId}`, fd, 'PUT');
    setMsg(document.getElementById('settingsMsg'), 'Game updated successfully.', 'success');
    loadGameSettings(); // refresh previews
  } catch (err) {
    setMsg(document.getElementById('settingsMsg'), err.message, 'error');
  } finally {
    btnLoad(btn, false);
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function api(url, opts = {}) {
  const headers = { Authorization: `Bearer ${A.token}` };
  if (opts.json) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.json ? JSON.stringify(opts.json) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function apiFetchFile(url, formData, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${A.token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed.');
  return data;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setMsg(el, text, type = 'info') {
  if (!text) { el.innerHTML = ''; return; }
  const cls = { success: 'alert-success', error: 'alert-error', warning: 'alert-warning', info: 'alert-info' }[type] || 'alert-info';
  el.innerHTML = `<div class="alert ${cls}"><span>${esc(text)}</span></div>`;
}

function btnLoad(btn, loading) {
  if (!btn) return;
  if (loading) { btn.disabled = true; btn.dataset.orig = btn.textContent; btn.textContent = 'Loading...'; }
  else         { btn.disabled = false; btn.textContent = btn.dataset.orig || 'Submit'; }
}

function statusBadge(status) {
  const map = {
    awaiting_payment: ['badge-warning', 'Awaiting Payment'],
    payment_review:   ['badge-info',    'In Review'],
    payment_rejected: ['badge-danger',  'Rejected'],
    approved_waiting: ['badge-purple',  'Waiting'],
    playing:          ['badge-success', 'Playing'],
    completed:        ['badge-success', 'Completed'],
    missed_waiting:   ['badge-warning', 'Missed'],
  };
  const [cls, label] = map[status] || ['badge-info', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function esc(v) {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Screenshot modal ────────────────────────────────────────────────────────
function openModal(src) {
  const modal = document.getElementById('screenshotModal');
  const img   = document.getElementById('modalImg');
  img.src = src;
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const modal = document.getElementById('screenshotModal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
  document.getElementById('modalImg').src = '';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
