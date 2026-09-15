/** Static, no-build phone controller served by the control plane. */
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
  :root { color-scheme: dark; --bg:#101010; --surface:#191919; --raised:#242424; --text:#fff; --muted:#b3b3b3; --accent:#ff5c8a; --danger:#c83f5d; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { background:var(--bg); scroll-behavior:smooth; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,system-ui,sans-serif; padding-bottom:calc(5.25rem + env(safe-area-inset-bottom)); }
  button,input { font:inherit; }
  button { border:0; cursor:pointer; min-height:44px; }
  button:focus-visible,input:focus-visible { outline:3px solid #fff; outline-offset:2px; }
  .auth-gate { min-height:100dvh; display:grid; place-items:center; padding:1.25rem; }
  .token-row { width:min(100%,28rem); display:grid; gap:.8rem; padding:1.25rem; background:var(--surface); border-radius:1rem; box-shadow:0 16px 48px #0008; }
  .token-row h1 { margin:0; font-size:1.4rem; }
  .token-row p { margin:0; color:var(--muted); }
  .token-row input,.search-wrap input { width:100%; border:1px solid #4d4d4d; background:var(--raised); color:var(--text); padding:.9rem 1rem; border-radius:999px; font-size:1rem; }
  .primary { background:var(--accent); color:#16080d; border-radius:999px; padding:.75rem 1rem; font-weight:800; }
  .secondary { background:var(--raised); color:var(--text); border-radius:999px; padding:.65rem .9rem; font-weight:700; }
  .danger { background:#76243a; color:#fff; border-radius:999px; padding:.75rem 1rem; font-weight:800; }
  header { position:sticky; top:0; z-index:5; padding:calc(.55rem + env(safe-area-inset-top)) .85rem .55rem; background:#101010f2; backdrop-filter:blur(14px); border-bottom:1px solid #292929; }
  .topline { display:flex; align-items:center; gap:.55rem; }
  .topline strong { flex:1; font-size:1rem; }
  .room { color:var(--accent); font-size:.8rem; }
  .change-token { min-height:36px; padding:.35rem .7rem; font-size:.78rem; }
  .now-strip { margin-top:.55rem; display:flex; align-items:center; gap:.65rem; min-width:0; background:var(--surface); border-radius:.6rem; padding:.55rem .65rem; }
  .now-strip .pulse { width:.55rem; height:.55rem; flex:0 0 auto; border-radius:50%; background:var(--accent); box-shadow:0 0 12px var(--accent); }
  .now-copy { min-width:0; display:grid; gap:.08rem; }
  .now-copy b,.now-copy span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .now-copy b { font-size:.88rem; }
  .now-copy span { color:var(--muted); font-size:.74rem; }
  main { max-width:720px; margin:auto; padding:.85rem; }
  .panel { display:none; }
  .panel.active { display:block; }
  .section-head { display:flex; align-items:baseline; gap:.6rem; margin:.25rem 0 .65rem; }
  .section-head h2 { margin:0; font-size:1.35rem; }
  .count { color:var(--muted); font-size:.8rem; }
  .search-wrap { position:sticky; top:calc(6.8rem + env(safe-area-inset-top)); z-index:4; background:var(--bg); padding:.2rem 0 .65rem; }
  .search-suggestions { position:absolute; left:0; right:0; top:3.4rem; display:grid; background:var(--raised); border-radius:.75rem; box-shadow:0 12px 30px #000b; overflow:hidden; }
  .search-suggestions:empty { display:none; }
  .suggestion { text-align:left; color:var(--text); background:var(--raised); padding:.75rem 1rem; border-bottom:1px solid #383838; }
  .status { color:var(--muted); font-size:.82rem; min-height:1.1rem; margin:.3rem 0; }
  .status.error { color:#ff91a7; }
  .results,.queue-list { display:grid; gap:.55rem; }
  .result { display:grid; grid-template-columns:88px minmax(0,1fr) auto; gap:.7rem; align-items:center; padding:.5rem; background:var(--surface); border-radius:.7rem; }
  .result-main { display:contents; color:var(--text); background:transparent; text-align:left; padding:0; }
  .result img { width:88px; height:50px; object-fit:cover; border-radius:.35rem; background:#333; }
  .meta { min-width:0; display:grid; gap:.18rem; }
  .title { font-weight:700; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .sub { color:var(--muted); font-size:.78rem; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .quick-add { width:44px; padding:0; font-size:1.45rem; border-radius:50%; }
  .quick-add.done { background:#285b3a; color:#fff; font-size:.72rem; width:auto; min-width:54px; padding:0 .55rem; border-radius:999px; }
  .load-more { width:100%; margin-top:.75rem; }
  .queue-empty { color:var(--muted); background:var(--surface); padding:1rem; border-radius:.7rem; }
  .history-head { margin-top:1.3rem; }
  .history-list { display:grid; gap:.4rem; }
  .history-item { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:.6rem; padding:.65rem; border-radius:.65rem; background:#151515; color:var(--muted); }
  .queued { display:grid; grid-template-columns:2rem minmax(0,1fr) auto; gap:.55rem; align-items:center; background:var(--surface); padding:.55rem; border-radius:.7rem; }
  .position { color:var(--muted); text-align:center; font-weight:700; }
  .queue-actions { display:flex; gap:.25rem; }
  .queue-actions button { width:44px; padding:0; border-radius:50%; }
  .queue-actions button:disabled { opacity:.25; cursor:default; }
  .controls { display:grid; grid-template-columns:repeat(5,1fr); gap:.45rem; margin-top:.8rem; }
  .controls button { font-size:1.25rem; padding:.6rem 0; border-radius:50%; }
  .control-labels { margin-top:.8rem; color:var(--muted); font-size:.85rem; line-height:1.5; }
  .bottom-nav { position:fixed; z-index:9; bottom:0; left:0; right:0; display:grid; grid-template-columns:repeat(3,1fr); padding:.45rem .6rem calc(.45rem + env(safe-area-inset-bottom)); background:#171717f7; border-top:1px solid #343434; backdrop-filter:blur(16px); }
  .bottom-nav button { color:var(--muted); background:transparent; border-radius:.65rem; display:grid; place-items:center; gap:.08rem; font-size:.74rem; font-weight:700; }
  .bottom-nav button span { font-size:1.2rem; }
  .bottom-nav button.active { color:var(--text); background:var(--raised); }
  .badge { min-width:1.15rem; padding:.05rem .32rem; border-radius:999px; background:var(--accent); color:#16080d; font-size:.68rem; }
  .toast { position:fixed; z-index:20; left:50%; bottom:calc(5.5rem + env(safe-area-inset-bottom)); transform:translateX(-50%); width:max-content; max-width:calc(100vw - 2rem); padding:.75rem 1rem; border-radius:999px; background:#fff; color:#111; font-size:.88rem; font-weight:750; box-shadow:0 8px 30px #000b; }
  .toast.error { background:#ff91a7; }
  dialog { width:min(92vw,28rem); margin:auto; border:1px solid #444; border-radius:1rem; background:var(--surface); color:var(--text); padding:1rem; box-shadow:0 16px 50px #000b; }
  dialog::backdrop { background:#000b; }
  .sheet { display:grid; gap:.8rem; }
  .sheet h3 { margin:0; line-height:1.3; }
  .sheet-actions { display:grid; gap:.55rem; }
  @media(max-width:380px) { .result { grid-template-columns:72px minmax(0,1fr) auto; } .result img{width:72px;height:41px;} .queue-actions{gap:.1rem;} }
</style>
</head>
<body>
<div class="auth-gate" id="auth-gate">
  <form class="token-row" id="token-form">
    <h1>🎤 Join ${room}</h1><p>Enter your name and the party token from the host.</p>
    <input id="name-input" type="text" autocomplete="name" maxlength="40" placeholder="Your name" required>
    <input id="token-input" type="text" autocomplete="off" placeholder="Party token" required>
    <button id="token-save" class="primary" type="submit">Join party</button>
    <div class="status" id="token-status" role="alert"></div>
  </form>
</div>
<div id="controller-shell" hidden>
<header>
  <div class="topline"><strong>🎤 Karaoke</strong><span class="room" id="guest-name"></span><span class="room">${room}</span><button id="change-token" class="secondary change-token" type="button">Profile</button></div>
  <div class="now-strip"><span class="pulse"></span><div class="now-copy" id="now-playing"><b>Nothing playing</b><span>Search for a song</span></div></div>
</header>
<main>
  <section class="panel active" id="search-panel">
    <div class="section-head"><h2>Find a song</h2><span class="count" id="result-count"></span></div>
    <div class="search-wrap">
      <form id="search-form"><input id="karaoke-search" type="search" placeholder="Song or artist…" autocomplete="off" aria-label="Search YouTube karaoke"></form>
      <div class="search-suggestions" id="search-suggestions"></div>
    </div>
    <div class="status" id="search-status" aria-live="polite"></div>
    <div class="results" id="results"></div>
    <button class="secondary load-more" id="load-more" type="button" hidden>Show more results</button>
  </section>
  <section class="panel" id="queue-panel">
    <div class="section-head"><h2>Up next</h2><span class="count" id="queue-count"></span><button id="clear-queue" class="danger" type="button" hidden>Clear queue</button></div>
    <div class="queue-list" id="queue-list"></div>
    <div class="status" id="queue-status" aria-live="polite"></div>
    <div class="section-head history-head"><h2>History</h2><span class="count" id="history-count"></span></div>
    <div class="history-list" id="history-list"></div>
  </section>
  <section class="panel" id="controls-panel">
    <div class="section-head"><h2>Playback</h2></div>
    <div class="controls">
      <button id="control-toggle" class="secondary" type="button" aria-label="Pause playback">⏸</button>
      <button id="control-skip" class="secondary" type="button" aria-label="Skip song">⏭</button>
      <button id="volume-down" class="secondary" type="button" aria-label="Volume down">🔉</button>
      <button id="volume-up" class="secondary" type="button" aria-label="Volume up">🔊</button>
      <button id="control-fullscreen" class="secondary" type="button" aria-label="Fullscreen">⛶</button>
    </div>
    <div class="status" id="control-status" aria-live="polite"></div>
    <div class="control-labels">Pause or resume the TV, skip to the next singer, adjust volume, or restore fullscreen presentation.</div>
  </section>
</main>
<nav class="bottom-nav" id="bottom-nav" aria-label="Controller sections">
  <button id="nav-search" class="active" type="button" data-panel="search"><span>⌕</span>Search</button>
  <button id="nav-queue" type="button" data-panel="queue"><span>☷</span>Queue <b class="badge" id="queue-badge" hidden>0</b></button>
  <button id="nav-controls" type="button" data-panel="controls"><span>◉</span>Controls</button>
</nav>
</div>
<div class="toast" id="toast" aria-live="polite" hidden></div>
<dialog id="song-actions" aria-labelledby="song-actions-title"><div class="sheet"><h3 id="song-actions-title">Choose an action</h3><div class="sheet-actions">
  <button id="action-add" class="primary" type="button">Add to queue</button><button id="action-next" class="secondary" type="button">Play next</button><button id="action-now" class="danger" type="button">Play now</button><button id="action-cancel" class="secondary" type="button">Cancel</button>
</div></div></dialog>
<dialog id="play-now-confirm" aria-labelledby="play-now-confirm-title"><div class="sheet"><h3 id="play-now-confirm-title">Interrupt the current song?</h3><div class="sheet-actions">
  <button id="play-now-confirm-button" class="danger" type="button">Yes, play now</button><button id="play-now-cancel" class="secondary" type="button">Cancel</button>
</div></div></dialog>
<dialog id="queue-play-confirm" aria-labelledby="queue-play-confirm-title"><div class="sheet"><h3 id="queue-play-confirm-title">Interrupt the current song?</h3><div class="sheet-actions">
  <button id="queue-play-confirm-button" class="danger" type="button">Yes, play now</button><button id="queue-play-cancel" class="secondary" type="button">Cancel</button>
</div></div></dialog>
<dialog id="clear-queue-confirm" aria-labelledby="clear-queue-confirm-title"><div class="sheet"><h3 id="clear-queue-confirm-title">Clear every waiting song?</h3><div class="sheet-actions">
  <button id="clear-queue-confirm-button" class="danger" type="button">Yes, clear queue</button><button id="clear-queue-cancel" class="secondary" type="button">Cancel</button>
</div></div></dialog>
<script>
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const tokenKey = 'karaoke-token-${room}';
  const nameKey = 'karaoke-name-${room}';
  const legacyTokenKey = 'karaoke-token';
  const recentKey = 'karaoke-recent-searches';
  let token = null, guestName = '', selectedSong = null, selectedQueueItem = null, allResults = [], queuedItems = [], visibleResults = 0, queueLength = 0, volume = .75, playing = true, toastTimer, suggestSequence = 0;
  try { token = localStorage.getItem(tokenKey) || localStorage.getItem(legacyTokenKey); guestName=localStorage.getItem(nameKey)||''; } catch {}
  const api = (path, init) => fetch(path, {...init, headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(init && init.headers || {})}});
  const setStatus = (id,message,error) => { const node=$(id); node.textContent=message||''; node.classList.toggle('error',!!error); };
  const showToast = (message,error) => { clearTimeout(toastTimer); const node=$('toast'); node.textContent=message; node.classList.toggle('error',!!error); node.hidden=false; toastTimer=setTimeout(()=>{node.hidden=true;},2600); };
  const showGate = (message,error) => {$('controller-shell').hidden=true;$('auth-gate').hidden=false;$('name-input').value=guestName;$('token-input').value=token||'';setStatus('token-status',message||'',!!error);setTimeout(()=>$(guestName?'token-input':'name-input').focus(),0);};
  const forgetToken = (message) => { token=null; try{localStorage.removeItem(tokenKey);localStorage.removeItem(legacyTokenKey);}catch{} showGate(message,true); };
  const validateToken = async () => { try { const response=await api('/status'); if(!response.ok) throw new Error(response.status===401?'That party token was not accepted.':'Could not connect.'); $('auth-gate').hidden=true; $('controller-shell').hidden=false;$('guest-name').textContent=guestName;try{localStorage.setItem(tokenKey,token);localStorage.setItem(nameKey,guestName);localStorage.removeItem(legacyTokenKey);}catch{} renderStatus(await response.json()); return true; } catch(error){ forgetToken(error && error.message ? error.message : 'Could not connect.'); return false; } };
  $('token-form').addEventListener('submit',async(event)=>{event.preventDefault();const enteredName=$('name-input').value.trim();const value=$('token-input').value.trim();if(!enteredName){setStatus('token-status','Enter your name.',true);return;}if(!value){setStatus('token-status','Enter a party token.',true);return;}guestName=enteredName;token=value;setStatus('token-status','Joining…');$('token-save').disabled=true;await validateToken();$('token-save').disabled=false;});
  $('change-token').addEventListener('click',()=>showGate('Update your name or party token.',false));

  const showPanel = (name) => { for(const panel of document.querySelectorAll('.panel')) panel.classList.toggle('active',panel.id===name+'-panel'); for(const button of document.querySelectorAll('.bottom-nav button')) button.classList.toggle('active',button.dataset.panel===name); if(name==='search') setTimeout(()=>$('karaoke-search').focus(),0); };
  $('bottom-nav').addEventListener('click',(event)=>{const button=event.target.closest('[data-panel]');if(button)showPanel(button.dataset.panel);});

  const recent = () => { try{return JSON.parse(localStorage.getItem(recentKey)||'[]');}catch{return [];} };
  $('search-form').addEventListener('submit',async(event)=>{event.preventDefault();const query=$('karaoke-search').value.trim();if(!query)return;clearTimeout(suggestTimer);suggestSequence++;$('search-suggestions').textContent='';setStatus('search-status','Searching…');try{const response=await api('/search',{method:'POST',body:JSON.stringify({query})});if(response.status===401)return forgetToken('Your party token expired.');if(!response.ok)throw new Error('Search failed');const page=await response.json();allResults=page.items||[];$('results').textContent='';visibleResults=0;renderMore();const history=recent().filter(value=>value.toLowerCase()!==query.toLowerCase());try{localStorage.setItem(recentKey,JSON.stringify([query,...history].slice(0,8)));}catch{}setStatus('search-status',allResults.length?allResults.length+' results':'No results found');}catch(error){allResults=[];$('results').textContent='';$('load-more').hidden=true;setStatus('search-status',error.message||'Search failed',true);}});
  const resultRow = (item) => { const row=document.createElement('div');row.className='result';row.dataset.videoId=item.id;const main=document.createElement('button');main.type='button';main.className='result-main';main.setAttribute('aria-label','More actions for '+(item.title||item.id));main.innerHTML=(item.thumbnail?'<img src="'+esc(item.thumbnail)+'" alt="" loading="lazy">':'<img alt="">')+'<span class="meta"><span class="title">'+esc(item.title||item.id)+'</span><span class="sub">'+esc(item.channel||'')+(item.duration?' · '+esc(item.duration):'')+'</span></span>';main.addEventListener('click',()=>openSongActions(item));const add=document.createElement('button');add.type='button';add.className='primary quick-add';add.textContent='＋';add.setAttribute('aria-label','Add '+(item.title||item.id)+' to queue');add.addEventListener('click',()=>queueSong(item,'/queue','Added',row));row.append(main,add);return row; };
  const renderMore = () => { const container=$('results'); const end=Math.min(allResults.length,visibleResults+10); for(const item of allResults.slice(visibleResults,end)) container.appendChild(resultRow(item)); visibleResults=end; $('result-count').textContent=visibleResults+' of '+allResults.length; $('load-more').hidden=visibleResults>=allResults.length; };
  $('load-more').addEventListener('click',renderMore);

  let suggestTimer;
  $('karaoke-search').addEventListener('input',()=>{clearTimeout(suggestTimer);const query=$('karaoke-search').value.trim();const sequence=++suggestSequence;if(!query){$('search-suggestions').textContent='';return;}suggestTimer=setTimeout(async()=>{try{const response=await api('/suggest?q='+encodeURIComponent(query));if(!response.ok)throw new Error();const remote=(await response.json()).suggestions||[];if(sequence!==suggestSequence||$('karaoke-search').value.trim()!==query)return;const seen=new Set();const values=[...recent().filter(value=>value.toLowerCase().startsWith(query.toLowerCase())),...remote].filter(value=>{const key=value.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);$('search-suggestions').innerHTML=values.map(value=>'<button type="button" class="suggestion" data-value="'+esc(value)+'">'+esc(value)+'</button>').join('');}catch{if(sequence===suggestSequence)$('search-suggestions').textContent='';}},250);});
  $('search-suggestions').addEventListener('click',(event)=>{const button=event.target.closest('.suggestion');if(!button)return;$('karaoke-search').value=button.dataset.value||'';$('search-suggestions').textContent='';$('search-form').requestSubmit();});
  document.addEventListener('click',(event)=>{if(!event.target.closest('.search-wrap'))$('search-suggestions').textContent='';});

  const itemPayload = (item) => ({itemId:(((globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')&&globalThis.crypto.randomUUID())||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)),videoId:item.id,title:item.title||item.id,requestedBy:guestName,...(item.channel?{channel:item.channel}:{}),...(item.duration?{duration:item.duration}:{}),...(item.thumbnail?{thumbnail:item.thumbnail}:{})});
  const openSongActions = (item) => {selectedSong=item;$('song-actions-title').textContent=item.title||item.id;$('song-actions').showModal();};
  const queueSong = async (item,path,label,sourceRow) => {const row=sourceRow||[...document.querySelectorAll('.result')].find(candidate=>candidate.dataset.videoId===item.id);const buttons=row?[...row.querySelectorAll('button')]:[];buttons.forEach(button=>button.disabled=true);try{const response=await api(path,{method:'POST',body:JSON.stringify(itemPayload(item))});if(response.status===401)return forgetToken('Your party token expired.');if(!response.ok)throw new Error('Request failed');const verb=label==='Added'?'Added “'+(item.title||item.id)+'” to queue':label+' “'+(item.title||item.id)+'”';showToast(verb);const add=row&&row.querySelector('.quick-add');if(add){add.textContent=label;add.classList.add('done');}lastStatus='';await refresh();}catch(error){showToast('Could not update queue',true);buttons.forEach(button=>button.disabled=false);}};
  $('action-add').addEventListener('click',()=>{$('song-actions').close();if(selectedSong)queueSong(selectedSong,'/queue','Added');});
  $('action-next').addEventListener('click',()=>{$('song-actions').close();if(selectedSong)queueSong(selectedSong,'/queue/next','Playing next:');});
  $('action-now').addEventListener('click',()=>{$('song-actions').close();if(!selectedSong)return;$('play-now-confirm-title').textContent='Interrupt and play “'+(selectedSong.title||selectedSong.id)+'” now?';$('play-now-confirm').showModal();});
  $('action-cancel').addEventListener('click',()=>$('song-actions').close());$('play-now-cancel').addEventListener('click',()=>$('play-now-confirm').close());
  $('play-now-confirm-button').addEventListener('click',()=>{$('play-now-confirm').close();if(selectedSong)queueSong(selectedSong,'/queue/play-now','Playing now:');});
  $('queue-play-cancel').addEventListener('click',()=>{$('queue-play-confirm').close();selectedQueueItem=null;});
  $('queue-play-confirm-button').addEventListener('click',()=>{const item=selectedQueueItem;selectedQueueItem=null;$('queue-play-confirm').close();if(item)control('/queue/play',{itemId:item.itemId},'Playing “'+(item.title||item.videoId)+'”','queue-status');});
  $('clear-queue').addEventListener('click',()=>{$('clear-queue-confirm-title').textContent='Clear all '+queueLength+' waiting '+(queueLength===1?'song':'songs')+'?';$('clear-queue-confirm').showModal();});
  $('clear-queue-cancel').addEventListener('click',()=>$('clear-queue-confirm').close());
  $('clear-queue-confirm-button').addEventListener('click',()=>{$('clear-queue-confirm').close();control('/queue/clear',null,'Queue cleared','queue-status');});

  const itemDetails = (item) => [item.channel,item.duration,item.requestedBy?'Requested by '+item.requestedBy:''].filter(Boolean).map(esc).join(' · ');
  const queueCard = (item,index,total) => '<div class="queued"><span class="position">'+(index+1)+'</span><span class="meta"><span class="title">'+esc(item.title||item.videoId)+'</span><span class="sub">'+itemDetails(item)+'</span></span><span class="queue-actions"><button class="primary queue-play" type="button" data-item-id="'+esc(item.itemId)+'" aria-label="Play '+esc(item.title||item.videoId)+' now">▶</button><button class="secondary queue-up" type="button" '+(index===0?'disabled':'')+' data-item-id="'+esc(item.itemId)+'" data-position="'+index+'" aria-label="Move '+esc(item.title||item.videoId)+' up">↑</button><button class="secondary queue-down" type="button" '+(index===total-1?'disabled':'')+' data-item-id="'+esc(item.itemId)+'" data-position="'+index+'" aria-label="Move '+esc(item.title||item.videoId)+' down">↓</button><button class="secondary queue-remove" type="button" data-item-id="'+esc(item.itemId)+'" aria-label="Remove '+esc(item.title||item.videoId)+'">✕</button></span></div>';
  const historyCard = (item) => '<div class="history-item"><span class="meta"><span class="title">'+esc(item.title||item.videoId)+'</span><span class="sub">'+itemDetails(item)+'</span></span><span class="sub">'+(item.reason==='ended'?'finished':item.reason)+'</span></div>';
  let lastStatus='';
  const renderStatus = (status) => {const current=status.current;$('now-playing').innerHTML=current?'<b>'+esc(current.title||current.videoId)+'</b><span>'+itemDetails(current)+'</span>':'<b>Nothing playing</b><span>Search for a song</span>';const queue=status.queue||[];const history=status.history||[];queuedItems=queue;queueLength=queue.length;$('queue-list').innerHTML=queue.length?queue.map((item,index)=>queueCard(item,index,queue.length)).join(''):'<div class="queue-empty">The queue is empty. Add a song from Search.</div>';$('clear-queue').hidden=!queue.length;$('history-list').innerHTML=history.length?history.map(historyCard).join(''):'<div class="queue-empty">Songs you finish or skip will appear here.</div>';$('history-count').textContent=history.length+(history.length===1?' song':' songs');$('queue-count').textContent=queue.length+(queue.length===1?' song':' songs');$('queue-badge').textContent=String(queue.length);$('queue-badge').hidden=!queue.length;};
  async function refresh(){if(!token)return;try{const response=await api('/status');if(response.status===401)return forgetToken('Your party token expired.');if(!response.ok)return;const status=await response.json();const next=JSON.stringify({c:status.current,q:status.queue,h:status.history});if(next===lastStatus)return;lastStatus=next;renderStatus(status);}catch{}}
  $('queue-list').addEventListener('click',async(event)=>{const button=event.target.closest('button');if(!button||button.disabled)return;const itemId=button.dataset.itemId;if(!itemId)return;if(button.classList.contains('queue-play')){selectedQueueItem=queuedItems.find(item=>item.itemId===itemId)||null;if(!selectedQueueItem)return;$('queue-play-confirm-title').textContent='Interrupt and play “'+(selectedQueueItem.title||selectedQueueItem.videoId)+'” now?';$('queue-play-confirm').showModal();return;}button.disabled=true;let path,body,message;if(button.classList.contains('queue-remove')){path='/queue/remove';body={itemId};message='Removed from queue';}else{path='/queue/move';const delta=button.classList.contains('queue-up')?-1:1;body={itemId,position:Number(button.dataset.position)+delta};message='Queue order updated';}await control(path,body,message,'queue-status');});
  const control = async(path,body,message='Command sent',statusId='control-status')=>{try{const response=await api(path,{method:'POST',body:body?JSON.stringify(body):undefined});if(response.status===401)return forgetToken('Your party token expired.');if(!response.ok)throw new Error();setStatus(statusId,message);showToast(message);lastStatus='';await refresh();}catch{setStatus(statusId,'Command failed',true);showToast('Command failed',true);}};
  $('control-toggle').addEventListener('click',()=>{playing=!playing;$('control-toggle').textContent=playing?'⏸':'▶';$('control-toggle').setAttribute('aria-label',playing?'Pause playback':'Resume playback');control(playing?'/control/resume':'/control/pause',null,playing?'Playback resumed':'Playback paused');});
  $('control-skip').addEventListener('click',()=>control('/control/skip',null,'Skipped to next song'));$('volume-down').addEventListener('click',()=>{volume=Math.max(0,Number((volume-.25).toFixed(2)));control('/control/volume',{volume},'Volume '+Math.round(volume*100)+'%');});$('volume-up').addEventListener('click',()=>{volume=Math.min(1,Number((volume+.25).toFixed(2)));control('/control/volume',{volume},'Volume '+Math.round(volume*100)+'%');});$('control-fullscreen').addEventListener('click',()=>control('/control/fullscreen',null,'Fullscreen requested'));
  if(token&&guestName)validateToken(); else showGate('',false);
  setInterval(refresh,2500);
})();
</script>
</body></html>`;
}
