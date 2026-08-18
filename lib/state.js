// ============================================================================
// STATE -- Upstash Redis (REST API, no persistent connection needed)
// ============================================================================
// Two things need to survive between invocations, since each cron tick is a
// fresh, stateless function call with no memory of the last one:
//
// 1. The round-robin cursor -- which slice of the watch list to check this tick.
// 2. The last-known alignment per symbol -- so we alert on the TRANSITION into
//    FULL_BULL/FULL_BEAR, not on every single tick while it holds. Without this,
//    a setup that stays aligned for 3 hours would message you every few minutes
//    for 3 hours straight.
//
// Free tier at upstash.com is enough for this (single-digit KB of state, low
// request volume). No credit card required for the free tier as of this writing --
// verify current terms at upstash.com if that matters to you before signing up.
// ============================================================================

const { Redis } = require('@upstash/redis');

function getClient() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
}

async function getCursor(totalLength) {
  const redis = getClient();
  var cursor = await redis.get('sunrose:cursor');
  cursor = parseInt(cursor, 10);
  if (isNaN(cursor) || cursor < 0 || cursor >= totalLength) cursor = 0;
  return cursor;
}

async function setCursor(nextCursor) {
  const redis = getClient();
  await redis.set('sunrose:cursor', nextCursor);
}

// Separate cursor for the full-watchlist Vision scanner -- a different list
// (Forex+Gold only, not all 30) and a different meaning (which ONE symbol to
// check this tick, not a batch of 5), so it needs its own key entirely.
async function getVisionScanCursor(totalLength) {
  const redis = getClient();
  var cursor = await redis.get('sunrose:visionscan:cursor');
  cursor = parseInt(cursor, 10);
  if (isNaN(cursor) || cursor < 0 || cursor >= totalLength) cursor = 0;
  return cursor;
}

async function setVisionScanCursor(nextCursor) {
  const redis = getClient();
  await redis.set('sunrose:visionscan:cursor', nextCursor);
}

async function getLastAlignment(symbol) {
  const redis = getClient();
  return await redis.get('sunrose:align:' + symbol);
}

async function setLastAlignment(symbol, alignment) {
  const redis = getClient();
  await redis.set('sunrose:align:' + symbol, alignment);
}

// Atomic read-and-set for the alignment dedupe key. Using SET ... GET makes the
// "read the old value" and "write the new value" a single Redis operation, so
// two overlapping invocations (a slow prior run still finishing when the next
// cron tick fires, a retry, etc.) can't both read the old value before either
// one writes -- which is what caused duplicate alerts under the old
// get-then-set-as-two-steps approach. Prefer this over getLastAlignment +
// setLastAlignment wherever the result decides whether to send a Telegram alert.
async function getSetAlignment(symbol, alignment) {
  const redis = getClient();
  return await redis.set('sunrose:align:' + symbol, alignment, { get: true });
}

// Phase 2: dedupe on (symbol, mode) so Continuation and Reversal TRADE READY
// states are tracked independently -- a symbol can be ready for one and not
// the other at the same time.
async function getLastVerdict(symbol, mode) {
  const redis = getClient();
  return await redis.get('sunrose:verdict:' + symbol + ':' + mode);
}

async function setLastVerdict(symbol, mode, verdict) {
  const redis = getClient();
  await redis.set('sunrose:verdict:' + symbol + ':' + mode, verdict);
}

// Same atomic read-and-set fix as getSetAlignment above, for the verdict
// dedupe key. This is the one that caused the double ADA/USD TRADE READY
// alert -- closes that race entirely instead of narrowing the window.
async function getSetVerdict(symbol, mode, verdict) {
  const redis = getClient();
  return await redis.set('sunrose:verdict:' + symbol + ':' + mode, verdict, { get: true });
}

// ----------------------------------------------------------------------------
// PENDING VISION CONFIRMATIONS -- a simple queue so the fast, cheap, math-only
// watch.js tick can hand off a TRADE READY to the slower AI-vision worker
// without waiting for it. watch.js pushes; api/vision-worker.js (a separate
// scheduled job) pops and processes one at a time on its own 10-second budget.
// ----------------------------------------------------------------------------
async function pushPendingVision(record) {
  const redis = getClient();
  await redis.lpush('sunrose:pending_vision', JSON.stringify(record));
}

async function popPendingVision() {
  const redis = getClient();
  const raw = await redis.rpop('sunrose:pending_vision');
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return null; }
}

// ----------------------------------------------------------------------------
// OPEN POSITION TRACKING -- prevents placing a second demo trade on the same
// (symbol, mode) while one is already open. Cleared manually or by a future
// "check contract status" job -- this v1 does not yet auto-clear on close.
// ----------------------------------------------------------------------------
async function isPositionOpen(symbol, mode) {
  const redis = getClient();
  const v = await redis.get('sunrose:position:' + symbol + ':' + mode);
  return !!v;
}

async function markPositionOpen(symbol, mode, contractId) {
  const redis = getClient();
  await redis.set('sunrose:position:' + symbol + ':' + mode, contractId);
}

// ----------------------------------------------------------------------------
// SOLO SCAN VERDICT DEDUPE -- separate key namespace from getSetVerdict above.
// The solo scanner (api/xau-scan.js) runs independently of the math engine, so
// it needs its own transition-tracking key -- sharing the math engine's key
// would cause the two independent detection paths to suppress each other's
// alerts, which is wrong; each should alert on its own newly-found transition.
// ----------------------------------------------------------------------------
async function getSetSoloVerdict(symbol, mode, verdict) {
  const redis = getClient();
  return await redis.set('sunrose:soloverdict:' + symbol + ':' + mode, verdict, { get: true });
}

module.exports = {
  getCursor, setCursor, getVisionScanCursor, setVisionScanCursor,
  getLastAlignment, setLastAlignment, getSetAlignment,
  getLastVerdict, setLastVerdict, getSetVerdict,
  pushPendingVision, popPendingVision,
  isPositionOpen, markPositionOpen,
  getSetSoloVerdict
};
