// ============================================================================
// STATE BUILDER -- assembles one symbol's full check from a single Deriv fetch
// ============================================================================
// This is the piece that didn't exist as a single function in index.html --
// there, it's inlined into the big fetchAll() button handler, interleaved
// with DOM updates. This file is that same sequence of derivations, in the
// same order, with the DOM calls removed and the result returned as a plain
// object instead of written into a global S.
// ============================================================================

const { calcCPR, validateCPR, calcStrictBias } = require('./cpr-engine');
const { toDerivSymbol, derivFetchCandles, derivFetchQuote, buildNYDailyCandles, buildWeeklyFromDaily, buildMonthlyFromDaily } = require('./deriv');
const { detectLiquidity, detectSweeps, detectStructure, detectFVG, detectOrderBlocks, nySessionKey, classifyLevelRich } = require('./structure-engine');

async function buildState(symLabel) {
  const derivSym = toDerivSymbol(symLabel);

  const [quote, hourly] = await Promise.all([
    derivFetchQuote(derivSym),
    derivFetchCandles(derivSym, 3600, 1560)
  ]);
  const price = parseFloat(quote.close || hourly.values[0].close);

  const dayValues = buildNYDailyCandles(hourly.values);
  if (dayValues.length < 3) throw new Error('Not enough daily history reconstructed');
  const dPrev = dayValues[1];
  const dH = parseFloat(dPrev.high), dL = parseFloat(dPrev.low);
  const dailyCPR = calcCPR(dH, dL, parseFloat(dPrev.close));
  const dailyValid = validateCPR('Daily', dH, dL, dPrev.close, dailyCPR);
  if (!dailyValid.valid) throw new Error('Daily CPR invalid: ' + dailyValid.errors.join('; '));

  const weekValues = buildWeeklyFromDaily(dayValues);
  let weeklyCPR = null, wH = null, wL = null;
  if (weekValues.length >= 2) {
    const wPrev = weekValues[1];
    wH = parseFloat(wPrev.high); wL = parseFloat(wPrev.low);
    weeklyCPR = calcCPR(wH, wL, parseFloat(wPrev.close));
    const weeklyValid = validateCPR('Weekly', wH, wL, wPrev.close, weeklyCPR);
    if (!weeklyValid.valid) throw new Error('Weekly CPR invalid: ' + weeklyValid.errors.join('; '));
  }

  const monthValues = buildMonthlyFromDaily(dayValues);
  let monthlyCPR = null, mH = null, mL = null;
  if (monthValues.length >= 2) {
    // monthValues[0] is the current (in-progress) month, monthValues[1] is the
    // last FULLY COMPLETED month -- that's what Monthly CPR must be built from,
    // regardless of what day it is right now. There is no reason to gate this
    // to the first few days of the new month: monthValues[1] is already a
    // closed, complete month no matter when "today" falls.
    const mPrev = monthValues[1];
    mH = parseFloat(mPrev.high); mL = parseFloat(mPrev.low);
    monthlyCPR = calcCPR(mH, mL, parseFloat(mPrev.close));
    const monthlyValid = validateCPR('Monthly', mH, mL, mPrev.close, monthlyCPR);
    if (!monthlyValid.valid) throw new Error('Monthly CPR invalid: ' + monthlyValid.errors.join('; '));
  }
  // If fewer than 2 months of daily history exist yet, monthlyCPR stays null --
  // calcStrictBias treats that as NO_DATA, which is correct: there genuinely
  // isn't a completed prior month to calculate from yet.

  const bias = calcStrictBias(price, monthlyCPR, weeklyCPR, dailyCPR, symLabel);

  // -- rawHourly, in the {t,o,h,l,c} shape the structure/liquidity detectors expect --
  const rawHourly = hourly.values.map(function (c) {
    return { t: new Date(c.datetime.replace(' ', 'T') + 'Z').getTime(), o: parseFloat(c.open), h: parseFloat(c.high), l: parseFloat(c.low), c: parseFloat(c.close) };
  }).sort(function (a, b) { return a.t - b.t; });

  const recentDailyCandles = dayValues.slice(1, 12).map(function (d) {
    return { high: parseFloat(d.high), low: parseFloat(d.low), close: parseFloat(d.close), datetime: d.datetime };
  });

  // -- dailyCandlesForChart: up to 60 daily candles, OLDEST FIRST (chronological,
  // left-to-right), for feeding an auto-generated chart image to Chart Vision AI.
  // dayValues itself is newest-first (see deriv.js), so reverse after slicing.
  const dailyCandlesForChart = dayValues.slice(0, 60).map(function (d) {
    return { datetime: d.datetime, open: parseFloat(d.open), high: parseFloat(d.high), low: parseFloat(d.low), close: parseFloat(d.close) };
  }).reverse();

  // -- structureLevels: PDH/PDL/PWH/PWL/PMH/PML are the SAME prior-period H/L
  // that feed the CPR above -- surfaced directly, exactly as the app does it.
  const structureLevels = {
    pdh: dH, pdl: dL,
    todayH: parseFloat(dayValues[0].high), todayL: parseFloat(dayValues[0].low),
    pwh: weeklyCPR ? wH : null, pwl: weeklyCPR ? wL : null,
    pmh: monthlyCPR ? mH : null, pml: monthlyCPR ? mL : null
  };

  const taggedBars = hourly.values.map(function (c) {
    return { key: nySessionKey(c.datetime), h: parseFloat(c.high), l: parseFloat(c.low), c: parseFloat(c.close), dt: c.datetime };
  }).sort(function (a, b) { return a.dt < b.dt ? -1 : 1; });

  const todayKey = dayValues[0].datetime;
  const weekKeyStart = weeklyCPR ? weekValues[0].datetime : null;
  const monthKeyPrefix = monthlyCPR ? monthValues[0].datetime.substring(0, 7) : null;
  const todayBars = taggedBars.filter(function (b) { return b.key === todayKey; });
  const weekBars = weekKeyStart ? taggedBars.filter(function (b) { return b.key >= weekKeyStart; }) : [];
  const monthBars = monthKeyPrefix ? taggedBars.filter(function (b) { return b.key.substring(0, 7) === monthKeyPrefix; }) : [];
  const richTolerance = (dailyCPR.width || 10) * 0.15;

  structureLevels.richStates = {
    pdh: classifyLevelRich(dH, todayBars, price, true, richTolerance),
    pdl: classifyLevelRich(dL, todayBars, price, false, richTolerance),
    pwh: weeklyCPR ? classifyLevelRich(wH, weekBars, price, true, richTolerance) : null,
    pwl: weeklyCPR ? classifyLevelRich(wL, weekBars, price, false, richTolerance) : null,
    pmh: monthlyCPR ? classifyLevelRich(mH, monthBars, price, true, richTolerance) : null,
    pml: monthlyCPR ? classifyLevelRich(mL, monthBars, price, false, richTolerance) : null
  };

  // -- liquidity + sweeps, structure, and SMC zones -- all pure functions of rawHourly --
  const liquidityRaw = detectLiquidity(rawHourly, richTolerance);
  const sweeps = detectSweeps(rawHourly, liquidityRaw);
  const liquidity = {
    bsl: liquidityRaw.bsl.map(function (l) { return Object.assign({ status: sweeps.sweptBSL.indexOf(l) >= 0 ? 'swept' : 'untouched' }, l); }),
    ssl: liquidityRaw.ssl.map(function (l) { return Object.assign({ status: sweeps.sweptSSL.indexOf(l) >= 0 ? 'swept' : 'untouched' }, l); })
  };
  const structure = detectStructure(rawHourly);
  const fvgs = detectFVG(rawHourly).map(function (z, i) { return Object.assign({ idx: z.idx != null ? z.idx : i }, z); });
  const obs = detectOrderBlocks(rawHourly).map(function (z, i) { return Object.assign({ idx: z.idx != null ? z.idx : i }, z); });
  const smc = { ob: obs, fvg: fvgs };

  return {
    symbol: symLabel, price: price,
    daily: dailyCPR, weekly: weeklyCPR, monthly: monthlyCPR,
    bias: bias, structureLevels: structureLevels,
    recentDailyCandles: recentDailyCandles,
    dailyCandlesForChart: dailyCandlesForChart,
    structure: structure, liquidity: liquidity, smc: smc,
    settings: { minRR: 2 }
  };
}

// ----------------------------------------------------------------------------
// EXECUTION-TIMEFRAME CANDLES FOR CHART VISION -- only called from the vision
// worker (never from the fast watch.js tick), since it's extra Deriv calls
// that only need to happen on the rare TRADE READY confirmation, not every
// 2-minute check. Returns ascending-order (oldest-first) candles ready for
// chart-image.js, same shape as dailyCandlesForChart above.
// ----------------------------------------------------------------------------
async function fetchAuxTimeframeCandles(symLabel, granularitySec, count) {
  const derivSym = toDerivSymbol(symLabel);
  const resp = await derivFetchCandles(derivSym, granularitySec, count);
  return resp.values.map(function (c) {
    return { datetime: c.datetime, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close) };
  }).reverse(); // derivFetchCandles returns newest-first; charts want oldest-first
}

module.exports = { buildState, fetchAuxTimeframeCandles };
