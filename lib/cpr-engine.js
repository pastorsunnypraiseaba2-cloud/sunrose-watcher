// ============================================================================
// CPR + ALIGNMENT ENGINE -- ported from Sunrose Trader OS (index.html)
// ============================================================================
// Every function below is copied with only mechanical changes (var -> const/let
// where harmless, removing the S.symbol/S.price global lookups in favour of
// explicit parameters) from the live app's own source. Nothing here is a
// reimplementation from screenshots or memory -- it's the same math your
// browser runs, so a FULL_BULL/FULL_BEAR reading from this file means the
// same thing it means in the app.
//
// If you ever change this logic in index.html, mirror the change here too --
// this file has no automatic link back to the app. That's the one real risk
// of porting instead of sharing code: two copies that can drift silently.
// Diff this file against index.html's calcCPR/calcStrictBias/biasFromCPR
// occasionally to catch drift early.
// ============================================================================

function calcCPR(H, L, C) {
  const P = (H + L + C) / 3;
  const BC_raw = (H + L) / 2;
  const TC_raw = (2 * P) - BC_raw;
  const TC = Math.max(TC_raw, BC_raw);
  const BC = Math.min(TC_raw, BC_raw);
  const R1 = (2 * P) - L;
  const R2 = P + (H - L);
  const R3 = H + 2 * (P - L);
  const R4 = R3 + (R2 - R1);
  const S1 = (2 * P) - H;
  const S2 = P - (H - L);
  const S3 = L - 2 * (H - P);
  const S4 = S3 - (S1 - S2);
  const width = Math.abs(TC - BC);
  const widthLabel = width < 3 ? 'Narrow' : width < 10 ? 'Normal' : 'Wide';
  return { P, BC, TC, R1, R2, R3, R4, S1, S2, S3, S4, width, widthLabel };
}

// Same buffer table as the app, including the same honesty about which values
// are actually validated (XAUUSD only) vs. untested estimates for everything else.
function getCPRBuffer(symLabel, currentPrice) {
  var sym = (symLabel || 'XAU/USD').toUpperCase();
  if (sym.indexOf('XAU') !== -1 || sym.indexOf('GOLD') !== -1) return 8;
  if (sym.indexOf('XAG') !== -1 || sym.indexOf('SILVER') !== -1) return 0.05;
  var cryptoBases = ['BTC', 'ETH', 'LTC', 'XRP', 'BCH', 'EOS', 'ADA', 'DOT', 'DOGE', 'SOL'];
  var isCrypto = cryptoBases.some(function (c) { return sym.indexOf(c + '/') === 0 || sym.indexOf(c + 'USD') === 0; });
  if (isCrypto) return currentPrice ? currentPrice * 0.001 : 1;
  if (sym.indexOf('JPY') !== -1) return 0.08;
  return 0.0008;
}

function calcConf(price, edge, ext, bull) {
  const dist = bull ? Math.abs(price - edge) : Math.abs(edge - price);
  const range = Math.abs(ext - edge);
  if (range === 0) return 60;
  const pct = Math.min((dist / range) * 40 + 60, 99);
  return Math.round(pct);
}

function biasFromCPR(price, cpr, symLabel) {
  var buf = getCPRBuffer(symLabel, price);
  if (price > cpr.TC + buf) return { bias: 'BULLISH', conf: calcConf(price, cpr.TC, cpr.R1, true) };
  if (price < cpr.BC - buf) return { bias: 'BEARISH', conf: calcConf(price, cpr.BC, cpr.S1, false) };
  if (price > cpr.TC) return { bias: 'BULLISH', conf: Math.min(calcConf(price, cpr.TC, cpr.R1, true), 59), warning: 'Inside buffer zone -- feed discrepancy risk, treat as low-confidence' };
  if (price < cpr.BC) return { bias: 'BEARISH', conf: Math.min(calcConf(price, cpr.BC, cpr.S1, false), 59), warning: 'Inside buffer zone -- feed discrepancy risk, treat as low-confidence' };
  return { bias: 'NEUTRAL', conf: 50 };
}

function validateCPR(label, H, L, C, cpr) {
  var errors = [];
  if (!H || !L || !C || isNaN(H) || isNaN(L) || isNaN(C)) errors.push('Invalid OHLC data');
  if (H <= L) errors.push('High must be above Low');
  if (H <= 0 || L <= 0) errors.push('Price values must be positive');
  if (cpr) {
    if (isNaN(cpr.P) || isNaN(cpr.TC) || isNaN(cpr.BC)) errors.push('CPR values are NaN');
    if (cpr.TC < cpr.BC) errors.push('TC below BC after swap -- calculation error');
    if (cpr.P < cpr.BC - 0.01 || cpr.P > cpr.TC + 0.01) errors.push('Pivot outside TC/BC range');
  }
  return { valid: errors.length === 0, errors: errors, label: label };
}

// Same Monthly-wide exception, same three-way alignment logic, same partial/conflict
// classification as the app. FULL_BULL / FULL_BEAR is what the watcher fires on.
function calcStrictBias(price, monthly, weekly, daily, symLabel) {
  if (!monthly || !weekly || !daily) return { alignment: 'NO_DATA', monthly: null, weekly: null, daily: null };
  var mResult = biasFromCPR(price, monthly, symLabel);
  var wResult = biasFromCPR(price, weekly, symLabel);
  var dResult = biasFromCPR(price, daily, symLabel);
  var mBias = mResult.bias, wBias = wResult.bias, dBias = dResult.bias;

  var MONTHLY_WIDE_THRESHOLD = 150;
  var monthlyExceptionActive = monthly.width > MONTHLY_WIDE_THRESHOLD && mBias === 'NEUTRAL';
  var bullCount = [mBias, wBias, dBias].filter(function (b) { return b === 'BULLISH'; }).length;
  var bearCount = [mBias, wBias, dBias].filter(function (b) { return b === 'BEARISH'; }).length;

  var alignment, dailyNote;
  if (bullCount === 3) {
    alignment = 'FULL_BULL'; dailyNote = null;
  } else if (bearCount === 3) {
    alignment = 'FULL_BEAR'; dailyNote = null;
  } else if (monthlyExceptionActive && wBias === 'BULLISH' && dBias === 'BULLISH') {
    alignment = 'FULL_BULL';
    dailyNote = 'Monthly CPR is exceptionally wide (' + monthly.width.toFixed(1) + ' pts) with price trading inside it. Weekly and Daily alignment (BULLISH) is treated as full alignment.';
  } else if (monthlyExceptionActive && wBias === 'BEARISH' && dBias === 'BEARISH') {
    alignment = 'FULL_BEAR';
    dailyNote = 'Monthly CPR is exceptionally wide (' + monthly.width.toFixed(1) + ' pts) with price trading inside it. Weekly and Daily alignment (BEARISH) is treated as full alignment.';
  } else if (mBias === 'BEARISH' && wBias === 'BEARISH' && dBias === 'BULLISH') {
    alignment = 'PARTIAL_BEAR'; dailyNote = 'Daily is bullish but Monthly and Weekly are bearish.';
  } else if (mBias === 'BULLISH' && wBias === 'BULLISH' && dBias === 'BEARISH') {
    alignment = 'PARTIAL_BULL'; dailyNote = 'Daily is bearish but Monthly and Weekly are bullish.';
  } else if (mBias === wBias && mBias !== 'NEUTRAL') {
    alignment = mBias === 'BULLISH' ? 'PARTIAL_BULL' : 'PARTIAL_BEAR';
    dailyNote = 'Monthly and Weekly agree (' + mBias + '). Daily differs.';
  } else if (mBias !== wBias) {
    alignment = 'CONFLICT'; dailyNote = 'Monthly (' + mBias + ') and Weekly (' + wBias + ') conflict.';
  } else {
    alignment = 'CONFLICT'; dailyNote = null;
  }

  return {
    alignment: alignment,
    monthly: { bias: mBias, conf: mResult.conf, warning: mResult.warning || null },
    weekly: { bias: wBias, conf: wResult.conf, warning: wResult.warning || null },
    daily: { bias: dBias, conf: dResult.conf, warning: dResult.warning || null },
    dailyNote: dailyNote,
    monthlyExceptionActive: monthlyExceptionActive
  };
}

function fmt(v) {
  if (v === null || v === undefined || v === 0 || isNaN(v)) return '\u2014';
  var decimals = Math.abs(v) < 50 ? 4 : 2;
  return v.toFixed(decimals);
}

module.exports = { calcCPR, getCPRBuffer, biasFromCPR, calcConf, validateCPR, calcStrictBias, fmt };
