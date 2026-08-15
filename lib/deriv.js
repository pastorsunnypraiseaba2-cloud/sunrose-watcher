// ============================================================================
// DERIV DATA LAYER -- ported from Sunrose Trader OS (index.html)
// ============================================================================
// Same symbol map, same WebSocket request shape, same DST-aware 17:00 NY-close
// session reconstruction the app uses for Daily/Weekly/Monthly candles. This is
// what makes the CPR levels computed here match what the app itself would show.
// ============================================================================

const WebSocket = require('ws');

const DERIV_SYMBOL_MAP = {
  'XAU/USD': 'frxXAUUSD', 'XAG/USD': 'frxXAGUSD',
  'EUR/USD': 'frxEURUSD', 'GBP/USD': 'frxGBPUSD',
  'USD/JPY': 'frxUSDJPY', 'USD/CHF': 'frxUSDCHF',
  'AUD/USD': 'frxAUDUSD', 'USD/CAD': 'frxUSDCAD', 'NZD/USD': 'frxNZDUSD',
  'GBP/JPY': 'frxGBPJPY', 'EUR/JPY': 'frxEURJPY', 'EUR/GBP': 'frxEURGBP',
  'AUD/JPY': 'frxAUDJPY', 'EUR/AUD': 'frxEURAUD', 'GBP/AUD': 'frxGBPAUD',
  'EUR/CHF': 'frxEURCHF', 'GBP/CHF': 'frxGBPCHF', 'CHF/JPY': 'frxCHFJPY',
  'AUD/CAD': 'frxAUDCAD', 'CAD/JPY': 'frxCADJPY', 'NZD/JPY': 'frxNZDJPY',
  'AUD/NZD': 'frxAUDNZD',
  'BTC/USD': 'cryBTCUSD', 'ETH/USD': 'cryETHUSD', 'LTC/USD': 'cryLTCUSD',
  'XRP/USD': 'cryXRPUSD', 'BCH/USD': 'cryBCHUSD', 'EOS/USD': 'cryEOSUSD',
  'ADA/USD': 'cryADAUSD', 'DOT/USD': 'cryDOTUSD', 'DOGE/USD': 'cryDOGUSD',
  'SOL/USD': 'crySOLUSD'
};
function toDerivSymbol(sym) {
  return DERIV_SYMBOL_MAP[sym] || 'frxXAUUSD';
}

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089'; // Deriv's public demo app_id, same one the app uses

function derivWSRequest(request, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + DERIV_APP_ID);
    var timer = setTimeout(function () {
      try { ws.close(); } catch (e) {}
      reject(new Error('Deriv request timed out after ' + (timeoutMs || 8000) + 'ms for ' + JSON.stringify(request)));
    }, timeoutMs || 8000);
    ws.on('open', function () { ws.send(JSON.stringify(request)); });
    ws.on('message', function (raw) {
      var data;
      try { data = JSON.parse(raw); } catch (e) { return; }
      if (data.error) {
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        reject(new Error('Deriv API error: ' + data.error.message));
        return;
      }
      if (data.msg_type === 'candles' || data.msg_type === 'history') {
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        resolve(data);
      }
    });
    ws.on('error', function () { /* onclose handles rejection */ });
    ws.on('close', function (code) {
      clearTimeout(timer);
      if (code !== 1000) reject(new Error('Deriv WebSocket closed unexpectedly, code ' + code));
    });
  });
}

async function derivFetchCandles(derivSymbol, granularitySec, count) {
  var resp = await derivWSRequest({
    ticks_history: derivSymbol, adjust_start_time: 1, count: count,
    end: 'latest', style: 'candles', granularity: granularitySec
  });
  if (!resp.candles || !resp.candles.length) throw new Error('No candle data returned for ' + derivSymbol);
  var values = resp.candles.map(function (c) {
    var d = new Date(c.epoch * 1000);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var datetime = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    return { datetime: datetime, open: c.open, high: c.high, low: c.low, close: c.close };
  }).sort(function (a, b) { return a.datetime < b.datetime ? 1 : -1; });
  return { values: values };
}

async function derivFetchQuote(derivSymbol) {
  var resp = await derivWSRequest({ ticks_history: derivSymbol, adjust_start_time: 1, count: 1, end: 'latest', style: 'ticks' });
  if (resp.history && resp.history.prices && resp.history.prices.length) {
    return { close: resp.history.prices[resp.history.prices.length - 1] };
  }
  throw new Error('No quote data returned for ' + derivSymbol);
}

// -- Same DST-aware 17:00 NY-close session reconstruction the app uses. --
function nyPartsFromUTC(dt) {
  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  var parts = {};
  fmt.formatToParts(dt).forEach(function (p) { if (p.type !== 'literal') parts[p.type] = p.value; });
  return { y: parseInt(parts.year, 10), m: parseInt(parts.month, 10), d: parseInt(parts.day, 10), h: parseInt(parts.hour === '24' ? '0' : parts.hour, 10) };
}

function buildNYDailyCandles(hourlyValues) {
  if (!hourlyValues || !hourlyValues.length) return [];
  var bars = hourlyValues.map(function (c) {
    return { dt: c.datetime, h: parseFloat(c.high), l: parseFloat(c.low), c: parseFloat(c.close), o: parseFloat(c.open) };
  }).sort(function (a, b) { return a.dt < b.dt ? -1 : 1; });
  var sessions = {};
  bars.forEach(function (bar) {
    var utcDt = new Date(bar.dt.replace(' ', 'T') + 'Z');
    var ny = nyPartsFromUTC(utcDt);
    var sessionDate = new Date(Date.UTC(ny.y, ny.m - 1, ny.d));
    if (ny.h >= 17) { sessionDate.setUTCDate(sessionDate.getUTCDate() + 1); }
    var key = sessionDate.toISOString().substring(0, 10);
    if (!sessions[key]) sessions[key] = { high: bar.h, low: bar.l, close: bar.c, open: bar.o, firstDt: bar.dt, lastDt: bar.dt };
    var s = sessions[key];
    if (bar.h > s.high) s.high = bar.h;
    if (bar.l < s.low) s.low = bar.l;
    if (bar.dt > s.lastDt) { s.close = bar.c; s.lastDt = bar.dt; }
    if (bar.dt < s.firstDt) { s.open = bar.o; s.firstDt = bar.dt; }
  });
  var keys = Object.keys(sessions).sort().reverse();
  return keys.map(function (k) { return { datetime: k, high: sessions[k].high, low: sessions[k].low, close: sessions[k].close, open: sessions[k].open }; });
}

function buildWeeklyFromDaily(dailyCandles) {
  var weeks = {};
  dailyCandles.forEach(function (day) {
    var d = new Date(day.datetime + 'T00:00:00Z');
    var dow = d.getUTCDay();
    var diff = (dow === 0 ? -6 : 1) - dow;
    var monday = new Date(d); monday.setUTCDate(d.getUTCDate() + diff);
    var key = monday.toISOString().substring(0, 10);
    if (!weeks[key]) weeks[key] = { high: day.high, low: day.low, close: day.close, open: day.open, firstDate: day.datetime, lastDate: day.datetime };
    var w = weeks[key];
    if (day.high > w.high) w.high = day.high;
    if (day.low < w.low) w.low = day.low;
    if (day.datetime > w.lastDate) { w.close = day.close; w.lastDate = day.datetime; }
    if (day.datetime < w.firstDate) { w.open = day.open; w.firstDate = day.datetime; }
  });
  var keys = Object.keys(weeks).sort().reverse();
  return keys.map(function (k) { return { datetime: k, high: weeks[k].high, low: weeks[k].low, close: weeks[k].close, open: weeks[k].open }; });
}

function buildMonthlyFromDaily(dailyCandles) {
  var months = {};
  dailyCandles.forEach(function (day) {
    var key = day.datetime.substring(0, 7);
    if (!months[key]) months[key] = { high: day.high, low: day.low, close: day.close, open: day.open, firstDate: day.datetime, lastDate: day.datetime };
    var m = months[key];
    if (day.high > m.high) m.high = day.high;
    if (day.low < m.low) m.low = day.low;
    if (day.datetime > m.lastDate) { m.close = day.close; m.lastDate = day.datetime; }
    if (day.datetime < m.firstDate) { m.open = day.open; m.firstDate = day.datetime; }
  });
  var keys = Object.keys(months).sort().reverse();
  return keys.map(function (k) { return { datetime: k, high: months[k].high, low: months[k].low, close: months[k].close, open: months[k].open }; });
}

module.exports = {
  DERIV_SYMBOL_MAP, toDerivSymbol, derivFetchCandles, derivFetchQuote,
  buildNYDailyCandles, buildWeeklyFromDaily, buildMonthlyFromDaily
};
