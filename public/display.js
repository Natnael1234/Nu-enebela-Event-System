'use strict';

const STATION_NUMS = [1, 2];
let _prevState = { s1: null, s2: null };

document.addEventListener('DOMContentLoaded', () => {
  tick();
  setInterval(tick, 1000);
  refresh();
  setInterval(refresh, 3500);
});

function tick() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  document.getElementById('clock').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function refresh() {
  try {
    const [displayRes, lbRes] = await Promise.all([
      fetch('/api/display'),
      fetch('/api/leaderboard'),
    ]);
    const displayData = await displayRes.json();
    const lbData      = await lbRes.json();

    displayData.stations.forEach((station) => {
      renderStation(station.stationNumber, station);
    });

    // Per-station leaderboards
    const games = lbData.games || [];
    games.forEach((g) => {
      const entries = lbData.byGame?.[g.id] || [];
      const titleEl = document.getElementById(`dlbTitle${g.stationNumber}`);
      const rowsEl  = document.getElementById(`dlbRows${g.stationNumber}`);
      if (titleEl) titleEl.textContent = `${g.name} — Top Scores`;
      if (rowsEl)  renderLeaderboardInto(rowsEl, entries);
    });
  } catch (_) {
    // silent — keep showing last known state
  }
}

function renderStation(num, data) {
  document.getElementById(`ds${num}Title`).textContent = `Station ${num}`;
  document.getElementById(`ds${num}Game`).textContent  = data.gameName || '--';

  // Now playing
  const nowEl = document.getElementById(`ds${num}Now`);
  if (data.currentPlaying) {
    const b = data.currentPlaying;
    const hasScore = b.score !== null && b.score !== undefined;
    nowEl.innerHTML = `
      <div class="ds-now-label">
        <span style="display:inline-flex;align-items:center;gap:8px">
          <span class="pulse-dot"></span> Now Playing
        </span>
      </div>
      <div class="ds-player-name">${esc(b.user?.fullName || '--')}</div>
      ${hasScore ? `<div class="ds-player-score">${b.score} pts</div>` : ''}
      <div class="ds-queue-num">Queue #${b.queueNumber || '--'}</div>
    `;
  } else {
    nowEl.innerHTML = `
      <div class="ds-now-label">Now Playing</div>
      <div class="ds-empty-state">Waiting for next player...</div>
    `;
  }

  // Next up
  const nextEl = document.getElementById(`ds${num}Next`);
  nextEl.innerHTML = `<div class="ds-next-label">Up Next</div>`;

  const waiting = data.waiting || [];
  if (!waiting.length) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'ds-empty-state text-dim text-sm';
    emptyDiv.textContent = 'No one in queue';
    nextEl.appendChild(emptyDiv);
  } else {
    waiting.slice(0, 4).forEach((b) => {
      const item = document.createElement('div');
      item.className = 'ds-next-item';
      item.innerHTML = `
        <div class="ds-next-num">#${b.queueNumber || '?'}</div>
        <div class="ds-next-name">${esc(b.user?.fullName || '--')}</div>
      `;
      nextEl.appendChild(item);
    });
  }
}

function renderLeaderboardInto(el, entries) {
  el.innerHTML = '';
  if (!entries.length) {
    el.innerHTML = `<div style="color:var(--text-3);font-size:.88rem;padding:6px 0">No scores yet.</div>`;
    return;
  }
  entries.slice(0, 8).forEach((e) => {
    const item = document.createElement('div');
    item.className = 'dlb-row';
    item.innerHTML = `
      <span class="dlb-rank">${e.rank}</span>
      <span class="dlb-name">${esc(e.fullName)}</span>
      <span class="dlb-score">${e.score}</span>
    `;
    el.appendChild(item);
  });
}

function esc(v) {
  return String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
