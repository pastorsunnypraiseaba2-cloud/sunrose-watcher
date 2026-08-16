// ============================================================================
// CHART VISION -- ported from Sunrose Trader OS (index.html)
// ============================================================================
// This is the SAME 10-step institutional checklist prompt your app already
// sends to Claude for manual chart uploads -- copied here word-for-word (the
// multi-chart branch: Daily + 4H + 1H + 15M, a smaller version of the
// multi-timeframe screenshot set you'd upload manually). If you update the
// prompt in index.html, mirror the change here too -- same drift risk noted
// in cpr-engine.js applies.
//
// Sends to your existing Vercel relay (sunrose-relay.vercel.app/api/analyze),
// which already holds your ANTHROPIC_API_KEY server-side -- no new key needed
// here.
// ============================================================================

const RELAY_URL = process.env.CHART_VISION_RELAY_URL || 'https://sunrose-relay.vercel.app/api/analyze';

function buildPrompt(symLabel, mode) {
  const chartModeSteps = mode === 'reversal'
    ? ('Your task is NOT to predict the market. Your task is to identify only the highest probability institutional REVERSAL setups -- trades AGAINST an exhausted move, where institutional control has changed hands. Analyse the chart from the highest timeframe down to the execution timeframe. You never issue TRADE READY unless every condition is fully and unambiguously satisfied.\n\n' +
      'VALIDITY RULE (applies throughout): a BOS or CHoCH is only valid once price has CLOSED beyond the swing level on a completed candle. A wick poking through, or structure still "forming"/"developing"/"nascent" without a confirmed close, does NOT count -- treat it as not yet satisfied.\n\n' +
      'Follow this exact checklist:\n\n' +
      'STEP 1 -- Prior Trend and Exhaustion Context: Identify the PRIOR trend using Monthly CPR, Weekly CPR, Daily CPR, Daily structure, and 4H structure (whichever are visible or inferable). A reversal requires an established prior move to reverse -- state what that prior trend was (Bullish or Bearish) and the evidence it is exhausting (extended distance from CPR/mean, slowing momentum, divergent swings). If no clear prior trend exists, there is nothing to reverse -- verdict NO TRADE.\n\n' +
      'STEP 2 -- Market Location at an Extreme: A valid reversal begins at a MAJOR institutional level -- PMH/PWH/PDH or R3/R4 for a bearish reversal candidate; PML/PWL/PDL or S3/S4 for a bullish reversal candidate. Mark PMH, PML, PWH, PWL, PDH, PDL where visible, and state whether price is in Premium (for bearish reversals) or Discount (for bullish reversals). A reversal attempted from mid-range/Equilibrium is low quality -- score it accordingly.\n\n' +
      'STEP 3 -- Terminal Liquidity Sweep (MANDATORY): Identify the liquidity pools at that extreme -- previous highs/lows, equal highs/lows, trendline liquidity. The reversal is INVALID unless liquidity has been SWEPT at the level: price must have pushed beyond it (trapping breakout traders / running stops) and rejected back. No sweep, no trade.\n\n' +
      'STEP 4 -- Character Shift in the NEW Direction: Look for the sequence Liquidity Sweep -> CHoCH -> Break of Structure (BOS), where the CHoCH and BOS are in the OPPOSITE direction of the prior trend. Do not accept a setup unless a VALID CHoCH or BOS (closed candle, per the validity rule) confirms institutional control has actually changed. Also note whether the Daily CPR has been reclaimed (bullish reversal) or lost (bearish reversal) -- the stronger the CPR shift, the stronger the reversal.\n\n' +
      'STEP 5 -- Reversal Momentum Quality: Measure the impulse AWAY from the swept extreme -- number of consecutive impulse candles, size of impulse, body-to-wick ratio, speed. Rate it Very Weak, Weak, Moderate, Strong, or Explosive. A genuine institutional reversal displaces aggressively away from the trap; a weak drift back is more likely a pullback in the old trend than a reversal.\n\n' +
      'STEP 6 -- Retest Quality: After the CHoCH/BOS, evaluate the retest back toward the origin of the reversal. Classify it as No Retest Yet, Shallow Retest, Normal Retest, or Deep Retest. The best reversals retest into the zone left behind by the displacement without going back beyond the swept extreme -- a retest that trades back through the sweep level invalidates the idea.\n\n' +
      'STEP 7 -- Institutional Confluence: Check whether the retest zone aligns with any of: Fair Value Gap, Order Block, Breaker Block, Mitigation Block, CPR, Daily Pivot, Equilibrium, Previous High/Low, Volume Imbalance, Liquidity Void. List which confluences are present. The more confluences, the stronger the setup.\n\n' +
      'STEP 8 -- Reversal Probability: Score each of the following out of 10: Exhaustion & Location (how major the level, how stretched the prior move), Liquidity Sweep, Structure Shift (CHoCH/BOS quality in the new direction), Momentum, Retest Quality, Institutional Confluence. Sum to a total out of 60. Interpretation: 55-60 = Elite Institutional Setup; 48-54 = High Probability; 40-47 = Tradable; below 40 = Ignore (verdict NO TRADE).\n\n' +
      'STEP 9 -- Trade Plan: Provide Entry Zone, Stop Loss (beyond the swept extreme), Invalidation Level, Target 1, Target 2, Target 3 (working toward the opposite previous-period extreme: Daily CPR -> PDH/PDL -> Weekly CPR -> PWH/PWL -> PMH/PML), Expected Risk:Reward, Probability of Success, and Estimated Holding Time. Only provide a full trade plan if the total score is 40 or above AND every mandatory condition is confirmed.\n\n' +
      'STEP 10 -- Institutional Explanation: Explain WHY institutions would execute this reversal. Describe who got trapped at the extreme (breakout buyers above the highs / sellers below the lows), where the liquidity for the institutional position came from, why the CHoCH/BOS occurred, why the retest holds without breaching the sweep, and why the reversal is expected to travel to the opposite extreme. Do not describe indicators. Think like a hedge fund distributing into trapped positions.\n\n' +
      'SPECIAL SUNROSE RULE (REVERSAL): The highest-rated reversals are those where liquidity is swept at a MAJOR level, the opposite-direction CHoCH and BOS follow immediately with a confirmed close, momentum away from the trap expands aggressively, the Daily CPR is reclaimed (bullish) or lost (bearish) and NOT given back, the retest stays shallow and never re-breaches the swept extreme, and every push back toward the trap is quickly rejected. These are the Institutional Reversal Models. If this exact pattern exists, set eliteSetup to true -- this is the five-star SUNROSE ELITE REVERSAL SETUP. Estimate the likelihood (0-100) that price continues in the NEW (reversal) direction.\n\n' +
      'VERDICT RULES: Use TRADE READY only when the total score is 40+ AND all mandatory conditions (major level, terminal sweep, valid closed opposite-direction CHoCH/BOS) are confirmed AND a valid entry zone exists AND the CURRENT price shown on the chart is INSIDE that entry zone right now. Compare the current price against the zone boundaries explicitly: if the current price is above the zone (for a BUY) or below it (for a SELL) or otherwise outside it, the verdict is WAIT even if price touched the zone earlier -- \'was in the zone recently\' is not \'in the zone now\'. Use WAIT when the setup is developing favorably but a required condition is not yet fully satisfied (especially an unconfirmed CHoCH/BOS close, or the current price sitting outside the entry zone). Use NO TRADE when there is no prior trend to reverse, no sweep has occurred, the total score is below 40, or the setup has clearly failed -- and state it as: NO TRADE -- WAIT FOR BETTER INSTITUTIONAL CONFIRMATION.\n\n')
    : ('Your task is NOT to predict the market. Your task is to identify only the highest probability institutional continuation setups. Analyse the chart from the highest timeframe down to the execution timeframe. You never issue TRADE READY unless every condition is fully and unambiguously satisfied.\n\n' +
      'VALIDITY RULE (applies throughout): a BOS or CHoCH is only valid once price has CLOSED beyond the swing level on a completed candle. A wick poking through, or structure still "forming"/"developing"/"nascent" without a confirmed close, does NOT count -- treat it as not yet satisfied.\n\n' +
      'Follow this exact checklist:\n\n' +
      'STEP 1 -- Higher Timeframe Bias: Determine the trend using Monthly CPR, Weekly CPR, Daily CPR, Daily structure, and 4H structure (whichever are visible or inferable). State whether the market is Bullish, Bearish, or Neutral. Do not continue past this step unless a clear directional bias exists -- if bias is Neutral, the verdict is NO TRADE.\n\n' +
      'STEP 2 -- Market Location: Identify whether price is trading in Premium, Discount, or Equilibrium. Mark PMH, PML, PWH, PWL, PDH, PDL where visible. Determine whether price is positioned where institutions would naturally buy or sell.\n\n' +
      'STEP 3 -- Liquidity Analysis: Identify all liquidity pools -- previous highs/lows, equal highs/lows, trendline liquidity, internal and external liquidity. Determine whether liquidity has already been swept. The setup is INVALID if liquidity has not yet been taken.\n\n' +
      'STEP 4 -- Character Shift: Look for the sequence Liquidity Sweep -> CHoCH -> Break of Structure (BOS). Do not accept a setup unless a VALID BOS (closed candle, per the validity rule) confirms institutional participation.\n\n' +
      'STEP 5 -- Momentum Quality: Measure the number of consecutive impulse candles, size of impulse, body-to-wick ratio, and speed of movement. Rate momentum as Very Weak, Weak, Moderate, Strong, or Explosive. The best setups normally have Strong or Explosive momentum.\n\n' +
      'STEP 6 -- Pullback Quality: After BOS, evaluate the pullback. Classify it as No Pullback, Shallow Pullback, Normal Pullback, or Deep Pullback. High-probability setups usually produce only shallow pullbacks before continuation. Reject setups with deep retracements unless there is a compelling institutional reason.\n\n' +
      'STEP 7 -- Institutional Confluence: Check whether the pullback aligns with any of: Fair Value Gap, Order Block, Breaker Block, Mitigation Block, CPR, Daily Pivot, Equilibrium, Previous High/Low, Volume Imbalance, Liquidity Void. List which confluences are present. The more confluences, the stronger the setup.\n\n' +
      'STEP 8 -- Continuation Probability: Score each of the following out of 10: Trend Alignment, Liquidity Sweep, Structure Break, Momentum, Pullback Quality, Institutional Confluence. Sum to a total out of 60. Interpretation: 55-60 = Elite Institutional Setup; 48-54 = High Probability; 40-47 = Tradable; below 40 = Ignore (verdict NO TRADE).\n\n' +
      'STEP 9 -- Trade Plan: Provide Entry Zone, Stop Loss, Invalidation Level, Target 1, Target 2, Target 3, Expected Risk:Reward, Probability of Success, and Estimated Holding Time. Only provide a full trade plan if the total score is 40 or above AND every mandatory condition is confirmed.\n\n' +
      'STEP 10 -- Institutional Explanation: Explain WHY institutions would execute this move. Describe who got trapped, where liquidity came from, why the BOS occurred, why the pullback remained shallow, and why continuation is expected. Do not describe indicators. Think like a hedge fund.\n\n' +
      'SPECIAL SUNROSE RULE: The highest-rated setups are those where liquidity is swept, BOS immediately follows, momentum expands aggressively, price does NOT return above (or below, for shorts) the CPR or Equilibrium after BOS, pullbacks remain shallow, and every retracement is quickly rejected. These are the Institutional Continuation Models. If this exact pattern exists, set eliteSetup to true -- this is the five-star SUNROSE ELITE CONTINUATION SETUP. Estimate the likelihood (0-100) that price continues in the direction of the impulse.\n\n' +
      'VERDICT RULES: Use TRADE READY only when the total score is 40+ AND all mandatory conditions (bias, sweep, valid closed BOS) are confirmed AND a valid entry zone exists AND the CURRENT price shown on the chart is INSIDE that entry zone right now. Compare the current price against the zone boundaries explicitly: if the current price is outside the zone in either direction, the verdict is WAIT even if price touched the zone earlier -- \'was in the zone recently\' is not \'in the zone now\'. Use WAIT when the setup is developing favorably but a required condition is not yet fully satisfied (especially an unconfirmed BOS/CHoCH close, or the current price sitting outside the entry zone). Use NO TRADE when bias is Neutral, liquidity has not been swept, the total score is below 40, or the setup has clearly failed -- and state it as: NO TRADE -- WAIT FOR BETTER INSTITUTIONAL CONFIRMATION.\n\n');

  // Multi-chart branch: the watcher supplies Daily (for HTF bias/CPR context),
  // plus 4H/1H/15M for structure and execution-level precision -- a smaller
  // version of your manual multi-timeframe screenshot workflow.
  const mtfManifest = 'You have FOUR charts, in this order: (1) Daily -- use this for Monthly/Weekly/Daily CPR context and overall bias, (2) 4H, (3) 1H, (4) 15M -- use these three for structure (CHoCH/BOS), liquidity sweeps, and precise entry timing. Weekly/Monthly CPR levels are not drawn on any chart -- infer higher-timeframe bias primarily from the Daily chart\'s recent price action and score Trend Alignment conservatively if it is ambiguous.\n\n';

  const coherenceRule = mode === 'reversal'
    ? 'COHERENCE RULE (MANDATORY): a reversal trades AGAINST the prior trend. If htfBias (the prior trend) is Bearish, direction must be BUY; if Bullish, direction must be SELL. If the setup you see moves WITH the prior trend, it is a continuation, not a reversal -- set setupType to NONE, verdict to NO TRADE, and say so in stepByStep.\n\n'
    : 'COHERENCE RULE (MANDATORY): a continuation resumes the higher-timeframe trend. If htfBias is Bearish, direction must be SELL; if Bullish, direction must be BUY. If the only setup you can see is a BUY while htfBias is Bearish (or a SELL while htfBias is Bullish), that is NOT a continuation. Set setupType to NONE, verdict to NO TRADE, and explain in stepByStep that the low-timeframe move opposes the higher-timeframe bias and belongs to the Reversal strategy. Do not relabel a counter-trend entry as continuation to keep the analysis alive.\n\n';

  const jsonSchema =
    'Examine the chart image carefully and respond ONLY with this exact JSON (no markdown fences, no extra text before or after):\n' +
    '{\n' +
    '"detectedInstrument": "the instrument name or ticker as literally printed on the chart itself. Use \\"unknown\\" only if no label is legible.",\n' +
    '"instrumentMatchesContext": true if the chart is the SAME market as the stated asset context, false otherwise,\n' +
    '"htfBias": "Bullish" or "Bearish" or "Neutral",\n' +
    '"marketLocation": "Premium" or "Discount" or "Equilibrium" or "unclear",\n' +
    '"setupType": ' + (mode === 'reversal' ? '"REVERSAL" or "NONE"' : '"CONTINUATION" or "NONE"') + ',\n' +
    '"direction": "BUY" or "SELL" or "NONE",\n' +
    '"momentum": "Very Weak" or "Weak" or "Moderate" or "Strong" or "Explosive",\n' +
    '"pullbackQuality": ' + (mode === 'reversal' ? '"No Retest Yet" or "Shallow Retest" or "Normal Retest" or "Deep Retest"' : '"No Pullback" or "Shallow Pullback" or "Normal Pullback" or "Deep Pullback"') + ',\n' +
    '"confluences": ["list of confluence names present"],\n' +
    '"scores": {"trendAlignment": 0-10, "liquiditySweep": 0-10, "structureBreak": 0-10, "momentum": 0-10, "pullbackQuality": 0-10, "institutionalConfluence": 0-10, "total": 0-60},\n' +
    '"scoreTier": "Elite Institutional Setup" or "High Probability" or "Tradable" or "Ignore",\n' +
    '"eliteSetup": true or false,\n' +
    '"continuationProbability": 0-100,\n' +
    '"entryZone": {"high": number or null, "low": number or null},\n' +
    '"target": {"price": number or null, "reason": "one-line explanation"},\n' +
    '"stopLoss": {"price": number or null, "reason": "one-line explanation"},\n' +
    '"invalidationLevel": number or null,\n' +
    '"estimatedHoldingTime": "short description or null",\n' +
    '"institutionalExplanation": "who got trapped, where liquidity came from, why the structure shift occurred, why continuation/reversal is expected -- as a hedge fund would reason",\n' +
    '"verdict": "TRADE READY" or "WAIT" or "NO TRADE",\n' +
    '"confidence": 0-100\n' +
    '}\n\n';

  return 'You are an elite Institutional Market Analyst trained in Smart Money Concepts (SMC), ICT concepts, and the Sunrose Trading Constitution. The asset context is ' + symLabel + ' unless the chart clearly shows a different instrument.\n\n' +
    mtfManifest + chartModeSteps + jsonSchema + coherenceRule +
    'This chart was auto-generated from live Deriv price data by an automated watcher, not uploaded by the trader -- there are no trader notes for this check.';
}

function stripFences(text) {
  return text.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
}

async function callChartVision(symLabel, mode, images) {
  const prompt = buildPrompt(symLabel, mode);
  const imageBlocks = images.map(function (img) {
    return { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.b64 } };
  });
  const messages = [{
    role: 'user',
    content: imageBlocks.concat([{ type: 'text', text: prompt }])
  }];

  const res = await fetch(RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, messages: messages })
  });

  const rawText = await res.text();
  let data;
  try { data = JSON.parse(rawText); }
  catch (e) { throw new Error('Relay returned invalid response (HTTP ' + res.status + '): ' + rawText.substring(0, 200)); }
  if (data.error) throw new Error('Anthropic error: ' + (data.error.message || JSON.stringify(data.error)));
  if (!data.content || !data.content.length) throw new Error('Relay returned no content.');

  const textBlock = data.content.find(function (c) { return c.type === 'text'; });
  if (!textBlock) throw new Error('No text block in Claude response.');

  let parsed;
  try { parsed = JSON.parse(stripFences(textBlock.text)); }
  catch (e) { throw new Error('Could not parse Chart Vision JSON: ' + textBlock.text.substring(0, 200)); }

  return parsed;
}

module.exports = { buildPrompt, callChartVision };
