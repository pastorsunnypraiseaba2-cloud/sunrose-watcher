// ============================================================================
// SUNROSE WATCHER -- Phase 1 (CPR alignment) + Phase 2 (TRADE READY verdicts)
// ============================================================================
// Hit by an external scheduler (cron-job.org or similar) every few minutes.
// Each call processes ONE BATCH of the watch list, runs the full ported Brain
// (both Continuation and Reversal strategies) against each symbol, and
// Telegram-alerts on:
//
//   - A symbol newly reaching full Monthly+Weekly+Daily CPR alignment
//     ("heads up, worth watching") -- unchanged from Phase 1.
//   - A symbol newly reaching TRADE READY on either strategy
//     ("the six/eight-rule verdict just fired") -- Phase 2.
//
// Both are transition-triggered (alert once when the state is newly reached,
// not every tick it holds) via Upstash-backed dedupe.
//
// BATCHING, same reasoning as Phase 1: Vercel Hobby's 10-second ceiling is
// hard and non-configurable. Phase 2 adds no extra Deriv calls per symbol --
// structure/liquidity/rich-state detection all run on the same hourly candle
// set Phase 1 already fetches -- so the same batch size that worked for
// Phase 1 should still fit. Watch the function logs after deploying and
// lower WATCH_BATCH_SIZE if you see timeouts.
// ============================================================================

const { fmt } = require('../lib/cpr-engine');
const { buildState } = require('../lib/build-state');
const { evaluateContinuationStrategy, evaluateReversalStrategy } = require('../lib/brain');
const { getCursor, setCursor, getSetAlignment, getSetVerdict, pushPendingVision } = require('../lib/state');
const { sendTelegramAlert } = require('../lib/telegram');
const WATCHLIST = require('../lib/watchlist');

const BATCH_SIZE = parseInt(process.env.WATCH_BATCH_SIZE || '5', 10);

async function checkOneSymbol(symLabel) {
  const S = await buildState(symLabel);
  const continuation = evaluateContinuationStrategy(S);
  const reversal = evaluateReversalStrategy(S);
  return { symLabel, price: S.price, bias: S.bias, continuation, reversal, dailyCandlesForChart: S.dailyCandlesForChart };
}

function formatVerdictAlert(symLabel, price, result) {
  const dirWord = result.direction === 'BUY' ? 'BUY' : 'SELL';
  const targetLine = result.target ? (result.target.name + ' at ' + fmt(result.target.price)) : 'mark further levels';
  const rrLine = result.riskReward != null ? ('1:' + result.riskReward.toFixed(2)) : '--';
  return (
    '\uD83D\uDFE2 <b>' + symLabel + ' -- ' + result.strategyName + ': TRADE READY (' + dirWord + ')</b>\n' +
    'Quality: ' + result.quality + ' (' + result.confidence + '%)\n' +
    'Price: ' + fmt(price) + '\n' +
    'Entry zone: ' + (result.entryZone ? fmt(result.entryZone.low) + '--' + fmt(result.entryZone.high) : '--') + '\n' +
    'Stop: ' + (result.stopPrice != null ? fmt(result.stopPrice) : '--') + '\n' +
    'Target: ' + targetLine + '  |  RR ' + rrLine + '\n\n' +
    'Ported from your real Constitution logic, but not yet validated against the live app for this instrument -- confirm in the app before acting.'
  );
}

module.exports = async function handler(req, res) {
  const secret = req.query.secret || (req.headers['x-watch-secret']);
  if (!process.env.WATCH_SECRET || secret !== process.env.WATCH_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const cursor = await getCursor(WATCHLIST.length);
  const batch = [];
  for (let i = 0; i < BATCH_SIZE && i < WATCHLIST.length; i++) {
    batch.push(WATCHLIST[(cursor + i) % WATCHLIST.length]);
  }

  const results = await Promise.allSettled(batch.map(checkOneSymbol));

  const summary = [];
  for (let i = 0; i < results.length; i++) {
    const symLabel = batch[i];
    const r = results[i];

    if (r.status === 'rejected') {
      summary.push({ symbol: symLabel, ok: false, error: r.reason.message });
      continue;
    }

    const { price, bias, continuation, reversal, dailyCandlesForChart } = r.value;
    const alignment = bias.alignment;
    const entry = { symbol: symLabel, ok: true, alignment: alignment, price: price, continuation: continuation.verdict, reversal: reversal.verdict };
    summary.push(entry);

    // -- Phase 1: CPR alignment heads-up --
    // getSetAlignment reads the old value AND writes the new one in a single
    // atomic Redis call, so two overlapping invocations can't both see the
    // stale value and both alert. Only touch the stored key when this tick
    // actually produced a real alignment -- NO_DATA never triggers an alert
    // anyway (isFullAlignment is false), so there's nothing to gain by
    // overwriting a real prior alignment with "no data this tick," and doing
    // so would break the transition comparison on the next good tick.
    const isFullAlignment = alignment === 'FULL_BULL' || alignment === 'FULL_BEAR';
    const previousAlignment = alignment !== 'NO_DATA' ? await getSetAlignment(symLabel, alignment) : null;
    if (isFullAlignment && previousAlignment !== alignment) {
      const direction = alignment === 'FULL_BULL' ? 'BULLISH' : 'BEARISH';
      const note = bias.dailyNote ? '\n' + bias.dailyNote : '';
      try {
        await sendTelegramAlert(
          '\u26A1 <b>' + symLabel + ' -- full ' + direction + ' alignment</b>\n' +
          'Monthly + Weekly + Daily CPR all agree.\nPrice: ' + fmt(price) + note + '\n\n' +
          'This is the precondition, not a verdict -- see if either strategy below reaches TRADE READY.'
        );
      } catch (e) { entry.alignmentTelegramError = e.message; }
    }

    // -- Phase 2: full verdicts, one dedupe key per (symbol, mode) --
    // Same atomic read-and-set fix -- this is the one that caused the
    // duplicate ADA/USD TRADE READY alert under the old two-step approach.
    for (const [mode, result] of [['continuation', continuation], ['reversal', reversal]]) {
      const previousVerdict = await getSetVerdict(symLabel, mode, result.verdict);
      if (result.verdict === 'TRADE READY' && previousVerdict !== 'TRADE READY') {
        try {
          await sendTelegramAlert(formatVerdictAlert(symLabel, price, result));
        } catch (e) { entry[mode + 'TelegramError'] = e.message; }
        // Queue the slower AI Chart Vision confirmation instead of running it
        // inline -- this keeps the fast math-only tick fast and safely inside
        // Vercel's 10-second limit. A separate scheduled job (api/vision-worker)
        // picks this up and sends a follow-up Telegram message with the
        // hedge-fund-style explanation once it's done.
        try {
          await pushPendingVision({ symbol: symLabel, mode: mode, price: price, dailyCandlesForChart: dailyCandlesForChart, queuedAt: Date.now() });
        } catch (e) { entry[mode + 'VisionQueueError'] = e.message; }
      }
    }
  }

  await setCursor((cursor + BATCH_SIZE) % WATCHLIST.length);

  res.status(200).json({
    checked: batch,
    nextCursor: (cursor + BATCH_SIZE) % WATCHLIST.length,
    results: summary
  });
};
