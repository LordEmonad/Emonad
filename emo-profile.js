// emonad.lol — auth + profile + XP + game records
// Self-contained module. Listens for `emo:track` CustomEvents from the host page.
// Public API on window.EmoProfile and as the default export.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CONFIG = {
  CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuZW1vbmFkLmxvbCQ',
  CLERK_FRONTEND_API:    'clerk.emonad.lol',
  SUPABASE_URL:          'https://jdymhwsfmodqxvhcdsti.supabase.co',
  SUPABASE_ANON_KEY:     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkeW1od3NmbW9kcXh2aGNkc3RpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NzU5NTIsImV4cCI6MjA5MzE1MTk1Mn0.QsGxG8iyJaPzoPTxONLco7pMXTGgqBZTFeM48Lfcr2k',
  CLERK_JWT_TEMPLATE:    'supabase',
  PER_TYPE_DAILY_CAP:    10,           // 10 blocks + 10 emonads = 20 click-XP/day
  DAILY_REWARD_XP:       5,            // tarot / flap / emocrush each = +5 XP/day
  XP_PER_LEVEL:          60,           // 60 XP per level
  MAX_LEVEL:             70,           // soft cap (70 * 60 = 4200 — 420 × 10, the bigger meme)
  FLUSH_MS:              3000,
};

const CLICK_TYPES = ['block', 'emonad'];
const DAILY_GAMES = ['tarot', 'flap', 'emocrush'];

const state = {
  ready: false,
  user: null,                   // Clerk user object (session pointer only)
  xUserId: null,                // X permanent numeric ID — the real identity
  page: 'unknown',
  buffer: [],                   // { source, page }
  todayCounts: { block: 0, emonad: 0 },
  todayClaims: { tarot: false, flap: false, emocrush: false },
  todayKey: null,
  flushTimer: null,
  serverStats: null,            // full get_user_stats row
  listeners: new Set(),
};

// ─── Identity helpers ────────────────────────────────────────────────
function xAccountOf(clerkUser) {
  if (!clerkUser) return null;
  return (clerkUser.externalAccounts || []).find(a =>
    /^(x|oauth_x|twitter|oauth_twitter)$/.test(a.provider)
  ) || null;
}
function xUserIdOf(clerkUser) {
  const xAcc = xAccountOf(clerkUser);
  return xAcc?.providerUserId || xAcc?.externalId || null;
}

function highResAvatar(url, size = 256, handle = null) {
  if (handle) {
    const clean = String(handle).replace(/^@/, '').trim();
    if (clean) return `https://unavatar.io/twitter/${encodeURIComponent(clean)}`;
  }
  if (!url) return '';
  if (url.includes('img.clerk.com')) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}width=${size}`;
  }
  if (url.includes('pbs.twimg.com')) {
    return url.replace(/_(normal|bigger|mini)\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i, '_400x400.$2$3');
  }
  return url;
}

async function ensureXMetadata(clerkUser) {
  const xAcc = xAccountOf(clerkUser);
  const xUserId = xAcc?.providerUserId || xAcc?.externalId || null;
  if (!xUserId) return null;
  const meta = clerkUser.unsafeMetadata || {};
  const xHandle = xAcc?.username || null;
  if (meta.x_user_id !== xUserId || meta.x_handle !== xHandle) {
    try {
      await clerkUser.update({
        unsafeMetadata: { ...meta, x_user_id: xUserId, x_handle: xHandle },
      });
      try { await clerkUser.session?.getToken?.({ template: CONFIG.CLERK_JWT_TEMPLATE, skipCache: true }); } catch {}
    } catch (e) {
      console.warn('emo-profile: failed to write unsafeMetadata', e);
    }
  }
  return xUserId;
}

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  global: {
    fetch: async (input, init = {}) => {
      const headers = new Headers(init.headers || {});
      try {
        if (window.Clerk?.session) {
          const token = await window.Clerk.session.getToken({ template: CONFIG.CLERK_JWT_TEMPLATE });
          if (token) headers.set('Authorization', `Bearer ${token}`);
        }
      } catch (e) {
        console.warn('emo-profile: token fetch failed', e);
      }
      return fetch(input, { ...init, headers });
    },
  },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ─── Themed CSS injected once ────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('emo-profile-styles')) return;
  const css = `
    .emo-auth-host { display: inline-flex; align-items: center; flex-shrink: 0; }
    .emo-auth-btn {
      height: 32px; padding: 0 14px;
      border-radius: 999px;
      border: 1px solid var(--surface-border, rgba(255,255,255,0.1));
      background: var(--surface, rgba(255,255,255,0.06));
      color: var(--text-color, #fff);
      font: inherit; font-size: 12.5px; font-weight: 600;
      letter-spacing: 0.01em; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      transition: all 0.2s ease; white-space: nowrap;
    }
    .emo-auth-btn:hover {
      border-color: var(--accent, #9B5FFF);
      background: var(--accent-glow, rgba(155,95,255,0.18));
      color: var(--text-color, #fff);
    }
    .emo-auth-btn:focus-visible { outline: 2px solid var(--accent, #9B5FFF); outline-offset: 2px; }
    .emo-auth-widget {
      display: inline-flex; align-items: center; gap: 8px;
      height: 32px; padding: 0 12px 0 3px;
      border-radius: 999px;
      border: 1px solid var(--surface-border, rgba(255,255,255,0.1));
      background: var(--surface, rgba(255,255,255,0.06));
      color: var(--text-color, #fff);
      cursor: pointer; font: inherit;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .emo-auth-widget:hover {
      border-color: var(--accent, #9B5FFF);
      background: var(--accent-glow, rgba(155,95,255,0.18));
      box-shadow: 0 0 16px var(--accent-glow, rgba(155,95,255,0.35));
    }
    .emo-auth-widget:hover img { box-shadow: 0 0 12px var(--accent-glow, rgba(155,95,255,0.6)); }
    .emo-auth-widget img {
      width: 26px; height: 26px; border-radius: 50%; object-fit: cover;
      border: 1px solid var(--surface-border, rgba(255,255,255,0.15));
      transition: box-shadow 0.2s ease;
    }
    .emo-auth-xp {
      font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
      color: var(--accent, #9B5FFF);
      font-variant-numeric: tabular-nums;
    }
    .emo-auth-xp.maxed {
      color: var(--accent, #9B5FFF);
      text-shadow: 0 0 12px var(--accent-glow, rgba(155,95,255,0.7));
    }
    .emo-xp-pop {
      position: fixed; pointer-events: none;
      font-weight: 800; font-size: 16px;
      color: var(--accent, #9B5FFF);
      text-shadow: 0 0 12px var(--accent-glow, rgba(155,95,255,0.7)),
                   0 2px 6px rgba(0,0,0,0.4);
      z-index: 9999;
      animation: emoXpFloat 1000ms ease-out forwards;
      will-change: transform, opacity;
    }
    .emo-xp-pop.big { font-size: 22px; font-weight: 900; }
    @keyframes emoXpFloat {
      0%   { transform: translate(-50%, 0) scale(0.8); opacity: 0; }
      15%  { transform: translate(-50%, -6px) scale(1.1); opacity: 1; }
      100% { transform: translate(-50%, -60px) scale(0.95); opacity: 0; }
    }

    /* Modal */
    .emo-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      z-index: 9990;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      opacity: 0; animation: emoFadeIn 0.2s ease forwards;
    }
    @keyframes emoFadeIn { to { opacity: 1; } }
    .emo-modal {
      width: 100%; max-width: 440px; position: relative;
      background: var(--bg-color, #0a0a0a);
      border: 1px solid var(--surface-border, rgba(255,255,255,0.12));
      border-radius: 22px;
      padding: 28px 24px 22px;
      color: var(--text-color, #fff);
      font: inherit;
      box-shadow: 0 30px 80px rgba(0,0,0,0.6),
                  0 0 60px var(--accent-glow, rgba(155,95,255,0.25));
      transform: translateY(12px);
      animation: emoSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      max-height: 90vh; overflow-y: auto;
    }
    @keyframes emoSlideIn { to { transform: translateY(0); } }
    .emo-modal h2 {
      margin: 0 0 18px;
      font-size: 13px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--text-secondary, #888);
    }
    .emo-modal .profile-row {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 16px;
      background: var(--surface, rgba(255,255,255,0.04));
      border: 1px solid var(--surface-border, rgba(255,255,255,0.08));
      border-radius: 14px; margin-bottom: 18px; position: relative;
    }
    .emo-modal .profile-row .avatar-wrap { position: relative; flex-shrink: 0; }
    .emo-modal .profile-row img {
      width: 56px; height: 56px; border-radius: 50%; object-fit: cover;
      border: 2px solid var(--accent, #9B5FFF);
      box-shadow: 0 0 18px var(--accent-glow, rgba(155,95,255,0.4));
      display: block;
    }
    .emo-modal .level-chip {
      position: absolute; bottom: -4px; right: -4px;
      min-width: 26px; height: 22px; padding: 0 7px;
      border-radius: 12px;
      background: var(--accent, #9B5FFF);
      color: #fff; font-size: 11px; font-weight: 800; letter-spacing: 0.04em;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4),
                  0 0 14px var(--accent-glow, rgba(155,95,255,0.7));
      border: 2px solid var(--bg-color, #0a0a0a);
    }
    .emo-modal .level-chip.maxed {
      background: linear-gradient(135deg, var(--accent, #9B5FFF), #ec4899);
      letter-spacing: 0.06em;
    }
    .emo-modal .profile-row .info { min-width: 0; flex: 1; }
    .emo-modal .profile-row .name {
      font-weight: 800; font-size: 16px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .emo-modal .profile-row .handle {
      color: var(--text-secondary, #888); font-size: 13px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .emo-level-row {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 7px; font-size: 12.5px;
    }
    .emo-level-row .lv {
      font-weight: 800; letter-spacing: 0.02em;
      color: var(--text-color, #fff);
    }
    .emo-level-row .next {
      color: var(--text-secondary, #888);
      font-variant-numeric: tabular-nums;
    }
    .emo-bar {
      height: 8px; border-radius: 4px;
      background: var(--surface-border, rgba(255,255,255,0.1));
      overflow: hidden; margin-bottom: 20px; position: relative;
    }
    .emo-bar > div {
      height: 100%;
      background: linear-gradient(90deg, var(--accent, #9B5FFF), #ec4899);
      transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 0 12px var(--accent-glow, rgba(155,95,255,0.55));
    }
    .emo-section-head {
      display: flex; flex-direction: column; gap: 2px;
      margin: 0 0 10px; padding: 0 2px;
    }
    .emo-section-title {
      font-size: 11px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--accent, #9B5FFF);
    }
    .emo-section-sub {
      font-size: 11px; color: var(--text-secondary, #888);
      letter-spacing: 0.01em;
    }
    .emo-stats-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      margin-bottom: 18px;
    }
    .emo-stat-card {
      background: var(--surface, rgba(255,255,255,0.04));
      border: 1px solid var(--surface-border, rgba(255,255,255,0.08));
      border-radius: 12px; padding: 12px 14px;
    }
    .emo-stat-card .num {
      font-size: 20px; font-weight: 800;
      color: var(--accent, #9B5FFF); line-height: 1.1;
    }
    .emo-stat-card .lab {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-secondary, #888); margin-top: 2px;
    }
    .emo-stat-card .sub-lab {
      font-size: 10.5px; color: var(--text-muted, #555); margin-top: 4px;
    }
    .emo-stat-card.claimed .sub-lab { color: var(--accent, #9B5FFF); }
    .emo-modal .actions { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .emo-modal .actions .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .emo-modal-btn {
      width: 100%; min-height: 40px;
      border-radius: 10px;
      border: 1px solid var(--surface-border, rgba(255,255,255,0.1));
      background: transparent; color: var(--text-color, #fff);
      font: inherit; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.18s ease;
      padding: 0 14px; text-decoration: none;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    }
    .emo-modal-btn:hover {
      border-color: var(--accent, #9B5FFF);
      background: var(--accent-glow, rgba(155,95,255,0.15));
    }
    .emo-modal-btn.primary {
      background: var(--accent, #9B5FFF);
      border-color: var(--accent, #9B5FFF);
      color: #fff;
      box-shadow: 0 4px 18px var(--accent-glow, rgba(155,95,255,0.4));
    }
    .emo-modal-btn.primary:hover {
      background: var(--accent-hover, #b080ff);
      filter: brightness(1.05);
    }
    .emo-modal-close {
      position: absolute; top: 12px; right: 12px;
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%; background: transparent;
      border: 1px solid var(--surface-border, rgba(255,255,255,0.1));
      color: var(--text-secondary, #888);
      cursor: pointer; font-size: 14px;
      transition: all 0.15s ease;
    }
    .emo-modal-close:hover {
      color: var(--text-color, #fff);
      border-color: var(--accent, #9B5FFF);
    }
    @media (max-width: 480px) {
      .emo-auth-btn { padding: 0 10px; font-size: 12px; height: 30px; }
      .emo-auth-widget { height: 30px; padding: 0 10px 0 3px; }
      .emo-auth-widget img { width: 24px; height: 24px; }
      .emo-auth-xp { font-size: 11px; }
    }
  `;
  const style = document.createElement('style');
  style.id = 'emo-profile-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ─── Clerk loader ────────────────────────────────────────────────────
function loadClerkScript() {
  return new Promise((resolve, reject) => {
    if (window.Clerk) return resolve();
    const s = document.createElement('script');
    s.src = `https://${CONFIG.CLERK_FRONTEND_API}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.dataset.clerkPublishableKey = CONFIG.CLERK_PUBLISHABLE_KEY;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load Clerk SDK'));
    document.head.appendChild(s);
  });
}

// ─── Profile upsert ──────────────────────────────────────────────────
async function upsertProfile(clerkUser) {
  const xAcc = xAccountOf(clerkUser);
  const xUserId = xAcc?.providerUserId || xAcc?.externalId || null;
  if (!xUserId) {
    console.warn('emo-profile: no X account on Clerk user — cannot upsert profile');
    return;
  }
  const row = {
    x_user_id:    xUserId,
    clerk_id:     clerkUser.id,
    x_handle:     xAcc?.username || clerkUser.username || null,
    display_name: clerkUser.fullName || xAcc?.username || null,
    avatar_url:   clerkUser.imageUrl || xAcc?.imageUrl || null,
    updated_at:   new Date().toISOString(),
  };
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'x_user_id' });
  if (error) console.warn('emo-profile: upsert failed', error);
}

// ─── Local cap helpers ───────────────────────────────────────────────
function todayKey() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
}
function loadDailyCounts() {
  const stored = localStorage.getItem('emo:dailyCounts');
  if (!stored) return { date: todayKey(), counts: { block: 0, emonad: 0 }, claims: { tarot: false, flap: false, emocrush: false } };
  try {
    const parsed = JSON.parse(stored);
    if (parsed.date === todayKey()) {
      return {
        date: parsed.date,
        counts: { block: parsed.counts?.block || 0, emonad: parsed.counts?.emonad || 0 },
        claims: {
          tarot:    !!parsed.claims?.tarot,
          flap:     !!parsed.claims?.flap,
          emocrush: !!parsed.claims?.emocrush,
        },
      };
    }
  } catch {}
  return { date: todayKey(), counts: { block: 0, emonad: 0 }, claims: { tarot: false, flap: false, emocrush: false } };
}
function saveDailyCounts() {
  localStorage.setItem('emo:dailyCounts', JSON.stringify({
    date:   state.todayKey,
    counts: state.todayCounts,
    claims: state.todayClaims,
  }));
}
function ensureToday() {
  if (state.todayKey !== todayKey()) {
    state.todayKey = todayKey();
    state.todayCounts = { block: 0, emonad: 0 };
    state.todayClaims = { tarot: false, flap: false, emocrush: false };
    saveDailyCounts();
  }
}

// ─── Server sync ─────────────────────────────────────────────────────
async function refreshServerStats() {
  if (!state.xUserId) return null;
  const { data, error } = await supabase.rpc('get_user_stats', { uid: state.xUserId });
  if (error) { console.warn('emo-profile: stats failed', error); return null; }
  const stats = data?.[0] || null;
  if (stats) {
    state.serverStats = stats;
    // Server is the source of truth — overwrite local caps/claims.
    ensureToday();
    state.todayCounts.block      = stats.today_blocks  ?? 0;
    state.todayCounts.emonad     = stats.today_emonads ?? 0;
    state.todayClaims.tarot      = (stats.today_tarot    ?? 0) > 0;
    state.todayClaims.flap       = (stats.today_flap     ?? 0) > 0;
    state.todayClaims.emocrush   = (stats.today_emocrush ?? 0) > 0;
    saveDailyCounts();
    notify();
  }
  return stats;
}

// ─── Buffered xp_events insert (for clicks) ──────────────────────────
function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flush, CONFIG.FLUSH_MS);
}
async function flush() {
  state.flushTimer = null;
  if (!state.xUserId || state.buffer.length === 0) return;
  const batch = state.buffer.splice(0);
  const rows = batch.map(b => ({
    x_user_id: state.xUserId,
    source:    b.source,
    amount:    b.amount ?? 1,
    page:      b.page,
  }));
  const { error } = await supabase.from('xp_events').insert(rows);
  if (error) {
    if (/daily_cap_reached/i.test(error.message || '')) {
      refreshServerStats();
    } else {
      state.buffer.unshift(...batch);
      console.warn('emo-profile: flush failed', error);
    }
  } else {
    refreshServerStats();
  }
}
window.addEventListener('beforeunload', () => { if (state.buffer.length && state.xUserId) flush(); });

// ─── Level math ──────────────────────────────────────────────────────
function levelInfo(totalXp) {
  const xp = Math.max(0, totalXp || 0);
  const lvCap = CONFIG.MAX_LEVEL;
  const xpCap = lvCap * CONFIG.XP_PER_LEVEL;
  const maxed = xp >= xpCap;
  const level = maxed ? lvCap : Math.floor(xp / CONFIG.XP_PER_LEVEL) + 1;
  const intoLevel = maxed ? CONFIG.XP_PER_LEVEL : (xp % CONFIG.XP_PER_LEVEL);
  const xpToNext  = maxed ? 0 : (CONFIG.XP_PER_LEVEL - intoLevel);
  const progress  = maxed ? 1 : (intoLevel / CONFIG.XP_PER_LEVEL);
  return { xp, level, maxed, intoLevel, xpToNext, progress, xpCap, levelCap: lvCap };
}

// ─── XP popup ────────────────────────────────────────────────────────
function spawnXpPop(x, y, text, big = false) {
  const el = document.createElement('div');
  el.className = 'emo-xp-pop' + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1050);
}
function centerXp(text, big = true) {
  spawnXpPop(window.innerWidth / 2, window.innerHeight * 0.32, text, big);
}

// ─── UI: auth button ────────────────────────────────────────────────
function buildAuthButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'emo-auth-btn';
  btn.textContent = 'Log in';
  btn.setAttribute('aria-label', 'Log in with X');
  btn.addEventListener('click', () => api.login());
  return btn;
}
function buildAuthWidget(user) {
  const xAcc = xAccountOf(user);
  const handle = (xAcc && xAcc.username) || user.username || '';
  const fallback = (xAcc && xAcc.imageUrl) || user.imageUrl || '';
  const avatar = highResAvatar(fallback, 128, handle);

  const widget = document.createElement('button');
  widget.type = 'button';
  widget.className = 'emo-auth-widget';
  widget.setAttribute('aria-label', 'Open profile (' + (handle ? '@'+handle : 'account') + ')');

  const img = document.createElement('img');
  img.src = avatar;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  if (fallback && avatar !== fallback) {
    img.onerror = () => { img.onerror = null; img.src = fallback; };
  }
  widget.appendChild(img);

  const xp = document.createElement('span');
  xp.className = 'emo-auth-xp';
  const total = state.serverStats?.total_xp ?? 0;
  const li = levelInfo(total);
  xp.textContent = li.maxed ? 'MAX' : (total + ' XP');
  if (li.maxed) xp.classList.add('maxed');
  widget.appendChild(xp);

  widget.addEventListener('click', () => api.openProfileModal());
  return widget;
}

function renderInto(host) {
  if (!host) return;
  host.innerHTML = '';
  host.classList.add('emo-auth-host');
  if (state.user) host.appendChild(buildAuthWidget(state.user));
  else            host.appendChild(buildAuthButton());
}

const mountedHosts = new Set();
function refreshMounts() { mountedHosts.forEach(renderInto); }

// ─── Profile modal ───────────────────────────────────────────────────
function openModal() {
  if (!state.user) return;
  closeModal();

  const s = state.serverStats || {};
  const total      = s.total_xp ?? 0;
  const blocks     = s.xp_blocks ?? 0;
  const emonads    = s.xp_emonads ?? 0;
  const ecBest     = s.emocrush_best_score ?? 0;
  const ecLevel    = s.emocrush_best_level ?? 0;
  const flBest     = s.flap_high_score ?? 0;
  const trReadings = s.tarot_readings ?? 0;
  const li = levelInfo(total);

  const xAcc = xAccountOf(state.user);
  const handle = (xAcc && xAcc.username) || state.user.username || '';
  const fallbackAvatar = (xAcc && xAcc.imageUrl) || state.user.imageUrl || '';
  const avatar = highResAvatar(fallbackAvatar, 256, handle);
  const name = state.user.fullName || handle;

  const backdrop = document.createElement('div');
  backdrop.className = 'emo-modal-backdrop';
  backdrop.id = 'emo-modal-root';
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

  const modal = document.createElement('div');
  modal.className = 'emo-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = `
    <button class="emo-modal-close" aria-label="Close">✕</button>
    <h2>Your profile</h2>
    <div class="profile-row">
      <div class="avatar-wrap">
        <img src="${avatar}" alt="" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${escapeHtml(fallbackAvatar)}'">
        <span class="level-chip ${li.maxed ? 'maxed' : ''}">${li.maxed ? 'MAX' : 'L' + li.level}</span>
      </div>
      <div class="info">
        <div class="name">${escapeHtml(name)}</div>
        <div class="handle">@${escapeHtml(handle)}</div>
      </div>
    </div>
    <div class="emo-level-row">
      <span class="lv">${li.maxed ? 'MAX LEVEL' : 'Level ' + li.level}</span>
      <span class="next">${li.maxed ? li.xp + ' XP' : (li.intoLevel + ' / ' + CONFIG.XP_PER_LEVEL + ' XP')}</span>
    </div>
    <div class="emo-bar"><div style="width:${(li.progress * 100).toFixed(1)}%"></div></div>

    <div class="emo-section-head">
      <span class="emo-section-title">Homepage missions</span>
      <span class="emo-section-sub">Click emo blocks &amp; emonads on the homepage · 10 each / day</span>
    </div>
    <div class="emo-stats-grid">
      <div class="emo-stat-card">
        <div class="num">${blocks}</div>
        <div class="lab">Blocks broken</div>
        <div class="sub-lab">${state.todayCounts.block} / ${CONFIG.PER_TYPE_DAILY_CAP} today</div>
      </div>
      <div class="emo-stat-card">
        <div class="num">${emonads}</div>
        <div class="lab">Emonads slain</div>
        <div class="sub-lab">${state.todayCounts.emonad} / ${CONFIG.PER_TYPE_DAILY_CAP} today</div>
      </div>
    </div>

    <div class="emo-section-head">
      <span class="emo-section-title">Games</span>
      <span class="emo-section-sub">Play each game once a day for +5 XP</span>
    </div>
    <div class="emo-stats-grid">
      <div class="emo-stat-card ${state.todayClaims.emocrush ? 'claimed' : ''}">
        <div class="num">${ecLevel > 0 ? 'Lv ' + ecLevel : '—'}</div>
        <div class="lab">Emo Crush</div>
        <div class="sub-lab">${ecBest ? 'best ' + ecBest.toLocaleString() : 'no score yet'} · ${state.todayClaims.emocrush ? '+5 XP claimed' : 'daily +5 XP'}</div>
      </div>
      <div class="emo-stat-card ${state.todayClaims.flap ? 'claimed' : ''}">
        <div class="num">${flBest || '—'}</div>
        <div class="lab">Flap Emonad</div>
        <div class="sub-lab">${flBest ? 'high score' : 'no flaps yet'} · ${state.todayClaims.flap ? '+5 XP claimed' : 'daily +5 XP'}</div>
      </div>
    </div>
    <div class="emo-stats-grid" style="grid-template-columns: 1fr;">
      <div class="emo-stat-card ${state.todayClaims.tarot ? 'claimed' : ''}">
        <div class="num">${trReadings}</div>
        <div class="lab">Tarot readings</div>
        <div class="sub-lab">${state.todayClaims.tarot ? 'daily +5 XP claimed' : 'do a reading for +5 XP today'}</div>
      </div>
    </div>

    <div class="actions">
      <a class="emo-modal-btn primary" href="${profileLinkBase()}profile.html?handle=${encodeURIComponent(handle)}" target="_blank" rel="noopener">View public profile →</a>
      <div class="row-2">
        <button class="emo-modal-btn" data-action="manage">Manage</button>
        <button class="emo-modal-btn" data-action="logout">Log out</button>
      </div>
    </div>
  `;

  modal.querySelector('.emo-modal-close').addEventListener('click', closeModal);
  modal.querySelector('[data-action="manage"]').addEventListener('click', () => { closeModal(); api.openClerkProfile(); });
  modal.querySelector('[data-action="logout"]').addEventListener('click', () => { closeModal(); api.logout(); });

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const onKey = e => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}
function closeModal() {
  const existing = document.getElementById('emo-modal-root');
  if (existing) existing.remove();
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// "profile.html" lives at site root. Adjust the link prefix depending on
// which page hosts the modal so it works from /, /emo-crush/, /flapemonad/, /tarot/.
function profileLinkBase() {
  switch (state.page) {
    case 'emo-crush':
    case 'flapemonad':
    case 'tarot':
      return '../';
    default:
      return '';
  }
}

// ─── Local-progress claim (game records merge on first login) ────────
// Reads on-device localStorage best scores from Emo Crush + Flap Emonad and
// pushes them up to the server records via mergeGameRecord (max-merge for
// bests, delta-add for games_played/wins).
//
// Guarded per (xUserId) with a one-shot flag so games_played doesn't
// double-count on reload. IMPORTANT: the flag is only set when we
// successfully migrated something — otherwise a fresh-device login (no local
// data yet) would set the flag and permanently block future migrations once
// the user accumulates local scores.
//
// Pass force=true to bypass the flag (used by the public manual trigger).
async function claimLocalGameProgress(force = false) {
  if (!state.xUserId) return { migrated: false, reason: 'no-user' };
  const claimKey = `emo:localClaimed:${state.xUserId}`;
  if (!force && localStorage.getItem(claimKey) === '1') {
    return { migrated: false, reason: 'already-claimed' };
  }

  let migratedAny = false;
  const summary = { emocrush: null, flap: null, stars: false };

  // Emo Crush bests
  try {
    const ecRaw = localStorage.getItem('emocrush-personal-best');
    if (ecRaw) {
      const ec = JSON.parse(ecRaw);
      const payload = {
        best_score:   Math.max(0, Number(ec.best_score)   || 0),
        best_level:   Math.max(0, Number(ec.best_level)   || 0),
        best_combo:   Math.max(0, Number(ec.best_combo)   || 0),
        games_played: Math.max(0, Number(ec.games_played) || 0),
        wins:         Math.max(0, Number(ec.wins)         || 0),
        last_score:   Math.max(0, Number(ec.last_score)   || 0),
        last_level:   Math.max(0, Number(ec.last_level)   || 0),
      };
      if (payload.best_score > 0 || payload.best_level > 0 || payload.games_played > 0) {
        const result = await mergeGameRecord('emocrush', payload);
        if (result) {
          migratedAny = true;
          summary.emocrush = payload;
          console.log('[emo-profile] migrated emo-crush local progress →', payload);
        }
      }
    }
    // Per-level stars map
    const ecProgRaw = localStorage.getItem('emocrush-progress');
    if (ecProgRaw) {
      const ecProg = JSON.parse(ecProgRaw);
      if (ecProg && ecProg.stars && typeof ecProg.stars === 'object' && Object.keys(ecProg.stars).length) {
        const result = await mergeGameRecord('emocrush', { stars: ecProg.stars });
        if (result) {
          migratedAny = true;
          summary.stars = true;
          console.log('[emo-profile] migrated emo-crush stars →', ecProg.stars);
        }
      }
    }
  } catch (e) { console.warn('[emo-profile] emo-crush local merge failed', e); }

  // Flap Emonad high score
  try {
    const flBest = parseInt(localStorage.getItem('flapEmonadBestScore') || '0', 10);
    if (flBest > 0) {
      const result = await mergeGameRecord('flap', { high_score: flBest });
      if (result) {
        migratedAny = true;
        summary.flap = { high_score: flBest };
        console.log('[emo-profile] migrated flap-emonad local best →', flBest);
      }
    }
  } catch (e) { console.warn('[emo-profile] flap local merge failed', e); }

  if (migratedAny) {
    try { localStorage.setItem(claimKey, '1'); } catch {}
  } else {
    console.log('[emo-profile] no local game progress to migrate (yet)');
  }
  return { migrated: migratedAny, summary };
}

// ─── Bidirectional game-score sync ──────────────────────────────────
// Reconciles localStorage <-> server records on every login.
//
// Bests (best_score / best_level / best_combo / high_score / stars):
//   pushed up via mergeGameRecord (max-merge) AND pulled down via max merge
//   into localStorage. Idempotent — repeated calls are no-ops if everything
//   is already in agreement. Safe to run on every login regardless of
//   whether the migration flag is set or not.
//
// Counters (games_played / wins): not pushed here (would double-count;
// only the per-game submit during play increments them). Pulled DOWN with
// max-merge so a fresh device shows the cross-device-correct count.
//
// Net effect: a user's bests are eventually consistent across every device
// they ever log into. The highest value anywhere wins, forever.
async function syncGameProgress() {
  if (!state.xUserId) return { synced: false, reason: 'no-user' };
  const summary = { emocrush: null, flap: null };

  // ── Emo Crush ──
  try {
    // Read local
    const ecRaw = localStorage.getItem('emocrush-personal-best');
    const ecLocal = ecRaw ? (JSON.parse(ecRaw) || {}) : {};
    const localBests = {
      best_score: Number(ecLocal.best_score) || 0,
      best_level: Number(ecLocal.best_level) || 0,
      best_combo: Number(ecLocal.best_combo) || 0,
    };
    // Push bests up (safe to repeat: server max-merges)
    if (localBests.best_score > 0 || localBests.best_level > 0 || localBests.best_combo > 0) {
      await mergeGameRecord('emocrush', localBests);
    }
    // Push stars up (safe to repeat: server max-merges per level)
    const progRaw = localStorage.getItem('emocrush-progress');
    const prog = progRaw ? (JSON.parse(progRaw) || {}) : {};
    const localStars = prog.stars && typeof prog.stars === 'object' ? prog.stars : {};
    if (Object.keys(localStars).length > 0) {
      await mergeGameRecord('emocrush', { stars: localStars });
    }
    // Pull server values back down (post-push these reflect the merged max)
    const { data: ec } = await supabase
      .from('emocrush_records')
      .select('best_score, best_combo, best_level, games_played, wins, last_score, last_level, stars, updated_at')
      .eq('x_user_id', state.xUserId)
      .maybeSingle();
    if (ec) {
      const merged = {
        ...ecLocal,
        best_score:   Math.max(localBests.best_score, Number(ec.best_score) || 0),
        best_combo:   Math.max(localBests.best_combo, Number(ec.best_combo) || 0),
        best_level:   Math.max(localBests.best_level, Number(ec.best_level) || 0),
        games_played: Math.max(Number(ecLocal.games_played) || 0, Number(ec.games_played) || 0),
        wins:         Math.max(Number(ecLocal.wins)         || 0, Number(ec.wins)         || 0),
        last_score:   Number(ec.last_score) || Number(ecLocal.last_score) || 0,
        last_level:   Number(ec.last_level) || Number(ecLocal.last_level) || 0,
        updated_at:   ec.updated_at || new Date().toISOString(),
      };
      localStorage.setItem('emocrush-personal-best', JSON.stringify(merged));
      summary.emocrush = merged;

      if (ec.stars && typeof ec.stars === 'object' && Object.keys(ec.stars).length) {
        const mergedStars = { ...localStars };
        for (const k of Object.keys(ec.stars)) {
          const v = Number(ec.stars[k]) || 0;
          if (v > (Number(mergedStars[k]) || 0)) mergedStars[k] = v;
        }
        prog.stars = mergedStars;
        localStorage.setItem('emocrush-progress', JSON.stringify(prog));
      }
    }
  } catch (e) { console.warn('[emo-profile] emocrush sync failed', e); }

  // ── Flap Emonad ──
  try {
    const localHigh = parseInt(localStorage.getItem('flapEmonadBestScore') || '0', 10);
    // Push local best up (max-merge on server)
    if (localHigh > 0) {
      await mergeGameRecord('flap', { high_score: localHigh });
    }
    // Pull server back down
    const { data: fl } = await supabase
      .from('flapemonad_records')
      .select('high_score, games_played, last_score, updated_at')
      .eq('x_user_id', state.xUserId)
      .maybeSingle();
    if (fl) {
      const merged = Math.max(localHigh, Number(fl.high_score) || 0);
      localStorage.setItem('flapEmonadBestScore', String(merged));
      summary.flap = { high_score: merged };
    }
  } catch (e) { console.warn('[emo-profile] flap sync failed', e); }

  if (summary.emocrush || summary.flap) {
    console.log('[emo-profile] game progress synced (bidir) →', summary);
  }
  return { synced: true, summary };
}

// Back-compat alias for any code still using the old name.
const syncServerGameProgress = syncGameProgress;

// ─── Game records ────────────────────────────────────────────────────
const GAME_TABLES = {
  emocrush: 'emocrush_records',
  flap:     'flapemonad_records',
};

// Smart upsert. Semantics by field:
//   best_* / high_score / stars : max-merge (never go backwards)
//   games_played / wins         : delta-increment (patch value is added to current)
//   last_*                      : straight overwrite (just the latest)
// Race conditions aren't a concern at this scale; if two devices submit at
// the exact same moment, the last write wins which only loses one increment.
async function mergeGameRecord(game, patch) {
  if (!state.xUserId) return null;
  const table = GAME_TABLES[game];
  if (!table) { console.warn('emo-profile: unknown game', game); return null; }

  const { data: cur } = await supabase.from(table).select('*').eq('x_user_id', state.xUserId).maybeSingle();
  const next = { x_user_id: state.xUserId, updated_at: new Date().toISOString() };

  if (game === 'emocrush') {
    next.best_score   = Math.max(cur?.best_score || 0, Number(patch.best_score) || 0);
    next.best_level   = Math.max(cur?.best_level || 0, Number(patch.best_level) || 0);
    next.best_combo   = Math.max(cur?.best_combo || 0, Number(patch.best_combo) || 0);
    next.games_played = (cur?.games_played || 0) + (Number(patch.games_played) || 0);
    next.wins         = (cur?.wins         || 0) + (Number(patch.wins)         || 0);
    if (patch.last_score !== undefined) next.last_score = Number(patch.last_score) || 0;
    if (patch.last_level !== undefined) next.last_level = Number(patch.last_level) || 0;
    // Stars: per-level max merge
    if (patch.stars && typeof patch.stars === 'object') {
      const merged = { ...(cur?.stars || {}) };
      for (const k of Object.keys(patch.stars)) {
        const v = Number(patch.stars[k]) || 0;
        if (v > (Number(merged[k]) || 0)) merged[k] = v;
      }
      next.stars = merged;
    }
  } else if (game === 'flap') {
    next.high_score   = Math.max(cur?.high_score || 0, Number(patch.high_score) || 0);
    next.games_played = (cur?.games_played || 0) + (Number(patch.games_played) || 0);
    if (patch.last_score !== undefined) next.last_score = Number(patch.last_score) || 0;
  }

  const { error } = await supabase.from(table).upsert(next, { onConflict: 'x_user_id' });
  if (error) { console.warn('emo-profile: mergeGameRecord failed', game, error); return null; }
  return next;
}

// ─── Public API ──────────────────────────────────────────────────────
const api = {
  CONFIG,
  CLICK_TYPES,
  DAILY_GAMES,

  async init({ page = 'unknown' } = {}) {
    if (state.ready) return;
    state.page = page;
    injectStyles();

    const today = loadDailyCounts();
    state.todayKey    = today.date;
    state.todayCounts = today.counts;
    state.todayClaims = today.claims;

    await loadClerkScript();
    await window.Clerk.load();

    const onAuth = async () => {
      const u = window.Clerk.user;
      const prevXUserId = state.xUserId;
      state.user  = u || null;
      state.ready = true;
      if (u) {
        state.xUserId = await ensureXMetadata(u);
      } else {
        state.xUserId = null;
        state.serverStats = null;
      }
      const identityChanged = state.xUserId && state.xUserId !== prevXUserId;
      if (state.xUserId && identityChanged) {
        await upsertProfile(u);
        await claimLocalGameProgress();   // one-shot: counter delta migration
        await syncGameProgress();         // every login: bidir bests + pull
        await refreshServerStats();
      }
      refreshMounts();
      notify();
    };

    await onAuth();
    window.Clerk.addListener(onAuth);

    document.addEventListener('emo:track', e => {
      const detail = (e && e.detail) || {};
      api.track(detail.type, { x: detail.x, y: detail.y });
    });
  },

  isReady()    { return state.ready; },
  getUser()    { return state.user; },
  isLoggedIn() { return !!state.user; },

  todayCount(type) {
    ensureToday();
    if (!type) return state.todayCounts.block + state.todayCounts.emonad;
    return state.todayCounts[type] || 0;
  },
  dailyCap(_type) { return CONFIG.PER_TYPE_DAILY_CAP; },
  hasClaimedToday(game) { ensureToday(); return !!state.todayClaims[game]; },
  serverStats()   { return state.serverStats; },
  levelInfo()     { return levelInfo(state.serverStats?.total_xp ?? 0); },

  login() {
    if (!window.Clerk) return;
    window.Clerk.openSignIn({
      afterSignInUrl: window.location.pathname + window.location.search,
      afterSignUpUrl: window.location.pathname + window.location.search,
    });
  },
  logout() { if (window.Clerk) window.Clerk.signOut(); },
  openClerkProfile() { if (window.Clerk) window.Clerk.openUserProfile(); },
  openProfileModal() { openModal(); },
  closeProfileModal() { closeModal(); },

  mount(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    mountedHosts.add(el);
    renderInto(el);
  },

  // ── Click tracking (homepage emo blocks + flying emonads) ──────────
  track(type, opts = {}) {
    if (!state.xUserId) return false;
    if (!CLICK_TYPES.includes(type)) {
      console.warn('emo-profile: invalid track type', type);
      return false;
    }
    ensureToday();
    if (state.todayCounts[type] >= CONFIG.PER_TYPE_DAILY_CAP) return false;

    state.todayCounts[type] += 1;
    saveDailyCounts();
    const source = type === 'block' ? 'click_block' : 'click_emonad';
    state.buffer.push({ source, amount: 1, page: state.page });
    scheduleFlush();

    if (state.serverStats) {
      state.serverStats = {
        ...state.serverStats,
        total_xp:      (state.serverStats.total_xp || 0) + 1,
        xp_blocks:     type === 'block'  ? (state.serverStats.xp_blocks  || 0) + 1 : state.serverStats.xp_blocks,
        xp_emonads:    type === 'emonad' ? (state.serverStats.xp_emonads || 0) + 1 : state.serverStats.xp_emonads,
        today_blocks:  type === 'block'  ? (state.serverStats.today_blocks  || 0) + 1 : state.serverStats.today_blocks,
        today_emonads: type === 'emonad' ? (state.serverStats.today_emonads || 0) + 1 : state.serverStats.today_emonads,
      };
    }

    if (typeof opts.x === 'number' && typeof opts.y === 'number') {
      spawnXpPop(opts.x, opts.y, '+1 XP');
    }
    refreshMounts();
    notify();
    return true;
  },

  // ── Daily +5 XP claim for tarot / flap / emocrush ──────────────────
  // Silently no-ops if not logged in or already claimed today.
  // Returns true iff a fresh server-side claim was made.
  async claimDaily(game, opts = {}) {
    if (!state.xUserId) return false;
    if (!DAILY_GAMES.includes(game)) {
      console.warn('emo-profile: invalid daily game', game);
      return false;
    }
    ensureToday();
    if (state.todayClaims[game]) return false;

    // Optimistic: mark claimed locally before the round-trip so re-entrant
    // calls in the same session don't double-fire.
    state.todayClaims[game] = true;
    saveDailyCounts();

    const source = `${game}_daily`;
    const { error } = await supabase.from('xp_events').insert([{
      x_user_id: state.xUserId,
      source,
      amount:    CONFIG.DAILY_REWARD_XP,
      page:      state.page,
    }]);

    if (error) {
      // Server already saw it today (different device, same day) — keep
      // local flag set so we don't keep re-trying; the next refresh will
      // align reality. Other errors: roll back local flag.
      if (/daily_cap_reached/i.test(error.message || '')) {
        refreshServerStats();
        return false;
      }
      state.todayClaims[game] = false;
      saveDailyCounts();
      console.warn('emo-profile: claimDaily failed', game, error);
      return false;
    }

    // Optimistic stats bump so UI updates before the round trip.
    if (state.serverStats) {
      const fld = `xp_${game}`;
      const todayFld = `today_${game}`;
      state.serverStats = {
        ...state.serverStats,
        total_xp: (state.serverStats.total_xp || 0) + CONFIG.DAILY_REWARD_XP,
        [fld]: (state.serverStats[fld] || 0) + CONFIG.DAILY_REWARD_XP,
        [todayFld]: (state.serverStats[todayFld] || 0) + 1,
      };
    }

    // Popup
    const popText = `+${CONFIG.DAILY_REWARD_XP} XP daily`;
    if (typeof opts.x === 'number' && typeof opts.y === 'number') {
      spawnXpPop(opts.x, opts.y, popText, true);
    } else {
      centerXp(popText, true);
    }

    refreshServerStats();
    refreshMounts();
    notify();
    return true;
  },

  // ── Game record updates ────────────────────────────────────────────
  async updateGameRecord(game, patch) {
    if (!state.xUserId) return null;
    const result = await mergeGameRecord(game, patch);
    notify();
    return result;
  },

  // ── Manual migration of localStorage game scores → server ─────────
  // Public escape hatch so users whose flag was set incorrectly (or anyone
  // debugging) can force a re-run. Bypasses the one-shot guard.
  // Usage from devtools: `await EmoProfile.migrateLocalGameProgress()`
  async migrateLocalGameProgress() {
    const result = await claimLocalGameProgress(true);
    await syncGameProgress();
    await refreshServerStats();
    notify();
    return result;
  },

  // Bidirectional reconcile of localStorage <-> server game records.
  // Safe to call any time; max-merge in both directions.
  async syncGameProgress() {
    const result = await syncGameProgress();
    notify();
    return result;
  },
  // Back-compat alias.
  async syncServerGameProgress() { return this.syncGameProgress(); },

  // ── Read helpers ───────────────────────────────────────────────────
  async getStats(xUserId) {
    const id = xUserId || state.xUserId;
    if (!id) return null;
    const { data, error } = await supabase.rpc('get_user_stats', { uid: id });
    if (error) { console.warn('emo-profile: getStats', error); return null; }
    return data?.[0] || null;
  },
  async getProfile(xUserId) {
    const id = xUserId || state.xUserId;
    if (!id) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('x_user_id', id).single();
    if (error) { console.warn('emo-profile: getProfile', error); return null; }
    return data;
  },
  async getProfileByHandle(handle) {
    if (!handle) return null;
    const { data, error } = await supabase
      .from('profiles').select('*')
      .ilike('x_handle', handle)
      .limit(1).maybeSingle();
    if (error) { console.warn('emo-profile: getProfileByHandle', error); return null; }
    return data;
  },
  async getLeaderboard(limit = 25) {
    const { data, error } = await supabase.from('leaderboard').select('*').limit(limit);
    if (error) { console.warn('emo-profile: leaderboard', error); return []; }
    return data || [];
  },

  highResAvatar,

  onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); },
};

function notify() { state.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

window.EmoProfile = api;
export default api;
export { supabase as supabaseClient };
