// ─────────────────────────────────────────────────────────────────────
// emonad.lol — referral OG card Worker
//
// Routes (all under i.emonad.lol):
//   GET /<handle>           → HTML landing page with custom OG tags + meta
//                             refresh → emonad.lol/?ref=<handle>
//   GET /<handle>/card.png  → 1200×630 PNG card with the user's PFP / XP
//   GET /                   → 302 → emonad.lol
//
// How the share flow works:
//   User shares    i.emonad.lol/lordemo
//   X/TG/Discord   hit the URL, parse OG tags, embed the PNG preview.
//   Humans         get the same HTML, but JS/meta-refresh sends them to
//                  emonad.lol/?ref=lordemo so the referral RPC fires.
//
// All data comes from Supabase via the public anon key — no service role.
// Reads `profiles` (public RLS read), which has x_handle, display_name,
// avatar_url, total_xp. That's everything the card needs.
// ─────────────────────────────────────────────────────────────────────

import { ImageResponse } from 'workers-og';

const XP_PER_LEVEL = 60;
const MAX_LEVEL    = 70;
const ACCENT       = '#9B5FFF';
const PINK         = '#ec4899';
const BG_DARK      = '#0a0612';
const TEXT_MUTED   = '#b8a3e8';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      let path = url.pathname.replace(/^\/+|\/+$/g, '');

      // Root or favicon → bounce to homepage
      if (!path || path === 'favicon.ico' || path === 'robots.txt') {
        return Response.redirect(env.SITE_ORIGIN || 'https://emonad.lol', 302);
      }

      // Card endpoint
      if (path.endsWith('/card.png')) {
        const handle = decodeURIComponent(path.replace(/\/card\.png$/, ''));
        return await renderCardPng(handle, env);
      }

      // Anything else → HTML landing page for that handle
      const handle = decodeURIComponent(path);
      return await renderLandingHtml(handle, env);
    } catch (err) {
      console.error('og-worker error:', err);
      return new Response('Server error', { status: 500 });
    }
  },
};

// ── Supabase REST helper ────────────────────────────────────────────
async function fetchProfile(handle, env) {
  const cleanHandle = String(handle || '').replace(/^@/, '').trim();
  if (!cleanHandle) return null;
  // ilike for case-insensitive lookup. Profiles have public RLS read.
  const u = `${env.SUPABASE_URL}/rest/v1/profiles`
    + `?x_handle=ilike.${encodeURIComponent(cleanHandle)}`
    + `&select=x_handle,display_name,avatar_url,total_xp`
    + `&limit=1`;
  const res = await fetch(u, {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function levelFromXp(xp) {
  const cap = MAX_LEVEL * XP_PER_LEVEL;
  const maxed = (xp || 0) >= cap;
  const level = maxed ? MAX_LEVEL : Math.floor((xp || 0) / XP_PER_LEVEL) + 1;
  return { level, maxed };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

// Resolve a usable avatar as a data: URL so satori never has to re-fetch
// (and never sees an "Unsupported image type" failure on the inner decode).
//
// Strategy:
//   1. Prefer unavatar.io/x/<handle> — always serves the CURRENT X PFP.
//      `fallback=false` makes it 404 instead of serving a placeholder SVG
//      when the handle doesn't exist on X.
//   2. Fall back to profile.avatar_url (Clerk's cached snapshot).
//   3. Pre-fetch each candidate. Skip anything that isn't actually image/*.
//   4. Return the bytes as a data: URL. satori embeds it without
//      re-fetching, so a flaky avatar source can't loop and burn CPU.
async function resolveAvatarDataUrl(profile, handle) {
  const h = (profile?.x_handle || handle || '').replace(/^@/, '').trim();
  // Same URL list profile.html's fetchFreshAvatar uses (known-good on X).
  const candidates = [];
  if (h) {
    candidates.push(`https://unavatar.io/twitter/${encodeURIComponent(h)}?size=1000`);
    candidates.push(`https://unavatar.io/x/${encodeURIComponent(h)}?size=1000`);
    candidates.push(`https://unavatar.io/twitter/${encodeURIComponent(h)}`);
  }
  if (profile?.avatar_url) candidates.push(profile.avatar_url);

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        cf: { cacheTtl: 3600, cacheEverything: true },
        // unavatar redirects to the actual image host — follow it.
        redirect: 'follow',
      });
      if (!res.ok) {
        console.log(`avatar miss ${url} → ${res.status}`);
        continue;
      }
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      // Accept any image/* — JPEG/PNG/WebP/GIF/AVIF. Reject SVG (satori
      // can't rasterize it) and anything non-image.
      if (!ct.startsWith('image/') || ct.includes('svg')) {
        console.log(`avatar wrong content-type ${url} → ${ct}`);
        continue;
      }
      const buf = await res.arrayBuffer();
      // Cap at 1 MB — bigger PFPs would inflate the data URL and slow render.
      if (buf.byteLength > 1_000_000) {
        console.log(`avatar too big ${url} → ${buf.byteLength}`);
        continue;
      }
      const b64 = arrayBufferToBase64(buf);
      console.log(`avatar ok ${url} → ${ct} ${buf.byteLength}b`);
      return `data:${ct};base64,${b64}`;
    } catch (e) {
      console.log(`avatar threw ${url} → ${e.message || e}`);
    }
  }
  return null;
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const len = bytes.byteLength;
  // Chunk to avoid hitting argument-count limits on String.fromCharCode
  const CHUNK = 0x8000;
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, len)));
  }
  return btoa(binary);
}

// ── HTML landing page (what social crawlers parse) ──────────────────
async function renderLandingHtml(handle, env) {
  const cleanHandle = handle.replace(/^@/, '').trim();
  const profile = await fetchProfile(cleanHandle, env);
  const displayName = profile?.display_name || cleanHandle;
  const xHandle     = profile?.x_handle     || cleanHandle;
  const xp          = profile?.total_xp     || 0;
  const { level, maxed } = levelFromXp(xp);

  const cardUrl     = `https://i.emonad.lol/${encodeURIComponent(cleanHandle)}/card.png`;
  const landingUrl  = `https://i.emonad.lol/${encodeURIComponent(cleanHandle)}`;
  // Redirect directly to /emo.html?ref=... — avoids passing through
  // index.html, which used to strip the ?ref= during its own redirect.
  // index.html now preserves query strings, but going direct is one
  // fewer hop either way.
  const redirectUrl = `${env.SITE_ORIGIN || 'https://emonad.lol'}/emo.html?ref=${encodeURIComponent(cleanHandle)}`;
  const title       = `Join ${displayName} on emonad.lol — +50 XP free`;
  const desc        = `${maxed ? 'MAX LEVEL' : 'Level ' + level} · ${xp.toLocaleString('en-US')} XP earned · the emo kid of Monad. Click the link to claim your bonus.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<link rel="canonical" href="${escapeHtml(redirectUrl)}">

<!-- Open Graph -->
<meta property="og:type"          content="website">
<meta property="og:site_name"     content="Emonad">
<meta property="og:url"           content="${escapeHtml(landingUrl)}">
<meta property="og:title"         content="${escapeHtml(title)}">
<meta property="og:description"   content="${escapeHtml(desc)}">
<meta property="og:image"         content="${escapeHtml(cardUrl)}">
<meta property="og:image:secure_url" content="${escapeHtml(cardUrl)}">
<meta property="og:image:type"    content="image/png">
<meta property="og:image:width"   content="1200">
<meta property="og:image:height"  content="630">
<meta property="og:image:alt"     content="${escapeHtml(displayName + ' — emonad.lol')}">

<!-- Twitter Card -->
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:site"        content="@EmonadCoin">
<meta name="twitter:creator"     content="@${escapeHtml(xHandle)}">
<meta name="twitter:title"       content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image"       content="${escapeHtml(cardUrl)}">

<!-- Humans get bounced to the real referral URL so the claim RPC fires -->
<meta http-equiv="refresh" content="0; url=${escapeHtml(redirectUrl)}">
<style>
  html, body { margin: 0; padding: 0; background: ${BG_DARK}; color: #fff;
               font-family: system-ui, -apple-system, sans-serif; height: 100%; }
  .wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  .msg { text-align: center; font-size: 16px; opacity: 0.85; }
  .msg a { color: ${ACCENT}; text-decoration: none; font-weight: 700; }
</style>
</head>
<body>
<div class="wrap"><div class="msg">
  Redirecting to <a href="${escapeHtml(redirectUrl)}">emonad.lol</a>…
</div></div>
<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 5min edge cache — long enough to absorb crawler bursts, short
      // enough that XP/avatar updates show up quickly.
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  });
}

// ── PNG card (what the og:image URL resolves to) ────────────────────
async function renderCardPng(handle, env) {
  const cleanHandle = handle.replace(/^@/, '').trim();
  const profile = await fetchProfile(cleanHandle, env);
  const displayName = profile?.display_name || cleanHandle;
  const xHandle     = profile?.x_handle     || cleanHandle;
  const xp          = profile?.total_xp     || 0;
  const { level, maxed } = levelFromXp(xp);
  const avatar = await resolveAvatarDataUrl(profile, cleanHandle);

  // workers-og uses satori under the hood. Satori counts HTML comments
  // AND whitespace as text nodes, so multi-child divs must have explicit
  // display:flex and NO surrounding whitespace/comments. We build the
  // template with no formatting whitespace between sibling elements.
  const avatarBlock = avatar
    ? `<div style="display:flex;position:relative;flex-shrink:0;"><img src="${escapeHtml(avatar)}" width="188" height="188" style="border-radius:94px;border:4px solid ${ACCENT};box-shadow:0 0 60px rgba(155,95,255,0.7);object-fit:cover;background:#1a0f2e;"/><div style="display:flex;position:absolute;bottom:-10px;left:14px;padding:6px 14px;border-radius:16px;background:linear-gradient(135deg,${ACCENT},${PINK});color:#fff;font-size:12px;font-weight:900;letter-spacing:2px;text-transform:uppercase;border:3px solid ${BG_DARK};">${maxed ? 'MAX LEVEL' : 'Level ' + level}</div></div>`
    : '';

  const firstName = (displayName.split(' ')[0] || displayName);

  const card = (
    `<div style="display:flex;width:1200px;height:630px;position:relative;background:linear-gradient(135deg,#14082a 0%,${BG_DARK} 100%);font-family:'Space Grotesk',system-ui,sans-serif;color:#fff;">`
    + `<div style="display:flex;position:absolute;left:-200px;top:-200px;width:900px;height:700px;background:radial-gradient(circle,rgba(155,95,255,0.45) 0%,rgba(155,95,255,0) 60%);border-radius:450px;"></div>`
    + `<div style="display:flex;position:absolute;right:-180px;bottom:-180px;width:900px;height:700px;background:radial-gradient(circle,rgba(236,72,153,0.35) 0%,rgba(236,72,153,0) 60%);border-radius:450px;"></div>`
    + `<div style="display:flex;flex-direction:column;justify-content:space-between;padding:56px 0 56px 64px;width:660px;height:100%;">`
      + `<div style="display:flex;align-items:center;">`
        + `<div style="display:flex;width:12px;height:12px;background:${ACCENT};border-radius:6px;margin-right:14px;"></div>`
        + `<div style="display:flex;color:#fff;font-weight:900;letter-spacing:3px;font-size:14px;margin-right:14px;">EMONAD</div>`
        + `<div style="display:flex;color:${TEXT_MUTED};font-weight:600;letter-spacing:2px;font-size:13px;">· emonad.lol</div>`
      + `</div>`
      + `<div style="display:flex;align-items:center;">`
        + avatarBlock
        + `<div style="display:flex;flex-direction:column;margin-left:28px;">`
          + `<div style="display:flex;font-size:44px;font-weight:900;line-height:1;color:#fff;">${escapeHtml(displayName)}</div>`
          + `<div style="display:flex;font-size:22px;font-weight:600;color:${TEXT_MUTED};margin-top:6px;">@${escapeHtml(xHandle)}</div>`
          + `<div style="display:flex;align-items:flex-end;margin-top:16px;">`
            + `<div style="display:flex;font-size:56px;font-weight:900;color:#fff;line-height:1;">${xp.toLocaleString('en-US')}</div>`
            + `<div style="display:flex;font-size:22px;font-weight:900;color:${ACCENT};letter-spacing:2px;margin-left:6px;margin-bottom:4px;">XP</div>`
          + `</div>`
          + `<div style="display:flex;font-size:12px;font-weight:800;color:${TEXT_MUTED};letter-spacing:4px;margin-top:6px;">TOTAL EMO XP EARNED</div>`
        + `</div>`
      + `</div>`
      + `<div style="display:flex;height:1px;"></div>`
    + `</div>`
    + `<div style="display:flex;flex-direction:column;justify-content:center;padding:56px 64px 56px 36px;width:540px;height:100%;border-left:1px solid rgba(155,95,255,0.3);">`
      + `<div style="display:flex;font-size:13px;font-weight:800;letter-spacing:5px;color:${TEXT_MUTED};">YOU'RE INVITED</div>`
      + `<div style="display:flex;font-size:60px;font-weight:900;line-height:0.95;letter-spacing:-1px;color:#fff;margin-top:14px;">Join ${escapeHtml(firstName)}</div>`
      + `<div style="display:flex;font-size:60px;font-weight:900;line-height:0.95;letter-spacing:-1px;margin-top:6px;background:linear-gradient(135deg,${ACCENT} 0%,${PINK} 100%);background-clip:text;color:transparent;-webkit-background-clip:text;-webkit-text-fill-color:transparent;">on emonad.lol</div>`
      + `<div style="display:flex;flex-direction:column;margin-top:18px;">`
        + `<div style="display:flex;font-size:18px;font-weight:800;color:#fff;line-height:1.4;">Sign up with X and grab 50 XP on us.</div>`
        + `<div style="display:flex;font-size:18px;font-weight:500;color:#d6c8f0;line-height:1.4;margin-top:2px;">Climb the leaderboard. Become emo.</div>`
      + `</div>`
      + `<div style="display:flex;align-self:flex-start;align-items:center;margin-top:18px;padding:14px 22px;border-radius:18px;background:linear-gradient(135deg,rgba(155,95,255,0.22) 0%,rgba(236,72,153,0.22) 100%);border:1px solid rgba(155,95,255,0.55);">`
        + `<div style="display:flex;align-items:flex-end;">`
          + `<div style="display:flex;font-size:42px;font-weight:900;color:#fff;line-height:1;">+50</div>`
          + `<div style="display:flex;font-size:18px;font-weight:900;color:${ACCENT};margin-left:4px;margin-bottom:3px;">XP</div>`
        + `</div>`
        + `<div style="display:flex;flex-direction:column;margin-left:14px;">`
          + `<div style="display:flex;font-size:12px;font-weight:800;letter-spacing:2px;color:${TEXT_MUTED};">SIGNUP BONUS</div>`
          + `<div style="display:flex;font-size:13px;font-weight:900;color:#fff;margin-top:2px;">via ${escapeHtml(displayName)}'s link</div>`
        + `</div>`
      + `</div>`
    + `</div>`
    + `</div>`
  );

  const img = new ImageResponse(card, {
    width: 1200,
    height: 630,
    // Space Grotesk lives on the main site; satori needs the font bytes
    // directly. We fetch from Google Fonts as a fallback that's free + CDN'd.
    // If you'd rather self-host, switch this to a fetch of your woff2 file.
    fonts: [
      await loadFont('https://fonts.gstatic.com/s/spacegrotesk/v15/V8mDoQDmQT-jzS3qJiYW7VYNvFnQqLrf6oaW.woff', 'Space Grotesk', 500),
      await loadFont('https://fonts.gstatic.com/s/spacegrotesk/v15/V8mDoQDmQT-jzS3qJiYW7VYNvFnVqLrf6oaW.woff', 'Space Grotesk', 900),
    ].filter(Boolean),
  });

  // Short edge cache (5 min) so PFP / XP changes show up quickly on the
  // next share. Workers Paid bills per-request not per-render, so we can
  // afford to re-render often; crawler bursts still get coalesced inside
  // a 5-min window which is plenty for cost containment.
  return new Response(img.body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  });
}

async function loadFont(url, name, weight) {
  try {
    const res = await fetch(url, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    return { name, data, weight, style: 'normal' };
  } catch {
    return null;
  }
}
