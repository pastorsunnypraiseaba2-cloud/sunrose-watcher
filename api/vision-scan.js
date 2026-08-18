// ============================================================================
// VISION SCAN -- AI Vision as the PRIMARY scout across all Forex pairs + Gold.
// ============================================================================
// No math engine involved at all -- Claude looks at four fresh charts
// (Daily/4H/1H/15M) for each instrument and decides for itself, from scratch,
// using the full 10-step institutional checklist, for both Continuation and
// Reversal.
//
// COVERAGE MATH: Vercel's 10-second limit means one tick can't check even one
// full symbol (both modes) reliably -- checking both Continuation AND
// Reversal in a single run timed out in testing. This checks ONE (symbol,
// mode) pair per tick, rotating through 21 symbols x 2 modes = 42 units via a
// Redis-backed cursor. At one per 2-minute tick, a full pass through
// everything takes about 84 minutes -- "every 2 minutes" is how often this
// SCANNER runs, not how often any single instrument+mode gets rechecked.
//
// NOT wired to auto-trade. Auto-trading required the math engine AND Vision
// to independently agree; since the math-gated confirmation flow was removed,
// that cross-check no longer exists anywhere in the system. Wire this up
// deliberately later if you want it -- it should not happen silently.
// ============================================================================

const { buildState, fetchAuxTimeframeCandles } = require('../lib/build-state');
const { fetchChartImageBase64 } = require('../lib/chart-image');
const { callChartVision } = require('../lib/chart-vision');
const { sendTelegramAlert, sendTelegramPhoto } = require('../lib/telegram');
const { getVisionScanCursor, setVisionScanCursor, getSetSoloVerdict } = require('../lib/state');
const { fmt } = require('../lib/cpr-engine');

// Forex majors/crosses + Gold only, per your instruction -- excludes Silver
// and crypto (those stay on the original math-gated watcher only).
const FOREX_AND_GOLD = [
  'XAU/USD',
  'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
  'GBP/JPY', 'EUR/JPY', 'EUR/GBP', 'AUD/JPY', 'EUR/AUD', 'GBP/AUD',
  'EUR/CHF', 'GBP/CHF', 'CHF/JPY', 'AUD/CAD', 'CAD/JPY', 'NZD/JPY', 'AUD/NZD'
];

// Flatten to (symbol, mode) pairs -- 21 symbols x 2 modes = 42 units. Each
// tick processes exactly ONE unit: one symbol, ONE mode, ONE vision call.
// Checking both modes in a single invocation was the original design here and
// it timed out at 30s -- the version that worked reliably (the old
// vision-worker.js) only ever did one mode per run, so this matches that.
const SCAN_UNITS = [];
FOREX_AND_GOLD.forEach(function (sym) {
  SCAN_UNITS.push({ symbol: sym, mode: 'continuation' });
  SCAN_UNITS.push({ symbol: sym, mode: 'reversal' });
});

function formatScanAlert(symbol, mode, v) {
  const scoreLine = v.scores ? (v.scores.total + '/60 -- ' + v.scoreTier) : (v.scoreTier || 'unscored');
  const entryLine = v.entryZone && v.entryZone.low != null ? (fmt(v.entryZone.low) + '--' + fmt(v.entryZone.high)) : '--';
  const eliteTag = v.eliteSetup ? '\u2B50\uFE0F SUNROSE ELITE ' + (mode === 'reversal' ? 'REVERSAL' : 'CONTINUATION') + ' SETUP\n' : '';
  return (
    '\uD83D\uDD0E <b>' + symbol + ' -- AI VISION SCAN (' + mode + ')</b>\n' +
    'Found directly by AI Vision, no math-engine cross-check.\n\n' +
    eliteTag +
    'Verdict: ' + (v.verdict || 'unknown') + '   |   Score: ' + scoreLine + '\n' +
    'Direction: ' + (v.direction || '--') + '   |   Confidence: ' + (v.confidence != null ? v.confidence + '%' : '--') + '\n' +
    'Entry zone (AI read): ' + entryLine + '\n\n' +
    (v.institutionalExplanation || 'No explanation returned.')
  );
}

module.exports = async function handler(req, res) {
  const secret = req.query.secret || (req.headers['x-watch-secret']);
  if (!process.env.WATCH_SECRET || secret !== process.env.WATCH_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const cursor = await getVisionScanCursor(SCAN_UNITS.length);
  const unit = SCAN_UNITS[cursor];
  const { symbol, mode } = unit;
  const nextCursor = (cursor + 1) % SCAN_UNITS.length;
  await setVisionScanCursor(nextCursor);

  try {
    const S = await buildState(symbol);
    const [fourHour, oneHour, fifteenMin] = await Promise.all([
      fetchAuxTimeframeCandles(symbol, 14400, 60),
      fetchAuxTimeframeCandles(symbol, 3600, 60),
      fetchAuxTimeframeCandles(symbol, 900, 60)
    ]);
    const [dailyImg, fourHourImg, oneHourImg, fifteenMinImg] = await Promise.all([
      fetchChartImageBase64(S.dailyCandlesForChart, symbol, 'Daily'),
      fetchChartImageBase64(fourHour, symbol, '4H'),
      fetchChartImageBase64(oneHour, symbol, '1H'),
      fetchChartImageBase64(fifteenMin, symbol, '15M')
    ]);
    const images = [dailyImg, fourHourImg, oneHourImg, fifteenMinImg];

    const visionResult = await callChartVision(symbol, mode, images);
    const previousVerdict = await getSetSoloVerdict(symbol, mode, visionResult.verdict);
    const result = { verdict: visionResult.verdict, score: visionResult.scores ? visionResult.scores.total : null };

    if (visionResult.verdict === 'TRADE READY' && previousVerdict !== 'TRADE READY') {
      await Promise.all(images.map(function (img) {
        return sendTelegramPhoto(img.b64, img.mediaType, symbol + ' -- ' + img.tfLabel + ' (' + mode + ')');
      }));
      await sendTelegramAlert(formatScanAlert(symbol, mode, visionResult));
    }

    res.status(200).json({ processed: true, symbol: symbol, mode: mode, cursor: cursor, nextCursor: nextCursor, result: result });
  } catch (e) {
    res.status(200).json({ processed: false, symbol: symbol, mode: mode, cursor: cursor, error: e.message });
  }
};
