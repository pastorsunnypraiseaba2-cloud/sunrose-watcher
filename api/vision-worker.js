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
const { popPendingVision } = require('../lib/state');
const { fetchChartImageBase64 } = require('../lib/chart-image');
const { callChartVision } = require('../lib/chart-vision');
const { sendTelegramAlert } = require('../lib/telegram');

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
      await sendTelegramAlert(formatVisionAlert(pending.symbol, pending.mode, pending.price, visionResult));
    } catch (telegramErr) {
      res.status(200).json({ processed: true, symbol: pending.symbol, mode: pending.mode, visionResult: visionResult, telegramError: telegramErr.message });
      return;
    }
    res.status(200).json({ processed: true, symbol: pending.symbol, mode: pending.mode, verdict: visionResult.verdict, score: visionResult.scores ? visionResult.scores.total : null });
  } catch (e) {
    res.status(200).json({ processed: false, symbol: pending.symbol, mode: pending.mode, error: e.message });
  }
};
