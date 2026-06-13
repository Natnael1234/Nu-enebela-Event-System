'use strict';

const _state = {
  leader1: null,
  leader2: null,
  gameIds: { 1: null, 2: null },
};

document.addEventListener('DOMContentLoaded', () => {
  tick();
  setInterval(tick, 1000);
  refresh();
  setInterval(refresh, 3500);
});

// ── Clock ──────────────────────────────────────────────────────────────────────
function tick() {
  const n = new Date(), p = (v) => String(v).padStart(2, '0');
  document.getElementById('clock').textContent =
    `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}

// ── Data ───────────────────────────────────────────────────────────────────────
async function refresh() {
  try {
    const [dr, lr] = await Promise.all([fetch('/api/display'), fetch('/api/leaderboard')]);
    const dData = await dr.json();
    const lData = await lr.json();

    (lData.games || []).forEach((g) => { _state.gameIds[g.stationNumber] = g.id; });

    dData.stations.forEach((s) => renderNowPlaying(s));

    [1, 2].forEach((n) => {
      const gameId  = _state.gameIds[n];
      const entries = gameId ? (lData.byGame?.[gameId] || []).map((e, i) => ({ ...e, rank: i + 1 })) : [];
      const gameName = lData.games?.find((g) => g.stationNumber === n)?.name || `Station ${n}`;

      document.getElementById(`lb${n}GameName`).textContent = gameName;
      document.getElementById(`lb${n}Count`).textContent    = entries.length ? `${entries.length} players` : '';

      const newLeader = entries[0]?.fullName || null;
      const prevKey   = `leader${n}`;
      const changed   = _state[prevKey] && newLeader && newLeader !== _state[prevKey];
      _state[prevKey] = newLeader;

      renderLeaderboard(n, entries, changed, gameName);
      if (changed) showBanner(newLeader, gameName);
    });
  } catch (_) {}
}

// ── Now Playing ───────────────────────────────────────────────────────────────
function renderNowPlaying(data) {
  const n = data.stationNumber;

  document.getElementById(`nc${n}Game`).textContent = data.gameName || `Station ${n}`;

  const playerEl   = document.getElementById(`nc${n}Player`);
  const scoreBox   = document.getElementById(`nc${n}ScoreBox`);
  const scoreValEl = document.getElementById(`nc${n}Score`);
  const queueEl    = document.getElementById(`nc${n}Queue`);

  if (data.currentPlaying) {
    const b = data.currentPlaying;
    playerEl.textContent = b.user?.fullName || '--';
    playerEl.className   = 'now-player-name';

    if (b.score !== null && b.score !== undefined) {
      scoreBox.style.display = 'block';
      animNum(scoreValEl, Number(b.score));
    } else {
      scoreBox.style.display = 'none';
    }
  } else {
    playerEl.textContent = 'Waiting for next player...';
    playerEl.className   = 'now-player-name now-empty-text';
    scoreBox.style.display = 'none';
  }

  // Clear chips but keep the "Next:" label span
  const labelSpan = queueEl.querySelector('.queue-label');
  queueEl.innerHTML = '';
  if (labelSpan) queueEl.appendChild(labelSpan);

  (data.waiting || []).slice(0, 8).forEach((b, i) => {
    const chip = document.createElement('span');
    chip.className = `qchip${i === 0 ? ' next' : ''}`;
    chip.textContent = `#${b.queueNumber}`;
    queueEl.appendChild(chip);
  });
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
const CRESTS = [
  { bg: 'crest-bg-1', icon: '♛', nameClass: 'p-n-1', scoreClass: 'p-s-1', rankClass: 'rc-1', slotClass: 'ps-1', rankLabel: 'rl-1', label: '1st Place' },
  { bg: 'crest-bg-2', icon: '⚜', nameClass: 'p-n-2', scoreClass: 'p-s-2', rankClass: 'rc-2', slotClass: 'ps-2', rankLabel: 'rl-2', label: '2nd Place' },
  { bg: 'crest-bg-3', icon: '⚔', nameClass: 'p-n-3', scoreClass: 'p-s-3', rankClass: 'rc-3', slotClass: 'ps-3', rankLabel: 'rl-3', label: '3rd Place' },
];

function renderLeaderboard(n, entries, newLeader, gameName) {
  const el = document.getElementById(`lb${n}Content`);
  el.innerHTML = '';

  if (!entries.length) {
    el.innerHTML = `
      <div class="lb-solo">
        ${gemSVG()}
        <div class="no-scores">— No scores yet —<br/>Be the first champion</div>
      </div>`;
    return;
  }

  // One player, solo display
  if (entries.length === 1) {
    const e = entries[0];
    el.innerHTML = `
      <div class="lb-solo">
        ${gemSVG()}
        <div style="text-align:center">
          <div style="font-family:var(--cinzel);font-size:clamp(.75rem,1.5vw,1.1rem);color:var(--gold);font-weight:700;text-shadow:0 0 12px rgba(255,215,0,.5)">${esc(e.fullName)}</div>
          <div style="font-family:var(--brand);font-size:clamp(1rem,2.2vw,1.6rem);font-weight:900;color:var(--gold);margin-top:4px;text-shadow:0 0 16px rgba(255,215,0,.7)">${e.score.toLocaleString()}</div>
          <div style="font-size:.58rem;letter-spacing:.14em;text-transform:uppercase;color:#4a5070;margin-top:4px">Current Champion</div>
        </div>
      </div>`;
    return;
  }

  // Podium — visual order: 2nd | 1st | 3rd
  const top3  = entries.slice(0, 3);
  const order = [top3[1] || null, top3[0] || null, top3[2] || null];
  const cIdx  = [1, 0, 2]; // which CRESTS entry to use

  const podium = document.createElement('div');
  podium.className = 'podium';

  order.forEach((entry, vi) => {
    const ci    = cIdx[vi];
    const c     = CRESTS[ci];
    const col   = document.createElement('div');
    col.className = `podium-slot ${c.slotClass}${vi === 1 && newLeader ? ' new-leader' : ''}`;

    if (!entry) { podium.appendChild(col); return; }

    col.innerHTML = `
      <div class="rank-label ${c.rankLabel}">${c.label}</div>
      <div class="crest-wrap">
        <div class="crest">
          <div class="crest-bg ${c.bg}"></div>
          <div class="crest-border">
            <span class="crest-icon">${c.icon}</span>
          </div>
        </div>
      </div>
      <div class="rank-coin ${c.rankClass}">${ci + 1}</div>
      <div class="podium-name ${c.nameClass}">${esc(entry.fullName)}</div>
      <div class="podium-score ${c.scoreClass}">${entry.score.toLocaleString()}</div>
    `;
    podium.appendChild(col);
  });
  el.appendChild(podium);

  // Ornamental divider
  const rest = entries.slice(3);
  if (rest.length) {
    el.insertAdjacentHTML('beforeend', `
      <div class="orn-divider">
        <div class="orn-line"></div>
        <div class="orn-diamond"></div>
        <div class="orn-line"></div>
      </div>
    `);

    const rows = document.createElement('div');
    rows.className = 'lb-rows';
    rest.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.style.animationDelay = `${i * 0.06}s`;
      row.innerHTML = `
        <span class="row-rank">${e.rank}</span>
        <span class="row-name">${esc(e.fullName)}</span>
        <span class="row-score">${e.score.toLocaleString()}</span>
      `;
      rows.appendChild(row);
    });
    el.appendChild(rows);
  }
}

// ── Banner ────────────────────────────────────────────────────────────────────
function showBanner(name, game) {
  document.getElementById('__banner')?.remove();
  const b = document.createElement('div');
  b.id        = '__banner';
  b.className = 'champion-banner';
  b.innerHTML = `👑 &nbsp;New Leader! &nbsp;<strong>${esc(name)}</strong>&nbsp; — ${esc(game)}`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 3900);
}

// ── Animated number ───────────────────────────────────────────────────────────
function animNum(el, target) {
  const cur = parseInt(el.textContent.replace(/,/g, '')) || 0;
  if (cur === target) return;
  const steps = 28, dur = 550, step = dur / steps;
  let i = 0;
  const t = setInterval(() => {
    i++;
    const p = i / steps;
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(cur + (target - cur) * e).toLocaleString();
    if (i >= steps) { clearInterval(t); el.textContent = target.toLocaleString(); }
  }, step);
}

// ── Gem SVG (for empty/solo leaderboard) ─────────────────────────────────────
function gemSVG() {
  return `
  <svg viewBox="0 0 100 100" style="width:clamp(55px,7vw,90px);height:clamp(55px,7vw,90px)">
    <defs>
      <linearGradient id="gemG1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#e8f0ff"/>
        <stop offset="35%" stop-color="#9ab0ff"/>
        <stop offset="70%" stop-color="#6070cc"/>
        <stop offset="100%" stop-color="#303878"/>
      </linearGradient>
      <linearGradient id="gemG2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="rgba(255,255,255,.6)"/>
        <stop offset="100%" stop-color="rgba(120,140,220,.2)"/>
      </linearGradient>
    </defs>
    <!-- outer gem shape -->
    <polygon points="50,5 90,35 80,90 20,90 10,35" fill="url(#gemG1)" opacity=".9"/>
    <!-- facets -->
    <polygon points="50,5 90,35 50,42" fill="url(#gemG2)" opacity=".7"/>
    <polygon points="50,5 10,35 50,42" fill="rgba(255,255,255,.15)"/>
    <polygon points="10,35 50,42 20,90" fill="rgba(60,80,160,.5)"/>
    <polygon points="90,35 80,90 50,42" fill="rgba(30,50,140,.6)"/>
    <polygon points="20,90 50,42 80,90" fill="rgba(80,100,200,.4)"/>
    <!-- sparkle -->
    <circle cx="50" cy="28" r="3" fill="white" opacity=".8"/>
  </svg>`;
}

function esc(v) {
  return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
