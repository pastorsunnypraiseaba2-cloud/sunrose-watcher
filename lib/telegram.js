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

module.exports = { sendTelegramAlert };
