import dotenv from 'dotenv';
dotenv.config({ override: true });
import { OpenAI } from 'openai';
import readline from 'readline';
import { argv, env, exit } from 'process';
import * as api from './index.js';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// 1. Verify API Key
if (!env.OPENAI_API_KEY) {
  console.error('\x1b[31mError: OPENAI_API_KEY is not defined in the environment.\x1b[0m');
  console.error('Please create a `.env` file in the project root with your key:');
  console.error('OPENAI_API_KEY=your_key_here');
  exit(1);
}

const MODEL = env.OPENAI_MODEL || 'gpt-5-mini';
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const PROFILE_PATH = 'user_profile.json';
const JOURNAL_PATH = 'trade_journal.json';

// Initialize Supabase Client
const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_KEY;
const isSupabaseEnabled = !!(supabaseUrl && supabaseKey);
const supabase = isSupabaseEnabled ? createClient(supabaseUrl, supabaseKey) : null;

if (isSupabaseEnabled) {
  console.log('\x1b[32m[System] Supabase database integration is enabled.\x1b[0m');
} else {
  console.log('\x1b[33m[System] Supabase credentials not found. Falling back to local JSON files.\x1b[0m');
}

// Helper to parse currency strings to numbers (e.g. "$10.00" -> 10.00)
function parseCurrency(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const cleaned = val.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Helper to compute P&L from result string
function calculatePnL(result, risk, reward) {
  if (!result || result.toLowerCase().includes('pending')) {
    return null;
  }
  if (result.toLowerCase().includes('profit')) {
    const val = parseCurrency(result);
    return val !== 0 ? Math.abs(val) : parseCurrency(reward);
  }
  if (result.toLowerCase().includes('loss')) {
    const val = parseCurrency(result);
    return val !== 0 ? -Math.abs(val) : -parseCurrency(risk);
  }
  const val = parseCurrency(result);
  return val;
}

// Helper to read user profile (async)
async function readUserProfile() {
  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('user_profile')
        .select('*')
        .eq('key', 'default')
        .maybeSingle();

      if (error) throw error;
      if (data) {
        return {
          capital: Number(data.capital),
          riskTolerance: Number(data.risk_tolerance),
          minRR: Number(data.min_rr),
          preferredExpiry: data.preferred_expiry || undefined,
          preferredStrategies: data.preferred_strategies || [],
          notes: data.notes || ''
        };
      }
    } catch (error) {
      console.error(`\x1b[31m[Supabase Error] Failed to read user profile: ${error.message}\x1b[0m`);
    }
  }

  try {
    if (fs.existsSync(PROFILE_PATH)) {
      const data = fs.readFileSync(PROFILE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`\x1b[31m[System Error] Failed to read user profile: ${error.message}\x1b[0m`);
  }
  return {};
}

// Helper to write user profile (async)
async function writeUserProfile(profile) {
  if (isSupabaseEnabled) {
    try {
      const dbProfile = {
        capital: profile.capital,
        risk_tolerance: profile.riskTolerance,
        min_rr: profile.minRR,
        preferred_expiry: profile.preferredExpiry,
        preferred_strategies: profile.preferredStrategies,
        notes: profile.notes,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('user_profile')
        .upsert({ key: 'default', ...dbProfile }, { onConflict: 'key' });

      if (error) throw error;
      return { success: true, message: 'User profile updated in Supabase.' };
    } catch (error) {
      console.error(`\x1b[31m[Supabase Error] Failed to write user profile: ${error.message}\x1b[0m`);
      return { success: false, error: error.message };
    }
  }

  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
    return { success: true, message: 'User profile updated locally.' };
  } catch (error) {
    console.error(`\x1b[31m[System Error] Failed to write user profile: ${error.message}\x1b[0m`);
    return { success: false, error: error.message };
  }
}

// Helper to read trade journal (async)
async function readTradeJournal() {
  if (isSupabaseEnabled) {
    try {
      const { data, error } = await supabase
        .from('trade_journal')
        .select('*')
        .order('date', { ascending: false })
        .order('id', { ascending: false });

      if (error) throw error;
      return data.map(item => ({
        date: item.date,
        marketState: item.market_state,
        strategy: item.strategy,
        reason: item.reason,
        risk: `$${Number(item.risk).toFixed(2)}`,
        reward: `$${Number(item.reward).toFixed(2)}`,
        result: item.result,
        lessons: item.lessons || '',
        legs: item.legs || [],
        entryFactors: item.entry_factors || null
      }));
    } catch (error) {
      console.error(`\x1b[31m[Supabase Error] Failed to read trade journal: ${error.message}\x1b[0m`);
    }
  }

  try {
    if (fs.existsSync(JOURNAL_PATH)) {
      const data = fs.readFileSync(JOURNAL_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`\x1b[31m[System Error] Failed to read trade journal: ${error.message}\x1b[0m`);
  }
  return [];
}

// Helper to write trade journal (async, local-only fallback)
async function writeTradeJournal(journal) {
  try {
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2), 'utf8');
    return { success: true, message: 'Trade logged successfully.' };
  } catch (error) {
    console.error(`\x1b[31m[System Error] Failed to write trade journal: ${error.message}\x1b[0m`);
    return { success: false, error: error.message };
  }
}

// Helper to insert a trade directly to Supabase
async function logTradeToSupabase(trade) {
  try {
    const riskVal = parseCurrency(trade.risk);
    const rewardVal = parseCurrency(trade.reward);
    const pnlVal = calculatePnL(trade.result, riskVal, rewardVal);

    const dbTrade = {
      date: trade.date,
      market_state: trade.marketState,
      strategy: trade.strategy,
      reason: trade.reason,
      risk: riskVal,
      reward: rewardVal,
      result: trade.result,
      pnl: pnlVal,
      lessons: trade.lessons,
      legs: trade.legs || [],
      entry_factors: trade.entryFactors || null
    };

    const { error } = await supabase
      .from('trade_journal')
      .insert([dbTrade]);

    if (error) throw error;
    return { success: true, message: 'Trade logged successfully in Supabase.' };
  } catch (error) {
    console.error(`\x1b[31m[Supabase Error] Failed to log trade: ${error.message}\x1b[0m`);
    return { success: false, error: error.message };
  }
}

const SYSTEM_PROMPT_BASE = `You are a professional options trading assistant. Your task is to convert raw market snapshot metrics into trading insights and recommendations.

You have access to the following market data and trade journaling tools:
1. getCurrentBTCPrice(): Returns the current BTC spot price.
2. getMarketSummary(expiry): Returns the market summary metadata, including marketState, candidateStrategies, and confidenceInputs.
3. getStrikeDetails(strike, expiry): Returns detailed Call/Put contract specifications, Greeks, and quotes for a specific strike price.
4. getOptionChain(expiry, fromStrike, toStrike): Returns the list of strikes with Call/Put details within the selected range.
5. calculateStrategy(params): Calculates maximum risk, maximum reward, net debit/credit, and break-even for a given options strategy.
6. getUserProfile(): Returns the stored user profile preferences (capital, risk tolerance, preferred strategies, etc.).
7. updateUserProfile(profile): Updates the stored user profile preferences.
8. getTradeJournal(): Returns logged trade entries from the trade journal.
9. logTrade(trade): Logs a trade with date, marketState, strategy, reason, risk, reward, result, lessons, legs, and entryFactors.
10. getChartTechnicalAnalysis(params): Fetches and analyzes historical candle data to detect trend (Uptrend, Downtrend, Sideways) and structural S/R pivots on custom resolutions (default 4h).

Rules for recommendation:
- NEVER guess or make up maximum risk, maximum reward, net credit/debit, or break-even points. Always call 'calculateStrategy' to fetch the exact calculations before recommending any options spreads or strategies.
- Trade Validation: You MUST invoke 'validateTrade' on your final proposed strategy strikes to evaluate scores and warnings. Report the overall Opportunity Score and individual checklist ratings.
- Strategy Selection: Do NOT invent strategies outside the 'candidateStrategies' list provided in the getMarketSummary() output. Recommend the single best strategy from those candidates.
- Chart S/R & Trend Alignment: Prioritize using structural 4H chart support and resistance levels (retrieved from getChartTechnicalAnalysis) to select your option strikes (e.g. place short put strike below 4H support, short call strike above 4H resistance). Explain how these chart-based levels align with or differ from option chain OI walls, and how the 4H trend bias confirms your strategy.
- Why Not? Section: For every recommendation, you must include a detailed "Why Not?" section explaining why you rejected the other options in the 'candidateStrategies' list (and compare it to common alternatives like an Iron Condor or other spreads).
- Confidence Score: Evaluate and explain your trade confidence based on the 'confidenceInputs' (the count of signalsAligned and signalsConflicting) returned by getMarketSummary(). Justify the final confidence (High, Medium, or Low) using these signals. Do not invent arbitrary percentages.
- Payout P&L Limits: Calculate strategy lot sizes relative to the users Capital and Risk Tolerance stored in their profile. Note that on Delta Exchange, 1 Lot = 0.001 BTC (so Risk per Lot = Max Risk per 1 BTC * 0.001). Explain this lot size math clearly in your recommendation.
- Delta Exchange India Brokerage & Taxes: Always factor in Delta Exchange India brokerage fees and taxes into your trade recommendations:
  * Taker Fee: 0.03% of Notional Value per leg (capped at 10% of Option Premium per leg).
  * GST: 18% GST on total brokerage fees.
  * TDS: 1% VDA TDS on gross transaction value (where applicable).
  * Round-Trip Cost: Always report entry brokerage, GST, and round-trip brokerage (entry + exit), along with Net Max Risk and Net Max Reward after brokerage.
- HISTORY-BASED LEARNING: Before suggesting any options trade, you MUST retrieve past trades via 'getTradeJournal()'. Analyze the 'entryFactors' of closed trades (those with "Profit" or "Loss" results). Identify which factor combinations (e.g. low/high IV, specific Greeks, alignment metrics, PCR levels) historically resulted in profitable outcomes versus losses. Mention this performance insight inside your trade recommendation (e.g., "Historically, setups under similar IV and PCR conditions resulted in [X]% win rate...").
- LOGGING ENTRY FACTORS: When you log a trade via 'logTrade()', you MUST populate the 'entryFactors' parameter using the exact market summary metrics (prices, S/R, PCR, IV, signals, Greeks, and validateTrade subscores) present at entry. This allows the system to build the historical training dataset for you to learn from in subsequent turns.
- Output Format: Present your response in a clear, formatted layout with sections: Market Bias, Reason, Recommended Strategy, Opportunity Score, Suggested Strikes, Maximum Risk, Maximum Reward, Delta Brokerage & GST Breakdown, Net Max Risk & Net Max Reward, Lot Size Sizing, Confidence (explaining Aligned vs Conflicting signals), Why not [alternative strategy candidates]?, Historical Learnings (analyzing closed trades factors).`;

/**
 * Builds the system prompt injecting the latest user memory profile.
 */
function getSystemPrompt(profile) {
  let profileSection = '\n\n=== USER PROFILE (MEMORY) ===\n';
  if (!profile || Object.keys(profile).length === 0) {
    profileSection += 'No user preferences or capital constraints stored yet. Ask the user for their capital and risk preferences if relevant, or save them when they state them.';
  } else {
    if (profile.capital) profileSection += `- Capital: $${profile.capital.toLocaleString('en-US')}\n`;
    if (profile.riskTolerance) profileSection += `- Risk Tolerance: ${(profile.riskTolerance * 100).toFixed(1)}% per trade\n`;
    if (profile.minRR) profileSection += `- Minimum Risk/Reward (minRR): ${profile.minRR.toFixed(2)}\n`;
    if (profile.preferredExpiry) profileSection += `- Preferred Expiry: ${profile.preferredExpiry}\n`;
    if (profile.lotSizeBtc) profileSection += `- Contract Sizing: 1 Lot = ${profile.lotSizeBtc} BTC\n`;
    if (profile.exchange) profileSection += `- Brokerage Exchange: ${profile.exchange} (0.03% Taker, 10% Premium Cap, 18% GST, 1% VDA TDS)\n`;
    if (profile.preferredStrategies && profile.preferredStrategies.length > 0) {
      profileSection += `- Preferred Strategies: ${profile.preferredStrategies.join(', ')}\n`;
    }
    if (profile.notes) profileSection += `- Additional Notes: ${profile.notes}\n`;
  }
  
  return SYSTEM_PROMPT_BASE + profileSection;
}

// Define the tools for OpenAI Function Calling
const tools = [
  {
    type: 'function',
    function: {
      name: 'getCurrentBTCPrice',
      description: 'Get the current real-time spot price of BTC.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getMarketSummary',
      description: 'Get the high-level market summary metadata (Support, Resistance, Max Pain, PCR, Average IV, Funding, and ATM Greeks) for the selected expiry.',
      parameters: {
        type: 'object',
        properties: {
          expiry: {
            type: 'string',
            description: "Optional custom expiry date in DDMMYY format or selection index (e.g. '150726' or '2')."
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getStrikeDetails',
      description: 'Get detailed Call and Put option metrics (quotes, Greeks, volumes, OI) for a specific strike price.',
      parameters: {
        type: 'object',
        properties: {
          strike: {
            type: 'number',
            description: 'The strike price to inspect (e.g. 63000).'
          },
          expiry: {
            type: 'string',
            description: "Optional custom expiry date in DDMMYY format or selection index (e.g. '150726' or '2')."
          }
        },
        required: ['strike']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getOptionChain',
      description: 'Get the option chain strikes and option quotes, optionally filtered within a strike range.',
      parameters: {
        type: 'object',
        properties: {
          expiry: {
            type: 'string',
            description: "Optional custom expiry date in DDMMYY format or selection index (e.g. '150726' or '2')."
          },
          fromStrike: {
            type: 'number',
            description: 'Optional lower bound for strike price filtering.'
          },
          toStrike: {
            type: 'number',
            description: 'Optional upper bound for strike price filtering.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculateStrategy',
      description: 'Calculate payoffs, maximum risk, maximum reward, and net credit/debit for options strategies (e.g. bullputcreditspread, bearcallcreditspread, ironcondor).',
      parameters: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            description: 'The strategy name (e.g., "bullputcreditspread", "bearcallcreditspread", "ironcondor").'
          },
          expiry: {
            type: 'string',
            description: "Optional custom expiry date in DDMMYY format or selection index."
          },
          shortStrike: {
            type: 'number',
            description: 'Strike price for short option (for spreads / puts).'
          },
          longStrike: {
            type: 'number',
            description: 'Strike price for long option (for spreads / puts).'
          },
          shortStrike2: {
            type: 'number',
            description: 'Optional second short strike price (e.g., short call for iron condor).'
          },
          longStrike2: {
            type: 'number',
            description: 'Optional second long strike price (e.g., long call for iron condor).'
          }
        },
        required: ['strategy', 'shortStrike', 'longStrike']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getUserProfile',
      description: 'Get the stored user profile preferences, including capital, risk tolerance, preferred strategies, and preferred expiries.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'updateUserProfile',
      description: 'Update the stored user profile preferences when the user states their capital, risk tolerance, strategy preferences, or notes.',
      parameters: {
        type: 'object',
        properties: {
          capital: {
            type: 'number',
            description: 'The users available capital in USD (e.g. 500).'
          },
          riskTolerance: {
            type: 'number',
            description: 'The users maximum risk tolerance per trade (as decimal, e.g. 0.02 for 2%).'
          },
          minRR: {
            type: 'number',
            description: 'The users minimum Risk/Reward ratio for trade validation (e.g. 0.20).'
          },
          preferredExpiry: {
            type: 'string',
            description: 'The users preferred expiry description (e.g., "Friday", "Weekly", "Daily").'
          },
          preferredStrategies: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of strategies the user prefers (e.g. ["Iron Condor", "Bull Put Spread"]).'
          },
          notes: {
            type: 'string',
            description: 'Any additional preferences or custom notes.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getTradeJournal',
      description: 'Get the logged history of previous options trades and lessons learned.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'logTrade',
      description: 'Log a new trade entry in the trade journal.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'The date of the trade in YYYY-MM-DD format. Defaults to current date if omitted.'
          },
          marketState: {
            type: 'string',
            description: 'The market state at the time of trade (e.g. "Trending Up", "Range Bound").'
          },
          strategy: {
            type: 'string',
            description: 'The options strategy executed (e.g. "Bull Put Credit Spread").'
          },
          reason: {
            type: 'string',
            description: 'Detailed explanation of why the trade was entered.'
          },
          risk: {
            type: 'string',
            description: 'The maximum risk amount (e.g. "$10.00").'
          },
          reward: {
            type: 'string',
            description: 'The maximum reward amount (e.g. "$2.50").'
          },
          result: {
            type: 'string',
            description: 'The outcome of the trade (e.g. "Pending", "Profit +$2.50", "Loss -$10.00"). Defaults to "Pending".'
          },
          lessons: {
            type: 'string',
            description: 'Lessons learned or general feedback about the trade.'
          },
          legs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Option contract symbol, e.g. C-BTC-65000-170726.' },
                strike: { type: 'number', description: 'Strike price.' },
                type: { type: 'string', enum: ['C', 'P'], description: 'Call (C) or Put (P).' },
                action: { type: 'string', enum: ['buy', 'sell'], description: 'buy (long) or sell (short).' },
                entry_price: { type: 'number', description: 'Option premium entry price per BTC.' },
                quantity: { type: 'number', description: 'Contract size/quantity in BTC terms, e.g. 0.01 or 1.' }
              },
              required: ['symbol', 'strike', 'type', 'action', 'entry_price', 'quantity']
            },
            description: 'Structured array of option legs for real-time P&L tracking.'
          },
          entryFactors: {
            type: 'object',
            properties: {
              btcPrice: { type: 'number' },
              averageIV: { type: 'number' },
              ivClassification: { type: 'string' },
              support: { type: 'number' },
              resistance: { type: 'number' },
              pcr: { type: 'number' },
              fundingRate: { type: 'number' },
              fundingSentiment: { type: 'string' },
              signalsAligned: { type: 'number' },
              signalsConflicting: { type: 'number' },
              opportunityScore: { type: 'number' },
              validationScores: {
                type: 'object',
                properties: {
                  riskReward: { type: 'number' },
                  liquidity: { type: 'number' },
                  spread: { type: 'number' },
                  oi: { type: 'number' },
                  expiry: { type: 'number' },
                  marketAlignment: { type: 'number' }
                }
              },
              greeks: {
                type: 'object',
                properties: {
                  callDelta: { type: 'number', nullable: true },
                  putDelta: { type: 'number', nullable: true },
                  callGamma: { type: 'number', nullable: true },
                  putGamma: { type: 'number', nullable: true },
                  callTheta: { type: 'number', nullable: true },
                  putTheta: { type: 'number', nullable: true },
                  callVega: { type: 'number', nullable: true },
                  putVega: { type: 'number', nullable: true },
                  callRho: { type: 'number', nullable: true },
                  putRho: { type: 'number', nullable: true }
                }
              }
            },
            description: 'Pre-trade market analysis metrics recorded at trade entry for AI performance learning.'
          }
        },
        required: ['strategy', 'reason', 'risk', 'reward']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'validateTrade',
      description: 'Programmatically validate a proposed options trade against liquidity, bid-ask spread, open interest, and risk/reward constraints, calculating an Opportunity Score.',
      parameters: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            description: 'The strategy name (e.g. "bullputcreditspread", "bearcallcreditspread", "ironcondor").'
          },
          expiry: {
            type: 'string',
            description: 'Optional custom expiry date in DDMMYY format or selection index.'
          },
          shortStrike: {
            type: 'number',
            description: 'Short option strike price.'
          },
          longStrike: {
            type: 'number',
            description: 'Long option strike price.'
          },
          shortStrike2: {
            type: 'number',
            description: 'Second short strike (e.g. short call for iron condor).'
          },
          longStrike2: {
            type: 'number',
            description: 'Second long strike (e.g. long call for iron condor).'
          }
        },
        required: ['strategy', 'shortStrike', 'longStrike']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getChartTechnicalAnalysis',
      description: 'Fetch and analyze historical candles to detect technical trend bias and structural support/resistance zones based on price action pivots.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'The trading symbol (e.g. "BTCUSD"). Defaults to "BTCUSD".'
          },
          resolution: {
            type: 'string',
            description: 'Candle timeframe resolution: "1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d", "1w". Defaults to "4h".'
          },
          limit: {
            type: 'number',
            description: 'Number of historical candles to analyze. Defaults to 150.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'autoCloseExpiredTrades',
      description: 'Automatically close open/pending trades in the journal at option expiry date using the final BTC settlement price.',
      parameters: {
        type: 'object',
        properties: {
          btcSettlementPrice: {
            type: 'number',
            description: 'Optional final BTC settlement price. If omitted, current BTC spot price is used as settlement price.'
          },
          targetTradeId: {
            type: 'string',
            description: 'Optional specific trade ID to settle. If omitted, all pending open trades are evaluated and settled.'
          }
        }
      }
    }
  }
];

// Map function names to functions
const availableFunctions = {
  getCurrentBTCPrice: api.getCurrentBTCPrice,
  getMarketSummary: api.getMarketSummary,
  getStrikeDetails: api.getStrikeDetails,
  getOptionChain: api.getOptionChain,
  calculateStrategy: api.calculateStrategy,
  getUserProfile: async () => {
    return await readUserProfile();
  },
  updateUserProfile: async (args) => {
    const current = await readUserProfile();
    const updated = { ...current, ...args };
    return await writeUserProfile(updated);
  },
  getTradeJournal: async () => {
    return await readTradeJournal();
  },
  logTrade: async (args) => {
    let entryFactors = args.entryFactors;
    if (!entryFactors && args.legs && args.legs.length > 0) {
      try {
        const btcPrice = await api.getCurrentBTCPrice();
        const summary = await api.getMarketSummary({});
        if (summary) {
          entryFactors = {
            btcPrice: btcPrice || null,
            averageIV: summary.averageIV || null,
            ivClassification: summary.ivClassification || null,
            support: summary.support || null,
            resistance: summary.resistance || null,
            pcr: summary.pcr || null,
            fundingRate: summary.funding?.rate !== undefined ? summary.funding.rate : null,
            fundingSentiment: summary.funding?.sentiment || null,
            signalsAligned: summary.confidenceInputs?.signalsAligned || 0,
            signalsConflicting: summary.confidenceInputs?.signalsConflicting || 0
          };
          
          try {
            const firstLeg = args.legs[0];
            const secondLeg = args.legs.find(l => l.action !== firstLeg.action);
            if (firstLeg && secondLeg) {
              const valResult = await api.validateTrade({
                strategy: args.strategy,
                expiry: firstLeg.symbol.split('-')[3] || '',
                shortStrike: secondLeg.strike,
                longStrike: firstLeg.strike
              });
              if (valResult) {
                entryFactors.opportunityScore = valResult.opportunityScore;
                entryFactors.validationScores = valResult.scores || valResult.validationScores;
              }
            }
          } catch (valErr) {
            console.error('Auto-validation of entry factors failed:', valErr.message);
          }
        }
      } catch (err) {
        console.error('Failed to auto-populate entry factors:', err.message);
      }
    }

    const newTrade = {
      id: args.id || Math.floor(Math.random() * 1000000000),
      date: args.date || new Date().toISOString().slice(0, 10),
      marketState: args.marketState || 'Unknown',
      market_state: args.marketState || 'Unknown',
      strategy: args.strategy || 'Unknown',
      reason: args.reason || '',
      risk: args.risk || '$0.00',
      reward: args.reward || '$0.00',
      result: args.result || 'Pending',
      lessons: args.lessons || '',
      legs: args.legs || [],
      entryFactors: entryFactors || null,
      entry_factors: entryFactors || null
    };
    if (isSupabaseEnabled) {
      return await logTradeToSupabase(newTrade);
    } else {
      const journal = await readTradeJournal();
      journal.push(newTrade);
      return await writeTradeJournal(journal);
    }
  },
  validateTrade: api.validateTrade,
  getChartTechnicalAnalysis: api.getChartTechnicalAnalysis,
  autoCloseExpiredTrades: api.autoCloseExpiredTrades
};

/**
 * Executes a single conversational turn with OpenAI, resolving tool calls in a loop.
 */
async function runAgentTurn(conversationHistory) {
  let run = true;
  let turns = 0;

  while (run && turns < 10) {
    turns++;
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: conversationHistory,
      tools: tools,
      tool_choice: 'auto'
    });

    const responseMessage = response.choices[0].message;

    // Check if the model wants to call a function
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      conversationHistory.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionToCall = availableFunctions[functionName];
        const functionArgs = JSON.parse(toolCall.function.arguments);

        try {
          console.log(`\x1b[33m[Agent Action] Calling tool ${functionName}(${JSON.stringify(functionArgs)})\x1b[0m`);
          const toolResponse = await functionToCall(functionArgs);
          
          if (functionName === 'validateTrade' && toolResponse.rejected) {
            console.log('\n\x1b[31m[Validation: Rejected]\x1b[0m');
            console.log(`Reason: ${toolResponse.reason}`);
            return `Rejected\n--------\nReason: ${toolResponse.reason}`;
          }
          
          conversationHistory.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: JSON.stringify(toolResponse)
          });
        } catch (error) {
          console.error(`\x1b[31m[Agent Error] Tool ${functionName} failed: ${error.message}\x1b[0m`);
          conversationHistory.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: JSON.stringify({ error: error.message })
          });
        }
      }
    } else {
      conversationHistory.push(responseMessage);
      run = false;
      return responseMessage.content;
    }
  }
  throw new Error('Maximum agent reasoning turns exceeded.');
}

/**
 * Main execution controller
 */
async function start() {
  const args = argv.slice(2);
  const userPrompt = args.join(' ').trim();

  // Load latest system prompt with user profile memory
  const profile = await readUserProfile();
  const systemPromptContent = getSystemPrompt(profile);
  const conversationHistory = [
    { role: 'system', content: systemPromptContent }
  ];

  if (userPrompt) {
    // Single prompt execution mode
    console.log(`\x1b[32mPrompt: ${userPrompt}\x1b[0m\n`);
    console.log('Thinking...');
    conversationHistory.push({ role: 'user', content: userPrompt });
    try {
      const response = await runAgentTurn(conversationHistory);
      console.log('\n\x1b[36mAssistant:\x1b[0m');
      console.log(response);
    } catch (error) {
      console.error('\x1b[31mError running prompt:\x1b[0m', error.message);
    }
  } else {
    // Interactive chat mode
    console.log('\x1b[36m==================================================');
    console.log(`   AI Options Trading Assistant (${MODEL})`);
    console.log('==================================================\x1b[0m');
    console.log('Type your question or prompt (e.g. "I have $500 capital.").');
    console.log('Type "exit" or "quit" to close the session.\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const askQuestion = () => {
      rl.question('\n\x1b[32mYou: \x1b[0m', async (input) => {
        const cleanedInput = input.trim();
        if (cleanedInput.toLowerCase() === 'exit' || cleanedInput.toLowerCase() === 'quit') {
          rl.close();
          return;
        }

        if (!cleanedInput) {
          askQuestion();
          return;
        }

        conversationHistory.push({ role: 'user', content: cleanedInput });
        console.log('\x1b[2mThinking...\x1b[0m');

        try {
          const response = await runAgentTurn(conversationHistory);
          console.log('\n\x1b[36mAssistant:\x1b[0m');
          console.log(response);
        } catch (error) {
          console.error('\x1b[31mError:\x1b[0m', error.message);
        }
        askQuestion();
      });
    };

    askQuestion();
  }
}

start();
