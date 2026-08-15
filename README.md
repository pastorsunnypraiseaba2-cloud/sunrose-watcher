# Sunrose Watcher

An always-on watcher that checks every instrument on your list, runs the same
CPR alignment check AND the full Continuation/Reversal Constitution logic
your app runs, and messages your Telegram bot the moment either fires. Works
even when your phone is locked or the browser is closed.

## What this alerts on

1. **CPR alignment** (\u26A1) -- Monthly + Weekly + Daily all agree. The
   precondition both strategies start from. "Worth watching," not a verdict.
2. **TRADE READY** (\uD83D\uDFE2) -- the full Continuation or Reversal rule
   sequence has actually completed, with real entry zone, stop, target, and
   risk-reward. This is the same verdict the app's Home tab shows.

Both are transition-triggered: you get messaged once when a state is newly
reached, not every few minutes while it holds.

## What changed since the first version of this README

The original version of this file said the full six/eight-rule check would
need a redesigned persistent structure-history store, and that it was a
separate "Phase 2" to build later. That turned out to be wrong: every piece
of structure/liquidity/institutional-level detection in your app is a pure
function of a candle window, recomputed fresh on every fetch -- the browser's
`localStorage` retention is a 5-day *display* convenience so recently-detected
zones don't flicker off the UI, not something the detection itself depends
on. So the full verdict check is built and included now, using the exact same
1560 hourly candles the alignment check already pulls -- no extra Deriv
calls, no persistent structure store.

## What's faithfully ported vs. what's not

**Ported directly from your `index.html`, function by function:** `calcCPR`,
`biasFromCPR`, `calcStrictBias`, `validateCPR`, the NY-session daily/weekly/
monthly candle builders, `findSwings`, `detectLiquidity`, `detectSweeps`,
`detectStructure`, `detectFVG`, `detectOrderBlocks`, the 9-state rich level
classifier, `findInstitutionalLevel`, `getLiquiditySweptStatus`,
`buildTargetLadder`, `findEntryZone`, `findFVGEntryZone`, `scoreSetupQuality`,
`evaluateContinuationStrategy`, and `evaluateReversalStrategy`. Every rule,
threshold, and design-note comment from the source is preserved.

**One real gap:** three zone types (Breaker Block, Mitigation Block, Inverse
FVG) are only ever added to your app by *manually marking them in the UI* --
there is no auto-detector for them in your source, only for Order Blocks and
FVGs. A server-side watcher has no one to do that marking, so it can never
see those zones. In practice this is a smaller gap than it sounds: the
DECISIVE final entry gate in both strategies (Continuation Rule 7 / Reversal
Rule 5) only ever reads FVGs anyway, so the verdict itself isn't weakened --
only the softer Rule 3 retracement check and the Institutional Confluence
score are marginally narrower than a session where you've manually marked
extra zones.

**One pre-existing bug this port surfaced, not introduced:** `detectStructure`
tags BOS/CHoCH events `dir: 'bullish'`/`'bearish'`, but `scoreSetupQuality`'s
own confluence check compares against `'bull'`/`'bear'` with an exact match --
so its Structure Break score never actually detects a real BOS/CHoCH, in your
live app too. The two strategy evaluators use a substring match instead,
which works correctly regardless of which form is used, so the actual
TRADE READY verdict is unaffected. Worth a one-line fix in `index.html` when
you get to it: `s.dir === wantDir` -> `s.dir.indexOf(wantDir) >= 0` in
`scoreSetupQuality`.

## Before you trust it

This has been tested with synthetic data engineered to walk every rule to a
pass, and separately to confirm a flat/no-signal state stays at WAIT with no
false alerts -- but it has never run against live Deriv data, because this
sandbox has no network access. **Run it alongside the app for a few days and
compare both the alignment reading and the full verdict here against what the
app shows for the same instrument at the same moment, before trusting an
unattended alert.** If they ever disagree, trust the app and tell me.

## Setup

### 1. Telegram -- using your existing bot

Since you already have a bot, you just need its token and the chat ID to send
to:

- **Token:** if you don't have it saved anywhere, message **@BotFather**,
  send `/mybots`, pick your bot, then **API Token**.
- **Chat ID:** if you already send messages to it from Make.com or elsewhere,
  you likely already have this saved in that automation. If not: send your
  bot any message, then visit
  `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and find
  `"chat":{"id":...}` in the response.

If you'd rather this feed into your existing Make.com signal pipeline instead
of messaging Telegram directly, swap the single function body in
`lib/telegram.js` for a POST to your Make.com webhook URL -- nothing else in
the project needs to change.

### 2. Upstash Redis (free)

1. Sign up at [upstash.com](https://upstash.com), create a Redis database.
2. Copy the **REST URL** and **REST TOKEN** from the dashboard.

### 3. Deploy to Vercel

A **separate, new Vercel project** -- not merged into `sunrose-relay`, so
there's no risk to the Anthropic-analysis relay that already works.

1. Push this folder to its own GitHub repo, import into Vercel.
2. Project Settings -> Environment Variables: fill in every value from
   `.env.example` with your real credentials. Invent your own `WATCH_SECRET`.
3. Deploy.

### 4. External scheduler (cron-job.org, free)

Vercel's free-tier cron only fires once a day -- not enough here. An external
scheduler hitting the same URL sidesteps that with no plan change needed.

1. Sign up at [cron-job.org](https://cron-job.org).
2. Create a job: GET request every 2-3 minutes to
   `https://your-project-name.vercel.app/api/watch?secret=YOUR_WATCH_SECRET`.

With `WATCH_BATCH_SIZE=5` and a 3-minute tick, all 30 instruments get checked
roughly every 18 minutes. Lower the batch size if Vercel's function logs show
timeouts; raise it if 18 minutes is too slow and you're willing to watch for
timeout errors, or upgrade to Vercel Pro for a longer execution ceiling.

## Tuning

- **`WATCH_BATCH_SIZE`** -- instruments per tick. Vercel Hobby's 10-second
  ceiling is hard and non-configurable; lower this first if you see timeouts.
- **Cron interval** -- set in cron-job.org. Faster ticks mean faster full-list
  coverage and more Deriv requests overall. Deriv doesn't publish a fixed
  rate limit, but persistent heavy use can draw scrutiny -- if you see errors
  from Deriv specifically (not Vercel timeouts), slow down.

## Files

- `lib/cpr-engine.js` -- CPR + alignment math
- `lib/deriv.js` -- Deriv fetch + NY-session candle building
- `lib/structure-engine.js` -- swings, liquidity, structure (BOS/CHoCH), FVG/OB,
  rich level states, target ladder, setup quality scoring
- `lib/build-state.js` -- assembles one symbol's full state from a single fetch
- `lib/brain.js` -- the two strategy evaluators
- `lib/state.js` -- Upstash-backed round-robin cursor and dedupe
- `lib/telegram.js` -- alert sender
- `lib/watchlist.js` -- your instrument list, editable
- `api/watch.js` -- ties it all together; the endpoint your cron hits
