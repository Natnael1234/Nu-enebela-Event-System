'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const S = {
  token:         localStorage.getItem('snx_c_tk') || '',
  bookingId:     localStorage.getItem('snx_bkg_id') || '',
  accessId:      '',
  activeBooking: null,
  userData:      null,
};

let _pollTimer   = null;
let _gamesCache  = [];
let _infoCache   = null;
let _lbCache     = { leaderboard: [], byGame: {}, games: [] };
let _activeLbTab = 'all';

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  prefetchInfo();
  setupFileUpload();
  document.getElementById('registerForm').addEventListener('submit', onRegister);
  document.getElementById('returningForm').addEventListener('submit', onReturning);
  document.getElementById('paymentForm').addEventListener('submit', onPayment);
  document.getElementById('feedbackForm').addEventListener('submit', onFeedback);

  if (S.token) {
    resumeSession();
  } else {
    showStep('landing');
  }
});

// ─── Step Navigation ──────────────────────────────────────────────────────────
function goStep(name) {
  document.querySelectorAll('.step').forEach((el) => el.classList.add('hidden'));
  const el = document.getElementById(`step-${name}`);
  if (el) {
    el.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Show footer only on landing
  const footer = document.getElementById('landingFooter');
  if (footer) footer.classList.toggle('hidden', name !== 'landing');

  if (name !== 'queue') stopPoll();
  if (name === 'register') {
    refreshGameGrid();
    if (S.userData) prefillRegisterForm(S.userData);
  }
  if (name === 'queue') startPoll();
}

function showStep(name) { goStep(name); }

// ─── Prefetch public info ─────────────────────────────────────────────────────
async function prefetchInfo() {
  try {
    const data = await apiFetch('/api/info');
    _infoCache  = data;
    _gamesCache = data.games || [];
  } catch (_) {}
}

// ─── Game grid for registration ───────────────────────────────────────────────
function refreshGameGrid() {
  const grid = document.getElementById('gameGrid');
  grid.innerHTML = '';

  if (!_gamesCache.length) {
    grid.innerHTML = '<p class="text-muted text-sm">Loading games...</p>';
    prefetchInfo().then(() => refreshGameGrid());
    return;
  }

  _gamesCache.forEach((game) => {
    const counts   = _infoCache?.queueCounts?.[game.id] || {};
    const waiting  = counts.waiting ?? 0;
    const isPlaying = counts.isPlaying;

    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.gameId = game.id;

    // Build media block: video > image > emoji fallback
    let mediaHtml = '';
    if (game.videoPath) {
      mediaHtml = `
        <div class="game-media">
          <video src="/${esc(game.videoPath)}" muted loop autoplay playsinline
            style="width:100%;height:100%;object-fit:cover;display:block;border-radius:0"
            onmouseenter="this.play()" onmouseleave="this.pause()"></video>
        </div>`;
    } else if (game.imagePath) {
      mediaHtml = `
        <div class="game-media">
          <img src="/${esc(game.imagePath)}" alt="${esc(game.name)}"
            style="width:100%;height:100%;object-fit:cover;display:block;border-radius:0" loading="lazy" />
        </div>`;
    } else {
      mediaHtml = `<div class="game-icon" style="padding-top:18px">🥽</div>`;
    }

    card.innerHTML = `
      <span class="station-badge">Station ${game.stationNumber}</span>
      ${mediaHtml}
      <div class="game-card-body">
        <div class="game-name">${esc(game.name)}</div>
        <div class="game-desc">${esc(game.description)}</div>
        <div class="queue-badge">
          ${isPlaying ? '<span class="dot dot-success"></span> 1 playing · ' : ''}
          ${waiting} waiting
        </div>
      </div>
    `;
    card.addEventListener('click', () => selectGame(game.id));
    grid.appendChild(card);
  });
}

function selectGame(gameId) {
  document.getElementById('selectedGameId').value = gameId;
  document.querySelectorAll('.game-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.gameId === gameId);
  });
}

// ─── Pre-fill register form for known users ───────────────────────────────────
function prefillRegisterForm(user) {
  if (!user) return;
  refreshGameGrid(); // ensure game cards are rendered

  const nameEl     = document.getElementById('reg-name');
  const phoneEl    = document.getElementById('reg-phone');
  const telegramEl = document.getElementById('reg-telegram');

  if (nameEl)     { nameEl.value     = user.fullName    || ''; }
  if (phoneEl)    { phoneEl.value    = user.phoneNumber || ''; }
  if (telegramEl) { telegramEl.value = user.telegram    || ''; }

  // Show a welcome-back note inside the form
  const msgEl = document.getElementById('registerMsg');
  if (msgEl) {
    msgEl.innerHTML = `
      <div class="alert alert-info" style="margin-top:0;margin-bottom:4px">
        <span>👋</span>
        <span>Welcome back, <strong>${esc(user.fullName)}</strong>! Your details are pre-filled — just pick a game and continue.</span>
      </div>`;
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────
async function onRegister(e) {
  e.preventDefault();
  const msgEl = document.getElementById('registerMsg');
  setMsg(msgEl, '');

  const gameId = document.getElementById('selectedGameId').value;
  if (!gameId) { setMsg(msgEl, 'Please select a game.', 'error'); return; }

  const fd = new FormData(e.target);
  const body = { fullName: fd.get('fullName'), phoneNumber: fd.get('phoneNumber'), telegram: fd.get('telegram'), gameId };

  try {
    showBtnLoading(e.target.querySelector('[type=submit]'), true);
    const data = await apiFetch('/api/client/register', { method: 'POST', json: body });

    S.token         = data.token;
    S.bookingId     = data.booking.id;
    S.accessId      = data.accessId;
    S.activeBooking = data.booking;
    S.userData      = data.booking.user || null;
    saveSession();

    _infoCache = { ..._infoCache, ticketPriceBirr: data.ticketPriceBirr, paymentMethods: data.paymentMethods };
    document.getElementById('accessIdDisplay').textContent = data.accessId;
    document.getElementById('bookingGame').textContent = `Game: ${esc(data.booking.game?.name || '')} — Station ${data.booking.game?.stationNumber}`;
    showStep('accessid');
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  } finally {
    showBtnLoading(e.target.querySelector('[type=submit]'), false);
  }
}

// ─── Returning ────────────────────────────────────────────────────────────────
async function onReturning(e) {
  e.preventDefault();
  const msgEl = document.getElementById('returningMsg');
  setMsg(msgEl, '');

  const fd = new FormData(e.target);
  const body = { phoneNumber: fd.get('phoneNumber'), accessId: fd.get('accessId') };

  try {
    showBtnLoading(e.target.querySelector('[type=submit]'), true);
    const data = await apiFetch('/api/client/access', { method: 'POST', json: body });

    S.token    = data.token;
    S.userData = data.user;
    saveSession();

    if (data.activeBooking) {
      S.bookingId = data.activeBooking.id;
      localStorage.setItem('snx_bkg_id', S.bookingId);
      routeByStatus(data.activeBooking);
    } else {
      // Pre-fill register form and go there immediately (no delay)
      prefillRegisterForm(data.user);
      setMsg(msgEl, '', '');
      showStep('register');
    }
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  } finally {
    showBtnLoading(e.target.querySelector('[type=submit]'), false);
  }
}

// ─── Resume session on reload ─────────────────────────────────────────────────
async function resumeSession() {
  try {
    const data = await apiFetch('/api/client/status');
    if (data.user) {
      S.userData = data.user;
    }
    if (data.activeBooking) {
      S.bookingId = data.activeBooking.id;
      localStorage.setItem('snx_bkg_id', S.bookingId);
      routeByStatus(data.activeBooking);
    } else {
      // Returning user with no active booking — send to pre-filled register
      if (data.user) {
        prefillRegisterForm(data.user);
        showStep('register');
      } else {
        clearSession();
        showStep('landing');
      }
    }
  } catch (_) {
    clearSession();
    showStep('landing');
  }
}

function routeByStatus(booking) {
  const { status } = booking;
  if (['awaiting_payment', 'payment_rejected'].includes(status)) {
    loadPaymentStep(booking);
    showStep('payment');
  } else {
    renderQueueStep(booking);
    showStep('queue');
  }
}

// ─── Payment ──────────────────────────────────────────────────────────────────

// Called from "Proceed to Payment" button on the Access ID screen
function goPayment() {
  const booking = S.activeBooking || { status: 'awaiting_payment' };
  loadPaymentStep(booking);
  showStep('payment');
}

function loadPaymentStep(booking) {
  const info = _infoCache;
  if (info?.paymentMethods) {
    document.getElementById('ticketPrice').textContent = `${info.ticketPriceBirr || 200} Birr per session`;
    renderPaymentMethods(info.paymentMethods);
  } else {
    // Always fetch fresh if cache missing
    apiFetch('/api/info').then((d) => {
      _infoCache = d;
      document.getElementById('ticketPrice').textContent = `${d.ticketPriceBirr} Birr per session`;
      renderPaymentMethods(d.paymentMethods);
    }).catch(() => {
      document.getElementById('paymentMethodsDisplay').innerHTML =
        '<p class="text-muted text-sm">Could not load payment accounts. Please refresh.</p>';
    });
  }

  if (booking.status === 'payment_rejected') {
    document.getElementById('rejectionNotice').classList.remove('hidden');
    document.getElementById('rejectionText').textContent = booking.paymentRejectReason || 'Payment rejected. Please upload again.';
  } else {
    document.getElementById('rejectionNotice').classList.add('hidden');
  }
}

function renderPaymentMethods(methods) {
  const telebirr   = methods?.telebirr   || '--';
  const cbe        = methods?.cbe        || '--';
  const holderName = methods?.holderName || 'SaNex Realities';

  document.getElementById('paymentMethodsDisplay').innerHTML = `
    <div class="pm-row" style="padding-bottom:10px">
      <span class="pm-name" style="color:var(--text-3);font-size:.78rem;min-width:0">Account Holder</span>
      <span style="font-weight:700;font-size:.95rem;color:var(--text);
                   -webkit-user-select:none;user-select:none;pointer-events:none">
        ${esc(holderName)}
      </span>
    </div>
    <div class="pm-row">
      <span class="pm-name">📱 Telebirr</span>
      <span class="pm-value" style="display:flex;align-items:center;gap:8px">
        <span style="font-weight:700">${esc(telebirr)}</span>
        <button type="button" onclick="copyText('${esc(telebirr)}','tb-copy')" class="btn btn-ghost btn-sm" id="tb-copy" style="padding:3px 9px;font-size:.75rem">Copy</button>
      </span>
    </div>
    <div class="pm-row">
      <span class="pm-name">🏦 CBE</span>
      <span class="pm-value" style="display:flex;align-items:center;gap:8px">
        <span style="font-weight:700">${esc(cbe)}</span>
        <button type="button" onclick="copyText('${esc(cbe)}','cbe-copy')" class="btn btn-ghost btn-sm" id="cbe-copy" style="padding:3px 9px;font-size:.75rem">Copy</button>
      </span>
    </div>
  `;
}

function copyText(value, btnId) {
  navigator.clipboard?.writeText(value).then(() => {
    const btn = document.getElementById(btnId);
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1800); }
  }).catch(() => {});
}

function copyAccessId() {
  const val = document.getElementById('accessIdDisplay')?.textContent || '';
  const btn = document.getElementById('copyAidBtn');
  navigator.clipboard?.writeText(val).then(() => {
    if (btn) { btn.innerHTML = '✓ Copied!'; btn.style.color = 'var(--success)'; setTimeout(() => { btn.innerHTML = '<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy Access ID'; btn.style.color = ''; }, 2000); }
  }).catch(() => { alert(`Your Access ID is: ${val}`); });
}

async function onPayment(e) {
  e.preventDefault();
  const msgEl = document.getElementById('paymentMsg');
  setMsg(msgEl, '');

  if (!S.token || !S.bookingId) { setMsg(msgEl, 'Session missing. Please log in again.', 'error'); return; }

  const file = document.getElementById('proofFile').files[0];
  if (!file) { setMsg(msgEl, 'Please select a payment screenshot.', 'error'); return; }

  const fd = new FormData();
  fd.append('proof', file);

  try {
    showBtnLoading(e.target.querySelector('[type=submit]'), true);
    const data = await apiFetchFile(`/api/client/bookings/${S.bookingId}/payment`, fd);

    setMsg(msgEl, 'Payment screenshot submitted. Waiting for admin approval...', 'success');
    setTimeout(() => { renderQueueStep(data.booking); showStep('queue'); }, 1400);
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  } finally {
    showBtnLoading(e.target.querySelector('[type=submit]'), false);
  }
}

// ─── Queue step ───────────────────────────────────────────────────────────────
function renderQueueStep(booking) {
  const qnum  = booking.queueNumber;
  const game  = booking.game;
  const msg   = booking.queueMsg;
  const info  = _infoCache;

  document.getElementById('myQueueNum').textContent  = qnum || '--';
  document.getElementById('myGameName').textContent  = game ? `${game.name} · Station ${game.stationNumber}` : '--';

  // Status alert
  const alertEl = document.getElementById('queueStatusAlert');
  alertEl.className = `alert ${alertClassForMsg(msg)}`;
  alertEl.innerHTML = `<span>${msgIcon(msg)}</span><span>${msg?.text || 'Checking...'}</span>`;

  // Position bar
  const counts = info?.queueCounts?.[booking.gameId] || {};
  const waiting = counts.waiting ?? '--';
  const ahead = (() => {
    if (!qnum || booking.status !== 'approved_waiting') return '--';
    return counts.waiting ?? '--';
  })();

  document.getElementById('qpbWaiting').textContent = waiting;
  document.getElementById('qpbStatus').textContent  = fmtStatus(booking.status);

  // Ahead — derived from queue message
  if (msg?.type === 'waiting') {
    const m = msg.text.match(/(\d+) people ahead/);
    document.getElementById('qpbAhead').textContent = m ? m[1] : '--';
  } else if (msg?.type === 'urgent' || msg?.type === 'playing') {
    document.getElementById('qpbAhead').textContent = '0';
  } else if (msg?.type === 'ready') {
    const m = msg.text.match(/(\d+) people ahead/);
    document.getElementById('qpbAhead').textContent = m ? m[1] : '--';
  } else {
    document.getElementById('qpbAhead').textContent = '--';
  }

  // Now playing
  const cp = counts;
  if (cp.isPlaying && cp.currentPlayerName) {
    document.getElementById('nowPlayingName').textContent = cp.currentPlayerName;
    document.getElementById('nowPlayingGame').textContent = game?.name || '';
  } else {
    document.getElementById('nowPlayingName').textContent = 'No one is playing right now';
    document.getElementById('nowPlayingGame').textContent = '';
  }

  // Score
  if (booking.status === 'completed' && booking.score !== null && booking.score !== undefined) {
    document.getElementById('scoreSection').classList.remove('hidden');
    document.getElementById('myScore').textContent = booking.score;
  } else {
    document.getElementById('scoreSection').classList.add('hidden');
  }

  // Feedback (only after completed)
  if (booking.status === 'completed') {
    checkFeedback(booking.id);
  } else {
    showFeedbackSection(false);
  }

  // Media
  const media = booking.gameplayMedia || [];
  if (media.length) {
    document.getElementById('mediaSection').classList.remove('hidden');
    const list = document.getElementById('mediaList');
    list.innerHTML = '';
    media.forEach((path) => {
      const a = document.createElement('a');
      a.href = `/${path}`;
      a.target = '_blank';
      a.className = 'media-tag';
      a.innerHTML = `📹 Open gameplay file`;
      list.appendChild(a);
    });
  } else {
    document.getElementById('mediaSection').classList.add('hidden');
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────
function startPoll() {
  stopPoll();
  _pollTimer = setInterval(pollStatus, 4500);
  pollStatus();
}

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function pollStatus() {
  if (!S.token) { stopPoll(); return; }
  try {
    const data = await apiFetch('/api/client/status');
    _infoCache  = { ..._infoCache, queueCounts: data.queueCounts };
    _gamesCache = data.queueCounts ? Object.keys(data.queueCounts).map((id) => ({ id, ...data.queueCounts[id] })) : _gamesCache;

    if (data.activeBooking) {
      if (['awaiting_payment', 'payment_rejected'].includes(data.activeBooking.status)) {
        stopPoll();
        loadPaymentStep(data.activeBooking);
        showStep('payment');
        return;
      }
      renderQueueStep(data.activeBooking);
    }

    // Refresh leaderboard
    fetchLeaderboard();
  } catch (_) {}
}

async function fetchLeaderboard() {
  try {
    const data = await apiFetch('/api/leaderboard');
    _lbCache = data;

    // Update tab labels with game names
    if (data.games?.length) {
      data.games.forEach((g) => {
        const tab = document.querySelector(`[data-lb="${g.id}"]`);
        if (tab) tab.textContent = `S${g.stationNumber}: ${g.name.split(' ').slice(0, 2).join(' ')}`;
      });
    }

    renderLeaderboard();
  } catch (_) {}
}

function switchLbTab(tab) {
  _activeLbTab = tab;
  document.querySelectorAll('.lb-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.lb === tab);
  });
  renderLeaderboard();
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboardMini');
  if (!el) return;

  let entries = [];
  if (_activeLbTab === 'all') {
    entries = _lbCache.leaderboard || [];
  } else {
    entries = _lbCache.byGame?.[_activeLbTab] || [];
  }

  el.innerHTML = '';

  if (!entries.length) {
    el.innerHTML = `<div class="lb-row"><span class="lb-rank text-dim" style="font-size:.85rem;padding:6px 0">No scores yet — be the first!</span></div>`;
    return;
  }

  entries.slice(0, 6).forEach((e) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.innerHTML = `
      <span class="lb-rank">${e.rank}</span>
      <span class="lb-name">${esc(e.fullName)}</span>
      ${_activeLbTab === 'all' ? `<span class="lb-game text-muted text-xs">${esc(e.gameName)}</span>` : ''}
      <span class="lb-score">${e.score}</span>
    `;
    el.appendChild(row);
  });
}

// ─── File upload UX ───────────────────────────────────────────────────────────
function setupFileUpload() {
  const fileInput = document.getElementById('proofFile');
  const nameEl    = document.getElementById('uploadFileName');
  if (!fileInput) return;

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      nameEl.textContent = file.name;
      nameEl.classList.remove('hidden');
    }
  });
}

// ─── Session ──────────────────────────────────────────────────────────────────
function saveSession() {
  localStorage.setItem('snx_c_tk', S.token);
  if (S.bookingId) localStorage.setItem('snx_bkg_id', S.bookingId);
}

function clearSession() {
  localStorage.removeItem('snx_c_tk');
  localStorage.removeItem('snx_bkg_id');
  S.token = '';
  S.bookingId = '';
}

function clientLogout() {
  stopPoll();
  clearSession();
  showStep('landing');
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
async function checkFeedback(bookingId) {
  if (!bookingId || !S.token) return;
  try {
    const data = await apiFetch(`/api/client/bookings/${bookingId}/feedback`);
    showFeedbackSection(!data.submitted);
    if (data.submitted) {
      document.getElementById('feedbackSubmitted').classList.remove('hidden');
      document.getElementById('feedbackForm').classList.add('hidden');
    }
  } catch (_) {}
}

function showFeedbackSection(show) {
  document.getElementById('feedbackSection').classList.toggle('hidden', !show);
}

async function onFeedback(e) {
  e.preventDefault();
  const msgEl  = document.getElementById('feedbackMsg');
  const rating = document.querySelector('input[name="rating"]:checked')?.value;
  if (!rating) { setMsg(msgEl, 'Please select a star rating.', 'error'); return; }

  const comment = document.getElementById('fbComment').value;
  const btn     = e.target.querySelector('[type=submit]');
  try {
    btnLoadClient(btn, true);
    await apiFetch(`/api/client/bookings/${S.bookingId}/feedback`, {
      method: 'POST',
      json: { rating: Number(rating), comment },
    });
    document.getElementById('feedbackForm').classList.add('hidden');
    document.getElementById('feedbackSubmitted').classList.remove('hidden');
    setMsg(msgEl, '', '');
  } catch (err) {
    setMsg(msgEl, err.message, 'error');
  } finally {
    btnLoadClient(btn, false);
  }
}

function btnLoadClient(btn, loading) {
  if (!btn) return;
  if (loading) { btn.disabled = true; btn.dataset.orig = btn.textContent; btn.textContent = 'Sending...'; }
  else         { btn.disabled = false; btn.textContent = btn.dataset.orig || 'Submit'; }
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const headers = {};
  if (S.token) headers['Authorization'] = `Bearer ${S.token}`;
  if (opts.json) { headers['Content-Type'] = 'application/json'; }

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.json ? JSON.stringify(opts.json) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

async function apiFetchFile(url, formData) {
  const headers = {};
  if (S.token) headers['Authorization'] = `Bearer ${S.token}`;
  const res = await fetch(url, { method: 'POST', headers, body: formData });
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

function showBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) { btn.disabled = true; btn.dataset.orig = btn.textContent; btn.textContent = 'Loading...'; }
  else         { btn.disabled = false; btn.textContent = btn.dataset.orig || 'Submit'; }
}

function alertClassForMsg(msg) {
  const map = { playing: 'alert-playing', done: 'alert-success', error: 'alert-error', warning: 'alert-warning', urgent: 'alert-playing', ready: 'alert-warning' };
  return map[msg?.type] || 'alert-info';
}

function msgIcon(msg) {
  const map = { playing: '🎮', done: '✅', error: '❌', warning: '⚠️', urgent: '🚨', ready: '⏱️', waiting: '⌛', info: 'ℹ️' };
  return map[msg?.type] || 'ℹ️';
}

function fmtStatus(status) {
  const map = {
    awaiting_payment: 'Pending',
    payment_review:   'Review',
    payment_rejected: 'Rejected',
    approved_waiting: 'Queued',
    playing:          'Playing!',
    completed:        'Done',
    missed_waiting:   'Missed',
  };
  return map[status] || status;
}

function esc(v) {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
