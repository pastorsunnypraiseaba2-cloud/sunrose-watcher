// ============================================================================
// VISION WORKER -- picks up one queued TRADE READY event at a time and runs
// the full Chart Vision AI confirmation (auto-generated chart + your ported
// 10-step prompt) against it, on its OWN 10-second budget, separate from the
// fast math-only watch.js tick.
// ============================================================================
// Hit by its OWN cron-job.org schedule (separate from the main watcher). Every
// 2 minutes is reasonable -- TRADE READY events should be rare, so most ticks
// will find nothing pending and return immediately.
// ============================================================================

const { fmt } = require('../lib/cpr-engine');
const { popPendingVision, isPositionOpen, markPositionOpen } = require('../lib/state');
const { fetchChartImageBase64 } = require('../lib/chart-image');
const { callChartVision } = require('../lib/chart-vision');
const { sendTelegramAlert, sendTelegramPhoto } = require('../lib/telegram');
const { toDerivSymbol } = require('../lib/deriv');
const { placeMultiplierTrade } = require('../lib/deriv-trade');

function formatVisionAlert(symbol, mode, mathPrice, v) {
  const scoreLine = v.scores ? (v.scores.total + '/60 -- ' + v.scoreTier) : (v.scoreTier || 'unscored');
  const entryLine = v.entryZone && v.entryZone.low != null ? (fmt(v.entryZone.low) + '--' + fmt(v.entryZone.high)) : '--';
  const eliteTag = v.eliteSetup ? '\u2B50\uFE0F SUNROSE ELITE ' + (mode === 'reversal' ? 'REVERSAL' : 'CONTINUATION') + ' SETUP\n' : '';
  return (
    '\uD83E\uDDE0 <b>' + symbol + ' -- AI Vision Confirmation (' + mode + ')</b>\n' +
    eliteTag +
    'Verdict: ' + (v.verdict || 'unknown') + '   |   Score: ' + scoreLine + '\n' +
    'Direction: ' + (v.direction || '--') + '   |   Confidence: ' + (v.confidence != null ? v.confidence + '%' : '--') + '\n' +
    'Entry zone (AI read): ' + entryLine + '\n\n' +
    (v.institutionalExplanation || 'No explanation returned.') + '\n\n' +
    'This is Claude reading an auto-generated Daily chart -- a single-timeframe check, less thorough than manually running Chart Vision in the app with your full multi-timeframe screenshot set. Cross-check before acting.'
  );
}

function formatTradeAlert(symbol, mode, direction, tradeResult, error) {
  if (error) {
    return '\u26A0\uFE0F <b>' + symbol + ' -- AUTO-TRADE FAILED (' + mode + ', ' + direction + ')</b>\nMath engine and AI both agreed TRADE READY, but placing the demo order failed:\n' + error + '\n\nNo position was opened. Check manually if you want this trade.';
  }
  return (
    '\uD83E\uDD16 <b>' + symbol + ' -- DEMO TRADE PLACED (' + mode + ', ' + direction + ')</b>\n' +
    'Contract ID: ' + tradeResult.contractId + '\n' +
    'Buy price: ' + fmt(tradeResult.buyPrice) + '   |   Multiplier: x' + tradeResult.multiplier + '\n' +
    'Stop loss: $' + tradeResult.stopLossUSD + '   |   Take profit: $' + tradeResult.takeProfitUSD + '\n\n' +
    'Both the math engine and AI Vision independently confirmed TRADE READY before this order was placed. This is your DEMO account -- verify in the Deriv app.'
  );
}

module.exports = async function handler(req, res) {
  const secret = req.query.secret || (req.headers['x-watch-secret']);
  if (!process.env.WATCH_SECRET || secret !== process.env.WATCH_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const pending = await popPendingVision();
  if (!pending) {
    res.status(200).json({ processed: false, reason: 'queue empty' });
    return;
  }

  try {
    const image = await fetchChartImageBase64(pending.dailyCandlesForChart, pending.symbol);
    const visionResult = await callChartVision(pending.symbol, pending.mode, image.b64, image.mediaType);
    try {
      // Send the actual chart Claude analyzed first, so the text verdict that
      // follows has visual context right above it in the chat.
      await sendTelegramPhoto(image.b64, image.mediaType, pending.symbol + ' -- auto-generated Daily chart (' + pending.mode + ')');
      await sendTelegramAlert(formatVisionAlert(pending.symbol, pending.mode, pending.price, visionResult));
    } catch (telegramErr) {
      res.status(200).json({ processed: true, symbol: pending.symbol, mode: pending.mode, visionResult: visionResult, telegramError: telegramErr.message });
      return;
    }

    // -- Auto-trade gate (DEMO account only, and only if explicitly enabled) --
    // Fires ONLY when the math engine (which queued this) AND the AI Vision
    // check independently agree: verdict TRADE READY, same direction. This
    // double-confirmation mirrors the "Brain vs Chart Vision agreement" check
    // already in your app, and is intentionally strict -- given how many bugs
    // we found in the math engine this session, requiring two independent
    // reads to agree before any real order is placed is the right amount of
    // caution for now.
    const autoTradeOn = (process.env.AUTO_TRADE_ENABLED || '').toLowerCase() === 'true';
    const agrees = visionResult.verdict === 'TRADE READY' && visionResult.direction === pending.direction;
    if (autoTradeOn && agrees) {
      const alreadyOpen = await isPositionOpen(pending.symbol, pending.mode);
      if (!alreadyOpen) {
        try {
          const stakeUSD = parseFloat(process.env.AUTO_TRADE_STAKE_USD || '10');
          const tradeResult = await placeMultiplierTrade({
            derivSymbol: toDerivSymbol(pending.symbol), direction: pending.direction, stakeUSD: stakeUSD,
            entryPrice: pending.price, stopPrice: pending.stopPrice, targetPrice: pending.targetPrice
          });
          await markPositionOpen(pending.symbol, pending.mode, tradeResult.contractId);
          await sendTelegramAlert(formatTradeAlert(pending.symbol, pending.mode, pending.direction, tradeResult, null));
        } catch (tradeErr) {
          await sendTelegramAlert(formatTradeAlert(pending.symbol, pending.mode, pending.direction, null, tradeErr.message));
        }
      }
    }

    res.status(200).json({ processed: true, symbol: pending.symbol, mode: pending.mode, verdict: visionResult.verdict, score: visionResult.scores ? visionResult.scores.total : null });
  } catch (e) {
    res.status(200).json({ processed: false, symbol: pending.symbol, mode: pending.mode, error: e.message });
  }
};
