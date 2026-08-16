// ============================================================================
// CHART IMAGE -- auto-generates a candlestick chart PNG from Deriv daily candle
// data, so the automated watcher has something to show Chart Vision AI without
// a human uploading a screenshot.
// ============================================================================
// Uses QuickChart.io (free, no API key needed for reasonable volume) via its
// Chart.js-compatible POST endpoint, which returns image bytes directly in one
// call -- no separate fetch-the-URL step needed.
//
// HONEST NOTE: this produces one chart per call, at whatever timeframe you ask
// for. vision-worker.js calls this multiple times (Daily/4H/1H/15M) to build a
// small multi-timeframe set, similar in spirit to your manual Chart Vision
// screenshot workflow -- though still fewer/simpler than what you'd hand-pick
// yourself, and drawn from Deriv data only (no manually marked FVG/OB zones).
// ============================================================================

async function fetchChartImageBase64(candles, symLabel, timeframeLabel) {
  if (!candles || candles.length < 5) {
    throw new Error('Not enough candles to build a ' + (timeframeLabel || '') + ' chart image for ' + symLabel);
  }
  const tfLabel = timeframeLabel || 'Daily';

  const labels = candles.map(function (c) { return c.datetime; });
  const data = candles.map(function (c) {
    return { x: c.datetime, o: c.open, h: c.high, l: c.low, c: c.close };
  });

  const chartConfig = {
    type: 'candlestick',
    data: {
      datasets: [{
        label: symLabel,
        data: data,
        borderColor: { up: '#22c55e', down: '#ef4444', unchanged: '#999999' },
        color: { up: '#22c55e', down: '#ef4444', unchanged: '#999999' }
      }]
    },
    options: {
      plugins: {
        legend: { display: true, labels: { color: '#e5e5e5' } },
        title: { display: true, text: symLabel + ' -- ' + tfLabel, color: '#e5e5e5', font: { size: 16 } }
      },
      scales: {
        x: { type: 'category', labels: labels, ticks: { color: '#cccccc', maxTicksLimit: 12 } },
        y: { ticks: { color: '#cccccc' } }
      }
    }
  };

  const res = await fetch('https://quickchart.io/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: chartConfig,
      width: 900,
      height: 500,
      backgroundColor: '#111318',
      format: 'png',
      version: '4'
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(function () { return ''; });
    throw new Error('QuickChart request failed (' + res.status + '): ' + errText.substring(0, 200));
  }

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return { b64: base64, mediaType: 'image/png', tfLabel: tfLabel };
}

module.exports = { fetchChartImageBase64 };
