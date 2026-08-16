// ============================================================================
// TELEGRAM -- plain Bot API call, no Make.com in the loop.
// ============================================================================
// One HTTPS POST, one dependency removed compared to routing through your
// existing Make.com pipeline. If you'd rather this feed into the same
// automation as your signal channel instead, swap this function's body for a
// POST to your Make.com webhook URL -- the rest of the watcher doesn't care
// which one it calls.
// ============================================================================

async function sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing from environment.');
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
  });
  const data = await resp.json();
  if (!data.ok) throw new Error('Telegram send failed: ' + (data.description || JSON.stringify(data)));
  return data;
}

// Sends the actual chart image Chart Vision AI analyzed, so you can see with
// your own eyes what Claude was looking at when it wrote its verdict -- rather
// than trusting the text description alone. base64Image/mediaType come
// straight from chart-image.js's fetchChartImageBase64() output; nothing is
// saved to disk anywhere, so this photo message IS the only record of it.
async function sendTelegramPhoto(base64Image, mediaType, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing from environment.');
  const url = 'https://api.telegram.org/bot' + token + '/sendPhoto';
  const buffer = Buffer.from(base64Image, 'base64');
  const blob = new Blob([buffer], { type: mediaType || 'image/png' });
  const form = new FormData();
  form.append('chat_id', chatId);
  if (caption) { form.append('caption', caption.substring(0, 1024)); form.append('parse_mode', 'HTML'); }
  form.append('photo', blob, 'chart.png');
  const resp = await fetch(url, { method: 'POST', body: form });
  const data = await resp.json();
  if (!data.ok) throw new Error('Telegram photo send failed: ' + (data.description || JSON.stringify(data)));
  return data;
}

module.exports = { sendTelegramAlert, sendTelegramPhoto };
