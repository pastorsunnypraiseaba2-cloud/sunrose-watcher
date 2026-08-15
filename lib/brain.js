// ============================================================================
// STRATEGY EVALUATORS -- ported from Sunrose Trader OS (index.html)
// ============================================================================
// evaluateContinuationStrategy and evaluateReversalStrategy below are as close
// to a literal transcription of your real evaluateContinuationStrategy() /
// evaluateReversalStrategy() as the S-global -> explicit-parameter change
// allows. Every rule, every threshold, every design-note comment from the
// source is preserved so this can be diffed against index.html later.
//
// S here is a plain object built fresh per check by buildState() in
// api/watch.js -- not the browser's global S, and not persisted between
// checks. See structure-engine.js's file header for why that's enough.
// ============================================================================

const { calcTFStructureBias, calcStructureScore, getLiquiditySweptStatus,
  findInstitutionalLevel, buildTargetLadder, findEntryZone, findFVGEntryZone,
  scoreSetupQuality } = require('./structure-engine');
const { fmt } = require('./cpr-engine');

function evaluateContinuationStrategy(S) {
  var b = S.bias;
  var price = S.price;
  var mBias = b.monthly && b.monthly.bias;
  var wBias = b.weekly && b.weekly.bias;
  var dBias = b.daily && b.daily.bias;

  // Rule 1 -- Trend Alignment: Monthly + Weekly + Daily CPR must ALL agree.
  var trendPass = !!(mBias && wBias && dBias && mBias === wBias && wBias === dBias && mBias !== 'NEUTRAL');
  var direction = trendPass ? (mBias === 'BULLISH' ? 'BUY' : 'SELL') : 'NONE';
  var trendDetail = trendPass
    ? 'Monthly, Weekly and Daily all ' + mBias + ', with price on the correct side of Daily CPR -- the trend is established.'
    : (mBias && wBias && dBias) ? 'Monthly (' + mBias + '), Weekly (' + wBias + '), Daily (' + dBias + ') do not all agree -- no established trend to continue.'
    : 'Fetch market data first.';

  // Rule 2 -- Strong Impulse Leg Exists.
  var sl0 = S.structureLevels || {};
  var impulseMBias = calcTFStructureBias(price, sl0.pmh, sl0.pml);
  var impulseWBias = calcTFStructureBias(price, sl0.pwh, sl0.pwl);
  var impulseDBias = calcTFStructureBias(price, sl0.pdh, sl0.pdl);
  var impulseScore = calcStructureScore(impulseMBias, impulseWBias, impulseDBias);
  var impulsePassToday = trendPass && (direction === 'BUY' ? impulseScore.score >= 55 : impulseScore.score <= 45);
  var impulsePassRecently = false;
  if (trendPass && !impulsePassToday && S.recentDailyCandles && S.recentDailyCandles.length > 0) {
    for (var ri = 0; ri < Math.min(3, S.recentDailyCandles.length); ri++) {
      var rd = S.recentDailyCandles[ri];
      if (!rd) continue;
      var recentScoreApprox = direction === 'BUY'
        ? (rd.close > (sl0.pmh || Infinity) || rd.close > (sl0.pwh || Infinity) || rd.close > (sl0.pdh || Infinity))
        : (rd.close < (sl0.pml || -Infinity) || rd.close < (sl0.pwl || -Infinity) || rd.close < (sl0.pdl || -Infinity));
      if (recentScoreApprox) { impulsePassRecently = true; break; }
    }
  }
  var impulsePass = impulsePassToday || impulsePassRecently;
  var impulseDetail = !trendPass ? 'Waiting on trend alignment first.'
    : impulsePassToday ? 'Structure Score ' + impulseScore.score + '/100 confirms a strong ' + (direction === 'BUY' ? 'bullish' : 'bearish') + ' impulse leg is already in place.'
    : impulsePassRecently ? 'A strong impulse leg occurred within the last 3 days -- price has since started retracing, which is expected.'
    : 'Structure Score ' + impulseScore.score + '/100 does not yet show a strong enough impulse leg -- market may still be choppy.';

  // Rule 3 -- Retraced Into Value.
  var insideDailyCPR = !!(price && S.daily && price >= S.daily.BC && price <= S.daily.TC);
  var insideWeeklyCPR = !!(price && S.weekly && price >= S.weekly.BC && price <= S.weekly.TC);
  var earlyZone = direction !== 'NONE' ? findEntryZone(direction, S) : null;
  var insideEarlyZone = !!(earlyZone && price && price >= earlyZone.low && price <= earlyZone.high);
  var retracedIntoValue = impulsePass && (insideDailyCPR || insideWeeklyCPR || insideEarlyZone);
  var retraceDetail = !impulsePass ? 'Waiting on the impulse leg first.'
    : retracedIntoValue ? 'Price has retraced into ' + (insideEarlyZone ? 'a valid zone' : insideDailyCPR ? 'the Daily CPR' : 'the Weekly CPR') + ' -- correction into value confirmed.'
    : 'Price has not yet corrected into the Daily CPR, Weekly CPR, or a valid zone. No retracement, no trade.';

  // Rule 4 -- Liquidity Swept Against Trend (mandatory).
  var liqStatus = retracedIntoValue ? getLiquiditySweptStatus(direction, S) : { pass: false, detail: 'Waiting on the retracement first.' };

  // Rule 5 -- Structure Holds (no opposing CHoCH).
  var struct = S.structure || { bos: [], choch: [] };
  var wantDir = direction === 'BUY' ? 'bull' : 'bear';
  var opposingDir = direction === 'BUY' ? 'bear' : 'bull';
  var opposingCHoCH = (struct.choch || []).filter(function (s) { return direction !== 'NONE' && s.dir.indexOf(opposingDir) >= 0; }).sort(function (a, b) { return (b.id || 0) - (a.id || 0); })[0];
  var structureHolds = liqStatus.pass && !opposingCHoCH;
  var structureDetail = !liqStatus.pass ? 'Waiting on the liquidity sweep first.'
    : structureHolds ? 'No opposing CHoCH detected -- major ' + (direction === 'BUY' ? 'bullish' : 'bearish') + ' structure remains intact.'
    : 'An opposing CHoCH was detected -- major structure has broken. The continuation idea is invalid; reassess for a possible reversal instead.';

  // Rule 6 -- BOS Confirms Continuation.
  var latestBOS = (struct.bos || []).filter(function (s) { return direction !== 'NONE' && s.dir.indexOf(wantDir) >= 0; }).sort(function (a, b) { return (b.id || 0) - (a.id || 0); })[0];
  var bosPass = structureHolds && !!latestBOS;
  var bosDetail = !structureHolds ? 'Waiting on structure holding first.'
    : bosPass ? 'BOS at $' + fmt(latestBOS.price) + ' confirms institutions have resumed the ' + direction + ' trend.'
    : 'Waiting for a ' + direction + ' BOS on your entry timeframe to confirm the trend has resumed.';

  // Rule 7 -- Retest Into Entry Zone (FVG only, the precise final trigger).
  var zone = bosPass ? findFVGEntryZone(direction, S) : null;
  var insideZone = !!(zone && price && price >= zone.low && price <= zone.high);
  var zoneDetail = !bosPass ? 'Waiting on the BOS confirmation first.'
    : insideZone ? 'Price is inside the ' + direction + ' FVG retest zone at $' + fmt(zone.low) + '--$' + fmt(zone.high) + ' -- entry on rejection.'
    : zone ? 'FVG marked at $' + fmt(zone.low) + '--$' + fmt(zone.high) + ' -- waiting for the retest. Never chase the BOS.'
    : 'No matching FVG marked yet for the retest.';

  var sl = S.structureLevels || {};
  var targetCandidates = direction === 'BUY'
    ? [{ name: 'PDH', price: sl.pdh }, { name: 'R1', price: S.daily && S.daily.R1 }, { name: 'R2', price: S.daily && S.daily.R2 }, { name: 'R3', price: S.daily && S.daily.R3 }, { name: 'PWH', price: sl.pwh }, { name: 'PMH', price: sl.pmh }]
    : [{ name: 'PDL', price: sl.pdl }, { name: 'S1', price: S.daily && S.daily.S1 }, { name: 'S2', price: S.daily && S.daily.S2 }, { name: 'S3', price: S.daily && S.daily.S3 }, { name: 'PWL', price: sl.pwl }, { name: 'PML', price: sl.pml }];
  var ladder = direction !== 'NONE' ? buildTargetLadder(direction, targetCandidates, price) : [];

  var minRR = Math.max(3, (S.settings && S.settings.minRR) || 2);

  // Rule 8 -- Minimum 1:3 Risk-to-Reward, searching the whole ladder.
  var zoneBuffer = (S.daily && S.daily.width ? S.daily.width : 10) * 0.1;
  var stopPrice = zone ? (direction === 'BUY' ? zone.low - zoneBuffer : zone.high + zoneBuffer) : null;
  var nextTarget = null, riskReward = null;
  if (insideZone && stopPrice != null && price) {
    var riskAmt0 = Math.abs(price - stopPrice);
    if (riskAmt0 > 0) {
      for (var ti = 0; ti < ladder.length; ti++) {
        var candRR = Math.abs(ladder[ti].price - price) / riskAmt0;
        if (candRR >= minRR) { nextTarget = ladder[ti]; riskReward = candRR; break; }
      }
      if (!nextTarget && ladder.length > 0) { nextTarget = ladder[0]; riskReward = Math.abs(ladder[0].price - price) / riskAmt0; }
    }
  } else if (ladder.length > 0) {
    nextTarget = ladder[0];
  }
  var rrPass = insideZone ? (riskReward != null && riskReward >= minRR) : false;
  var rrDetail = !insideZone ? 'Waiting on the retest zone first.'
    : riskReward == null ? 'Cannot compute RR yet -- mark a target level.'
    : rrPass ? 'Target offers 1:' + riskReward.toFixed(2) + ' RR (' + (nextTarget ? nextTarget.name : '') + ') -- meets the 1:' + minRR + ' minimum.'
    : 'Even the furthest marked target (' + (nextTarget ? nextTarget.name : 'none') + ') only offers 1:' + (riskReward != null ? riskReward.toFixed(2) : '--') + ' RR -- below the 1:' + minRR + ' minimum. Wait for a better target or a tighter entry.';

  var checks = [trendPass, impulsePass, retracedIntoValue, liqStatus.pass, structureHolds, bosPass, insideZone, rrPass];
  var passCount = checks.filter(Boolean).length;
  var confidence = Math.round((passCount / checks.length) * 100);
  var quality = confidence >= 90 ? 'A+' : confidence >= 75 ? 'A' : confidence >= 50 ? 'B' : confidence >= 25 ? 'C' : 'D';

  var verdict, nextRequirement;
  if (!S.daily) {
    verdict = 'NO DATA'; nextRequirement = 'Fetch market data first (CPR tab)';
  } else if (!trendPass) {
    verdict = 'NO TREND'; nextRequirement = trendDetail;
  } else if (!impulsePass) {
    verdict = 'WAIT'; nextRequirement = impulseDetail;
  } else if (!retracedIntoValue) {
    verdict = 'WAIT'; nextRequirement = retraceDetail;
  } else if (!liqStatus.pass) {
    verdict = 'WAIT'; nextRequirement = direction + ' setup forming -- waiting for a liquidity sweep against the trend before anything else. No sweep, no trade.';
  } else if (!structureHolds) {
    verdict = 'NO TREND'; nextRequirement = structureDetail;
  } else if (!bosPass) {
    verdict = 'WAIT'; nextRequirement = bosDetail;
  } else if (!insideZone) {
    var cprWidth = (S.daily && S.daily.width) || 10;
    var expiredThreshold = cprWidth * 1.5;
    var movedAway = zone && price ? (direction === 'SELL' ? price < ((zone.low + zone.high) / 2) - expiredThreshold : price > ((zone.low + zone.high) / 2) + expiredThreshold) : false;
    if (zone && movedAway) {
      verdict = 'MISSED'; nextRequirement = 'This continuation setup has likely expired -- price ran well past the retest zone without returning. Wait for the next setup.';
    } else {
      verdict = 'WAIT'; nextRequirement = zone ? 'Wait for price to retest the ' + direction + ' FVG -- never chase the BOS.' : 'No ' + direction + ' FVG marked yet for price to retest.';
    }
  } else if (!rrPass) {
    verdict = 'WAIT'; nextRequirement = rrDetail;
  } else {
    verdict = 'TRADE READY';
    nextRequirement = direction + ' from $' + fmt(zone.low) + '--$' + fmt(zone.high) + ' on rejection. SL beyond the sweep/zone. Target: ' + (nextTarget ? nextTarget.name + ' at $' + fmt(nextTarget.price) : 'mark further levels') + '. Confirmed RR 1:' + riskReward.toFixed(2) + '.';
  }

  var steps = [
    { num: 1, name: 'Trend Alignment (Monthly + Weekly + Daily All Agree)', pass: trendPass, detail: trendDetail },
    { num: 2, name: 'Strong Impulse Leg Exists', pass: impulsePass, detail: impulseDetail },
    { num: 3, name: 'Retraced Into Value (CPR / OB / FVG)', pass: retracedIntoValue, detail: retraceDetail },
    { num: 4, name: 'Liquidity Swept Against Trend (Mandatory)', pass: liqStatus.pass, detail: liqStatus.detail },
    { num: 5, name: 'Structure Holds (No Break Against Trend)', pass: structureHolds, detail: structureDetail },
    { num: 6, name: 'BOS Confirms Continuation', pass: bosPass, detail: bosDetail },
    { num: 7, name: 'Retest Into Entry Zone', pass: insideZone, detail: zoneDetail },
    { num: 8, name: 'Minimum 1:3 Risk-to-Reward', pass: rrPass, detail: rrDetail }
  ];

  return {
    strategyName: 'Sunrose Continuation Strategy', mode: 'continuation',
    verdict: verdict, direction: direction, scenario: 'CONTINUATION',
    confidence: confidence, quality: quality, nextRequirement: nextRequirement,
    qualityScore: scoreSetupQuality(direction, S),
    articles: steps,
    target: nextTarget, targetLadder: ladder, stopPrice: stopPrice, riskReward: riskReward,
    entryZone: zone, mandatoryPassed: passCount, mandatoryTotal: checks.length
  };
}

function evaluateReversalStrategy(S) {
  var price = S.price;

  // Rule 1 -- Major Institutional Level Reached (checks both directions).
  var sellLevel = findInstitutionalLevel('SELL', S);
  var buyLevel = findInstitutionalLevel('BUY', S);
  var direction = 'NONE', level = null;
  if (sellLevel && buyLevel) {
    if (sellLevel.priority <= buyLevel.priority) { direction = 'SELL'; level = sellLevel; }
    else { direction = 'BUY'; level = buyLevel; }
  } else if (sellLevel) { direction = 'SELL'; level = sellLevel; }
  else if (buyLevel) { direction = 'BUY'; level = buyLevel; }
  var levelPass = !!level;
  var levelDetail = levelPass
    ? 'Price has reached ' + level.name + ' at $' + fmt(level.price) + ' (' + level.state + ') -- a major institutional level. Reversal candidate: ' + direction + '.'
    : 'No major institutional level (PMH/PWH/PDH/R3-R4 or PML/PWL/PDL/S3-S4) has been reached yet.';

  // Rule 2 -- Liquidity Swept (mandatory).
  var liqStatus = levelPass ? getLiquiditySweptStatus(direction, S) : { pass: false, detail: 'Waiting on an institutional level first.' };

  // Rule 3 -- CHoCH or BOS Confirms Direction.
  var struct = S.structure || { bos: [], choch: [] };
  var wantDir = direction === 'BUY' ? 'bull' : 'bear';
  var latestCHoCH = (struct.choch || []).filter(function (s) { return levelPass && s.dir.indexOf(wantDir) >= 0; }).sort(function (a, b) { return (b.id || 0) - (a.id || 0); })[0];
  var latestBOS = (struct.bos || []).filter(function (s) { return levelPass && s.dir.indexOf(wantDir) >= 0; }).sort(function (a, b) { return (b.id || 0) - (a.id || 0); })[0];
  var structPass = !!(latestCHoCH || latestBOS);
  var structDetail = !levelPass ? 'Waiting on an institutional level first.'
    : (latestCHoCH && latestBOS) ? 'CHoCH at $' + fmt(latestCHoCH.price) + ' and BOS at $' + fmt(latestBOS.price) + ' -- institutional control has changed.'
    : latestCHoCH ? 'CHoCH at $' + fmt(latestCHoCH.price) + ' confirms ' + direction + '.'
    : latestBOS ? 'BOS at $' + fmt(latestBOS.price) + ' confirms ' + direction + '.'
    : 'Waiting for a ' + direction + ' CHoCH or BOS on your entry timeframe -- either one is sufficient.';

  // Rule 4 -- Daily CPR Reclaimed / Lost.
  var cprConfirmPass = false;
  var cprConfirmDetail = 'Waiting on structure confirmation first.';
  if (structPass && S.daily && price) {
    cprConfirmPass = direction === 'BUY' ? price > S.daily.TC : price < S.daily.BC;
    cprConfirmDetail = cprConfirmPass
      ? 'Daily CPR ' + (direction === 'BUY' ? 'reclaimed -- price above Daily TC' : 'lost -- price below Daily BC') + '. Strong reversal confirmation.'
      : 'Structure has confirmed, but price has not yet ' + (direction === 'BUY' ? 'reclaimed the Daily CPR (needs to close above Daily TC)' : 'lost the Daily CPR (needs to close below Daily BC)') + '.';
  }

  // Rule 5 -- Retest Into Entry Zone (FVG only).
  var zone = cprConfirmPass ? findFVGEntryZone(direction, S) : null;
  var insideZone = !!(zone && price && price >= zone.low && price <= zone.high);
  var zoneDetail = !cprConfirmPass ? 'Waiting on CPR confirmation first.'
    : insideZone ? 'Price is inside the ' + direction + ' FVG retest zone at $' + fmt(zone.low) + '--$' + fmt(zone.high) + '.'
    : zone ? 'FVG marked at $' + fmt(zone.low) + '--$' + fmt(zone.high) + ' -- waiting for the retest.'
    : 'No matching FVG marked yet for the retest.';

  var sl = S.structureLevels || {};
  var targetCandidates = direction === 'BUY'
    ? [{ name: 'Daily CPR (TC)', price: S.daily && S.daily.TC }, { name: 'PDH', price: sl.pdh }, { name: 'Weekly CPR (TC)', price: S.weekly && S.weekly.TC }, { name: 'PWH', price: sl.pwh }, { name: 'Monthly CPR (TC)', price: S.monthly && S.monthly.TC }, { name: 'PMH', price: sl.pmh }, { name: 'R1', price: S.daily && S.daily.R1 }, { name: 'R2', price: S.daily && S.daily.R2 }, { name: 'R3', price: S.daily && S.daily.R3 }]
    : [{ name: 'Daily CPR (BC)', price: S.daily && S.daily.BC }, { name: 'PDL', price: sl.pdl }, { name: 'Weekly CPR (BC)', price: S.weekly && S.weekly.BC }, { name: 'PWL', price: sl.pwl }, { name: 'Monthly CPR (BC)', price: S.monthly && S.monthly.BC }, { name: 'PML', price: sl.pml }, { name: 'S1', price: S.daily && S.daily.S1 }, { name: 'S2', price: S.daily && S.daily.S2 }, { name: 'S3', price: S.daily && S.daily.S3 }];
  var ladder = levelPass ? buildTargetLadder(direction, targetCandidates, price) : [];

  var minRR = Math.max(3, (S.settings && S.settings.minRR) || 2);

  // Rule 6 -- Minimum 1:3 Risk-to-Reward, searching the whole ladder.
  var zoneBuffer2 = (S.daily && S.daily.width ? S.daily.width : 10) * 0.1;
  var stopPrice = zone ? (direction === 'BUY' ? zone.low - zoneBuffer2 : zone.high + zoneBuffer2) : null;
  var nextTarget = null, riskReward = null;
  if (insideZone && stopPrice != null && price) {
    var riskAmt0 = Math.abs(price - stopPrice);
    if (riskAmt0 > 0) {
      for (var ti = 0; ti < ladder.length; ti++) {
        var candRR = Math.abs(ladder[ti].price - price) / riskAmt0;
        if (candRR >= minRR) { nextTarget = ladder[ti]; riskReward = candRR; break; }
      }
      if (!nextTarget && ladder.length > 0) { nextTarget = ladder[0]; riskReward = Math.abs(ladder[0].price - price) / riskAmt0; }
    }
  } else if (ladder.length > 0) {
    nextTarget = ladder[0];
  }
  var rrPass = insideZone ? (riskReward != null && riskReward >= minRR) : false;
  var rrDetail = !insideZone ? 'Waiting on the retest zone first.'
    : riskReward == null ? 'Cannot compute RR yet -- mark a target level.'
    : rrPass ? 'Target offers 1:' + riskReward.toFixed(2) + ' RR (' + (nextTarget ? nextTarget.name : '') + ') -- meets the 1:' + minRR + ' minimum.'
    : 'Even the furthest marked target (' + (nextTarget ? nextTarget.name : 'none') + ') only offers 1:' + (riskReward != null ? riskReward.toFixed(2) : '--') + ' RR -- below the 1:' + minRR + ' minimum. Wait for a better target or a tighter entry.';

  var checks = [levelPass, liqStatus.pass, structPass, cprConfirmPass, insideZone, rrPass];
  var passCount = checks.filter(Boolean).length;
  var confidence = Math.round((passCount / checks.length) * 100);
  var quality = confidence >= 90 ? 'A+' : confidence >= 75 ? 'A' : confidence >= 50 ? 'B' : confidence >= 25 ? 'C' : 'D';

  var verdict, nextRequirement;
  if (!S.daily) {
    verdict = 'NO DATA'; nextRequirement = 'Fetch market data first (CPR tab)';
  } else if (!levelPass) {
    verdict = 'WAIT'; nextRequirement = levelDetail;
  } else if (!liqStatus.pass) {
    verdict = 'WAIT'; nextRequirement = level.name + ' reached -- waiting for a liquidity sweep at this level. No sweep, no trade.';
  } else if (!structPass) {
    verdict = 'WAIT'; nextRequirement = 'Liquidity swept -- now watch for a ' + direction + ' CHoCH or BOS on your entry timeframe -- either one is sufficient.';
  } else if (!cprConfirmPass) {
    verdict = 'WAIT'; nextRequirement = cprConfirmDetail;
  } else if (!insideZone) {
    var cprWidth2 = (S.daily && S.daily.width) || 10;
    var expiredThreshold2 = cprWidth2 * 1.5;
    var movedAway2 = zone && price ? (direction === 'SELL' ? price < ((zone.low + zone.high) / 2) - expiredThreshold2 : price > ((zone.low + zone.high) / 2) + expiredThreshold2) : false;
    if (zone && movedAway2) {
      verdict = 'MISSED'; nextRequirement = 'This reversal setup has likely expired -- price ran well past the retest zone. Wait for the next setup.';
    } else {
      verdict = 'WAIT'; nextRequirement = zone ? 'Wait for price to retest the ' + direction + ' FVG -- never enter immediately after the BOS.' : 'No ' + direction + ' FVG marked yet for price to retest.';
    }
  } else if (!rrPass) {
    verdict = 'WAIT'; nextRequirement = rrDetail;
  } else {
    verdict = 'TRADE READY';
    nextRequirement = direction + ' from $' + fmt(zone.low) + '--$' + fmt(zone.high) + ' on rejection. SL beyond the zone. Target: ' + (nextTarget ? nextTarget.name + ' at $' + fmt(nextTarget.price) : 'mark further levels') + '. Confirmed RR 1:' + riskReward.toFixed(2) + '.';
  }

  var steps = [
    { num: 1, name: 'Major Institutional Level Reached', pass: levelPass, detail: levelDetail },
    { num: 2, name: 'Liquidity Swept (Mandatory)', pass: liqStatus.pass, detail: liqStatus.detail },
    { num: 3, name: 'CHoCH or BOS Confirms Direction', pass: structPass, detail: structDetail },
    { num: 4, name: 'Daily CPR Reclaimed / Lost', pass: cprConfirmPass, detail: cprConfirmDetail },
    { num: 5, name: 'Retest Into Entry Zone', pass: insideZone, detail: zoneDetail },
    { num: 6, name: 'Minimum 1:3 Risk-to-Reward', pass: rrPass, detail: rrDetail }
  ];

  return {
    strategyName: 'Sunrose Reversal Strategy', mode: 'reversal',
    verdict: verdict, direction: direction, scenario: 'REVERSAL',
    confidence: confidence, quality: quality, nextRequirement: nextRequirement,
    qualityScore: scoreSetupQuality(direction, S),
    articles: steps,
    target: nextTarget, targetLadder: ladder, stopPrice: stopPrice, riskReward: riskReward,
    entryZone: zone, institutionalLevel: level,
    mandatoryPassed: passCount, mandatoryTotal: checks.length
  };
}

module.exports = { evaluateContinuationStrategy, evaluateReversalStrategy };
