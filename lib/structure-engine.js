// ============================================================================
// STRUCTURE + LIQUIDITY ENGINE -- ported from Sunrose Trader OS (index.html)
// ============================================================================
// Every function here is a pure function of a candle array -- none of them
// read or write persistent state. That's what makes this deployable inside a
// stateless serverless function without a rebuilt history store: the app's
// browser copy keeps a rolling display log of past detections (merged and
// retained for 5 days) purely so the UI doesn't flicker between fetches --
// the underlying DETECTION itself is recomputed fresh from the candle window
// every single time, in the browser too. This file only ports the detection,
// not the display-log bookkeeping, because the watcher has no UI to keep
// stable and only cares about "is this true right now."
//
// ONE REAL GAP: the app also supports three zone types (Breaker Block,
// Mitigation Block, Inverse FVG) that are marked MANUALLY by the user in the
// UI -- there is no auto-detector for them in the source, only for Order
// Blocks and FVGs (see runAutoDetection in index.html, which calls exactly
// detectFVG and detectOrderBlocks and nothing else). This watcher can
// therefore never see bb/mb/ifvg zones, since there's no one here to mark
// them. In practice this only narrows the pool for the Rule 3 "soft"
// retracement check and slightly understates the Institutional Confluence
// score -- the DECISIVE final entry gate in both strategies (Continuation
// Rule 7 / Reversal Rule 5) only ever reads FVGs anyway, so the verdict
// itself is not weakened by this gap.
// ============================================================================

function findSwings(candles, lookback) {
  lookback = lookback || 3;
  var highs = [], lows = [];
  for (var i = lookback; i < candles.length - lookback; i++) {
    var isHigh = true, isLow = true;
    for (var j = 1; j <= lookback; j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow = false;
    }
    if (isHigh) highs.push({ idx: i, price: candles[i].h, t: candles[i].t });
    if (isLow) lows.push({ idx: i, price: candles[i].l, t: candles[i].t });
  }
  return { highs: highs, lows: lows };
}

function clusterLevels(points, tolerance) {
  var sorted = points.slice().sort(function (a, b) { return a.price - b.price; });
  var clusters = [];
  var current = null;
  sorted.forEach(function (p) {
    if (!current) { current = { prices: [p.price], points: [p] }; return; }
    var avg = current.prices.reduce(function (a, b) { return a + b; }, 0) / current.prices.length;
    if (Math.abs(p.price - avg) <= tolerance) {
      current.prices.push(p.price);
      current.points.push(p);
    } else {
      clusters.push(current);
      current = { prices: [p.price], points: [p] };
    }
  });
  if (current) clusters.push(current);
  return clusters.map(function (c) {
    var avgPrice = c.prices.reduce(function (a, b) { return a + b; }, 0) / c.prices.length;
    return { price: avgPrice, touches: c.points.length, latestIdx: Math.max.apply(null, c.points.map(function (p) { return p.idx; })) };
  });
}

function detectLiquidity(candles, tolerance) {
  var swings = findSwings(candles, 3);
  var bslClusters = clusterLevels(swings.highs, tolerance).filter(function (c) { return c.touches >= 1; });
  var sslClusters = clusterLevels(swings.lows, tolerance).filter(function (c) { return c.touches >= 1; });
  var currentPrice = candles[candles.length - 1].c;
  bslClusters = bslClusters.filter(function (c) { return c.price > currentPrice; })
    .sort(function (a, b) { return (b.touches - a.touches) || (a.price - b.price); }).slice(0, 3);
  sslClusters = sslClusters.filter(function (c) { return c.price < currentPrice; })
    .sort(function (a, b) { return (b.touches - a.touches) || (b.price - a.price); }).slice(0, 3);
  return { bsl: bslClusters, ssl: sslClusters };
}

function detectSweeps(candles, liquidity) {
  var sweptBSL = [], sweptSSL = [];
  var recentCandles = candles.slice(-30);
  liquidity.bsl.forEach(function (level) {
    for (var i = 0; i < recentCandles.length; i++) {
      var c = recentCandles[i];
      if (c.h > level.price && c.c < level.price) { sweptBSL.push(level); break; }
    }
  });
  liquidity.ssl.forEach(function (level) {
    for (var i = 0; i < recentCandles.length; i++) {
      var c = recentCandles[i];
      if (c.l < level.price && c.c > level.price) { sweptSSL.push(level); break; }
    }
  });
  return { sweptBSL: sweptBSL, sweptSSL: sweptSSL };
}

function detectStructure(candles) {
  var swings = findSwings(candles, 3);
  var allHighs = swings.highs, allLows = swings.lows;
  if (allHighs.length < 2 || allLows.length < 2) return { bos: [], choch: [] };
  var lastClose = candles[candles.length - 1].c;
  var bosEvents = [], chochEvents = [];
  var recentHighs = allHighs.slice(-3);
  var recentLows = allLows.slice(-3);
  var trendUp = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price > recentHighs[recentHighs.length - 2].price &&
    recentLows.length >= 2 && recentLows[recentLows.length - 1].price > recentLows[recentLows.length - 2].price;
  var trendDown = recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price < recentHighs[recentHighs.length - 2].price &&
    recentLows.length >= 2 && recentLows[recentLows.length - 1].price < recentLows[recentLows.length - 2].price;
  var lastSwingHigh = allHighs[allHighs.length - 1];
  var lastSwingLow = allLows[allLows.length - 1];
  var brokeAboveHigh = lastClose > lastSwingHigh.price;
  var brokeBelowLow = lastClose < lastSwingLow.price;
  if (brokeAboveHigh) {
    if (trendUp || (!trendUp && !trendDown)) {
      bosEvents.push({ dir: 'bullish', price: lastSwingHigh.price, id: 1 });
    } else if (trendDown) {
      chochEvents.push({ dir: 'bullish', price: lastSwingHigh.price, id: 1 });
    }
  }
  if (brokeBelowLow) {
    if (trendDown || (!trendUp && !trendDown)) {
      bosEvents.push({ dir: 'bearish', price: lastSwingLow.price, id: 1 });
    } else if (trendUp) {
      chochEvents.push({ dir: 'bearish', price: lastSwingLow.price, id: 1 });
    }
  }
  return { bos: bosEvents, choch: chochEvents };
}

function detectFVG(candles) {
  var fvgs = [];
  var recent = candles.slice(-60);
  for (var i = 2; i < recent.length; i++) {
    var c1 = recent[i - 2], c3 = recent[i];
    if (c1.h < c3.l) fvgs.push({ dir: 'bull', high: c3.l, low: c1.h, idx: i });
    if (c1.l > c3.h) fvgs.push({ dir: 'bear', high: c1.l, low: c3.h, idx: i });
  }
  var unfilled = fvgs.filter(function (f) {
    var afterCandles = recent.slice(f.idx + 1);
    var filled = afterCandles.some(function (c) { return c.l <= f.low && c.h >= f.high; });
    return !filled;
  });
  return unfilled.slice(-4);
}

function detectOrderBlocks(candles) {
  var obs = [];
  var recent = candles.slice(-80);
  var avgRange = recent.reduce(function (sum, c) { return sum + (c.h - c.l); }, 0) / recent.length;
  for (var i = 1; i < recent.length - 1; i++) {
    var curr = recent[i];
    var range = curr.h - curr.l;
    if (range > avgRange * 1.8) {
      var prev = recent[i - 1];
      var bullishImpulse = curr.c > curr.o;
      var bearishImpulse = curr.c < curr.o;
      if (bullishImpulse && prev.c < prev.o) {
        obs.push({ dir: 'bull', high: prev.h, low: prev.l, idx: i - 1 });
      } else if (bearishImpulse && prev.c > prev.o) {
        obs.push({ dir: 'bear', high: prev.h, low: prev.l, idx: i - 1 });
      }
    }
  }
  return obs.slice(-4);
}

// -- Rich level state classifier (9-state model) --
// Walks the hourly bars within a level's CURRENT period to determine what
// price has actually done there: Testing, Rejected, Broken, Accepted
// Above/Below, Retest in Progress, or Liquidity Sweep -- not just where
// price sits right now. Ported verbatim from fetchAll()'s classifyLevelRich.
function nyPartsFromUTC(dt) {
  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  var parts = {};
  fmt.formatToParts(dt).forEach(function (p) { if (p.type !== 'literal') parts[p.type] = p.value; });
  return { y: parseInt(parts.year, 10), m: parseInt(parts.month, 10), d: parseInt(parts.day, 10), h: parseInt(parts.hour === '24' ? '0' : parts.hour, 10) };
}
function nySessionKey(dtStr) {
  var utcDt = new Date(dtStr.replace(' ', 'T') + 'Z');
  var ny = nyPartsFromUTC(utcDt);
  var sessionDate = new Date(Date.UTC(ny.y, ny.m - 1, ny.d));
  if (ny.h >= 17) sessionDate.setUTCDate(sessionDate.getUTCDate() + 1);
  return sessionDate.toISOString().substring(0, 10);
}

function classifyLevelRich(levelPrice, bars, currentPrice, isHighLevel, tolerance) {
  if (levelPrice == null || !currentPrice || bars.length === 0) return null;
  var everClosedBeyond = false, everWickedBeyond = false, closesAfterBreakAllBeyond = true;
  bars.forEach(function (bar) {
    var closeBeyond = isHighLevel ? bar.c > levelPrice : bar.c < levelPrice;
    var wickBeyond = isHighLevel ? bar.h > levelPrice : bar.l < levelPrice;
    if (wickBeyond) everWickedBeyond = true;
    if (closeBeyond) { everClosedBeyond = true; }
    else if (everClosedBeyond) { closesAfterBreakAllBeyond = false; }
  });
  var currentBeyond = isHighLevel ? currentPrice > levelPrice : currentPrice < levelPrice;
  var testing = Math.abs(currentPrice - levelPrice) <= tolerance;
  if (testing) return everClosedBeyond ? 'Retest in Progress' : 'Testing';
  if (currentBeyond) {
    if (!everClosedBeyond) return isHighLevel ? 'Above' : 'Below';
    if (closesAfterBreakAllBeyond) return isHighLevel ? 'Accepted Above' : 'Accepted Below';
    return 'Broken';
  }
  if (everClosedBeyond) return 'Liquidity Sweep';
  if (everWickedBeyond) return 'Rejected';
  return isHighLevel ? 'Below' : 'Above';
}

// Builds richStates for pdh/pdl/pwh/pwl/pmh/pml given the tagged hourly bars
// and the current-period keys (today / this week's start / this month's prefix).
function buildRichStates(taggedBars, todayKey, weekKeyStart, monthKeyPrefix, dH, dL, wH, wL, mH, mL, price, tolerance, hasWeekly, hasMonthly) {
  var todayBars = taggedBars.filter(function (b) { return b.key === todayKey; });
  var weekBars = weekKeyStart ? taggedBars.filter(function (b) { return b.key >= weekKeyStart; }) : [];
  var monthBars = monthKeyPrefix ? taggedBars.filter(function (b) { return b.key.substring(0, 7) === monthKeyPrefix; }) : [];
  return {
    pdh: classifyLevelRich(dH, todayBars, price, true, tolerance),
    pdl: classifyLevelRich(dL, todayBars, price, false, tolerance),
    pwh: hasWeekly ? classifyLevelRich(wH, weekBars, price, true, tolerance) : null,
    pwl: hasWeekly ? classifyLevelRich(wL, weekBars, price, false, tolerance) : null,
    pmh: hasMonthly ? classifyLevelRich(mH, monthBars, price, true, tolerance) : null,
    pml: hasMonthly ? classifyLevelRich(mL, monthBars, price, false, tolerance) : null
  };
}

function calcTFStructureBias(price, prevH, prevL) {
  if (!price || prevH == null || prevL == null) return 'Unknown';
  if (price > prevH) return 'Bullish';
  if (price < prevL) return 'Bearish';
  return 'Neutral';
}

function calcStructureScore(mBias, wBias, dBias) {
  var weights = { monthly: 45, weekly: 35, daily: 20 };
  function pts(bias, w) { return bias === 'Bullish' ? w : bias === 'Neutral' ? w / 2 : bias === 'Bearish' ? 0 : w / 2; }
  var score = Math.round(pts(mBias, weights.monthly) + pts(wBias, weights.weekly) + pts(dBias, weights.daily));
  var label = score >= 70 ? 'Bullish' : score <= 30 ? 'Bearish' : 'Mixed / Balanced';
  return { score: score, label: label };
}

// -- The level/liquidity/zone finders both strategy evaluators call. -------
// These take a plain state object (built fresh per check, see brain.js)
// instead of reading a global -- same logic, explicit input.

function getLiquiditySweptStatus(direction, S) {
  var liq = S.liquidity || { bsl: [], ssl: [] };
  var relevantLiq = direction === 'BUY' ? liq.ssl : liq.bsl;
  var sweptLiq = (relevantLiq || []).filter(function (l) { return l.status === 'swept'; });
  var rs = (S.structureLevels && S.structureLevels.richStates) || {};
  var relevantLevels = direction === 'BUY' ? ['pdl', 'pwl', 'pml'] : ['pdh', 'pwh', 'pmh'];
  var sweptStructLevels = relevantLevels.filter(function (k) { return rs[k] === 'Liquidity Sweep'; });
  var pass = sweptLiq.length > 0 || sweptStructLevels.length > 0;
  var labels = { pdl: 'PDL', pwl: 'PWL', pml: 'PML', pdh: 'PDH', pwh: 'PWH', pmh: 'PMH' };
  var detail;
  if (pass) {
    var parts = [];
    if (sweptLiq.length > 0) parts.push(sweptLiq.length + ' marked ' + (direction === 'BUY' ? 'sell-side' : 'buy-side') + ' level(s)');
    if (sweptStructLevels.length > 0) parts.push(sweptStructLevels.map(function (k) { return labels[k]; }).join('/') + ' swept');
    detail = 'Liquidity taken -- ' + parts.join(' and ') + '.';
  } else {
    detail = 'No liquidity swept yet in the ' + (direction === 'BUY' ? 'sell-side (below price)' : 'buy-side (above price)') + ' direction. No sweep, no trade.';
  }
  return { pass: pass, detail: detail };
}

function findInstitutionalLevel(direction, S) {
  var sl = S.structureLevels;
  if (!sl || !S.price) return null;
  var rs = sl.richStates || {};
  var tolerance = (S.daily && S.daily.width ? S.daily.width : 10) * 0.15;
  function rsState(levelPrice, isHigh) {
    if (levelPrice == null || !S.price) return 'Below';
    if (Math.abs(S.price - levelPrice) <= tolerance) return 'Testing';
    if (isHigh) return S.price > levelPrice ? 'Broken' : 'Below';
    return S.price < levelPrice ? 'Broken' : 'Above';
  }
  var candidates;
  if (direction === 'SELL') {
    candidates = [
      { name: 'PMH', price: sl.pmh, state: rs.pmh, priority: 1 },
      { name: 'PWH', price: sl.pwh, state: rs.pwh, priority: 2 },
      { name: 'PDH', price: sl.pdh, state: rs.pdh, priority: 3 },
      { name: 'R4', price: S.daily ? S.daily.R4 : null, state: S.daily ? rsState(S.daily.R4, true) : 'Below', priority: 4 },
      { name: 'R3', price: S.daily ? S.daily.R3 : null, state: S.daily ? rsState(S.daily.R3, true) : 'Below', priority: 5 }
    ];
  } else {
    candidates = [
      { name: 'PML', price: sl.pml, state: rs.pml, priority: 1 },
      { name: 'PWL', price: sl.pwl, state: rs.pwl, priority: 2 },
      { name: 'PDL', price: sl.pdl, state: rs.pdl, priority: 3 },
      { name: 'S4', price: S.daily ? S.daily.S4 : null, state: S.daily ? rsState(S.daily.S4, false) : 'Above', priority: 4 },
      { name: 'S3', price: S.daily ? S.daily.S3 : null, state: S.daily ? rsState(S.daily.S3, false) : 'Above', priority: 5 }
    ];
  }
  var reachedStates = ['Testing', 'Rejected', 'Liquidity Sweep'];
  var reached = candidates.filter(function (c) { return c.price != null && reachedStates.indexOf(c.state) >= 0; });
  reached.sort(function (a, b) { return a.priority - b.priority; });
  return reached[0] || null;
}

function buildTargetLadder(direction, candidates, price) {
  if (!price) return [];
  var ahead = candidates.filter(function (c) {
    return c.price != null && (direction === 'BUY' ? c.price > price : c.price < price);
  });
  ahead.sort(function (a, b) { return Math.abs(a.price - price) - Math.abs(b.price - price); });
  return ahead;
}

// Broader zone finder (Rule 3's soft check) -- OB + FVG only, per the manual-
// marking gap noted at the top of this file. bb/mb/ifvg are never populated here.
function findEntryZone(direction, S) {
  var smc = S.smc || { ob: [], fvg: [] };
  var wantDir = direction === 'BUY' ? 'bull' : 'bear';
  var allZones = ['ob', 'fvg'].reduce(function (acc, t) {
    return acc.concat((smc[t] || []).filter(function (z) { return z.dir === wantDir; }).map(function (z) { return Object.assign({ ztype: t }, z); }));
  }, []);
  allZones.sort(function (a, b) { return b.idx - a.idx; });
  return allZones[0] || null;
}

// FVG-only entry zone -- the decisive final retest gate in both strategies.
function findFVGEntryZone(direction, S) {
  var smc = S.smc || { fvg: [] };
  var wantDir = direction === 'BUY' ? 'bull' : 'bear';
  var zones = (smc.fvg || []).filter(function (z) { return z.dir === wantDir; });
  zones.sort(function (a, b) { return b.idx - a.idx; });
  return zones[0] || null;
}

function scoreSetupQuality(direction, S) {
  if (!S.daily || !S.price || direction === 'NONE') return null;
  var wantDir = direction === 'BUY' ? 'bull' : 'bear';

  var align = (S.bias && S.bias.alignment) || 'NONE';
  var strengths = ['monthly', 'weekly', 'daily'].map(function (tf) { return S.bias && S.bias[tf] && S.bias[tf].conf != null ? S.bias[tf].conf : null; }).filter(function (v) { return v != null; });
  var avgStrength = strengths.length ? strengths.reduce(function (a, b) { return a + b; }, 0) / strengths.length : 50;
  var trendScore = (align === 'FULL_BULL' || align === 'FULL_BEAR') ? Math.round(7 + (avgStrength / 100) * 3)
    : (align === 'PARTIAL_BULL' || align === 'PARTIAL_BEAR') ? Math.round(4 + (avgStrength / 100) * 2)
    : 2;

  var liq = S.liquidity || { bsl: [], ssl: [] };
  var relevantPool = direction === 'BUY' ? (liq.ssl || []) : (liq.bsl || []);
  var sweptCount = relevantPool.filter(function (l) { return l.status === 'swept'; }).length;
  var liqScore = sweptCount >= 2 ? 9 : sweptCount === 1 ? 7 : relevantPool.length > 0 ? 3 : 1;

  var struct = S.structure || { bos: [], choch: [] };
  // NOTE: detectStructure() labels events 'bullish'/'bearish', not 'bull'/'bear'.
  // Match by substring (same approach brain.js already uses successfully for
  // this exact comparison) instead of strict equality, which always failed
  // and silently zeroed this score.
  var hasBOS = (struct.bos || []).some(function (b) { return b.dir && b.dir.indexOf(wantDir) >= 0; });
  var hasCHoCH = (struct.choch || []).some(function (c) { return c.dir && c.dir.indexOf(wantDir) >= 0; });
  var structScore = hasBOS && hasCHoCH ? 9 : hasBOS ? 8 : hasCHoCH ? 6 : 2;

  var candles = S.recentDailyCandles || [];
  var momScore = 5;
  if (candles.length >= 3) {
    var consec = 0;
    for (var i = 0; i < Math.min(5, candles.length - 1); i++) {
      var cNow = candles[i], cPrev = candles[i + 1];
      var isDir = direction === 'BUY' ? cNow.close > cPrev.close : cNow.close < cPrev.close;
      if (isDir) consec++; else break;
    }
    var ratios = [];
    for (var j = 0; j < Math.min(5, candles.length - 1); j++) {
      var range = candles[j].high - candles[j].low;
      if (range > 0) ratios.push(Math.min(1, Math.abs(candles[j].close - candles[j + 1].close) / range));
    }
    var avgBody = ratios.length ? ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length : 0.5;
    momScore = Math.max(1, Math.min(10, Math.round(consec * 2 + avgBody * 6)));
  }

  var pullScore = 5;
  if (candles.length >= 5) {
    var win = candles.slice(0, 10);
    var hi = Math.max.apply(null, win.map(function (c) { return c.high; }));
    var lo = Math.min.apply(null, win.map(function (c) { return c.low; }));
    var legSize = hi - lo;
    if (legSize > 0) {
      var retrace = direction === 'BUY' ? (hi - S.price) / legSize : (S.price - lo) / legSize;
      pullScore = retrace < 0.05 ? 4 : retrace <= 0.38 ? 9 : retrace <= 0.61 ? 6 : 3;
    }
  }

  var tol = (S.daily.width || 0) * 0.5;
  var confCount = 0;
  var smc = S.smc || {};
  ['ob', 'fvg'].forEach(function (t) {
    if ((smc[t] || []).some(function (z) { return z.dir === wantDir && S.price >= z.low - tol && S.price <= z.high + tol; })) confCount++;
  });
  if (S.price >= S.daily.BC - tol && S.price <= S.daily.TC + tol) confCount++;
  var sl = S.structureLevels || {};
  [sl.pdh, sl.pdl, sl.pwh, sl.pwl].forEach(function (lvl) { if (lvl && Math.abs(S.price - lvl) <= tol) confCount++; });
  var confScore = Math.max(1, Math.min(10, 2 + confCount * 2));

  var total = trendScore + liqScore + structScore + momScore + pullScore + confScore;
  var tier = total >= 55 ? 'Elite Institutional Setup' : total >= 48 ? 'High Probability' : total >= 40 ? 'Tradable' : 'Ignore';

  return {
    trendAlignment: trendScore, liquiditySweep: liqScore, structureBreak: structScore,
    momentum: momScore, pullbackQuality: pullScore, institutionalConfluence: confScore,
    total: total, tier: tier
  };
}

module.exports = {
  findSwings, clusterLevels, detectLiquidity, detectSweeps, detectStructure,
  detectFVG, detectOrderBlocks, nySessionKey, classifyLevelRich, buildRichStates,
  calcTFStructureBias, calcStructureScore,
  getLiquiditySweptStatus, findInstitutionalLevel, buildTargetLadder,
  findEntryZone, findFVGEntryZone, scoreSetupQuality
};
