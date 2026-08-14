// emonad.lol — community page
// Two viz: bubble map of every user (Galaxy) + global XP leaderboard.

import EmoProfile from './emo-profile.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  forceSimulation, forceManyBody, forceCenter,
  forceCollide, forceX, forceY,
} from 'https://esm.sh/d3-force@3';

// Read-only Supabase client for public-read tables. Standalone (not the same
// instance as emo-profile.js uses) so this page doesn't depend on a new
// export — survives any browser-cache state of emo-profile.js.
const SUPABASE_URL  = 'https://jdymhwsfmodqxvhcdsti.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkeW1od3NmbW9kcXh2aGNkc3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NzU5NTIsImV4cCI6MjA5MzE1MTk1Mn0.QsGxG8iyJaPzoPTxONLco7pMXTGgqBZTFeM48Lfcr2k';
function fetchWithTimeout(input, init = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort();
    else init.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetchWithTimeout(input, init, 8000) },
});

const XP_PER_LEVEL = 60;
const MAX_LEVEL    = 70;
const POLL_MS      = 60_000;

// ─── Utilities ────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function safeHttpsUrl(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}
function levelFromXp(xp) {
  if (xp <= 0) return 0;
  const cap = XP_PER_LEVEL * MAX_LEVEL;
  if (xp >= cap) return MAX_LEVEL;
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 100000) return (n / 1000).toFixed(0) + 'K';
  if (n >= 10000)  return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// High-res chain (galaxy bubbles): unavatar size=1000 first.
function avatarCandidates(profile) {
  const out = [];
  const handle = (profile?.x_handle || '').replace(/^@/, '').trim();
  if (handle) {
    out.push(`https://unavatar.io/twitter/${encodeURIComponent(handle)}?size=1000`);
    out.push(`https://unavatar.io/x/${encodeURIComponent(handle)}?size=1000`);
    out.push(`https://unavatar.io/twitter/${encodeURIComponent(handle)}`);
  }
  if (profile?.avatar_url) {
    const u = profile.avatar_url;
    if (u.includes('img.clerk.com')) {
      out.push(u + (u.includes('?') ? '&' : '?') + 'width=400');
    } else if (u.includes('pbs.twimg.com')) {
      out.push(u.replace(/_(normal|bigger|mini)\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i, '_400x400.$2$3'));
    } else {
      out.push(u);
    }
  }
  return out.map(safeHttpsUrl).filter(Boolean);
}

// Small-and-fast for the leaderboard rows (40px). Uses the Clerk-proxied URL
// already in our DB result FIRST — avoids hammering unavatar.io for every
// leaderboard row when the galaxy is also loading from it at the same time.
function leaderboardAvatarSrc(profile) {
  const u = profile?.avatar_url;
  if (u) {
    if (u.includes('img.clerk.com')) return u + (u.includes('?') ? '&' : '?') + 'width=160';
    if (u.includes('pbs.twimg.com')) return u.replace(/_(normal|bigger|mini)\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i, '_200x200.$2$3');
    return u;
  }
  const handle = (profile?.x_handle || '').replace(/^@/, '').trim();
  if (handle) return `https://unavatar.io/twitter/${encodeURIComponent(handle)}`;
  return '';
}

// ─── Auth identity ────────────────────────────────────────────────────
let meXUserId = null;
function pickXUserIdFromUser(user) {
  if (!user) return null;
  const xAcc = (user.externalAccounts || []).find(a =>
    /^(x|oauth_x|twitter|oauth_twitter)$/.test(a.provider)
  );
  return xAcc?.providerUserId || xAcc?.externalId || null;
}
function refreshMeId() {
  let id = null;
  try { id = pickXUserIdFromUser(EmoProfile.getUser?.()); } catch {}
  if (id !== meXUserId) {
    meXUserId = id;
    try { renderLeaderboard(); } catch {}
    try { if (galaxy.canvas) drawGalaxy(); } catch {}
  }
}

// ─── State ────────────────────────────────────────────────────────────
const state = {
  profiles: [],
  profileById: new Map(),
};

// ─── Data fetches ─────────────────────────────────────────────────────
function applyProfiles(rows) {
  state.profiles = rows || [];
  state.profileById.clear();
  for (const p of state.profiles) state.profileById.set(p.x_user_id, p);
  return state.profiles;
}

async function fetchProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('x_user_id, x_handle, display_name, avatar_url, total_xp, created_at')
    .order('total_xp', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return applyProfiles(data || []);
}

async function fetchSnapshotProfiles() {
  const res = await fetch('xp-snapshot.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('snapshot ' + res.status);
  const snap = await res.json();
  return applyProfiles(snap.profiles || []);
}

function outageMessage(err) {
  const raw = String(err?.message || err?.name || err || '');
  const status = err?.status || err?.code || '';
  const looksDown = /503|502|504|Failed to fetch|NetworkError|upstream connect|111|AbortError|aborted|timeout/i.test(raw + ' ' + status);
  if (looksDown) {
    return 'XP database is temporarily unreachable. Your ranks are not wiped — refresh in a minute.';
  }
  return raw || 'Could not load profiles.';
}

// ─── Leaderboard ──────────────────────────────────────────────────────
function renderLeaderboard() {
  const root = document.getElementById('leaderboard');
  const meta = document.getElementById('lbMeta');
  if (!state.profiles.length) {
    const empty = document.createElement('div');
    empty.className = 'error-state';
    empty.textContent = 'No profiles yet.';
    root.replaceChildren(empty);
    meta.textContent = '—';
    return;
  }
  const ranked = state.profiles.slice().sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0));
  const N = ranked.length;
  meta.textContent = `${N} user${N === 1 ? '' : 's'} · by XP`;

  const frag = document.createDocumentFragment();
  ranked.forEach((p, i) => {
    const rank = i + 1;
    const handle = (p.x_handle || '').replace(/^@/, '');
    const name = p.display_name || handle || '—';
    const xp = p.total_xp || 0;
    const lvl = levelFromXp(xp);
    const isMax = lvl === MAX_LEVEL;
    const isMe = meXUserId && p.x_user_id === meXUserId;
    const topCls = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';

    const row = document.createElement('a');
    row.className = ('lb-row ' + topCls + (isMe ? ' me' : '')).trim();
    row.href = handle ? ('profile.html?handle=' + encodeURIComponent(handle)) : '#';
    row.title = '@' + handle;

    const rankEl = document.createElement('span');
    rankEl.className = 'rank';
    rankEl.textContent = rank === 1 ? '★' : '#' + rank;

    const who = document.createElement('span');
    who.className = 'who';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;
    const handleEl = document.createElement('span');
    handleEl.className = 'handle';
    handleEl.textContent = '@' + (handle || '—');
    who.append(nameEl, handleEl);

    const xpEl = document.createElement('span');
    xpEl.className = 'xp';
    xpEl.append(document.createTextNode(fmtNum(xp)));
    const lvlEl = document.createElement('span');
    lvlEl.className = 'lvl' + (isMax ? ' max' : '');
    lvlEl.textContent = isMax ? 'MAX' : 'Lv ' + lvl;
    xpEl.append(lvlEl);

    row.append(rankEl, leaderboardAvatarEl(p, handle, name), who, xpEl);
    frag.appendChild(row);
  });
  root.replaceChildren(frag);
}

function letterAvatar(initial) {
  const el = document.createElement('div');
  el.className = 'avatar placeholder';
  el.textContent = initial;
  return el;
}

function leaderboardAvatarEl(p, handle, name) {
  const primary = safeHttpsUrl(leaderboardAvatarSrc(p));
  const fallback = handle
    ? safeHttpsUrl('https://unavatar.io/twitter/' + encodeURIComponent(handle))
    : '';
  const initial = (handle || name || '?').charAt(0).toUpperCase();
  if (!primary && !fallback) return letterAvatar(initial);

  const img = document.createElement('img');
  img.className = 'avatar';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  let triedFallback = !primary;
  img.src = primary || fallback;
  img.addEventListener('error', function () {
    if (!triedFallback && fallback) {
      triedFallback = true;
      img.src = fallback;
      return;
    }
    img.replaceWith(letterAvatar(initial));
  });
  return img;
}

// ─── Galaxy ───────────────────────────────────────────────────────────
const galaxy = {
  canvas: null, ctx: null, dpr: 1, width: 0, height: 0,
  nodes: [], sim: null,
  avatars: new Map(),  // x_user_id -> { img, loaded, failed, srcIdx, candidates }
  hoverIdx: -1,
  pulseUntil: 0, pulseTarget: null,
  raf: null, running: false,
  loadedCount: 0, totalCount: 0,
};

function setupGalaxy() {
  galaxy.canvas = document.getElementById('galaxyCanvas');
  galaxy.ctx = galaxy.canvas.getContext('2d');
  const ro = new ResizeObserver(() => { sizeGalaxy(); rebuildGalaxySim(); });
  ro.observe(galaxy.canvas);
  sizeGalaxy();

  const tooltip = document.getElementById('galaxyTooltip');
  galaxy.canvas.addEventListener('mousemove', (e) => {
    const rect = galaxy.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = hitTestGalaxy(mx, my);
    if (idx !== galaxy.hoverIdx) galaxy.hoverIdx = idx;
    if (idx >= 0) {
      const n = galaxy.nodes[idx];
      const handle = (n.profile.x_handle || '').replace(/^@/, '');
      const display = n.profile.display_name || handle || '—';
      const lvl = levelFromXp(n.profile.total_xp || 0);
      const lvlText = lvl === MAX_LEVEL ? 'MAX' : 'Lv ' + lvl;
      const lvlClass = lvl === MAX_LEVEL ? 'lvl max' : 'lvl';
      tooltip.innerHTML = `<b>@${escapeHtml(handle || display)}</b><br><span class="${lvlClass}">${lvlText}</span> · ${n.profile.total_xp || 0} XP`;
      tooltip.style.left = (n.x) + 'px';
      tooltip.style.top  = (n.y - n.r - 4) + 'px';
      tooltip.style.opacity = '1';
      galaxy.canvas.style.cursor = 'pointer';
    } else {
      tooltip.style.opacity = '0';
      galaxy.canvas.style.cursor = '';
    }
    drawGalaxy();
  });
  galaxy.canvas.addEventListener('mouseleave', () => {
    galaxy.hoverIdx = -1;
    tooltip.style.opacity = '0';
    galaxy.canvas.style.cursor = '';
    drawGalaxy();
  });
  galaxy.canvas.addEventListener('click', () => {
    if (galaxy.hoverIdx < 0) return;
    const n = galaxy.nodes[galaxy.hoverIdx];
    const handle = (n.profile.x_handle || '').replace(/^@/, '');
    if (handle) window.location.href = `profile.html?handle=${encodeURIComponent(handle)}`;
  });

  document.getElementById('findMeBtn').addEventListener('click', findMe);
}

function sizeGalaxy() {
  const c = galaxy.canvas;
  const rect = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  galaxy.dpr = dpr;
  galaxy.width  = Math.max(1, Math.floor(rect.width));
  galaxy.height = Math.max(1, Math.floor(rect.height));
  c.width  = galaxy.width  * dpr;
  c.height = galaxy.height * dpr;
  galaxy.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function buildGalaxyNodes() {
  const W = galaxy.width || 800;
  const H = galaxy.height || 620;
  const PAD = 6;
  const usableArea = (W - 2*PAD) * (H - 2*PAD);

  // Size bubbles such that the TOTAL area they cover is at most ~55% of the
  // panel area. That keeps everything visible no matter how many users we have.
  const n = state.profiles.length || 1;
  const meanRTarget = Math.sqrt((usableArea * 0.55) / (Math.PI * n));
  // Allow the biggest user up to ~2.4× the mean radius, smallest at ~0.55×.
  const minR = Math.max(10, meanRTarget * 0.55);
  const maxR = Math.max(minR + 6, Math.min(meanRTarget * 2.4, Math.min(W, H) / 8));

  const maxXp = Math.max(1, ...state.profiles.map(p => p.total_xp || 0));

  galaxy.nodes = state.profiles.map((p) => {
    const xp = p.total_xp || 0;
    const ratio = maxXp > 0 ? Math.sqrt(xp) / Math.sqrt(maxXp) : 0;
    const r = minR + ratio * (maxR - minR);
    return {
      id: p.x_user_id,
      profile: p,
      r,
      x: W / 2 + (Math.random() - 0.5) * (W - 2*r - 2*PAD),
      y: H / 2 + (Math.random() - 0.5) * (H - 2*r - 2*PAD),
    };
  });
  // Biggest first (priority for hit test / draw order)
  galaxy.nodes.sort((a, b) => b.r - a.r);

  const meta = document.getElementById('galaxyMeta');
  if (meta) meta.textContent = `${state.profiles.length} user${state.profiles.length === 1 ? '' : 's'}`;
}

// Boundary force: clamp every node inside the canvas each tick.
function forceClampToBox() {
  return function(/* alpha */) {
    const W = galaxy.width, H = galaxy.height;
    const PAD = 4;
    for (const n of galaxy.nodes) {
      const min = n.r + PAD;
      if (n.x < min)         { n.x = min;          n.vx = Math.abs(n.vx || 0) * 0.4; }
      if (n.x > W - min)     { n.x = W - min;      n.vx = -Math.abs(n.vx || 0) * 0.4; }
      if (n.y < min)         { n.y = min;          n.vy = Math.abs(n.vy || 0) * 0.4; }
      if (n.y > H - min)     { n.y = H - min;      n.vy = -Math.abs(n.vy || 0) * 0.4; }
    }
  };
}

function rebuildGalaxySim() {
  if (!galaxy.canvas) return;
  buildGalaxyNodes();
  if (galaxy.sim) galaxy.sim.stop();
  const W = galaxy.width, H = galaxy.height;
  galaxy.sim = forceSimulation(galaxy.nodes)
    .force('center', forceCenter(W / 2, H / 2).strength(0.05))
    .force('charge', forceManyBody().strength(-30))
    .force('collide', forceCollide(d => d.r + 2).strength(1).iterations(4))
    .force('x', forceX(W / 2).strength(0.03))
    .force('y', forceY(H / 2).strength(0.03))
    .force('box', forceClampToBox())
    .alphaDecay(0.04)
    .on('tick', drawGalaxy);

  // Kick off avatar loading immediately
  startAvatarLoad();

  if (!galaxy.running) {
    galaxy.running = true;
    requestAnimationFrame(galaxyAnimLoop);
  }
}

// Avatar loader with retry chain. For each user, walk through candidate URLs
// (high-res first → degraded fallbacks) until one succeeds. Update progress
// indicator until every bubble has a real picture.
function startAvatarLoad() {
  galaxy.totalCount = galaxy.nodes.length;
  galaxy.loadedCount = 0;
  galaxy.avatars.clear();

  for (const n of galaxy.nodes) {
    galaxy.avatars.set(n.id, {
      img: null,
      loaded: false,
      failed: false,
      candidates: avatarCandidates(n.profile),
      srcIdx: 0,
    });
  }
  updateGalaxyProgress();

  // Concurrency-limited pump
  const CONCURRENCY = 6;
  const queue = galaxy.nodes.slice(); // already sorted big→small (priority order)
  let active = 0;

  function next() {
    while (active < CONCURRENCY && queue.length) {
      const n = queue.shift();
      const rec = galaxy.avatars.get(n.id);
      if (!rec || rec.loaded || rec.failed || rec.candidates.length === 0) continue;
      active++;
      tryLoad(n, rec, () => {
        active--;
        next();
      });
    }
  }

  function tryLoad(node, rec, done) {
    if (rec.srcIdx >= rec.candidates.length) {
      rec.failed = true;
      finished();
      done();
      return;
    }
    const src = rec.candidates[rec.srcIdx++];
    const img = new Image();
    // No crossOrigin — unavatar doesn't send CORS headers. We only draw
    // (never read pixels back), so a tainted canvas is fine here.
    img.referrerPolicy = 'no-referrer';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      tryLoad(node, rec, done);
    }, 8000);
    img.onload = () => {
      if (settled) return; settled = true; clearTimeout(timeout);
      rec.img = img;
      rec.loaded = true;
      finished();
      drawGalaxy();
      done();
    };
    img.onerror = () => {
      if (settled) return; settled = true; clearTimeout(timeout);
      tryLoad(node, rec, done);
    };
    img.src = src;
  }

  function finished() {
    galaxy.loadedCount++;
    updateGalaxyProgress();
  }

  next();
}

function updateGalaxyProgress() {
  const el = document.getElementById('galaxyProgress');
  if (!el) return;
  const total = galaxy.totalCount;
  if (total === 0) { el.textContent = ''; return; }
  const done = galaxy.loadedCount;
  if (done >= total) {
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = ''; }, 600);
  } else {
    el.style.opacity = '1';
    el.textContent = `LOADING PROFILES · ${done}/${total}`;
  }
}

function galaxyAnimLoop() {
  if (!galaxy.running) return;
  if (galaxy.pulseUntil > performance.now()) drawGalaxy();
  galaxy.raf = requestAnimationFrame(galaxyAnimLoop);
}

function hitTestGalaxy(mx, my) {
  // Visit smallest-first hit list isn't intuitive; do biggest-first so larger
  // bubbles can be selected when overlapping. Since nodes[] is sorted big→small,
  // iterate forward.
  for (let i = 0; i < galaxy.nodes.length; i++) {
    const n = galaxy.nodes[i];
    const dx = mx - n.x, dy = my - n.y;
    if (dx * dx + dy * dy <= (n.r + 2) ** 2) return i;
  }
  return -1;
}

function drawGalaxy() {
  if (!galaxy.ctx) return;
  const { ctx, width: W, height: H } = galaxy;
  ctx.clearRect(0, 0, W, H);

  // Soft central nebula
  ctx.save();
  const neb = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.min(W, H) * 0.55);
  neb.addColorStop(0, 'rgba(155, 95, 255, 0.10)');
  neb.addColorStop(0.6, 'rgba(155, 95, 255, 0.03)');
  neb.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = neb;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const hoverIdx = galaxy.hoverIdx;
  const pulseNow = performance.now();
  const pulseActive = pulseNow < galaxy.pulseUntil;
  const pulseK = pulseActive ? (1 - (galaxy.pulseUntil - pulseNow) / 1600) : 0;

  // Pass: bubbles smallest-first so big ones overlap correctly
  const draw = galaxy.nodes.slice().sort((a, b) => a.r - b.r);
  for (const n of draw) {
    const isHover = (n === galaxy.nodes[hoverIdx]);
    const isMe = meXUserId && n.id === meXUserId;
    const isPulseTarget = pulseActive && galaxy.pulseTarget === n.id;
    const ringColor = isHover ? '#fff' : isMe ? '#ec4899' : 'rgba(155, 95, 255, 0.85)';

    // Pulse ring for FIND-ME
    if (isPulseTarget) {
      const ringR = n.r + 4 + pulseK * 70;
      ctx.save();
      ctx.strokeStyle = `rgba(236, 72, 153, ${(1 - pulseK).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Outer glow
    ctx.save();
    ctx.shadowColor = isMe ? 'rgba(236, 72, 153, 0.8)' : 'rgba(155, 95, 255, 0.7)';
    ctx.shadowBlur = isHover ? 30 : isMe ? 26 : 16;
    ctx.fillStyle = isMe ? '#ec4899' : '#9B5FFF';
    ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Avatar disc
    const rec = galaxy.avatars.get(n.id);
    ctx.save();
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r - 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (rec && rec.loaded && rec.img) {
      // Cover-fit the (square) image inside the circle
      const r = n.r - 2;
      ctx.drawImage(rec.img, n.x - r, n.y - r, r * 2, r * 2);
    } else {
      // Loading state: solid dark fill + initial letter (still pretty)
      ctx.fillStyle = '#16102a';
      ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
      ctx.fillStyle = 'rgba(184, 163, 232, 0.85)';
      ctx.font = `900 ${Math.max(10, n.r * 0.85)}px "Space Grotesk", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const handle = (n.profile.x_handle || '?').replace(/^@/, '');
      ctx.fillText((handle || '?').charAt(0).toUpperCase(), n.x, n.y);
    }
    ctx.restore();

    // Sharp accent ring
    ctx.save();
    ctx.lineWidth = isHover ? 3 : isMe ? 2.5 : 1.6;
    ctx.strokeStyle = ringColor;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function findMe() {
  if (!meXUserId) { flashFindMsg('Sign in to find yourself'); return; }
  const me = galaxy.nodes.find(n => n.id === meXUserId);
  if (!me) { flashFindMsg('No profile yet — earn some XP first'); return; }
  galaxy.pulseTarget = me.id;
  galaxy.pulseUntil  = performance.now() + 1600;
  if (galaxy.sim) galaxy.sim.alpha(0.35).restart();
  document.getElementById('galaxyWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function flashFindMsg(msg) {
  const btn = document.getElementById('findMeBtn');
  const orig = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = orig; }, 1600);
}

// ─── Live pill ────────────────────────────────────────────────────────
function setLivePill(text, ok = true) {
  const el = document.getElementById('livePillText');
  if (el) el.textContent = text;
  const dot = document.querySelector('#livePill .dot');
  if (dot) dot.style.background = ok ? 'var(--accent)' : '#9b9b9b';
}

// ─── Polling ──────────────────────────────────────────────────────────
async function poll() {
  try {
    await fetchProfiles();
    renderLeaderboard();
    // Don't rebuild galaxy on poll — would jolt the layout. New users only
    // appear on a fresh reload (rare enough not to matter).
  } catch (err) {
    console.warn('poll failed', err);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────
async function boot() {
  setupGalaxy();

  // Auth must not gate the public leaderboard. If Clerk hangs, ranks
  // should still appear (or fail with a real outage message).
  const authReady = (async () => {
    try {
      await EmoProfile.init({ page: 'chart' });
      EmoProfile.mount('#emoAuthSlot');
      refreshMeId();
      EmoProfile.onChange?.(refreshMeId);
    } catch (err) {
      console.warn('EmoProfile init failed — continuing without auth:', err?.message || err);
    }
  })();

  try {
    await Promise.race([
      fetchProfiles(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]);
    console.log(`[chart] loaded ${state.profiles.length} profiles`);

    renderLeaderboard();
    rebuildGalaxySim();

    setLivePill('Live');
    setInterval(poll, POLL_MS);
  } catch (err) {
    console.warn('live fetch failed, using snapshot', err);
    try {
      await fetchSnapshotProfiles();
      renderLeaderboard();
      rebuildGalaxySim();
      setLivePill('Cached', false);
      const meta = document.getElementById('lbMeta');
      if (meta) meta.textContent = (meta.textContent || '') + ' · last known ranks';
    } catch (snapErr) {
      console.error('boot failed', err, snapErr);
      setLivePill('Offline', false);
      const lb = document.getElementById('leaderboard');
      if (lb) {
        lb.innerHTML = `<div class="error-state"><b>Leaderboard unavailable.</b>${escapeHtml(outageMessage(err))}</div>`;
      }
    }
  }

  await authReady;
}

boot();
