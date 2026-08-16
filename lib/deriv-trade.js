// ============================================================================
// DERIV TRADE -- places real orders via Deriv's Multipliers API.
// ============================================================================
// IMPORTANT: this executes real orders on whatever account the token belongs
// to. Use a DEMO/virtual account token while proving this out -- never a real
// -money token until you have watched many trades complete correctly.
//
// Flow (per Deriv's own documentation): authorize -> contracts_for (find the
// multiplier this symbol actually offers) -> proposal (get a live tradeable
// price + id) -> buy (execute using that id). This is the documented safer
// path over guessing a multiplier or skipping the proposal step.
//
// ONE THING THAT SURPRISED ME WHILE BUILDING THIS: Deriv's stop_loss/
// take_profit for Multipliers are DOLLAR AMOUNTS of loss/profit, not price
// levels -- unlike your strategy's stopPrice/target which ARE price levels.
// convertPriceDistanceToUSD() below does that conversion. Please sanity-check
// the very first few trades by hand against what you'd expect before trusting
// this unattended.
// ============================================================================

const WebSocket = require('ws');
const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';

function wsRequest(ws, request, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const reqId = Math.floor(Math.random() * 1e9);
    request.req_id = reqId;
    const timer = setTimeout(function () {
      reject(new Error('Deriv trade request timed out: ' + JSON.stringify(request)));
    }, timeoutMs || 8000);
    function onMessage(raw) {
      let data;
      try { data = JSON.parse(raw); } catch (e) { return; }
      if (data.req_id !== reqId) return;
      ws.removeListener('message', onMessage);
      clearTimeout(timer);
      if (data.error) { reject(new Error('Deriv API error: ' + data.error.message)); return; }
      resolve(data);
    }
    ws.on('message', onMessage);
    ws.send(JSON.stringify(request));
  });
}

function openAuthorizedConnection(token) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=' + DERIV_APP_ID);
    const timer = setTimeout(function () { try { ws.close(); } catch (e) {} reject(new Error('Deriv connection timed out')); }, 8000);
    ws.on('open', async function () {
      try {
        const authResp = await wsRequest(ws, { authorize: token });
        clearTimeout(timer);
        resolve({ ws: ws, account: authResp.authorize });
      } catch (e) {
        clearTimeout(timer);
        try { ws.close(); } catch (e2) {}
        reject(e);
      }
    });
    ws.on('error', function (e) { clearTimeout(timer); reject(e); });
  });
}

// Picks the SMALLEST multiplier this symbol offers -- most conservative choice,
// since a higher multiplier magnifies both profit and loss for the same price
// move. Change this if you deliberately want more leverage once you trust the
// system.
async function getConservativeMultiplier(ws, derivSymbol, contractType) {
  const resp = await wsRequest(ws, { contracts_for: derivSymbol, currency: 'USD' });
  const available = (resp.contracts_for && resp.contracts_for.available) || [];
  const match = available.find(function (c) { return c.contract_type === contractType && c.multiplier_range && c.multiplier_range.length; });
  if (!match) throw new Error('No ' + contractType + ' multiplier contract available for ' + derivSymbol);
  return Math.min.apply(null, match.multiplier_range);
}

// Converts a price-level stop/target into the dollar loss/profit amount Deriv
// expects for a Multiplier's limit_order, given the stake and multiplier.
// Formula: dollar move = stake * multiplier * (|price distance| / entry price)
function convertPriceDistanceToUSD(entryPrice, targetPrice, stakeUSD, multiplier) {
  const pctMove = Math.abs(targetPrice - entryPrice) / entryPrice;
  return Math.round(stakeUSD * multiplier * pctMove * 100) / 100;
}

// direction: 'BUY' or 'SELL'. entryPrice/stopPrice/targetPrice: price LEVELS
// from your strategy (not dollar amounts -- conversion happens inside).
async function placeMultiplierTrade({ derivSymbol, direction, stakeUSD, entryPrice, stopPrice, targetPrice }) {
  const token = process.env.DERIV_TRADE_API_TOKEN;
  if (!token) throw new Error('DERIV_TRADE_API_TOKEN is not set -- cannot place trades.');

  const contractType = direction === 'BUY' ? 'MULTUP' : 'MULTDOWN';
  const { ws } = await openAuthorizedConnection(token);

  try {
    const multiplier = await getConservativeMultiplier(ws, derivSymbol, contractType);
    const stopLossUSD = stopPrice != null ? convertPriceDistanceToUSD(entryPrice, stopPrice, stakeUSD, multiplier) : undefined;
    const takeProfitUSD = targetPrice != null ? convertPriceDistanceToUSD(entryPrice, targetPrice, stakeUSD, multiplier) : undefined;

    const proposalReq = {
      proposal: 1, amount: stakeUSD, basis: 'stake', contract_type: contractType,
      currency: 'USD', symbol: derivSymbol, multiplier: multiplier
    };
    const limitOrder = {};
    if (stopLossUSD != null) limitOrder.stop_loss = stopLossUSD;
    if (takeProfitUSD != null) limitOrder.take_profit = takeProfitUSD;
    if (Object.keys(limitOrder).length) proposalReq.limit_order = limitOrder;

    const proposalResp = await wsRequest(ws, proposalReq);
    const proposal = proposalResp.proposal;
    if (!proposal || !proposal.id) throw new Error('No tradeable proposal returned for ' + derivSymbol);

    const buyResp = await wsRequest(ws, { buy: proposal.id, price: proposal.ask_price });
    const bought = buyResp.buy;
    if (!bought || !bought.contract_id) throw new Error('Buy did not return a contract_id.');

    return {
      contractId: bought.contract_id, buyPrice: bought.buy_price,
      multiplier: multiplier, stopLossUSD: stopLossUSD, takeProfitUSD: takeProfitUSD,
      longcode: bought.longcode
    };
  } finally {
    try { ws.close(); } catch (e) {}
  }
}

module.exports = { placeMultiplierTrade };
