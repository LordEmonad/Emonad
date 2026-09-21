// emonad.lol — leaderboard page
// Podium + ranked list (XP / Emo Crush / Flap / Tarot), your-rank card with
// progress + rank change since your last visit, handle search, and the
// bubble map of every user (Galaxy).

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
const PAGE_SIZE    = 100;
const SEEN_KEY     = 'emo:lbSeen';
const SEEN_WINDOW  = 6 * 60 * 60 * 1000; // a "visit" is anything within 6h

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
function levelInfo(totalXp) {
  const xp = Math.max(0, totalXp || 0);
  const xpCap = MAX_LEVEL * XP_PER_LEVEL;
  const maxed = xp >= xpCap;
  const level = maxed ? MAX_LEVEL : Math.floor(xp / XP_PER_LEVEL) + 1;
  const intoLevel = maxed ? XP_PER_LEVEL : (xp % XP_PER_LEVEL);
  const xpToNext = maxed ? 0 : (XP_PER_LEVEL - intoLevel);
  const progress = maxed ? 1 : (intoLevel / XP_PER_LEVEL);
  return { xp, level, maxed, intoLevel, xpToNext, progress };
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 100000) return (n / 1000).toFixed(0) + 'K';
  if (n >= 10000)  return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
function fmtFull(n) { return (Number(n) || 0).toLocaleString('en-US'); }
function handleOf(p) { return (p?.x_handle || '').replace(/^@/, '').trim(); }
function nameOf(p) { return p?.display_name || handleOf(p) || '—'; }

// High-res chain (galaxy bubbles): unavatar size=1000 first.
function avatarCandidates(profile) {
  const out = [];
  const handle = handleOf(profile);
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

// Small-and-fast for rows / podium / me-card. Uses the Clerk-proxied URL
// already in our DB result FIRST — avoids hammering unavatar.io for every
// row when the galaxy is also loading from it at the same time.
function leaderboardAvatarSrc(profile, size = 160) {
  const u = profile?.avatar_url;
  if (u) {
    if (u.includes('img.clerk.com')) return u + (u.includes('?') ? '&' : '?') + 'width=' + size;
    if (u.includes('pbs.twimg.com')) return u.replace(/_(normal|bigger|mini)\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i, '_200x200.$2$3');
    return u;
  }
  const handle = handleOf(profile);
  if (handle) return `https://unavatar.io/twitter/${encodeURIComponent(handle)}`;
  return '';
}

// <img> with fallback chain → letter placeholder. `cls` is the element class.
function avatarEl(p, cls, size = 160) {
  const handle = handleOf(p);
  const primary = safeHttpsUrl(leaderboardAvatarSrc(p, size));
  const fallback = handle ? safeHttpsUrl('https://unavatar.io/twitter/' + encodeURIComponent(handle)) : '';
  const initial = (handle || nameOf(p) || '?').charAt(0).toUpperCase();
  const placeholder = () => {
    const el = document.createElement('span');
    el.className = cls + ' placeholder';
    el.textContent = initial;
    return el;
  };
  if (!primary && !fallback) return placeholder();
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.loading = 'lazy';
  let triedFallback = !primary;
  img.src = primary || fallback;
  img.addEventListener('error', function () {
    if (!triedFallback && fallback) { triedFallback = true; img.src = fallback; return; }
    img.replaceWith(placeholder());
  });
  return img;
}
function setAvatarInto(host, p, size) {
  const el = avatarEl(p, host.className.split(' ')[0], size);
  host.replaceWith(el);
  return el;
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
  const loggedIn = !!EmoProfile.isLoggedIn?.();
  if (id !== meXUserId || loggedIn !== state.loggedIn) {
    meXUserId = id;
    state.loggedIn = loggedIn;
    try { renderBoard(); } catch {}
    try { renderMe(); } catch {}
    try { if (galaxy.canvas) drawGalaxy(); } catch {}
  }
}

// ─── State ────────────────────────────────────────────────────────────
const state = {
  profiles: [],
  profileById: new Map(),
  loggedIn: false,
  authKnown: false,       // Clerk has answered (so we know whether to show the sign-in nudge)
  tab: 'xp',
  query: '',
  showAll: false,
  boards: {},             // tab -> [{ p, value, sub }] (game tabs cached after first fetch)
  boardErr: {},           // tab -> error message
  prevRanks: null,        // Map x_user_id -> { rank, xp } from your last visit (XP board)
  ranked: [],             // XP ranking (profiles sorted by total_xp)
};

// ─── Data fetches ─────────────────────────────────────────────────────
function applyProfiles(rows) {
  state.profiles = rows || [];
  state.profileById.clear();
  for (const p of state.profiles) state.profileById.set(p.x_user_id, p);
  state.ranked = state.profiles.slice().sort((a, b) => (b.total_xp || 0) - (a.total_xp || 0));
  state.boards.xp = state.ranked.map(p => ({ p, value: p.total_xp || 0 }));
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

// Per-game boards come from the public game-record tables, joined to the
// profiles we already have. Fetched once, on first tab open.
const BOARDS = {
  xp: {
    title: 'Top emos', unit: 'XP', foot: 'Ranks refresh every minute',
    stat: r => fmtNum(r.value),
    sub: r => { const lv = levelFromXp(r.value); return lv === MAX_LEVEL ? { text: 'MAX', max: true } : { text: 'Lv ' + lv }; },
  },
  emocrush: {
    title: 'Emo Crush', unit: 'best score', foot: 'Best single-game score',
    table: 'emocrush_records', select: 'x_user_id, best_score, best_level, games_played', order: 'best_score',
    map: r => ({ value: Number(r.best_score) || 0, extra: 'Lv ' + (Number(r.best_level) || 0) }),
    stat: r => fmtNum(r.value),
    sub: r => ({ text: r.extra }),
  },
  flap: {
    title: 'Flap Emonad', unit: 'high score', foot: 'Pipes cleared in one run',
    table: 'flapemonad_records', select: 'x_user_id, high_score, games_played', order: 'high_score',
    map: r => ({ value: Number(r.high_score) || 0, extra: (Number(r.games_played) || 0) + ' runs' }),
    stat: r => fmtNum(r.value),
    sub: r => ({ text: r.extra }),
  },
  tarot: {
    title: 'Emo Tarot', unit: 'readings', foot: 'Readings pulled all-time',
    table: 'tarot_records', select: 'x_user_id, readings_count, last_spread', order: 'readings_count',
    map: r => ({ value: Number(r.readings_count) || 0, extra: r.last_spread ? String(r.last_spread).replace(/[-_]/g, ' ') : '' }),
    stat: r => fmtNum(r.value),
    sub: r => ({ text: r.extra || 'reader' }),
  },
};

async function fetchBoard(tab) {
  const cfg = BOARDS[tab];
  if (!cfg.table || state.boards[tab]) return state.boards[tab];
  const { data, error } = await supabase
    .from(cfg.table)
    .select(cfg.select)
    .order(cfg.order, { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = [];
  for (const r of data || []) {
    const p = state.profileById.get(r.x_user_id);
    if (!p) continue;
    const m = cfg.map(r);
    if (m.value <= 0) continue;
    rows.push({ p, ...m });
  }
  rows.sort((a, b) => b.value - a.value);
  state.boards[tab] = rows;
  return rows;
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

// ─── "Since your last visit" ──────────────────────────────────────────
// We remember every user's XP rank in localStorage. On a later visit (>6h)
// the list shows ▲/▼ rank changes and +XP gained. Per-browser, honest, and
// needs no extra tables.
function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch { return null; }
}
function rememberRanks() {
  if (!state.ranked.length) return;
  const now = Date.now();
  const current = {};
  state.ranked.forEach((p, i) => { current[p.x_user_id] = [i + 1, p.total_xp || 0]; });
  const stored = loadSeen();
  let base = current, baseAt = now, prev = null;
  if (stored && stored.base && stored.baseAt) {
    if (now - stored.baseAt > SEEN_WINDOW) {
      prev = stored.base;                 // new visit → compare against the last one
    } else {
      base = stored.base; baseAt = stored.baseAt; prev = stored.prev || null;  // same visit → keep deltas stable
    }
  }
  state.prevRanks = prev ? new Map(Object.entries(prev).map(([id, [rank, xp]]) => [id, { rank, xp }])) : null;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ base, baseAt, prev })); } catch {}
}
function deltaFor(id, rank, xp) {
  if (!state.prevRanks) return null;
  const was = state.prevRanks.get(id);
  if (!was) return { kind: 'new' };
  return { kind: was.rank === rank ? 'flat' : (rank < was.rank ? 'up' : 'down'), by: Math.abs(was.rank - rank), gain: Math.max(0, xp - was.xp) };
}
function deltaEl(d) {
  if (!d || d.kind === 'flat') return null;   // only movers get a marker; flat rows stay clean
  const el = document.createElement('span');
  el.className = 'delta ' + d.kind;
  el.textContent = d.kind === 'new' ? 'NEW' : d.kind === 'flat' ? '–' : (d.kind === 'up' ? '▲' : '▼') + d.by;
  el.title = d.kind === 'new' ? 'Joined since your last visit' : d.kind === 'flat' ? 'Same rank as your last visit' : (d.kind === 'up' ? 'Up ' : 'Down ') + d.by + ' since your last visit';
  return el;
}

// ─── Stats strip ──────────────────────────────────────────────────────
function renderStats() {
  const ps = state.profiles;
  const total = ps.reduce((s, p) => s + (p.total_xp || 0), 0);
  const maxed = ps.filter(p => (p.total_xp || 0) >= XP_PER_LEVEL * MAX_LEVEL).length;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const fresh = ps.filter(p => p.created_at && new Date(p.created_at).getTime() > weekAgo).length;
  document.getElementById('statUsers').textContent = fmtFull(ps.length);
  document.getElementById('statXp').textContent = fmtNum(total);
  document.getElementById('statMax').textContent = fmtFull(maxed);
  document.getElementById('statNew').textContent = fmtFull(fresh);
}

// ─── Your rank card ───────────────────────────────────────────────────
function renderMe() {
  const card = document.getElementById('meCard');
  const cta = document.getElementById('meCta');
  if (!state.authKnown || !state.ranked.length) { card.hidden = true; cta.hidden = true; return; }
  if (!meXUserId) { card.hidden = true; cta.hidden = false; return; }
  const idx = state.ranked.findIndex(p => p.x_user_id === meXUserId);
  if (idx < 0) {
    // Signed in but no profile row yet (first sync still running) — show the nudge copy without the button.
    card.hidden = true; cta.hidden = false;
    cta.querySelector('.me-body').innerHTML = '<b>No XP yet</b>Earn some on the homepage or in a game and you\'ll show up here.';
    cta.querySelector('.me-actions').hidden = true;
    return;
  }
  cta.hidden = true; card.hidden = false;
  const me = state.ranked[idx];
  const rank = idx + 1;
  const li = levelInfo(me.total_xp || 0);
  const handle = handleOf(me);

  const avHost = document.getElementById('meAvatar') || card.querySelector('.me-avatar');
  const av = setAvatarInto(avHost, me, 200);
  av.id = 'meAvatar';

  document.getElementById('meRank').textContent = '#' + rank;
  document.getElementById('meName').textContent = nameOf(me);
  document.getElementById('meHandle').textContent = handle ? '@' + handle : '';

  const d = deltaFor(me.x_user_id, rank, me.total_xp || 0);
  const dEl = document.getElementById('meDelta');
  if (d && d.kind !== 'new') {
    dEl.className = 'me-delta ' + d.kind;
    dEl.textContent = (d.kind === 'up' ? '▲' + d.by : d.kind === 'down' ? '▼' + d.by : 'no change') + (d.gain ? ' · +' + d.gain + ' XP' : '') + ' since your last visit';
  } else {
    dEl.className = 'me-delta flat'; dEl.textContent = '';
  }

  requestAnimationFrame(() => { document.getElementById('meBar').style.width = Math.round(li.progress * 100) + '%'; });

  const sub = document.getElementById('meSub');
  const parts = [];
  parts.push(`<span class="lvl${li.maxed ? ' max' : ''}">${li.maxed ? 'MAX LEVEL' : 'Lv ' + li.level}</span>`);
  parts.push(`<span><b>${fmtFull(li.xp)}</b> XP</span>`);
  if (!li.maxed) parts.push(`<span><b>${li.xpToNext}</b> XP to Lv ${li.level + 1}</span>`);
  if (idx > 0) {
    const ahead = state.ranked[idx - 1];
    const gap = (ahead.total_xp || 0) - (me.total_xp || 0) + 1;
    parts.push(`<span><b>${fmtFull(gap)}</b> XP to pass @${escapeHtml(handleOf(ahead) || nameOf(ahead))}</span>`);
  } else {
    parts.push('<span><b>#1</b> · nobody above you</span>');
  }
  parts.push(`<span>top <b>${Math.max(1, Math.ceil(rank / state.ranked.length * 100))}%</b></span>`);
  sub.innerHTML = parts.join('');

  const profileUrl = 'https://emonad.lol/profile.html?handle=' + encodeURIComponent(handle);
  document.getElementById('meProfile').href = handle ? 'profile.html?handle=' + encodeURIComponent(handle) : '#';
  const text = `I'm #${rank} of ${state.ranked.length} on the @EmonadCoin leaderboard · ${li.maxed ? 'MAX LEVEL' : 'Lv ' + li.level} · ${fmtFull(li.xp)} XP\n\n${profileUrl}`;
  document.getElementById('meShare').href = 'https://x.com/intent/post?text=' + encodeURIComponent(text);
}

// ─── Podium + list ────────────────────────────────────────────────────
function currentRows() {
  const rows = state.boards[state.tab] || [];
  const q = state.query.trim().toLowerCase().replace(/^@/, '');
  if (!q) return rows;
  return rows.filter(r => handleOf(r.p).toLowerCase().includes(q) || nameOf(r.p).toLowerCase().includes(q));
}

function podiumEl(r, place, cfg) {
  const p = r.p;
  const handle = handleOf(p);
  const a = document.createElement('a');
  a.className = 'pod p' + place + (meXUserId && p.x_user_id === meXUserId ? ' me' : '');
  a.href = handle ? 'profile.html?handle=' + encodeURIComponent(handle) : '#';
  a.title = '@' + handle;
  const placeEl = document.createElement('span'); placeEl.className = 'place'; placeEl.textContent = '#' + place;
  a.appendChild(placeEl);
  if (place === 1) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = '👑'; a.appendChild(c); }
  a.appendChild(avatarEl(p, 'pav', 200));
  const n = document.createElement('span'); n.className = 'pname'; n.textContent = nameOf(p);
  const h = document.createElement('span'); h.className = 'phandle'; h.textContent = handle ? '@' + handle : '';
  const s = document.createElement('span'); s.className = 'pstat'; s.textContent = cfg.stat(r);
  const small = document.createElement('small');
  const sub = cfg.sub(r);
  small.textContent = state.tab === 'xp' ? (sub.max ? 'MAX LEVEL' : sub.text + ' · XP') : cfg.unit;
  s.appendChild(small);
  a.append(n, h, s);
  return a;
}

function renderBoard() {
  const cfg = BOARDS[state.tab];
  const root = document.getElementById('leaderboard');
  const meta = document.getElementById('lbMeta');
  const podium = document.getElementById('podium');
  const more = document.getElementById('showMore');
  document.getElementById('lbTitle').textContent = cfg.title;
  document.getElementById('lbFootLeft').textContent = cfg.foot;

  if (state.boardErr[state.tab]) {
    root.innerHTML = `<div class="error-state"><b>Couldn't load this board.</b>${escapeHtml(state.boardErr[state.tab])}</div>`;
    podium.hidden = true; more.hidden = true; meta.textContent = '—';
    return;
  }
  const all = state.boards[state.tab];
  if (!all) return; // still loading — skeleton stays
  const rows = currentRows();
  const searching = !!state.query.trim();

  // Podium (top 3 of the unfiltered board; hidden while searching)
  podium.hidden = searching || all.length < 3;
  if (!podium.hidden) {
    podium.replaceChildren(podiumEl(all[1], 2, cfg), podiumEl(all[0], 1, cfg), podiumEl(all[2], 3, cfg));
  }

  meta.innerHTML = searching
    ? `<b>${rows.length}</b> match${rows.length === 1 ? '' : 'es'}`
    : `<b>${fmtFull(all.length)}</b> ${state.tab === 'xp' ? 'emos · by XP' : 'players · by ' + cfg.unit}`;

  if (!rows.length) {
    root.innerHTML = `<div class="empty-state"><b>${searching ? 'No one by that name.' : 'Nobody here yet.'}</b>${searching ? 'Try a different handle.' : 'Play a round and be the first.'}</div>`;
    more.hidden = true;
    document.getElementById('lbFootRight').textContent = '';
    return;
  }

  const limit = (state.showAll || searching) ? rows.length : Math.min(PAGE_SIZE, rows.length);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < limit; i++) {
    const r = rows[i];
    const p = r.p;
    // Rank is the position on the full board, not the filtered one.
    const rank = searching ? all.indexOf(r) + 1 : i + 1;
    const handle = handleOf(p);
    const isMe = meXUserId && p.x_user_id === meXUserId;
    const topCls = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';

    const row = document.createElement('a');
    row.className = ('lb-row ' + topCls + (isMe ? ' me' : '')).trim();
    row.href = handle ? ('profile.html?handle=' + encodeURIComponent(handle)) : '#';
    row.title = '@' + handle;
    if (i < 30) row.style.animationDelay = (i * 18) + 'ms'; else row.style.animation = 'none';

    const rankEl = document.createElement('span');
    rankEl.className = 'rank';
    rankEl.textContent = rank === 1 ? '★' : '#' + rank;
    if (state.tab === 'xp') { const d = deltaEl(deltaFor(p.x_user_id, rank, r.value)); if (d) rankEl.appendChild(d); }

    const who = document.createElement('span');
    who.className = 'who';
    const nameEl = document.createElement('span'); nameEl.className = 'name'; nameEl.textContent = nameOf(p);
    const handleEl = document.createElement('span'); handleEl.className = 'handle'; handleEl.textContent = '@' + (handle || '—');
    who.append(nameEl, handleEl);
    if (state.tab === 'xp') {
      const li = levelInfo(r.value);
      const bar = document.createElement('span'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = Math.round(li.progress * 100) + '%';
      bar.appendChild(fill);
      bar.title = li.maxed ? 'Max level' : `${li.xpToNext} XP to Lv ${li.level + 1}`;
      who.appendChild(bar);
    }

    const xpEl = document.createElement('span');
    xpEl.className = 'xp';
    xpEl.append(document.createTextNode(cfg.stat(r)));
    const sub = cfg.sub(r);
    const lvlEl = document.createElement('span');
    lvlEl.className = 'lvl' + (sub.max ? ' max' : '');
    lvlEl.textContent = sub.text;
    xpEl.append(lvlEl);
    if (state.tab === 'xp') {
      const d = deltaFor(p.x_user_id, rank, r.value);
      if (d && d.gain) { const g = document.createElement('span'); g.className = 'gain'; g.textContent = '+' + d.gain + ' XP'; xpEl.append(g); }
    }

    row.append(rankEl, avatarEl(p, 'avatar'), who, xpEl);
    frag.appendChild(row);
  }
  root.replaceChildren(frag);

  more.hidden = limit >= rows.length;
  more.textContent = `Show everyone (${fmtFull(rows.length)})`;
  document.getElementById('lbFootRight').textContent = state.prevRanks && state.tab === 'xp' ? '▲▼ = change since your last visit' : (limit < rows.length ? `Showing top ${limit}` : '');
}

function showBoardSkeleton() {
  const root = document.getElementById('leaderboard');
  const row = '<div class="lb-skel-row"><span class="sk-rank"></span><span class="sk-av"></span><span class="sk-who"><span></span><span></span></span><span class="sk-xp"></span></div>';
  root.innerHTML = '<div class="lb-skel" aria-busy="true">' + row.repeat(6) + '</div>';
  document.getElementById('podium').hidden = true;
  document.getElementById('showMore').hidden = true;
}

async function selectTab(tab) {
  if (!BOARDS[tab]) return;
  state.tab = tab;
  state.showAll = false;
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (!state.boards[tab] && !state.boardErr[tab]) {
    showBoardSkeleton();
    document.getElementById('lbTitle').textContent = BOARDS[tab].title;
    try { await fetchBoard(tab); }
    catch (err) { console.warn('board fetch failed', tab, err); state.boardErr[tab] = outageMessage(err); }
    if (state.tab !== tab) return; // user moved on
  }
  renderBoard();
}

function setupControls() {
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  const input = document.getElementById('search');
  const wrap = document.getElementById('searchWrap');
  let t = null;
  input.addEventListener('input', () => {
    wrap.classList.toggle('has-value', !!input.value);
    clearTimeout(t);
    t = setTimeout(() => { state.query = input.value; renderBoard(); }, 120);
  });
  document.getElementById('searchClear').addEventListener('click', () => {
    input.value = ''; wrap.classList.remove('has-value'); state.query = ''; renderBoard(); input.focus();
  });
  document.getElementById('showMore').addEventListener('click', () => { state.showAll = true; renderBoard(); });
  document.getElementById('meLogin').addEventListener('click', () => { try { EmoProfile.login(); } catch {} });
  // "/" focuses search, like every other leaderboard on the internet
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); input.focus(); }
  });
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
    renderStats();
    if (state.tab === 'xp') renderBoard();
    renderMe();
    // Don't rebuild galaxy on poll — would jolt the layout. New users only
    // appear on a fresh reload (rare enough not to matter).
  } catch (err) {
    console.warn('poll failed', err);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────
async function boot() {
  setupGalaxy();
  setupControls();

  // Auth must not gate the public leaderboard. If Clerk hangs, ranks
  // should still appear (or fail with a real outage message).
  const authReady = (async () => {
    try {
      await EmoProfile.init({ page: 'chart' });
      EmoProfile.mount('#emoAuthSlot');
      state.authKnown = true;
      refreshMeId();
      renderMe();
      EmoProfile.onChange?.(refreshMeId);
    } catch (err) {
      console.warn('EmoProfile init failed — continuing without auth:', err?.message || err);
      state.authKnown = true;   // show the sign-in nudge anyway; login() just no-ops if Clerk is dead
      renderMe();
    }
  })();

  try {
    await Promise.race([
      fetchProfiles(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]);
    console.log(`[chart] loaded ${state.profiles.length} profiles`);

    rememberRanks();
    renderStats();
    renderBoard();
    renderMe();
    rebuildGalaxySim();

    setLivePill('Live');
    setInterval(poll, POLL_MS);
  } catch (err) {
    console.warn('live fetch failed, using snapshot', err);
    try {
      await fetchSnapshotProfiles();
      renderStats();
      renderBoard();
      renderMe();
      rebuildGalaxySim();
      setLivePill('Cached', false);
      document.getElementById('lbFootLeft').textContent = 'Last known ranks · XP database is catching its breath';
      document.querySelectorAll('.tab:not([data-tab="xp"])').forEach(b => { b.disabled = true; b.title = 'Game boards need the live database'; b.style.opacity = '0.45'; });
    } catch (snapErr) {
      console.error('boot failed', err, snapErr);
      setLivePill('Offline', false);
      const lb = document.getElementById('leaderboard');
      if (lb) {
        lb.innerHTML = `<div class="error-state"><b>Leaderboard unavailable.</b>${escapeHtml(outageMessage(err))}</div>`;
      }
      document.getElementById('podium').hidden = true;
    }
  }

  await authReady;
}

window.EmoLeaderboard = { refresh: refreshMeId, selectTab };
boot();
