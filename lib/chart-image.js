// ============================================================================
// CHART IMAGE -- auto-generates a candlestick chart PNG from Deriv daily candle
// data, so the automated watcher has something to show Chart Vision AI without
// a human uploading a screenshot.
// ============================================================================
// Uses QuickChart.io (free, no API key needed for reasonable volume) via its
// Chart.js-compatible POST endpoint, which returns image bytes directly in one
// call -- no separate fetch-the-URL step needed.
//
// HONEST LIMITATION: this produces ONE chart -- Daily timeframe, last 60
// sessions. Your manual Chart Vision workflow in the app can take up to 6
// charts across multiple timeframes (Monthly/Weekly/Daily/4H/1H/15m), which
// gives the AI a much richer picture. This auto-generated version deliberately
// uses the prompt's own "single chart supplied" branch, which is written to
// infer higher-timeframe context conservatively and score Trend Alignment
// accordingly -- it will not pretend to certainty it doesn't have.
// ============================================================================

async function fetchChartImageBase64(dailyCandles, symLabel) {
  if (!dailyCandles || dailyCandles.length < 5) {
    throw new Error('Not enough daily candles to build a chart image for ' + symLabel);
  }

  const labels = dailyCandles.map(function (c) { return c.datetime; });
  const data = dailyCandles.map(function (c) {
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
        title: { display: true, text: symLabel + ' -- Daily', color: '#e5e5e5', font: { size: 16 } }
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
  return { b64: base64, mediaType: 'image/png' };
}

module.exports = { fetchChartImageBase64 };
