// emonad.lol — EMO Wallet
// Passkey EOA only (Category Labs Mera). No MetaMask / Phantom / injected wallets.
// Fund MON (consumer buy links — no partner/company KYB) · Send/Receive · Buy/Sell $EMO
// Private keys only in memory while unlocked. Never in localStorage.

import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  createSecp256k1SigningSession,
  getEvmAddress,
  isMeraError,
} from 'https://esm.sh/@category-labs/mera@0.1.0';
import { HDKey } from 'https://esm.sh/@scure/bip32@2.2.0';
import { entropyToMnemonic, mnemonicToSeedSync } from 'https://esm.sh/@scure/bip39@2.2.0';
import { wordlist } from 'https://esm.sh/@scure/bip39@2.2.0/wordlists/english.js';
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  encodeFunctionData,
  parseEther,
  parseUnits,
  formatUnits,
  getAddress,
  isAddress,
  erc20Abi,
  keccak256,
  serializeTransaction,
  serializeSignature,
  hashMessage,
  hashTypedData,
  hexToBytes,
  toHex,
} from 'https://esm.sh/viem@2.31.0';
import { toAccount } from 'https://esm.sh/viem@2.31.0/accounts';
import { hashAuthorization } from 'https://esm.sh/viem@2.31.0/utils';
import * as QRCodeNS from 'https://esm.sh/qrcode@1.5.4';
const QRCode = QRCodeNS.default || QRCodeNS;

/**
 * Same adapter as @category-labs/mera/viem — inlined so we use ONE viem copy
 * from esm.sh (peer-dep dual-copies break createWalletClient accounts).
 */
function toViemAccount(session) {
  const address = getEvmAddress(session.publicKey);
  async function signHash(hash) {
    const { compact, recovery } = await session.signDigest(hexToBytes(hash));
    return {
      r: toHex(compact.slice(0, 32)),
      s: toHex(compact.slice(32, 64)),
      v: BigInt(27 + recovery),
      yParity: recovery,
    };
  }
  const account = toAccount({
    address,
    async sign({ hash }) {
      return serializeSignature(await signHash(hash));
    },
    async signAuthorization(authorization) {
      const contract = authorization.contractAddress ?? authorization.address;
      const { chainId, nonce } = authorization;
      const signature = await signHash(hashAuthorization({ address: contract, chainId, nonce }));
      return { address: contract, chainId, nonce, ...signature };
    },
    async signMessage({ message }) {
      return serializeSignature(await signHash(hashMessage(message)));
    },
    async signTransaction(transaction, { serializer = serializeTransaction } = {}) {
      const signable = transaction.type === 'eip4844'
        ? { ...transaction, sidecars: false }
        : transaction;
      const signature = await signHash(keccak256(await serializer(signable)));
      return serializer(transaction, signature);
    },
    async signTypedData(typedData) {
      return serializeSignature(await signHash(hashTypedData(typedData)));
    },
  });
  return { ...account, publicKey: toHex(session.publicKey), source: 'mera' };
}

// ─── Config ─────────────────────────────────────────────────────────
function isLocalHost() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

const CONFIG = Object.freeze({
  RP_NAME: 'Emonad',
  get rpId() {
    return isLocalHost() ? location.hostname : 'emonad.lol';
  },
  PATH: "m/44'/60'/0'/0/0",
  MONAD_RPC: 'https://rpc.monad.xyz',
  MONAD_CHAIN_ID: 143,
  EXPLORER: 'https://monadvision.com',
  EMO_TOKEN: '0x81A224F8A62f52BdE942dBF23A56df77A10b7777',
  EMO_DECIMALS: 18,
  WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
  // Nad.fun mainnet (https://github.com/Naddotfun/contract-v3-abi)
  NAD_LENS: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
  NAD_DEX_ROUTER: '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137',
  NAD_BONDING_ROUTER: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22',
  // Nad.fun UI defaults to 10% (with 20/30 + custom). 1% is too tight for meme liquidity.
  DEFAULT_SLIPPAGE_BPS: 1000n, // 10%
  MIN_SLIPPAGE_BPS: 10n,       // 0.1%
  MAX_SLIPPAGE_BPS: 5000n,     // 50% hard cap
  // MoonPay only (consumer widget, no partner sign). mon_mon = MON on Monad.
  FUND_BUY_MOONPAY: 'https://buy.moonpay.com/?defaultCurrencyCode=mon_mon&theme=dark',
  BALANCE_POLL_MS: 12_000,
  FUND_POLL_MS: 4_000,
  FUND_POLL_FOR_MS: 180_000,
  /** Auto-lock signing session after this much idle unlock time */
  SESSION_IDLE_MS: 90_000,
  /** Max age of an unlocked session even if "active" */
  SESSION_MAX_MS: 10 * 60_000,
  TX_DEADLINE_SEC: 600,
  STORAGE_KEY: 'emo:wallet',
  SLIPPAGE_KEY: 'emo:walletSlippageBps',
});

const monadChain = defineChain({
  id: CONFIG.MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.MONAD_RPC] } },
  blockExplorers: { default: { name: 'MonadVision', url: CONFIG.EXPLORER } },
});

const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(CONFIG.MONAD_RPC),
});

const lensAbi = [
  {
    type: 'function',
    name: 'getAmountOut',
    stateMutability: 'view',
    inputs: [
      { name: '_token', type: 'address' },
      { name: '_amountIn', type: 'uint256' },
      { name: '_isBuy', type: 'bool' },
    ],
    outputs: [
      { name: 'router', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
    ],
  },
];

const nadRouterAbi = [
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMin', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
];

// ─── State ──────────────────────────────────────────────────────────
const state = {
  ready: false,
  address: null,
  session: null,
  credentialId: null,
  transports: null,
  mon: null,
  emo: null,
  monRaw: null,
  emoRaw: null,
  pollTimer: null,
  fundFastTimer: null,
  fundPollUntil: 0,
  busy: false,
  view: 'home', // home | receive | send | fund | buy | sell
  lastTx: null,
  toast: null,
  quote: null,
  quoteError: null,
  slippageBps: null, // bigint bps; loaded lazily
  slippageCustom: false,
  sessionOpenedAt: 0,
  lastActivityAt: 0,
  idleTimer: null,
  unlockInFlight: null,
};

// ─── Storage (public only — never keys) ─────────────────────────────
function isValidAddress(a) {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
}

/** WebAuthn credential id is base64 / base64url; keep bounded */
function isValidCredentialId(id) {
  if (id == null || id === undefined) return true; // optional
  if (typeof id !== 'string') return false;
  if (id.length < 8 || id.length > 1024) return false;
  return /^[A-Za-z0-9_+\-/=]+$/.test(id);
}

function sanitizeTransports(t) {
  if (!Array.isArray(t)) return undefined;
  const out = t
    .filter((x) => typeof x === 'string' && x.length < 64)
    .slice(0, 8);
  return out.length ? out : undefined;
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw || raw.length > 4096) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (!isValidAddress(o.address)) return null;
    // Drop legacy injected-wallet cache (passkey-only product now)
    if (o.mode && o.mode !== 'passkey') {
      try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch { /* ignore */ }
      return null;
    }
    if (o.credentialId != null && !isValidCredentialId(o.credentialId)) {
      try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch { /* ignore */ }
      return null;
    }
    let addr;
    try { addr = getAddress(o.address); } catch { return null; }
    return {
      address: addr,
      mode: 'passkey',
      credentialId: o.credentialId || undefined,
      transports: sanitizeTransports(o.transports),
    };
  } catch {
    return null;
  }
}

function saveCache(partial) {
  try {
    const prev = loadCache() || {};
    const next = { ...prev, ...partial };
    if (!isValidAddress(next.address) && next.address) {
      try { next.address = getAddress(next.address); } catch { return; }
    }
    if (next.credentialId != null && !isValidCredentialId(next.credentialId)) {
      next.credentialId = undefined;
    }
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
      address: next.address,
      mode: 'passkey',
      credentialId: next.credentialId || undefined,
      transports: sanitizeTransports(next.transports),
    }));
  } catch { /* ignore */ }
}

function clearCache() {
  try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch { /* ignore */ }
}

// ─── HD / Passkey ───────────────────────────────────────────────────
function deriveEvmFromPrf(prfOutput) {
  let seed;
  try {
    const mnemonic = entropyToMnemonic(prfOutput, wordlist);
    seed = mnemonicToSeedSync(mnemonic);
    const node = HDKey.fromMasterSeed(seed).derive(CONFIG.PATH);
    if (!node.privateKey) throw new Error('derivation produced no key');
    const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
    try { node.privateKey.fill(0); } catch { /* ignore */ }
    const address = getEvmAddress(session.publicKey);
    return { session, address };
  } finally {
    try { prfOutput.fill(0); } catch { /* ignore */ }
    try { if (seed) seed.fill(0); } catch { /* ignore */ }
  }
}

async function createPasskeyWallet() {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: CONFIG.rpId, name: CONFIG.RP_NAME },
    user: {
      name: 'emo@emonad.lol',
      displayName: 'EMO Wallet',
    },
  });
  const { session, address } = deriveEvmFromPrf(created.prfOutput);
  return {
    session,
    address,
    credentialId: created.credentialId,
    transports: created.transports,
  };
}

async function restorePasskeyWallet() {
  const cached = loadCache();
  const known = cached?.credentialId
    ? { credentialId: cached.credentialId, transports: cached.transports }
    : undefined;

  if (known) {
    try {
      const got = await getPasskeyPrfOutput({ rpId: CONFIG.rpId, credential: known });
      const { session, address } = deriveEvmFromPrf(got.prfOutput);
      return {
        session,
        address,
        credentialId: got.credentialId,
        transports: known.transports,
      };
    } catch (e) {
      console.warn('emo-wallet: pinned passkey restore failed, trying discoverable', e);
    }
  }

  const got = await getPasskeyPrfOutput({ rpId: CONFIG.rpId });
  const { session, address } = deriveEvmFromPrf(got.prfOutput);
  return {
    session,
    address,
    credentialId: got.credentialId,
    transports: got.transports,
  };
}

function isUserCancel(err) {
  if (!err) return false;
  if (err.name === 'NotAllowedError' || err.name === 'AbortError') return true;
  const msg = String(err.message || '').toLowerCase();
  if (/cancel|denied|abort|not allowed/.test(msg)) return true;
  if (isMeraError?.(err) && err.code === 'PASSKEY_OPERATION_FAILED' && /cancel/i.test(err.message || '')) {
    return true;
  }
  return false;
}

function describeError(err) {
  if (isMeraError?.(err)) {
    switch (err.code) {
      case 'PRF_UNAVAILABLE':
        return 'This device can’t do passkey crypto (PRF). Use Safari + iCloud Keychain, Chrome signed into Google Password Manager, 1Password, or Windows Hello on recent Windows 11. Desktop Chrome “local profile only” passkeys won’t work.';
      case 'PASSKEY_OPERATION_FAILED':
        return 'Passkey was cancelled or failed. Try again.';
      case 'CRYPTO_UNAVAILABLE':
        return 'Web Crypto is missing — open this site over HTTPS or localhost.';
      case 'SESSION_ENDED':
        return 'Session locked. Unlock with your passkey to sign.';
      default:
        return err.message || 'Passkey error.';
    }
  }
  const msg = err?.shortMessage || err?.message || String(err);
  if (/user rejected|denied/i.test(msg)) return 'Request cancelled.';
  if (/insufficient funds|exceeds balance/i.test(msg)) return 'Not enough balance for this amount + gas.';
  if (/slippage|InsufficientOutput|InsufficientAmountOut/i.test(msg)) return 'Price moved past your slippage. Try a higher slippage or a smaller size.';
  if (/deadline|expired/i.test(msg)) return 'Transaction timed out. Try again.';
  if (/network|fetch|rpc|timeout/i.test(msg)) return 'Network hiccup. Check your connection and try again.';
  return msg;
}

// ─── Formatting ─────────────────────────────────────────────────────
function shortAddr(a) {
  if (!a || a.length < 12) return a || '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDisplay(raw, decimals = 18, maxFrac = 6) {
  try {
    const n = typeof raw === 'bigint' ? raw : BigInt(raw ?? 0);
    let s = formatUnits(n, decimals);
    if (!s.includes('.')) return s;
    const [w, f] = s.split('.');
    const frac = f.slice(0, maxFrac).replace(/0+$/, '');
    return frac ? `${w}.${frac}` : w;
  } catch {
    return '—';
  }
}

function parseAmountInput(str, decimals = 18) {
  const t = String(str || '').trim().replace(/,/g, '');
  if (!t || !/^\d*\.?\d+$/.test(t)) throw new Error('Enter a valid amount.');
  return parseUnits(t, decimals);
}

// ─── Session / balances ─────────────────────────────────────────────
function clearIdleTimer() {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
}

function touchActivity() {
  state.lastActivityAt = Date.now();
  scheduleIdleLock();
}

function scheduleIdleLock() {
  clearIdleTimer();
  if (!state.session) return;
  state.idleTimer = setTimeout(() => {
    if (state.busy) {
      // Don't lock mid-tx; reschedule
      scheduleIdleLock();
      return;
    }
    if (!state.session) return;
    const idleFor = Date.now() - (state.lastActivityAt || 0);
    const openFor = Date.now() - (state.sessionOpenedAt || 0);
    if (idleFor >= CONFIG.SESSION_IDLE_MS || openFor >= CONFIG.SESSION_MAX_MS) {
      lockSession();
      if (isWalletOpen() && state.view === 'home') {
        state.toast = 'Session locked for safety. Unlock to sign again.';
        renderHome();
      }
    } else {
      scheduleIdleLock();
    }
  }, Math.min(5_000, CONFIG.SESSION_IDLE_MS));
}

function lockSession() {
  clearIdleTimer();
  try { state.session?.end?.(); } catch { /* ignore */ }
  state.session = null;
  state.sessionOpenedAt = 0;
  state.lastActivityAt = 0;
  state.unlockInFlight = null;
}

function setActiveWallet({ address, session, credentialId, transports }) {
  // End previous session only (don't end the session we're about to assign).
  const prev = state.session;
  if (prev && prev !== session) {
    try { prev.end?.(); } catch { /* ignore */ }
  }
  let addr = address;
  try { addr = getAddress(address); } catch {
    throw new Error('Invalid wallet address.');
  }
  state.address = addr;
  state.session = session || null;
  state.credentialId = isValidCredentialId(credentialId) ? credentialId : null;
  state.transports = sanitizeTransports(transports) || null;
  state.mon = null;
  state.emo = null;
  state.monRaw = null;
  state.emoRaw = null;
  if (session) {
    state.sessionOpenedAt = Date.now();
    touchActivity();
  } else {
    clearIdleTimer();
    state.sessionOpenedAt = 0;
  }
  saveCache({ address: addr, credentialId: state.credentialId, transports: state.transports });
  startBalancePoll();
}

function forgetWallet() {
  lockSession();
  stopBalancePoll();
  clearCache();
  state.address = null;
  state.credentialId = null;
  state.transports = null;
  state.mon = null;
  state.emo = null;
  state.monRaw = null;
  state.emoRaw = null;
  state.lastTx = null;
  state.quote = null;
  state._sendDraft = null;
  state._buyDraft = null;
  state._sellDraft = null;
}

function startBalancePoll() {
  stopBalancePoll();
  refreshBalances();
  state.pollTimer = setInterval(() => refreshBalances(), CONFIG.BALANCE_POLL_MS);
  if (state.fundPollUntil > Date.now()) {
    state.fundFastTimer = setInterval(() => {
      if (Date.now() > state.fundPollUntil) {
        if (state.fundFastTimer) {
          clearInterval(state.fundFastTimer);
          state.fundFastTimer = null;
        }
        state.fundPollUntil = 0;
        return;
      }
      refreshBalances();
    }, CONFIG.FUND_POLL_MS);
  }
}

function stopBalancePoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.fundFastTimer) {
    clearInterval(state.fundFastTimer);
    state.fundFastTimer = null;
  }
}

function turboPollBalances(ms = CONFIG.FUND_POLL_FOR_MS) {
  state.fundPollUntil = Date.now() + ms;
  startBalancePoll();
}

async function refreshBalances() {
  if (!state.address) return;
  try {
    const addr = getAddress(state.address);
    const [monRaw, emoRaw] = await Promise.all([
      publicClient.getBalance({ address: addr }),
      publicClient.readContract({
        address: CONFIG.EMO_TOKEN,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [addr],
      }),
    ]);
    state.monRaw = monRaw;
    state.emoRaw = emoRaw;
    state.mon = formatDisplay(monRaw, 18, 6);
    state.emo = formatDisplay(emoRaw, CONFIG.EMO_DECIMALS, 4);
    // Only paint if home (or any view) still shows balance nodes for this wallet
    const monEl = document.getElementById('ewMonBal');
    const emoEl = document.getElementById('ewEmoBal');
    if (monEl) monEl.textContent = state.mon;
    if (emoEl) emoEl.textContent = state.emo;
  } catch (e) {
    console.warn('emo-wallet: balance fetch failed', e);
    if (state.mon == null) state.mon = '—';
    if (state.emo == null) state.emo = '—';
  }
}

/**
 * Unlock passkey if session missing. Returns true if ready to sign.
 * If UI already shows a cached address, the unlocked passkey MUST match it
 * (prevents signing a different wallet than the user thinks they're using).
 * Concurrent unlocks share one in-flight promise.
 */
async function ensureUnlocked() {
  if (state.session && state.address) {
    // Enforce max session age
    if (state.sessionOpenedAt && Date.now() - state.sessionOpenedAt > CONFIG.SESSION_MAX_MS) {
      lockSession();
    } else {
      touchActivity();
      return true;
    }
  }
  if (state.unlockInFlight) return state.unlockInFlight;

  state.unlockInFlight = (async () => {
    renderLoading('Unlock with passkey…');
    const expected = state.address ? getAddress(state.address) : null;
    const wallet = await restorePasskeyWallet();
    let unlockedAddr;
    try {
      unlockedAddr = getAddress(wallet.address);
    } catch {
      throw new Error('Passkey returned an invalid address.');
    }
    if (expected && unlockedAddr !== expected) {
      throw new Error(
        `That passkey opens ${shortAddr(unlockedAddr)}, but this device is set to ${shortAddr(expected)}. ` +
        'Use the same passkey as before, or Forget this wallet and open the correct one.'
      );
    }
    setActiveWallet({
      address: unlockedAddr,
      session: wallet.session,
      credentialId: wallet.credentialId,
      transports: wallet.transports,
    });
    return true;
  })();

  try {
    return await state.unlockInFlight;
  } finally {
    state.unlockInFlight = null;
  }
}

function walletClientFromSession() {
  if (!state.session || !state.address) throw new Error('Wallet locked. Unlock first.');
  if (state.sessionOpenedAt && Date.now() - state.sessionOpenedAt > CONFIG.SESSION_MAX_MS) {
    lockSession();
    throw new Error('Session expired. Unlock again to sign.');
  }
  const account = toViemAccount(state.session);
  // Belt-and-suspenders: derived account must match UI address
  try {
    if (getAddress(account.address) !== getAddress(state.address)) {
      lockSession();
      throw new Error('Session address mismatch. Lock and unlock again.');
    }
  } catch (e) {
    if (e.message?.includes('mismatch') || e.message?.includes('expired')) throw e;
    lockSession();
    throw new Error('Session address mismatch. Lock and unlock again.');
  }
  touchActivity();
  return createWalletClient({
    account,
    chain: monadChain,
    transport: http(CONFIG.MONAD_RPC),
  });
}

/** Fail closed if RPC is not Monad mainnet (chain id 143). */
async function assertMonadChain() {
  try {
    const id = await publicClient.getChainId();
    if (Number(id) !== CONFIG.MONAD_CHAIN_ID) {
      throw new Error(`Wrong network from RPC (got chain ${id}, need Monad ${CONFIG.MONAD_CHAIN_ID}).`);
    }
  } catch (e) {
    if (e.message?.includes('Wrong network')) throw e;
    throw new Error('Could not verify Monad network. Check your connection and try again.');
  }
}

async function sendTx(fn) {
  await assertMonadChain();
  touchActivity();
  const client = walletClientFromSession();
  const hash = await fn(client);
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error('Unexpected transaction response. Not broadcasting further.');
  }
  state.lastTx = hash;
  turboPollBalances(90_000);
  return hash;
}

/** Lock signing material after a successful outbound tx (keys only needed to sign). */
function lockAfterTx() {
  lockSession();
}

// ─── Fund (consumer buy — no partner company) ───────────────────────
// Mera passkey wallets are normal secp256k1 EOAs (0x…). Any MON-on-Monad
// on-ramp / CEX withdrawal to this address funds the same wallet.
async function copyWalletAddress() {
  if (!state.address) return false;
  try {
    await navigator.clipboard.writeText(state.address);
    return true;
  } catch {
    return false;
  }
}

function openFundProvider(url) {
  const safe = assertFundUrl(url);
  // Copy first so paste is ready on the buy site.
  copyWalletAddress();
  turboPollBalances();
  return window.open(safe, '_blank', 'noopener,noreferrer');
}

// ─── Nad.fun quotes / swaps ─────────────────────────────────────────
/** Only these routers may receive value / approvals. Never trust Lens blindly. */
function allowedNadRouters() {
  return new Set([
    getAddress(CONFIG.NAD_DEX_ROUTER),
    getAddress(CONFIG.NAD_BONDING_ROUTER),
  ]);
}

function assertAllowedRouter(router) {
  let addr;
  try {
    addr = getAddress(router);
  } catch {
    throw new Error('Invalid swap router from quote.');
  }
  if (addr === '0x0000000000000000000000000000000000000000') {
    throw new Error('No Nad.fun route for $EMO right now. Try again in a moment.');
  }
  if (!allowedNadRouters().has(addr)) {
    console.error('emo-wallet: blocked unexpected router', addr);
    throw new Error('Blocked unexpected swap router. Refresh and try again — if this keeps happening, stop and tell us.');
  }
  return addr;
}

/** Only MoonPay buy (consumer). Reject anything else even if UI is tampered. */
function assertFundUrl(url) {
  let u;
  try {
    u = new URL(url, location.href);
  } catch {
    throw new Error('Invalid fund link.');
  }
  if (u.protocol !== 'https:') throw new Error('Fund link must be HTTPS.');
  const host = u.hostname.toLowerCase();
  // buy.moonpay.com only — not arbitrary moonpay subdomains / open redirects
  if (host !== 'buy.moonpay.com') {
    throw new Error('Blocked unexpected fund provider.');
  }
  return u.toString();
}

function explorerTxUrl(hash) {
  // Defense in depth: only append hex-looking hashes
  const h = String(hash || '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return CONFIG.EXPLORER;
  return `${CONFIG.EXPLORER}/tx/${h}`;
}

async function quoteNad({ amountIn, isBuy }) {
  const [router, amountOut] = await publicClient.readContract({
    address: CONFIG.NAD_LENS,
    abi: lensAbi,
    functionName: 'getAmountOut',
    args: [CONFIG.EMO_TOKEN, amountIn, isBuy],
  });
  // Validate early so quotes fail closed if Lens ever returns garbage
  const safeRouter = assertAllowedRouter(router);
  return { router: safeRouter, amountOut };
}

function loadSlippageBps() {
  if (state.slippageBps != null) return state.slippageBps;
  try {
    const raw = localStorage.getItem(CONFIG.SLIPPAGE_KEY);
    if (raw != null) {
      const n = BigInt(raw);
      if (n >= CONFIG.MIN_SLIPPAGE_BPS && n <= CONFIG.MAX_SLIPPAGE_BPS) {
        state.slippageBps = n;
        // Treat non-preset as custom
        const presets = new Set([1000n, 2000n, 3000n]);
        state.slippageCustom = !presets.has(n);
        return n;
      }
    }
  } catch { /* ignore */ }
  state.slippageBps = CONFIG.DEFAULT_SLIPPAGE_BPS;
  state.slippageCustom = false;
  return state.slippageBps;
}

function setSlippageBps(bps, { custom = false } = {}) {
  let n = typeof bps === 'bigint' ? bps : BigInt(bps);
  if (n < CONFIG.MIN_SLIPPAGE_BPS) n = CONFIG.MIN_SLIPPAGE_BPS;
  if (n > CONFIG.MAX_SLIPPAGE_BPS) n = CONFIG.MAX_SLIPPAGE_BPS;
  state.slippageBps = n;
  state.slippageCustom = custom;
  try { localStorage.setItem(CONFIG.SLIPPAGE_KEY, String(n)); } catch { /* ignore */ }
}

function getSlippageBps() {
  return loadSlippageBps();
}

function slippagePctLabel(bps = getSlippageBps()) {
  const n = Number(bps);
  if (!Number.isFinite(n)) return '—';
  // Show clean ints when whole percent, else one decimal
  const pct = n / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

function applySlippage(amountOut) {
  const bps = getSlippageBps();
  return (amountOut * (10000n - bps)) / 10000n;
}

/** Slippage control HTML for buy/sell views */
function slippageControlsHtml() {
  loadSlippageBps();
  const bps = getSlippageBps();
  const custom = state.slippageCustom;
  const on = (v) => (!custom && bps === v ? ' on' : '');
  const customVal = custom ? String(Number(bps) / 100) : '';
  return `
    <div class="emo-wallet-field" style="margin-bottom:10px">
      <label><span>Slippage</span><span style="opacity:0.75;text-transform:none;letter-spacing:0">${escapeHtml(slippagePctLabel())}</span></label>
      <div class="emo-wallet-seg emo-wallet-slip" role="group" aria-label="Slippage">
        <button type="button" class="${on(1000n)}" data-ew-slip="1000">10%</button>
        <button type="button" class="${on(2000n)}" data-ew-slip="2000">20%</button>
        <button type="button" class="${on(3000n)}" data-ew-slip="3000">30%</button>
        <button type="button" class="${custom ? ' on' : ''}" data-ew-slip="custom">Custom</button>
      </div>
      <input type="text" id="ewSlipCustom" class="emo-wallet-slip-custom${custom ? ' show' : ''}"
        inputmode="decimal" placeholder="e.g. 15" value="${escapeHtml(customVal)}"
        aria-label="Custom slippage percent" ${custom ? '' : 'hidden'} />
    </div>
  `;
}

async function waitReceiptOk(hash, label = 'Transaction') {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status === 'reverted') {
    throw new Error(`${label} failed on-chain.`);
  }
  return receipt;
}

async function approveEmoExact(owner, routerAddr, amount) {
  const token = getAddress(CONFIG.EMO_TOKEN);
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, routerAddr],
  });
  if (allowance >= amount) return;

  // USDT-style tokens need approve(0) before a non-zero change when allowance != 0
  if (allowance > 0n) {
    renderLoading('Resetting $EMO allowance…');
    const zeroHash = await sendTx((client) => client.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [routerAddr, 0n],
      chain: monadChain,
    }));
    renderLoading('Waiting for reset…');
    await waitReceiptOk(zeroHash, 'Allowance reset');
  }

  renderLoading('Approve $EMO for this sell…');
  // Exact amount only — never maxUint256
  const approveHash = await sendTx((client) => client.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [routerAddr, amount],
    chain: monadChain,
  }));
  renderLoading('Waiting for approve…');
  await waitReceiptOk(approveHash, 'Approve');

  // Re-read allowance so we never sell without spend rights
  const after = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, routerAddr],
  });
  if (after < amount) {
    throw new Error('Approve succeeded but allowance is still too low. Try again.');
  }
}

async function buyEmoWithMon(monIn) {
  const to = getAddress(state.address);
  if (monIn <= 0n) throw new Error('Invalid buy amount.');
  await assertMonadChain();
  const { router, amountOut } = await quoteNad({ amountIn: monIn, isBuy: true });
  // quoteNad already allowlists router
  if (amountOut <= 0n) throw new Error('Quote returned zero. Try a larger amount.');
  const amountOutMin = applySlippage(amountOut);
  if (amountOutMin <= 0n) throw new Error('Min received is zero — lower size or check slippage.');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + CONFIG.TX_DEADLINE_SEC);
  const token = getAddress(CONFIG.EMO_TOKEN);
  const data = encodeFunctionData({
    abi: nadRouterAbi,
    functionName: 'buy',
    args: [{
      amountOutMin,
      token,
      to,
      deadline,
    }],
  });
  return sendTx((client) => client.sendTransaction({
    to: router,
    data,
    value: monIn,
    chain: monadChain,
  }));
}

async function sellEmoForMon(emoIn) {
  const owner = getAddress(state.address);
  if (emoIn <= 0n) throw new Error('Invalid sell amount.');
  await assertMonadChain();
  const { router, amountOut } = await quoteNad({ amountIn: emoIn, isBuy: false });
  if (amountOut <= 0n) throw new Error('Quote returned zero. Try a larger amount.');
  const amountOutMin = applySlippage(amountOut);
  if (amountOutMin <= 0n) throw new Error('Min received is zero — lower size or check slippage.');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + CONFIG.TX_DEADLINE_SEC);
  const routerAddr = router; // already checksummed + allowlisted
  const token = getAddress(CONFIG.EMO_TOKEN);

  await approveEmoExact(owner, routerAddr, emoIn);
  renderLoading('Selling $EMO…');

  const data = encodeFunctionData({
    abi: nadRouterAbi,
    functionName: 'sell',
    args: [{
      amountIn: emoIn,
      amountOutMin,
      token,
      to: owner,
      deadline,
    }],
  });
  return sendTx((client) => client.sendTransaction({
    to: routerAddr,
    data,
    value: 0n,
    chain: monadChain,
  }));
}

async function sendNative(to, amountWei) {
  if (amountWei <= 0n) throw new Error('Invalid amount.');
  return sendTx((client) => client.sendTransaction({
    to: getAddress(to),
    value: amountWei,
    chain: monadChain,
  }));
}

async function sendEmo(to, amount) {
  if (amount <= 0n) throw new Error('Invalid amount.');
  return sendTx((client) => client.writeContract({
    address: getAddress(CONFIG.EMO_TOKEN),
    abi: erc20Abi,
    functionName: 'transfer',
    args: [getAddress(to), amount],
    chain: monadChain,
  }));
}

// ─── Styles ─────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('emo-wallet-styles')) return;
  const css = `
    .emo-wallet-overlay {
      position: fixed; inset: 0; z-index: 10050;
      background: rgba(6, 4, 12, 0.82);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      display: flex; align-items: center; justify-content: center;
      padding: max(12px, env(safe-area-inset-top)) 14px max(14px, env(safe-area-inset-bottom));
      opacity: 0; pointer-events: none; transition: opacity 0.22s ease;
    }
    .emo-wallet-overlay.open { opacity: 1; pointer-events: auto; }
    .emo-wallet-panel {
      width: min(420px, 100%);
      max-height: min(92vh, 840px);
      overflow: auto;
      overscroll-behavior: contain;
      background: linear-gradient(165deg, rgba(30, 18, 52, 0.99), rgba(10, 7, 20, 0.995));
      border: 1px solid rgba(155, 95, 255, 0.32);
      border-radius: 22px;
      padding: 22px 18px 16px;
      box-shadow:
        0 28px 80px rgba(0,0,0,0.55),
        0 0 0 1px rgba(255,255,255,0.04) inset,
        0 0 60px rgba(155,95,255,0.08);
      color: var(--text-color, #f4eefc);
      font-family: 'Space Grotesk', system-ui, sans-serif;
      position: relative;
      transform: translateY(8px) scale(0.98);
      opacity: 0.96;
      transition: transform 0.22s ease, opacity 0.22s ease;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: rgba(155,95,255,0.35) transparent;
    }
    .emo-wallet-overlay.open .emo-wallet-panel {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
    .emo-wallet-panel.has-back { padding-top: 52px; }
    [data-theme="light"] .emo-wallet-panel {
      background: linear-gradient(165deg, rgba(255,255,255,0.99), rgba(246, 240, 255, 0.99));
      color: #1a1028;
      border-color: rgba(155, 95, 255, 0.28);
      box-shadow: 0 24px 60px rgba(40,20,80,0.14), 0 0 0 1px rgba(255,255,255,0.6) inset;
    }
    .emo-wallet-close, .emo-wallet-back {
      position: absolute; top: 12px;
      height: 34px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06);
      color: inherit; cursor: pointer; font-family: inherit;
      transition: border-color 0.15s, background 0.15s, opacity 0.15s;
    }
    [data-theme="light"] .emo-wallet-close,
    [data-theme="light"] .emo-wallet-back {
      border-color: rgba(0,0,0,0.1); background: rgba(0,0,0,0.04);
    }
    .emo-wallet-close {
      right: 12px; width: 34px; font-size: 20px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .emo-wallet-back {
      left: 12px; padding: 0 12px; font-size: 13px; font-weight: 600;
    }
    .emo-wallet-close:hover, .emo-wallet-back:hover {
      border-color: var(--accent, #9B5FFF);
      background: rgba(155,95,255,0.12);
    }
    .emo-wallet-close:focus-visible, .emo-wallet-back:focus-visible,
    .emo-wallet-btn:focus-visible, .emo-wallet-copy:focus-visible,
    .emo-wallet-chip:focus-visible, .emo-wallet-max:focus-visible,
    .emo-wallet-seg button:focus-visible, .emo-wallet-field input:focus-visible {
      outline: 2px solid rgba(155,95,255,0.7);
      outline-offset: 2px;
    }
    .emo-wallet-kicker {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      font-size: 11px; letter-spacing: 0.11em; text-transform: uppercase;
      color: var(--accent, #9B5FFF); font-weight: 700; margin: 0 0 8px; padding-right: 40px;
    }
    .emo-wallet-pill {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 10px; letter-spacing: 0.06em; font-weight: 700;
      padding: 3px 8px; border-radius: 999px;
      border: 1px solid transparent;
    }
    .emo-wallet-pill::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: currentColor; box-shadow: 0 0 8px currentColor;
    }
    .emo-wallet-pill.on {
      color: #6ee7b7; background: rgba(52,211,153,0.1);
      border-color: rgba(52,211,153,0.3);
    }
    .emo-wallet-pill.off {
      color: #fcd34d; background: rgba(251,191,36,0.1);
      border-color: rgba(251,191,36,0.3);
    }
    [data-theme="light"] .emo-wallet-pill.on { color: #047857; }
    [data-theme="light"] .emo-wallet-pill.off { color: #b45309; }
    .emo-wallet-title {
      font-size: 22px; font-weight: 700; margin: 0 0 8px; line-height: 1.22;
      letter-spacing: -0.02em;
    }
    .emo-wallet-msg { font-size: 13.5px; opacity: 0.84; margin: 0 0 14px; line-height: 1.55; }
    .emo-wallet-msg strong { opacity: 1; font-weight: 700; }
    .emo-wallet-error {
      background: rgba(236, 72, 153, 0.12); border: 1px solid rgba(236, 72, 153, 0.35);
      color: #ffb3d4; border-radius: 12px; padding: 10px 12px; font-size: 13px;
      margin-bottom: 12px; line-height: 1.45;
    }
    [data-theme="light"] .emo-wallet-error { color: #9f1239; background: rgba(236,72,153,0.08); }
    .emo-wallet-ok {
      background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.35);
      color: #6ee7b7; border-radius: 12px; padding: 10px 12px; font-size: 13px;
      margin-bottom: 12px; line-height: 1.45;
    }
    [data-theme="light"] .emo-wallet-ok { color: #047857; }
    .emo-wallet-addr-row {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px; padding: 10px 10px 10px 12px; margin-bottom: 12px;
    }
    [data-theme="light"] .emo-wallet-addr-row { background: rgba(0,0,0,0.035); border-color: rgba(0,0,0,0.08); }
    .emo-wallet-addr {
      flex: 1; min-width: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12.5px; word-break: break-all; line-height: 1.4;
    }
    .emo-wallet-addr.short { word-break: normal; letter-spacing: 0.01em; }
    .emo-wallet-copy, .emo-wallet-chip {
      flex-shrink: 0; height: 32px; padding: 0 12px; border-radius: 999px;
      border: 1px solid rgba(155,95,255,0.4); background: rgba(155,95,255,0.15);
      color: inherit; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
      text-decoration: none; display: inline-flex; align-items: center; justify-content: center;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .emo-wallet-copy:hover, .emo-wallet-chip:hover { background: rgba(155,95,255,0.28); }
    .emo-wallet-copy.copied { border-color: rgba(52,211,153,0.55); color: #6ee7b7; background: rgba(52,211,153,0.12); }
    .emo-wallet-bals {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px;
    }
    .emo-wallet-bal {
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px; padding: 12px 12px 11px;
      min-height: 68px;
    }
    [data-theme="light"] .emo-wallet-bal { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.06); }
    .emo-wallet-bal label {
      display: block; font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase;
      opacity: 0.55; margin-bottom: 6px; font-weight: 600;
    }
    .emo-wallet-bal strong {
      font-size: 17px; font-weight: 700; letter-spacing: -0.02em;
      word-break: break-all; line-height: 1.2;
    }
    .emo-wallet-actions { display: flex; flex-direction: column; gap: 8px; }
    .emo-wallet-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .emo-wallet-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      height: 46px; border-radius: 999px; font-weight: 700; font-size: 14px;
      cursor: pointer; border: none; font-family: inherit; text-decoration: none;
      transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s, box-shadow 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    .emo-wallet-btn:hover:not(:disabled) { transform: translateY(-1px); }
    .emo-wallet-btn:active:not(:disabled) { transform: scale(0.98); }
    .emo-wallet-btn:disabled { opacity: 0.48; cursor: not-allowed; transform: none; }
    .emo-wallet-btn-primary {
      background: linear-gradient(135deg, rgba(155,95,255,0.98), rgba(123,63,228,0.98));
      color: #fff; box-shadow: 0 8px 22px rgba(155,95,255,0.38);
    }
    .emo-wallet-btn-primary:hover:not(:disabled) {
      box-shadow: 0 10px 28px rgba(155,95,255,0.48);
    }
    .emo-wallet-btn-secondary {
      background: rgba(155,95,255,0.12); color: inherit;
      border: 1.5px solid rgba(155,95,255,0.45);
    }
    .emo-wallet-btn-secondary:hover:not(:disabled) {
      background: rgba(155,95,255,0.2);
    }
    .emo-wallet-btn-ghost {
      background: transparent; color: inherit; opacity: 0.72; height: 40px; font-weight: 600; font-size: 13px;
    }
    .emo-wallet-btn-ghost:hover:not(:disabled) { opacity: 1; background: rgba(255,255,255,0.04); }
    [data-theme="light"] .emo-wallet-btn-ghost:hover:not(:disabled) { background: rgba(0,0,0,0.04); }
    .emo-wallet-btn-danger {
      background: rgba(236,72,153,0.1); border: 1px solid rgba(236,72,153,0.35);
      color: #ffb3d4; height: 40px; font-size: 13px; font-weight: 600;
    }
    .emo-wallet-btn-danger:hover:not(:disabled) { background: rgba(236,72,153,0.18); }
    [data-theme="light"] .emo-wallet-btn-danger { color: #be185d; }
    .emo-wallet-foot {
      margin: 14px 0 2px; font-size: 11px; line-height: 1.5; opacity: 0.48; text-align: center;
    }
    .emo-wallet-foot.left { text-align: left; opacity: 0.55; }
    .emo-wallet-loading {
      text-align: center; padding: 36px 10px 28px; font-size: 14px; opacity: 0.85;
    }
    .emo-wallet-spinner {
      width: 30px; height: 30px; margin: 0 auto 14px;
      border-radius: 50%;
      border: 2.5px solid rgba(155,95,255,0.22);
      border-top-color: var(--accent, #9B5FFF);
      animation: ew-spin 0.7s linear infinite;
    }
    @keyframes ew-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .emo-wallet-spinner { animation: none; border-top-color: rgba(155,95,255,0.5); }
      .emo-wallet-panel, .emo-wallet-overlay { transition: none; }
      .emo-wallet-overlay.open .emo-wallet-panel { transform: none; }
    }
    .emo-wallet-field { margin-bottom: 12px; }
    .emo-wallet-field label {
      display: flex; justify-content: space-between; align-items: baseline;
      font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
      opacity: 0.62; margin-bottom: 6px; font-weight: 600;
    }
    .emo-wallet-field input, .emo-wallet-field select {
      width: 100%; box-sizing: border-box;
      height: 48px; border-radius: 14px; padding: 0 14px;
      border: 1px solid rgba(155,95,255,0.28);
      background: rgba(255,255,255,0.05); color: inherit;
      font: inherit; font-size: 16px; font-weight: 600;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    [data-theme="light"] .emo-wallet-field input,
    [data-theme="light"] .emo-wallet-field select {
      background: rgba(0,0,0,0.03); border-color: rgba(155,95,255,0.25);
    }
    .emo-wallet-field input:focus {
      border-color: rgba(155,95,255,0.75);
      box-shadow: 0 0 0 3px rgba(155,95,255,0.16);
    }
    .emo-wallet-field input::placeholder { opacity: 0.32; font-weight: 500; }
    .emo-wallet-max {
      background: none; border: none; color: var(--accent, #9B5FFF);
      font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; padding: 0;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .emo-wallet-max:hover { text-decoration: underline; text-underline-offset: 2px; }
    .emo-wallet-quote {
      background: rgba(155,95,255,0.08); border: 1px solid rgba(155,95,255,0.22);
      border-radius: 14px; padding: 12px 14px; font-size: 13px; line-height: 1.5; margin-bottom: 12px;
    }
    .emo-wallet-quote strong { font-weight: 700; }
    .emo-wallet-quote .sub { display: block; margin-top: 4px; opacity: 0.68; font-size: 12px; }
    .emo-wallet-confirm-card {
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px; padding: 12px 14px; margin-bottom: 14px; font-size: 13.5px; line-height: 1.5;
    }
    [data-theme="light"] .emo-wallet-confirm-card {
      background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.08);
    }
    .emo-wallet-confirm-card .row {
      display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px;
    }
    .emo-wallet-confirm-card .row:last-child { margin-bottom: 0; }
    .emo-wallet-confirm-card .lbl { opacity: 0.55; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
    .emo-wallet-confirm-card .val { font-weight: 700; text-align: right; word-break: break-all; }
    .emo-wallet-qr {
      display: flex; justify-content: center; margin: 4px 0 14px;
    }
    .emo-wallet-qr img, .emo-wallet-qr canvas {
      width: 188px; height: 188px; border-radius: 16px;
      background: #fff; padding: 12px; box-sizing: border-box;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    }
    .emo-wallet-seg {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
      background: rgba(255,255,255,0.05); border-radius: 14px; padding: 4px; margin-bottom: 14px;
    }
    .emo-wallet-seg.emo-wallet-slip {
      grid-template-columns: repeat(4, 1fr); margin-bottom: 8px;
    }
    [data-theme="light"] .emo-wallet-seg { background: rgba(0,0,0,0.05); }
    .emo-wallet-seg button {
      height: 38px; border: none; border-radius: 11px; background: transparent;
      color: inherit; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; opacity: 0.6;
      transition: background 0.15s, opacity 0.15s, box-shadow 0.15s;
    }
    .emo-wallet-seg.emo-wallet-slip button { font-size: 12px; height: 36px; padding: 0 2px; }
    .emo-wallet-seg button.on {
      background: rgba(155,95,255,0.28); opacity: 1;
      box-shadow: 0 0 0 1px rgba(155,95,255,0.45);
    }
    .emo-wallet-slip-custom {
      width: 100%; box-sizing: border-box;
      height: 44px; border-radius: 12px; padding: 0 14px;
      border: 1px solid rgba(155,95,255,0.28);
      background: rgba(255,255,255,0.05); color: inherit;
      font: inherit; font-size: 15px; font-weight: 600;
      outline: none; margin-bottom: 4px; display: none;
    }
    .emo-wallet-slip-custom.show, .emo-wallet-slip-custom:not([hidden]) { display: block; }
    [data-theme="light"] .emo-wallet-slip-custom {
      background: rgba(0,0,0,0.03); border-color: rgba(155,95,255,0.25);
    }
    .emo-wallet-slip-custom:focus {
      border-color: rgba(155,95,255,0.75);
      box-shadow: 0 0 0 3px rgba(155,95,255,0.16);
    }
    .emo-wallet-toast {
      position: sticky; top: 0; z-index: 2; margin: -4px 0 12px;
      background: rgba(52,211,153,0.14); border: 1px solid rgba(52,211,153,0.4);
      color: #6ee7b7; border-radius: 12px; padding: 10px 12px; font-size: 12.5px; line-height: 1.45;
    }
    [data-theme="light"] .emo-wallet-toast { color: #047857; }
    .emo-wallet-toast a { color: inherit; font-weight: 700; }
    .emo-wallet-warn-local {
      background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.35);
      color: #fcd34d; border-radius: 12px; padding: 10px 12px; font-size: 12px;
      margin-bottom: 12px; line-height: 1.45;
    }
    [data-theme="light"] .emo-wallet-warn-local { color: #b45309; }
    .emo-wallet-link {
      color: var(--accent, #9B5FFF); font-weight: 600; text-decoration: none;
    }
    .emo-wallet-link:hover { text-decoration: underline; text-underline-offset: 2px; }
    .emo-wallet-steps {
      list-style: none; margin: 0 0 14px; padding: 0; counter-reset: ewstep;
    }
    .emo-wallet-steps li {
      counter-increment: ewstep;
      display: flex; gap: 10px; align-items: flex-start;
      font-size: 13px; line-height: 1.5; margin-bottom: 10px; opacity: 0.9;
    }
    .emo-wallet-steps li:last-child { margin-bottom: 0; }
    .emo-wallet-steps li::before {
      content: counter(ewstep);
      flex-shrink: 0;
      width: 22px; height: 22px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700;
      background: rgba(155,95,255,0.2); border: 1px solid rgba(155,95,255,0.4);
      color: var(--accent, #9B5FFF);
      margin-top: 1px;
    }
    .emo-wallet-divider {
      height: 1px; background: rgba(255,255,255,0.07); margin: 4px 0 12px;
    }
    [data-theme="light"] .emo-wallet-divider { background: rgba(0,0,0,0.07); }
    .emo-wallet-provider-note {
      font-size: 11.5px; opacity: 0.55; text-align: center; margin: -2px 0 6px; line-height: 1.4;
    }
  `;
  const style = document.createElement('style');
  style.id = 'emo-wallet-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ─── Modal shell ────────────────────────────────────────────────────
function ensureOverlay() {
  let el = document.getElementById('emoWalletOverlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'emoWalletOverlay';
  el.className = 'emo-wallet-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'EMO Wallet');
  el.innerHTML = `<div class="emo-wallet-panel" id="emoWalletPanel"></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    if (e.target === el && !state.busy) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.classList.contains('open') || state.busy) return;
    closeModal();
  });
  return el;
}

function openOverlay() {
  ensureOverlay().classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeOverlay() {
  const el = document.getElementById('emoWalletOverlay');
  if (el) el.classList.remove('open');
  document.body.style.overflow = '';
}

function resolvePendingConfirm(value) {
  if (typeof state._confirmResolve !== 'function') return false;
  const resolve = state._confirmResolve;
  state._confirmResolve = null;
  resolve(value);
  return true;
}

function isWalletOpen() {
  return !!document.getElementById('emoWalletOverlay')?.classList.contains('open');
}

function closeModal() {
  // Don't nuke an in-flight approve/swap mid-sign
  if (state.busy) return;
  resolvePendingConfirm(false);
  lockSession();
  stopBalancePoll();
  closeOverlay();
}

function panelChrome(inner, { back = false } = {}) {
  return `
    ${back ? `<button type="button" class="emo-wallet-back" data-ew-home>← Back</button>` : ''}
    <button type="button" class="emo-wallet-close" data-ew-close aria-label="Close">&times;</button>
    ${inner}
  `;
}

function renderPanel(html, opts = {}) {
  ensureOverlay();
  const panel = document.getElementById('emoWalletPanel');
  if (panel) {
    panel.classList.toggle('has-back', !!opts.back);
    panel.innerHTML = panelChrome(html, opts);
  }
  openOverlay();
  bindPanelEvents();
  // Focus primary action for keyboard / screen-reader flow
  requestAnimationFrame(() => {
    const focusEl = panel?.querySelector(
      '.emo-wallet-btn-primary:not([disabled]), .emo-wallet-field input, .emo-wallet-btn-secondary'
    );
    try { focusEl?.focus({ preventScroll: true }); } catch { /* ignore */ }
  });
}

function toastHtml() {
  // state.toast is trusted HTML built only by us (links pre-escaped). Never put raw user input here.
  if (state.toast) {
    return `<div class="emo-wallet-toast" role="status">${state.toast}</div>`;
  }
  if (state.lastTx) {
    const url = explorerTxUrl(state.lastTx);
    return `<div class="emo-wallet-toast" role="status">Tx sent · <a class="emo-wallet-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">view on explorer</a></div>`;
  }
  return '';
}

function txToast(label, hash) {
  const url = explorerTxUrl(hash);
  return `${escapeHtml(label)} · <a class="emo-wallet-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">view tx</a>`;
}

function localWarnHtml() {
  if (!isLocalHost()) return '';
  return `<div class="emo-wallet-warn-local"><strong>Local testing.</strong> Passkeys created here won’t open on emonad.lol (different domain). Don’t send funds you’ll need in production.</div>`;
}

function statusPill(unlocked) {
  return unlocked
    ? `<span class="emo-wallet-pill on">unlocked</span>`
    : `<span class="emo-wallet-pill off">locked</span>`;
}

function addrRowHtml(addr, { short = false, showExplorer = true } = {}) {
  const a = addr || '';
  const shown = short ? shortAddr(a) : a;
  const explorer = a ? `${CONFIG.EXPLORER}/address/${a}` : '#';
  return `
    <div class="emo-wallet-addr-row">
      <span class="emo-wallet-addr${short ? ' short' : ''}" title="${escapeHtml(a)}">${escapeHtml(shown)}</span>
      <button type="button" class="emo-wallet-copy" data-ew-copy aria-label="Copy address">Copy</button>
      ${a && showExplorer ? `<a class="emo-wallet-chip" href="${escapeHtml(explorer)}" target="_blank" rel="noopener" title="View on MonadVision">Explorer</a>` : ''}
    </div>
  `;
}

function confirmCardHtml(rows) {
  const body = rows.map(([lbl, val]) => `
    <div class="row">
      <span class="lbl">${escapeHtml(lbl)}</span>
      <span class="val">${val}</span>
    </div>
  `).join('');
  return `<div class="emo-wallet-confirm-card">${body}</div>`;
}

/** In-wallet confirm — never use browser confirm(). */
function askConfirm({
  kicker = 'Confirm',
  title = 'are you sure?',
  msg = '',
  rows = null,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    // Cancel any previous pending confirm
    resolvePendingConfirm(false);
    state._confirmResolve = resolve;
    state.view = 'confirm';
    const detail = rows ? confirmCardHtml(rows) : '';
    renderPanel(`
      <div class="emo-wallet-kicker">${escapeHtml(kicker)}</div>
      <h2 class="emo-wallet-title">${escapeHtml(title)}</h2>
      ${msg ? `<p class="emo-wallet-msg">${msg}</p>` : ''}
      ${detail}
      <div class="emo-wallet-actions">
        <button type="button" class="emo-wallet-btn ${danger ? 'emo-wallet-btn-danger' : 'emo-wallet-btn-primary'}" data-ew-confirm-yes style="height:46px;font-size:14px;font-weight:700">
          ${escapeHtml(confirmLabel)}
        </button>
        <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-confirm-no>${escapeHtml(cancelLabel)}</button>
      </div>
    `, { back: true });
  });
}

// ─── Views ──────────────────────────────────────────────────────────
function renderLoading(msg) {
  renderPanel(`
    <div class="emo-wallet-kicker">EMO Wallet</div>
    <div class="emo-wallet-loading" role="status" aria-live="polite">
      <div class="emo-wallet-spinner" aria-hidden="true"></div>
      ${escapeHtml(msg || 'Working…')}
    </div>
  `);
}

function renderChooser() {
  state.view = 'chooser';
  renderPanel(`
    <div class="emo-wallet-kicker">EMO Wallet</div>
    <h2 class="emo-wallet-title">your wallet, no seed phrase</h2>
    <p class="emo-wallet-msg">
      One passkey, one Monad address. Unlock with Face&nbsp;ID, fingerprint, or Windows&nbsp;Hello —
      then fund, buy &amp; sell $EMO, send and receive. No MetaMask. No seed words.
    </p>
    ${localWarnHtml()}
    <div class="emo-wallet-actions">
      <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-create>
        Create passkey wallet
      </button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-open>
        I already have one
      </button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-close>Not now</button>
    </div>
    <p class="emo-wallet-foot">
      Works with iCloud Keychain, Google Password Manager, 1Password, Windows Hello.
      Desktop Chrome “local profile only” passkeys won’t work — use a synced password manager.
    </p>
  `);
}

function renderPasskeyGate({ firstVisit = false, error = null } = {}) {
  state.view = 'gate';
  renderPanel(`
    <div class="emo-wallet-kicker">EMO Wallet</div>
    <h2 class="emo-wallet-title">${firstVisit ? 'set up your wallet' : 'couldn’t open that passkey'}</h2>
    <p class="emo-wallet-msg">
      ${firstVisit
        ? 'Create once. The same passkey always opens the same address on this site.'
        : 'Use the <strong>same</strong> passkey as last time for the same address. Creating a new one makes a brand-new empty wallet.'}
    </p>
    ${error ? `<div class="emo-wallet-error">${escapeHtml(error)}</div>` : ''}
    ${localWarnHtml()}
    <div class="emo-wallet-actions">
      ${firstVisit
        ? `<button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-create>Create passkey wallet</button>
           <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-open>I already have one</button>`
        : `<button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-open>Try again</button>
           <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-create>Create a new wallet</button>`}
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-close>Close</button>
    </div>
  `);
}

function renderError(msg) {
  renderPanel(`
    <div class="emo-wallet-kicker">EMO Wallet</div>
    <h2 class="emo-wallet-title">that didn’t work</h2>
    <div class="emo-wallet-error">${escapeHtml(msg)}</div>
    <div class="emo-wallet-actions">
      <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-open>Try unlock again</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-create>Create a new wallet</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-close>Close</button>
    </div>
  `);
}

function renderHome() {
  state.view = 'home';
  const addr = state.address || '';
  const mon = state.mon == null ? '…' : state.mon;
  const emo = state.emo == null ? '…' : state.emo;
  const unlocked = !!state.session;

  renderPanel(`
    <div class="emo-wallet-kicker">EMO Wallet ${statusPill(unlocked)}</div>
    <h2 class="emo-wallet-title">${unlocked ? "you're in" : 'wallet ready'}</h2>
    ${toastHtml()}
    ${localWarnHtml()}
    ${addrRowHtml(addr, { short: true })}
    <div class="emo-wallet-bals">
      <div class="emo-wallet-bal"><label>MON</label><strong id="ewMonBal">${escapeHtml(String(mon))}</strong></div>
      <div class="emo-wallet-bal"><label>$EMO</label><strong id="ewEmoBal">${escapeHtml(String(emo))}</strong></div>
    </div>
    ${!unlocked
      ? `<p class="emo-wallet-msg" style="margin-top:-2px">Receive &amp; fund work while locked. Unlock to send, buy, or sell.</p>`
      : ''}
    <div class="emo-wallet-actions">
      ${!unlocked
        ? `<button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-open>Unlock with passkey</button>`
        : ''}
      <div class="emo-wallet-grid2">
        <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-buy>Buy $EMO</button>
        <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-sell>Sell $EMO</button>
      </div>
      <div class="emo-wallet-grid2">
        <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-receive>Receive</button>
        <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-send>Send</button>
      </div>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-secondary" data-ew-fund>Fund with card / Apple Pay</button>
      <div class="emo-wallet-divider"></div>
      ${unlocked
        ? `<button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-lock>Lock session</button>`
        : ''}
      <button type="button" class="emo-wallet-btn emo-wallet-btn-danger" data-ew-forget>Forget on this device</button>
    </div>
    <p class="emo-wallet-foot">
      Fund = MON via MoonPay · Swap $EMO on Nad.fun · Gas in MON ·
      Keys only in memory while unlocked · auto-locks after idle / every tx
    </p>
  `);
}

async function renderReceive() {
  state.view = 'receive';
  const addr = state.address || '';
  let qrData = '';
  try {
    qrData = await QRCode.toDataURL(addr, {
      width: 360,
      margin: 1,
      color: { dark: '#1a1028', light: '#ffffff' },
    });
  } catch (e) {
    console.warn('qr failed', e);
  }
  renderPanel(`
    <div class="emo-wallet-kicker">Receive</div>
    <h2 class="emo-wallet-title">your deposit address</h2>
    <p class="emo-wallet-msg">
      Only on <strong>Monad</strong>. Send MON or $EMO here.
      Wrong network = lost funds.
    </p>
    ${qrData ? `<div class="emo-wallet-qr"><img src="${qrData}" alt="Address QR code" width="188" height="188" /></div>` : ''}
    ${addrRowHtml(addr, { short: false })}
    <div class="emo-wallet-actions">
      <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-copy>Copy address</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back to wallet</button>
    </div>
  `, { back: true });
}

function renderSend() {
  state.view = 'send';
  const asset = state._sendAsset || 'MON';
  const bal = asset === 'EMO' ? (state.emo ?? '…') : (state.mon ?? '…');
  const assetLabel = asset === 'EMO' ? '$EMO' : 'MON';
  renderPanel(`
    <div class="emo-wallet-kicker">Send</div>
    <h2 class="emo-wallet-title">send ${escapeHtml(assetLabel)}</h2>
    ${toastHtml()}
    <div class="emo-wallet-seg" role="tablist" aria-label="Asset">
      <button type="button" role="tab" aria-selected="${asset === 'MON'}" class="${asset === 'MON' ? 'on' : ''}" data-ew-send-asset="MON">MON</button>
      <button type="button" role="tab" aria-selected="${asset === 'EMO'}" class="${asset === 'EMO' ? 'on' : ''}" data-ew-send-asset="EMO">$EMO</button>
    </div>
    <div class="emo-wallet-field">
      <label for="ewSendTo"><span>To</span></label>
      <input type="text" id="ewSendTo" placeholder="0x…" spellcheck="false" autocomplete="off" autocapitalize="off" />
    </div>
    <div class="emo-wallet-field">
      <label for="ewSendAmt">
        <span>Amount</span>
        <button type="button" class="emo-wallet-max" data-ew-send-max>Max · ${escapeHtml(String(bal))}</button>
      </label>
      <input type="text" id="ewSendAmt" inputmode="decimal" placeholder="0.0" />
    </div>
    <div class="emo-wallet-actions">
      <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-send-go>Review send</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back</button>
    </div>
    <p class="emo-wallet-foot">Triple-check the address. On-chain sends can’t be reversed. Gas paid in MON.</p>
  `, { back: true });
}

function renderBuy() {
  state.view = 'buy';
  const mon = state.mon ?? '…';
  renderPanel(`
    <div class="emo-wallet-kicker">Buy $EMO</div>
    <h2 class="emo-wallet-title">MON → $EMO</h2>
    ${toastHtml()}
    <p class="emo-wallet-msg">Swap on Nad.fun · live quote · same pool as the site.</p>
    <div class="emo-wallet-field">
      <label for="ewBuyAmt">
        <span>You pay (MON)</span>
        <button type="button" class="emo-wallet-max" data-ew-buy-max>Bal · ${escapeHtml(String(mon))}</button>
      </label>
      <input type="text" id="ewBuyAmt" inputmode="decimal" placeholder="0.0" />
    </div>
    ${slippageControlsHtml()}
    <div class="emo-wallet-quote" id="ewBuyQuote">Enter an amount for a quote.</div>
    <div class="emo-wallet-actions">
      <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-buy-go id="ewBuyGo" disabled>Buy $EMO</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-fund>Need MON? Fund wallet</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back</button>
    </div>
  `, { back: true });
  bindQuoteInput('ewBuyAmt', true);
}

function renderSell() {
  state.view = 'sell';
  const emo = state.emo ?? '…';
  renderPanel(`
    <div class="emo-wallet-kicker">Sell $EMO</div>
    <h2 class="emo-wallet-title">$EMO → MON</h2>
    ${toastHtml()}
    <p class="emo-wallet-msg">Swap on Nad.fun. First sell may ask you to approve $EMO once.</p>
    <div class="emo-wallet-field">
      <label for="ewSellAmt">
        <span>You sell ($EMO)</span>
        <button type="button" class="emo-wallet-max" data-ew-sell-max>Bal · ${escapeHtml(String(emo))}</button>
      </label>
      <input type="text" id="ewSellAmt" inputmode="decimal" placeholder="0.0" />
    </div>
    ${slippageControlsHtml()}
    <div class="emo-wallet-quote" id="ewSellQuote">Enter an amount for a quote.</div>
    <div class="emo-wallet-actions">
      <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-sell-go id="ewSellGo" disabled>Sell $EMO</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back</button>
    </div>
  `, { back: true });
  bindQuoteInput('ewSellAmt', false);
}

function bindQuoteInput(inputId, isBuy) {
  const input = document.getElementById(inputId);
  const quoteEl = document.getElementById(isBuy ? 'ewBuyQuote' : 'ewSellQuote');
  const goBtn = document.getElementById(isBuy ? 'ewBuyGo' : 'ewSellGo');
  if (!input || !quoteEl) return;
  const viewAtBind = state.view;
  let timer = null;
  let reqId = 0;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const myReq = ++reqId;
      const raw = input.value.trim();
      if (!raw) {
        quoteEl.textContent = 'Enter an amount for a quote.';
        if (goBtn) goBtn.disabled = true;
        state.quote = null;
        return;
      }
      try {
        const amountIn = parseAmountInput(raw, 18);
        if (amountIn <= 0n) throw new Error('Amount must be greater than zero.');
        quoteEl.textContent = 'Fetching quote…';
        if (goBtn) goBtn.disabled = true;
        const { amountOut, router } = await quoteNad({ amountIn, isBuy });
        if (myReq !== reqId || state.view !== viewAtBind) return;
        if (!amountOut || amountOut <= 0n) throw new Error('No liquidity for this size.');
        state.quote = { amountIn, amountOut, router, isBuy };
        const outLabel = isBuy ? '$EMO' : 'MON';
        const inLabel = isBuy ? 'MON' : '$EMO';
        const slip = slippagePctLabel();
        quoteEl.innerHTML = `You get about <strong>${escapeHtml(formatDisplay(amountOut, 18, isBuy ? 4 : 6))} ${outLabel}</strong>
          for <strong>${escapeHtml(formatDisplay(amountIn, 18, 6))} ${inLabel}</strong>
          <span class="sub">Min after ${escapeHtml(slip)} slippage: ${escapeHtml(formatDisplay(applySlippage(amountOut), 18, isBuy ? 4 : 6))} · via Nad.fun</span>`;
        if (goBtn) goBtn.disabled = false;
      } catch (e) {
        if (myReq !== reqId || state.view !== viewAtBind) return;
        state.quote = null;
        quoteEl.innerHTML = `<span style="color:#ffb3d4">${escapeHtml(describeError(e))}</span>`;
        if (goBtn) goBtn.disabled = true;
      }
    }, 280);
  };
  input.addEventListener('input', run);
  // Expose so slippage changes can refresh min-out without retyping
  state._requote = run;
}

async function renderFund() {
  state.view = 'fund';
  const addr = state.address || '';
  const mon = state.mon == null ? '…' : state.mon;

  // Copy address immediately so MoonPay paste is ready.
  const copied = await copyWalletAddress();
  turboPollBalances();

  renderPanel(`
    <div class="emo-wallet-kicker">Fund</div>
    <h2 class="emo-wallet-title">get MON</h2>
    ${toastHtml()}
    <p class="emo-wallet-msg">
      Buy MON on MoonPay with card or Apple&nbsp;Pay. Paste this address as the destination · network = <strong>Monad</strong>.
    </p>
    <div class="emo-wallet-ok">
      ${copied
        ? 'Address copied ✓ — paste it in MoonPay when they ask for a wallet.'
        : 'Copy the address below, then paste it in MoonPay when they ask for a wallet.'}
    </div>
    ${addrRowHtml(addr, { short: false })}
    <div class="emo-wallet-bals" style="margin-bottom:14px">
      <div class="emo-wallet-bal"><label>MON · live</label><strong id="ewMonBal">${escapeHtml(String(mon))}</strong></div>
      <div class="emo-wallet-bal"><label>Network</label><strong>Monad</strong></div>
    </div>
    <ol class="emo-wallet-steps">
      <li>Open MoonPay (new tab)</li>
      <li>Paste this address · choose <strong>Monad</strong> if asked</li>
      <li>Finish KYC and pay (card / Apple&nbsp;Pay where offered)</li>
      <li>Come back — balance refreshes automatically for a few minutes</li>
    </ol>
    <p class="emo-wallet-provider-note">MoonPay · their fees, KYC &amp; regions · we never see your card</p>
    <div class="emo-wallet-actions">
      <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-open-fund data-url="${escapeHtml(CONFIG.FUND_BUY_MOONPAY)}">
        Buy MON on MoonPay
      </button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-receive>Or show QR to receive</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-buy>I have MON — buy $EMO</button>
      <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back to wallet</button>
    </div>
    <p class="emo-wallet-foot left">
      <strong>Wrong network = lost funds.</strong> Always pick Monad (chain id 143), not Ethereum.
    </p>
  `, { back: true });
}

// ─── Events ─────────────────────────────────────────────────────────
function bindPanelEvents() {
  const panel = document.getElementById('emoWalletPanel');
  if (!panel) return;
  if (state.session) touchActivity();

  panel.querySelector('[data-ew-close]')?.addEventListener('click', () => closeModal());
  panel.querySelector('[data-ew-home]')?.addEventListener('click', () => {
    if (resolvePendingConfirm(false)) return;
    state.toast = null;
    if (state.address) renderHome();
    else renderChooser();
  });

  panel.querySelector('[data-ew-confirm-yes]')?.addEventListener('click', () => {
    resolvePendingConfirm(true);
  });
  panel.querySelector('[data-ew-confirm-no]')?.addEventListener('click', () => {
    resolvePendingConfirm(false);
  });

  panel.querySelectorAll('[data-ew-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.address) return;
      try {
        await navigator.clipboard.writeText(state.address);
        // Mark all copy buttons in panel
        panel.querySelectorAll('[data-ew-copy]').forEach((b) => {
          b.classList.add('copied');
          if (b.tagName === 'BUTTON') {
            const prev = b.dataset.prevLabel || b.textContent;
            b.dataset.prevLabel = prev;
            b.textContent = 'Copied';
          }
        });
        setTimeout(() => {
          panel.querySelectorAll('[data-ew-copy]').forEach((b) => {
            b.classList.remove('copied');
            if (b.tagName === 'BUTTON' && b.dataset.prevLabel) {
              b.textContent = b.dataset.prevLabel;
            }
          });
        }, 1400);
      } catch {
        btn.textContent = 'Failed';
      }
    });
  });

  panel.querySelector('[data-ew-open]')?.addEventListener('click', () => openPasskeyFlow({ forceCreate: false }));
  panel.querySelector('[data-ew-create]')?.addEventListener('click', () => openPasskeyFlow({ forceCreate: true }));
  panel.querySelector('[data-ew-lock]')?.addEventListener('click', () => {
    lockSession();
    state.toast = 'Session locked. Unlock when you need to sign.';
    renderHome();
  });
  panel.querySelector('[data-ew-forget]')?.addEventListener('click', () => runForget());

  panel.querySelector('[data-ew-receive]')?.addEventListener('click', () => renderReceive());
  panel.querySelector('[data-ew-send]')?.addEventListener('click', () => {
    state._sendAsset = state._sendAsset || 'MON';
    renderSend();
  });
  panel.querySelector('[data-ew-buy]')?.addEventListener('click', () => renderBuy());
  panel.querySelector('[data-ew-sell]')?.addEventListener('click', () => renderSell());
  panel.querySelector('[data-ew-fund]')?.addEventListener('click', () => renderFund());

  panel.querySelectorAll('[data-ew-open-fund]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      if (!url) return;
      try {
        const w = openFundProvider(url);
        if (!w) {
          state.toast = 'Popup blocked — allow popups for this site, then try again. Your address is still copied.';
          renderFund();
        }
      } catch (e) {
        state.toast = null;
        renderPanel(`
          <div class="emo-wallet-kicker">Fund</div>
          <h2 class="emo-wallet-title">blocked</h2>
          <div class="emo-wallet-error">${escapeHtml(describeError(e))}</div>
          <div class="emo-wallet-actions">
            <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back to wallet</button>
          </div>
        `, { back: true });
      }
    });
  });

  panel.querySelectorAll('[data-ew-send-asset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state._sendAsset = btn.getAttribute('data-ew-send-asset') || 'MON';
      renderSend();
    });
  });

  panel.querySelector('[data-ew-send-max]')?.addEventListener('click', () => {
    const input = document.getElementById('ewSendAmt');
    if (!input) return;
    const asset = state._sendAsset || 'MON';
    if (asset === 'EMO') {
      input.value = state.emoRaw != null ? formatUnits(state.emoRaw, 18) : (state.emo || '');
    } else if (state.monRaw != null) {
      // leave a little for gas if possible
      const leave = parseEther('0.01');
      const send = state.monRaw > leave ? state.monRaw - leave : state.monRaw;
      input.value = formatUnits(send, 18);
    } else {
      input.value = state.mon || '';
    }
  });

  function refreshSlippageLabel() {
    const slipHead = Array.from(panel.querySelectorAll('.emo-wallet-field label')).find((el) =>
      /slippage/i.test(el.textContent || '')
    );
    if (slipHead) {
      const spans = slipHead.querySelectorAll('span');
      if (spans[1]) spans[1].textContent = slippagePctLabel();
    }
    if (typeof state._requote === 'function') state._requote();
  }

  panel.querySelectorAll('[data-ew-slip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-ew-slip');
      const customInput = document.getElementById('ewSlipCustom');
      if (v === 'custom') {
        panel.querySelectorAll('[data-ew-slip]').forEach((b) => {
          b.classList.toggle('on', b.getAttribute('data-ew-slip') === 'custom');
        });
        if (customInput) {
          customInput.hidden = false;
          customInput.classList.add('show');
          if (!customInput.value.trim()) {
            customInput.value = String(Number(getSlippageBps()) / 100);
          }
          // Apply whatever is in the box as custom
          const raw = customInput.value.trim().replace(/%/g, '').replace(/,/g, '');
          const pct = Number(raw);
          if (Number.isFinite(pct) && pct >= 0) {
            const bps = BigInt(Math.min(Math.round(pct * 100), Number(CONFIG.MAX_SLIPPAGE_BPS)));
            setSlippageBps(bps, { custom: true });
          } else {
            state.slippageCustom = true;
          }
          customInput.focus();
          customInput.select();
        }
        refreshSlippageLabel();
        return;
      }
      setSlippageBps(BigInt(v), { custom: false });
      panel.querySelectorAll('[data-ew-slip]').forEach((b) => {
        b.classList.toggle('on', b.getAttribute('data-ew-slip') === v);
      });
      if (customInput) {
        customInput.hidden = true;
        customInput.classList.remove('show');
      }
      refreshSlippageLabel();
    });
  });

  const slipCustom = panel.querySelector('#ewSlipCustom');
  if (slipCustom) {
    const applyCustom = () => {
      const raw = slipCustom.value.trim().replace(/%/g, '').replace(/,/g, '');
      if (!raw) return;
      const pct = Number(raw);
      if (!Number.isFinite(pct) || pct < 0) return;
      // percent → bps (15 → 1500). Cap at MAX (50%).
      const bps = BigInt(Math.min(Math.round(pct * 100), Number(CONFIG.MAX_SLIPPAGE_BPS)));
      setSlippageBps(bps, { custom: true });
      panel.querySelectorAll('[data-ew-slip]').forEach((b) => {
        b.classList.toggle('on', b.getAttribute('data-ew-slip') === 'custom');
      });
      refreshSlippageLabel();
    };
    slipCustom.addEventListener('input', applyCustom);
    slipCustom.addEventListener('change', applyCustom);
  }

  panel.querySelector('[data-ew-send-go]')?.addEventListener('click', () => runSend());
  panel.querySelector('[data-ew-buy-go]')?.addEventListener('click', () => runBuy());
  panel.querySelector('[data-ew-sell-go]')?.addEventListener('click', () => runSell());
  panel.querySelector('[data-ew-buy-max]')?.addEventListener('click', () => {
    const input = document.getElementById('ewBuyAmt');
    if (!input) return;
    if (state.monRaw != null) {
      const leave = parseEther('0.01');
      const spend = state.monRaw > leave ? state.monRaw - leave : 0n;
      input.value = formatUnits(spend, 18);
      input.dispatchEvent(new Event('input'));
    }
  });
  panel.querySelector('[data-ew-sell-max]')?.addEventListener('click', () => {
    const input = document.getElementById('ewSellAmt');
    if (!input) return;
    if (state.emoRaw != null) {
      input.value = formatUnits(state.emoRaw, 18);
      input.dispatchEvent(new Event('input'));
    }
  });
}

async function runForget() {
  if (state.busy) return;
  const ok = await askConfirm({
    kicker: 'Forget wallet',
    title: 'clear this device?',
    msg: 'Your passkey still lives in your password manager — you can open the same wallet again later. This only removes the saved address from <strong>this browser</strong>.',
    rows: state.address ? [['Address', escapeHtml(shortAddr(state.address))]] : null,
    confirmLabel: 'Forget on this device',
    cancelLabel: 'Keep it',
    danger: true,
  });
  if (!ok) {
    if (!isWalletOpen()) return;
    if (state.address) renderHome();
    else renderChooser();
    return;
  }
  forgetWallet();
  renderChooser();
}

async function runSend() {
  if (state.busy) return;
  const toRaw = document.getElementById('ewSendTo')?.value?.trim();
  const amtStr = document.getElementById('ewSendAmt')?.value?.trim();
  const asset = state._sendAsset || 'MON';
  const assetLabel = asset === 'EMO' ? '$EMO' : 'MON';
  // Preserve form values across confirm re-render
  state._sendDraft = { to: toRaw, amt: amtStr, asset };
  try {
    if (!toRaw || !isAddress(toRaw, { strict: false })) throw new Error('Enter a valid 0x address.');
    const to = getAddress(toRaw);
    if (to === '0x0000000000000000000000000000000000000000') {
      throw new Error('Cannot send to the zero address.');
    }
    if (state.address && to === getAddress(state.address)) {
      throw new Error('That’s this wallet. Pick a different address.');
    }
    const amount = parseAmountInput(amtStr, 18);
    if (amount <= 0n) throw new Error('Amount must be greater than zero.');
    if (asset === 'EMO' && state.emoRaw != null && amount > state.emoRaw) {
      throw new Error('Not enough $EMO.');
    }
    if (asset === 'MON' && state.monRaw != null && amount >= state.monRaw) {
      throw new Error('Leave a little MON for gas (try Max or a smaller amount).');
    }
    const ok = await askConfirm({
      kicker: 'Send',
      title: 'confirm send',
      msg: 'On-chain transfers can’t be reversed. Make sure the address is right.',
      rows: [
        ['Amount', escapeHtml(`${formatDisplay(amount)} ${assetLabel}`)],
        ['To', escapeHtml(to)],
      ],
      confirmLabel: `Send ${assetLabel}`,
      cancelLabel: 'Go back',
    });
    if (!ok) {
      if (!isWalletOpen()) return;
      renderSend();
      restoreSendDraft();
      return;
    }
    state.busy = true;
    renderLoading('Unlock with passkey…');
    await ensureUnlocked();
    await refreshBalances();
    if (asset === 'EMO' && state.emoRaw != null && amount > state.emoRaw) {
      throw new Error('Not enough $EMO in this wallet.');
    }
    if (asset === 'MON' && state.monRaw != null && amount >= state.monRaw) {
      throw new Error('Leave a little MON for gas.');
    }
    renderLoading('Sending…');
    const hash = asset === 'EMO'
      ? await sendEmo(to, amount)
      : await sendNative(to, amount);
    state.toast = txToast(`Sent ${assetLabel}`, hash);
    state._sendDraft = null;
    lockAfterTx();
    await refreshBalances();
    renderHome();
  } catch (e) {
    console.warn('send', e);
    if (!isWalletOpen() && isUserCancel(e)) return;
    if (!isUserCancel(e)) {
      state.toast = null;
      renderPanel(`
        <div class="emo-wallet-kicker">Send</div>
        <h2 class="emo-wallet-title">couldn’t send</h2>
        <div class="emo-wallet-error">${escapeHtml(describeError(e))}</div>
        <div class="emo-wallet-actions">
          <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-send>Try again</button>
          <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back to wallet</button>
        </div>
      `, { back: true });
    } else if (state.address && isWalletOpen()) {
      renderSend();
      restoreSendDraft();
    }
  } finally {
    state.busy = false;
  }
}

function restoreSendDraft() {
  const d = state._sendDraft;
  if (!d) return;
  requestAnimationFrame(() => {
    const to = document.getElementById('ewSendTo');
    const amt = document.getElementById('ewSendAmt');
    if (to && d.to) to.value = d.to;
    if (amt && d.amt) amt.value = d.amt;
  });
}

async function runBuy() {
  if (state.busy) return;
  const amtStr = document.getElementById('ewBuyAmt')?.value?.trim();
  state._buyDraft = amtStr;
  try {
    const monIn = parseAmountInput(amtStr, 18);
    if (monIn <= 0n) throw new Error('Enter how much MON to spend.');
    // Need MON left for gas — buy value is sent as msg.value, gas paid separately
    if (state.monRaw != null) {
      const leave = parseEther('0.005');
      if (monIn + leave > state.monRaw) {
        throw new Error('Leave a little MON for gas (try Max or a smaller amount).');
      }
    }
    const { amountOut } = await quoteNad({ amountIn: monIn, isBuy: true });
    if (amountOut <= 0n) throw new Error('No liquidity for this size.');
    const slip = slippagePctLabel();
    const ok = await askConfirm({
      kicker: 'Buy $EMO',
      title: 'confirm swap',
      msg: `Swaps on Nad.fun with <strong>${escapeHtml(slip)}</strong> slippage. You’ll sign with your passkey.`,
      rows: [
        ['You pay', escapeHtml(`${formatDisplay(monIn)} MON`)],
        ['You get ~', escapeHtml(`${formatDisplay(amountOut, 18, 4)} $EMO`)],
        ['Min received', escapeHtml(`${formatDisplay(applySlippage(amountOut), 18, 4)} $EMO`)],
        ['Slippage', escapeHtml(slip)],
      ],
      confirmLabel: 'Buy $EMO',
      cancelLabel: 'Go back',
    });
    if (!ok) {
      if (!isWalletOpen()) return;
      renderBuy();
      restoreBuyDraft();
      return;
    }
    state.busy = true;
    renderLoading('Unlock with passkey…');
    await ensureUnlocked();
    await refreshBalances();
    {
      const leave = parseEther('0.005');
      if (state.monRaw != null && monIn + leave > state.monRaw) {
        throw new Error('Leave a little MON for gas after unlock.');
      }
    }
    renderLoading('Buying $EMO…');
    const hash = await buyEmoWithMon(monIn);
    state.toast = txToast('Bought $EMO', hash);
    state._buyDraft = null;
    lockAfterTx();
    await refreshBalances();
    renderHome();
  } catch (e) {
    console.warn('buy', e);
    if (!isWalletOpen() && isUserCancel(e)) return;
    if (!isUserCancel(e)) {
      renderPanel(`
        <div class="emo-wallet-kicker">Buy $EMO</div>
        <h2 class="emo-wallet-title">buy failed</h2>
        <div class="emo-wallet-error">${escapeHtml(describeError(e))}</div>
        <div class="emo-wallet-actions">
          <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-buy>Try again</button>
          <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back to wallet</button>
        </div>
      `, { back: true });
    } else if (state.address && isWalletOpen()) {
      renderBuy();
      restoreBuyDraft();
    }
  } finally {
    state.busy = false;
  }
}

function restoreBuyDraft() {
  if (state._buyDraft == null) return;
  requestAnimationFrame(() => {
    const input = document.getElementById('ewBuyAmt');
    if (input) {
      input.value = state._buyDraft;
      input.dispatchEvent(new Event('input'));
    }
  });
}

async function runSell() {
  if (state.busy) return;
  const amtStr = document.getElementById('ewSellAmt')?.value?.trim();
  state._sellDraft = amtStr;
  try {
    const emoIn = parseAmountInput(amtStr, 18);
    if (emoIn <= 0n) throw new Error('Enter how much $EMO to sell.');
    if (state.emoRaw != null && emoIn > state.emoRaw) throw new Error('Not enough $EMO.');
    if (state.monRaw != null && state.monRaw === 0n) {
      throw new Error('You need a tiny bit of MON for gas. Fund or receive MON first.');
    }
    const { amountOut } = await quoteNad({ amountIn: emoIn, isBuy: false });
    if (amountOut <= 0n) throw new Error('No liquidity for this size.');
    const slip = slippagePctLabel();
    const ok = await askConfirm({
      kicker: 'Sell $EMO',
      title: 'confirm swap',
      msg: `Swaps on Nad.fun with <strong>${escapeHtml(slip)}</strong> slippage. First time may include an approve step.`,
      rows: [
        ['You sell', escapeHtml(`${formatDisplay(emoIn, 18, 4)} $EMO`)],
        ['You get ~', escapeHtml(`${formatDisplay(amountOut)} MON`)],
        ['Min received', escapeHtml(`${formatDisplay(applySlippage(amountOut))} MON`)],
        ['Slippage', escapeHtml(slip)],
      ],
      confirmLabel: 'Sell $EMO',
      cancelLabel: 'Go back',
    });
    if (!ok) {
      if (!isWalletOpen()) return;
      renderSell();
      restoreSellDraft();
      return;
    }
    state.busy = true;
    renderLoading('Unlock with passkey…');
    await ensureUnlocked();
    await refreshBalances();
    if (state.emoRaw != null && emoIn > state.emoRaw) throw new Error('Not enough $EMO in this wallet.');
    if (state.monRaw != null && state.monRaw === 0n) {
      throw new Error('Need a tiny bit of MON for gas.');
    }
    renderLoading('Selling $EMO…');
    const hash = await sellEmoForMon(emoIn);
    state.toast = txToast('Sold $EMO', hash);
    state._sellDraft = null;
    lockAfterTx();
    await refreshBalances();
    renderHome();
  } catch (e) {
    console.warn('sell', e);
    if (!isWalletOpen() && isUserCancel(e)) return;
    if (!isUserCancel(e)) {
      renderPanel(`
        <div class="emo-wallet-kicker">Sell $EMO</div>
        <h2 class="emo-wallet-title">sell failed</h2>
        <div class="emo-wallet-error">${escapeHtml(describeError(e))}</div>
        <div class="emo-wallet-actions">
          <button type="button" class="emo-wallet-btn emo-wallet-btn-primary" data-ew-sell>Try again</button>
          <button type="button" class="emo-wallet-btn emo-wallet-btn-ghost" data-ew-home>Back to wallet</button>
        </div>
      `, { back: true });
    } else if (state.address && isWalletOpen()) {
      renderSell();
      restoreSellDraft();
    }
  } finally {
    state.busy = false;
  }
}

function restoreSellDraft() {
  if (state._sellDraft == null) return;
  requestAnimationFrame(() => {
    const input = document.getElementById('ewSellAmt');
    if (input) {
      input.value = state._sellDraft;
      input.dispatchEvent(new Event('input'));
    }
  });
}

// ─── Flows ──────────────────────────────────────────────────────────
async function openPasskeyFlow({ forceCreate = false } = {}) {
  if (state.busy) return;

  // Creating a second wallet while one is cached — warn first
  if (forceCreate) {
    const cached = loadCache();
    if (cached?.address || state.address) {
      const ok = await askConfirm({
        kicker: 'New wallet',
        title: 'create a new wallet?',
        msg: 'This makes a <strong>brand-new</strong> empty address. Your old passkey still works if you open it later — but this device will switch to the new one.',
        rows: (cached?.address || state.address)
          ? [['Current', escapeHtml(shortAddr(cached?.address || state.address))]]
          : null,
        confirmLabel: 'Create new wallet',
        cancelLabel: 'Keep current',
        danger: true,
      });
      if (!ok) {
        if (!isWalletOpen()) return;
        if (state.address || cached?.address) {
          if (!state.address && cached?.address) {
            state.address = cached.address;
            state.credentialId = cached.credentialId || null;
            state.transports = cached.transports || null;
          }
          renderHome();
        } else {
          renderChooser();
        }
        return;
      }
    }
  }

  state.busy = true;
  renderLoading(forceCreate ? 'Creating passkey wallet…' : 'Unlock with passkey…');
  try {
    if (!window.isSecureContext) {
      throw new Error('Passkeys need HTTPS or localhost.');
    }
    let wallet;
    if (forceCreate) {
      wallet = await createPasskeyWallet();
    } else {
      try {
        wallet = await restorePasskeyWallet();
      } catch (restoreErr) {
        if (isUserCancel(restoreErr)) throw restoreErr;
        const cached = loadCache();
        const firstVisit = !cached?.credentialId && !cached?.address;
        state.busy = false;
        renderPasskeyGate({
          firstVisit,
          error: firstVisit ? null : describeError(restoreErr),
        });
        return;
      }
    }
    setActiveWallet({
      address: wallet.address,
      session: wallet.session,
      credentialId: wallet.credentialId,
      transports: wallet.transports,
    });
    state.toast = forceCreate
      ? 'Wallet created ✓ — fund with a card or receive MON to get started.'
      : null;
    renderHome();
  } catch (err) {
    console.warn('emo-wallet: passkey flow', err);
    if (isUserCancel(err)) {
      const cached = loadCache();
      if (cached?.address) {
        state.address = cached.address;
        state.credentialId = cached.credentialId || null;
        state.transports = cached.transports || null;
        renderHome();
      } else {
        renderChooser();
      }
    } else {
      renderError(describeError(err));
    }
  } finally {
    state.busy = false;
  }
}

function openEntry() {
  injectStyles();
  const cached = loadCache();
  if (!state.address && cached?.address) {
    state.address = cached.address;
    state.credentialId = cached.credentialId || null;
    state.transports = cached.transports || null;
  }
  if (state.address) {
    startBalancePoll();
    // Cached address → home (locked until passkey unlock for signing)
    renderHome();
    return;
  }
  renderChooser();
}

// ─── Public API ─────────────────────────────────────────────────────
// Minimal surface. No session/key access. CONFIG is frozen + read-only copy.
const publicConfig = Object.freeze({
  MONAD_CHAIN_ID: CONFIG.MONAD_CHAIN_ID,
  EMO_TOKEN: CONFIG.EMO_TOKEN,
  EXPLORER: CONFIG.EXPLORER,
  FUND_BUY_MOONPAY: CONFIG.FUND_BUY_MOONPAY,
});

const api = {
  CONFIG: publicConfig,
  init() {
    if (state.ready) return;
    injectStyles();
    loadSlippageBps();
    const cached = loadCache();
    if (cached?.address) {
      state.address = cached.address;
      state.credentialId = cached.credentialId || null;
      state.transports = cached.transports || null;
    }
    document.addEventListener('visibilitychange', () => {
      // Keep session during busy txs (approve wait, send, etc.)
      if (document.visibilityState === 'hidden' && !state.busy) {
        lockSession();
      }
    });
    // pagehide fires more reliably than unload on mobile
    window.addEventListener('pagehide', () => {
      if (!state.busy) lockSession();
    });
    window.addEventListener('beforeunload', () => {
      if (!state.busy) lockSession();
    });
    // Any pointer/key activity while wallet open refreshes idle timer
    const activity = () => {
      if (state.session) touchActivity();
    };
    document.addEventListener('pointerdown', activity, { passive: true });
    document.addEventListener('keydown', activity, { passive: true });
    // Return from MoonPay popup → refresh balances
    window.addEventListener('focus', () => {
      if (state.address) refreshBalances();
    });
    state.ready = true;
  },
  open() {
    this.init();
    touchActivity();
    openEntry();
  },
  openCreate() {
    this.init();
    openPasskeyFlow({ forceCreate: true });
  },
  openRestore() {
    this.init();
    openPasskeyFlow({ forceCreate: false });
  },
  close() { closeModal(); },
  getAddress() { return state.address; },
  isUnlocked() { return !!(state.session && state.address); },
  disconnect() {
    this.init();
    forgetWallet();
    if (isWalletOpen()) renderChooser();
  },
  clearLocal() { forgetWallet(); },
};

Object.freeze(api);
window.EmoWallet = api;
export default api;
