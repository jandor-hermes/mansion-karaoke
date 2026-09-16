/** Static phone guest UI for the karaoke control plane.
 * Single HTML page, no framework or build step; the server interpolates the
 * room name. The bearer token is a shared party secret entered once and kept
 * in the guest browser's localStorage. */

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function guestPage(roomId: string): string {
    const room = escapeHtml(roomId);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Karaoke — ${room}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d12; color: #f2f2f7; font-family: -apple-system, system-ui, sans-serif;
         padding-bottom: env(safe-area-inset-bottom); }
  header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: .5rem;
           padding: .75rem 1rem; background: #14141c; border-bottom: 1px solid #26263a; }
  header h1 { font-size: 1.1rem; font-weight: 700; }
  header .room { color: #ff5c8a; }
  main { padding: 1rem; display: grid; gap: 1.25rem; max-width: 720px; margin: 0 auto; }
  section h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
               color: #9a9ab0; margin-bottom: .5rem; }
  input[type="search"], .token-row input {
    width: 100%; font-size: 1rem; padding: .9rem 1rem; border-radius: .75rem;
    border: 1px solid #33334d; background: #1b1b28; color: #f2f2f7; }
  button { border: 0; border-radius: .75rem; background: #ff5c8a; color: #14141c;
           font-size: 1rem; font-weight: 700; padding: .9rem 1rem; min-height: 3rem;
           min-width: 3rem; cursor: pointer; }
  button.secondary { background: #2a2a40; color: #f2f2f7; }
  button:active { filter: brightness(1.3); }
  .token-row { display: grid; gap: .5rem; padding: 1rem; background: #1b1b28;
               border: 1px solid #33334d; border-radius: .75rem; }
  .result, .queued { display: grid; grid-template-columns: 96px 1fr; gap: .75rem; width: 100%;
    text-align: left; background: #1b1b28; color: #f2f2f7; padding: .5rem; border-radius: .75rem;
    border: 1px solid #26263a; font-weight: 400; min-height: 0; align-items: center; }
  .queued { grid-template-columns: 1fr auto; }
  .queue-actions { display: flex; gap: .4rem; }
  .result img { width: 96px; height: 54px; object-fit: cover; border-radius: .4rem; background: #26263a; }
  .result .meta, .queued .meta { display: grid; gap: .2rem; align-content: center; overflow: hidden; }
  .result .title, .queued .title { font-size: .95rem; font-weight: 600; color: #f2f2f7;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .result .sub, .queued .sub { font-size: .8rem; color: #9a9ab0; }
  .results, .queue-list { display: grid; gap: .6rem; }
  .search-wrap { position: relative; }
  .search-suggestions { position: absolute; left: 0; right: 0; z-index: 4; display: grid; gap: 1px;
    background: #33334d; border: 1px solid #33334d; border-radius: .75rem; overflow: hidden; }
  .search-suggestions:empty { display: none; }
  .suggestion { border-radius: 0; background: #1b1b28; color: #f2f2f7; text-align: left; font-weight: 500; }
  dialog { width: min(92vw, 28rem); margin: auto; border: 1px solid #3a3a55; border-radius: 1rem;
    background: #171721; color: #f2f2f7; padding: 1rem; }
  dialog::backdrop { background: rgba(0,0,0,.72); }
  .sheet { display: grid; gap: .75rem; }
  .sheet h3 { font-size: 1.05rem; line-height: 1.3; }
  .sheet-actions { display: grid; gap: .6rem; }
  .danger { background: #802a3e; color: white; }
  #now-playing .result-card-empty { color: #9a9ab0; font-size: .9rem; }
  .controls { display: grid; grid-template-columns: repeat(5, 1fr); gap: .5rem; }
  .controls button { font-size: 1.2rem; padding: 1rem 0; }
  .status { font-size: .8rem; color: #9a9ab0; min-height: 1.2rem; margin-top: .5rem; }
  .status.error { color: #ff7a7a; }
  @media (max-width: 380px) { .result { grid-template-columns: 72px 1fr; } .result img { width: 72px; height: 40px; } }
</style>
</head>
<body>
<header><h1>🎤 Karaoke</h1><span class="room">${room}</span></header>
<main>
  <div class="token-row" id="token-row" hidden>
    <label for="token-input">Enter the party token (shared secret from the host)</label>
    <input id="token-input" type="password" autocomplete="off" placeholder="Party token">
    <button id="token-save" type="button">Save token</button>
  </div>

  <section id="search-section">
    <h2>Search</h2>
    <div class="search-wrap">
      <form id="search-form">
        <input id="karaoke-search" type="search" placeholder="Search YouTube karaoke…" autocomplete="off" aria-autocomplete="list" aria-controls="search-suggestions">
      </form>
      <div class="search-suggestions" id="search-suggestions" role="listbox"></div>
    </div>
    <div class="status" id="search-status"></div>
    <div class="results" id="results"></div>
  </section>

  <section id="now-playing-section">
    <h2>Now playing</h2>
    <div id="now-playing"><div class="result-card-empty">Nothing yet — queue something!</div></div>
  </section>

  <section id="queue-section">
    <h2>Queue</h2>
    <div class="queue-list" id="queue-list"></div>
  </section>

  <section>
    <h2>Controls</h2>
    <div class="controls">
      <button id="control-toggle" class="secondary" type="button">⏸</button>
      <button id="control-skip" class="secondary" type="button">⏭</button>
      <button id="volume-down" class="secondary" type="button">🔉</button>
      <button id="volume-up" class="secondary" type="button">🔊</button>
      <button id="control-fullscreen" class="secondary" type="button">⛶</button>
    </div>
    <div class="status" id="control-status"></div>
  </section>
</main>
<dialog id="song-actions">
  <div class="sheet">
    <h3 id="song-actions-title">Choose an action</h3>
    <div class="sheet-actions">
      <button id="action-add" type="button">Add to queue</button>
      <button id="action-next" class="secondary" type="button">Play next</button>
      <button id="action-now" class="danger" type="button">Play now</button>
      <button id="action-cancel" class="secondary" type="button">Cancel</button>
    </div>
  </div>
</dialog>
<dialog id="play-now-confirm">
  <div class="sheet">
    <h3 id="play-now-confirm-title">Interrupt the current song?</h3>
    <div class="sheet-actions">
      <button id="play-now-confirm-button" class="danger" type="button">Yes, play now</button>
      <button id="play-now-cancel" class="secondary" type="button">Cancel</button>
    </div>
  </div>
</dialog>
<script>
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const tokenRow = $('token-row');
  let token = localStorage.getItem('karaoke-token');
  if (!token) tokenRow.hidden = false;
  $('token-save').addEventListener('click', () => {
    token = $('token-input').value.trim();
    localStorage.setItem('karaoke-token', token);
    tokenRow.hidden = true;
    refresh();
  });

  const api = (path, init) => fetch(path, {
    ...init,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init && init.headers || {}) },
  });

  let volume = 0.75;
  let playing = true;
  let selectedSong = null;
  const recentKey = 'karaoke-recent-searches';

  const setStatus = (id, message, isError) => { const el = $(id); el.textContent = message || ''; el.classList.toggle('error', !!isError); };

  $('search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('karaoke-search').value.trim();
    if (!query) return;
    $('search-suggestions').textContent = '';
    setStatus('search-status', 'Searching…');
    try {
      const response = await api('/search', { method: 'POST', body: JSON.stringify({ query }) });
      if (response.status === 401) { tokenRow.hidden = false; throw new Error('bad token'); }
      const page = await response.json();
      renderResults(page.items || []);
      const recent = JSON.parse(localStorage.getItem(recentKey) || '[]').filter((value) => value.toLowerCase() !== query.toLowerCase());
      localStorage.setItem(recentKey, JSON.stringify([query, ...recent].slice(0, 8)));
      setStatus('search-status', '');
    } catch (error) {
      renderResults([]);
      setStatus('search-status', 'Search failed (' + (error && error.message ? error.message : 'error') + ')', true);
    }
  });

  const renderResults = (items) => {
    const container = $('results');
    container.textContent = '';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result';
      const thumbnail = item.thumbnail
        ? '<img src="' + item.thumbnail + '" alt="" loading="lazy">'
        : '<img alt="">';
      button.innerHTML = thumbnail +
        '<span class="meta"><span class="title">' + esc(item.title || item.id) + '</span>' +
        '<span class="sub">' + esc(item.channel || '') + (item.duration ? ' · ' + esc(item.duration) : '') + '</span></span>';
      button.addEventListener('click', () => openSongActions(item));
      container.appendChild(button);
    }
  };

  const itemPayload = (item) => ({
    itemId: (((globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') && globalThis.crypto.randomUUID()) || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)),
    videoId: item.id,
    title: item.title || item.id,
    ...(item.channel ? { channel: item.channel } : {}),
    ...(item.duration ? { duration: item.duration } : {}),
    ...(item.thumbnail ? { thumbnail: item.thumbnail } : {})
  });
  const openSongActions = (item) => {
    selectedSong = item;
    $('song-actions-title').textContent = item.title || item.id;
    $('song-actions').showModal();
  };
  const queue = async (item, path = '/queue', success = 'Added to the queue!') => {
    setStatus('control-status', 'Adding…');
    try {
      const response = await api(path, { method: 'POST', body: JSON.stringify(itemPayload(item)) });
      if (response.status === 401) { tokenRow.hidden = false; throw new Error('bad token'); }
      setStatus('control-status', response.ok ? success : 'Queue failed', !response.ok);
      refresh();
    } catch (error) { setStatus('control-status', 'Queue failed (' + (error && error.message ? error.message : 'error') + ')', true); }
  };

  $('action-add').addEventListener('click', () => { $('song-actions').close(); if (selectedSong) queue(selectedSong); });
  $('action-next').addEventListener('click', () => { $('song-actions').close(); if (selectedSong) queue(selectedSong, '/queue/next', 'Set to play next!'); });
  $('action-now').addEventListener('click', () => {
    $('song-actions').close();
    if (!selectedSong) return;
    $('play-now-confirm-title').textContent = 'Interrupt and play “' + (selectedSong.title || selectedSong.id) + '” now?';
    $('play-now-confirm').showModal();
  });
  $('action-cancel').addEventListener('click', () => $('song-actions').close());
  $('play-now-cancel').addEventListener('click', () => $('play-now-confirm').close());
  $('play-now-confirm-button').addEventListener('click', () => {
    $('play-now-confirm').close();
    if (selectedSong) queue(selectedSong, '/queue/play-now', 'Playing now!');
  });
  for (const dialog of [$('song-actions'), $('play-now-confirm')]) dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  let suggestTimer;
  $('karaoke-search').addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const query = $('karaoke-search').value.trim();
    if (!query) { $('search-suggestions').textContent = ''; return; }
    suggestTimer = setTimeout(async () => {
      try {
        const response = await api('/suggest?q=' + encodeURIComponent(query));
        if (!response.ok) throw new Error('suggest failed');
        const remote = (await response.json()).suggestions || [];
        const recent = JSON.parse(localStorage.getItem(recentKey) || '[]').filter((value) => value.toLowerCase().startsWith(query.toLowerCase()));
        const seen = new Set();
        const values = [...recent, ...remote].filter((value) => { const key = value.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 8);
        $('search-suggestions').innerHTML = values.map((value) => '<button type="button" class="suggestion" role="option" data-value="' + esc(value) + '">' + esc(value) + '</button>').join('');
      } catch { $('search-suggestions').textContent = ''; }
    }, 250);
  });
  $('search-suggestions').addEventListener('click', (event) => {
    const button = event.target.closest('.suggestion');
    if (!button) return;
    $('karaoke-search').value = button.getAttribute('data-value') || '';
    $('search-suggestions').textContent = '';
    $('search-form').requestSubmit();
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.search-wrap')) $('search-suggestions').textContent = ''; });

  const card = (item) => '<div class="queued"><span class="meta">' +
    '<span class="title">' + (item.title || item.videoId) + '</span>' +
    '<span class="sub">' + (item.channel || '') + '</span></span></div>';
  const queueCard = (item, position) => '<div class="queued"><span class="meta">' +
    '<span class="title">' + esc(item.title || item.videoId) + '</span><span class="sub">' + esc(item.channel || '') + (item.duration ? ' · ' + esc(item.duration) : '') + '</span></span>' +
    '<span class="queue-actions">' +
    '<button class="secondary queue-up" type="button" data-item-id="' + item.itemId + '" data-position="' + position + '" aria-label="Move up">↑</button>' +
    '<button class="secondary queue-down" type="button" data-item-id="' + item.itemId + '" data-position="' + position + '" aria-label="Move down">↓</button>' +
    '<button class="secondary queue-remove" type="button" data-item-id="' + item.itemId + '" aria-label="Remove from queue">✕</button>' +
    '</span></div>';

  let lastStatus = '';
  async function refresh() {
    try {
      const response = await api('/status');
      if (response.status === 401) { tokenRow.hidden = false; return; }
      const status = await response.json();
      const next = JSON.stringify({ c: status.current, q: status.queue });
      if (next === lastStatus) return;
      lastStatus = next;
      const now = status.current
        ? '<div class="queued"><span class="meta"><span class="title">' + esc(status.current.title || status.current.videoId) + '</span>' +
          '<span class="sub">' + esc(status.current.channel || 'playing now') + (status.current.duration ? ' · ' + esc(status.current.duration) : '') + '</span></span></div>'
        : '<div class="result-card-empty">Nothing yet — queue something!</div>';
      $('now-playing').innerHTML = now;
      $('queue-list').innerHTML = (status.queue || []).map(queueCard).join('');
    } catch { /* transient; next poll retries */ }
  }

  $('queue-list').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const itemId = button.getAttribute('data-item-id');
    if (!itemId) return;
    if (button.classList.contains('queue-remove')) {
      control('/queue/remove', { itemId });
    } else if (button.classList.contains('queue-up') || button.classList.contains('queue-down')) {
      const position = Number(button.getAttribute('data-position'));
      const delta = button.classList.contains('queue-up') ? -1 : 1;
      control('/queue/move', { itemId, position: position + delta });
    }
  });

  const control = async (path, body) => {
    try {
      const response = await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      if (response.status === 401) tokenRow.hidden = false;
      setStatus('control-status', response.ok ? '' : 'Command failed', !response.ok);
    } catch { setStatus('control-status', 'Command failed', true); }
    refresh();
  };

  $('control-toggle').addEventListener('click', () => {
    playing = !playing;
    $('control-toggle').textContent = playing ? '⏸' : '▶';
    control(playing ? '/control/resume' : '/control/pause');
  });
  $('control-skip').addEventListener('click', () => control('/control/skip'));
  $('volume-down').addEventListener('click', () => {
    volume = Math.max(0, Number((volume - 0.25).toFixed(2)));
    control('/control/volume', { volume });
  });
  $('volume-up').addEventListener('click', () => {
    volume = Math.min(1, Number((volume + 0.25).toFixed(2)));
    control('/control/volume', { volume });
  });
  $('control-fullscreen').addEventListener('click', () => control('/control/fullscreen'));

  if (token) refresh();
  setInterval(refresh, 2500);
})();
</script>
</body>
</html>`;
}
