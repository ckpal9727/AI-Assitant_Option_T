import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';
import {
  getCurrentBTCPrice,
  getMarketSummary,
  getStrikeDetails,
  getOptionChain,
  calculateStrategy,
  validateTrade
} from '../../../../../index.js';

const apiKey = process.env.OPENAI_API_KEY || '';
const modelName = process.env.OPENAI_MODEL || 'gpt-5-mini';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Currency parsing helpers
function parseCurrency(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const cleaned = val.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

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

// Supabase helper functions
async function readUserProfile() {
  if (supabase) {
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
      console.error('[API Agent DB] Read user profile failed:', error.message);
    }
  }
  return {};
}

async function writeUserProfile(profile) {
  if (supabase) {
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
      console.error('[API Agent DB] Write user profile failed:', error.message);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Database connection not available.' };
}

async function readTradeJournal() {
  if (supabase) {
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
        legs: item.legs || []
      }));
    } catch (error) {
      console.error('[API Agent DB] Read trade journal failed:', error.message);
    }
  }
  return [];
}

async function logTradeToSupabase(trade) {
  if (supabase) {
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
        legs: trade.legs || []
      };

      const { error } = await supabase
        .from('trade_journal')
        .insert([dbTrade]);

      if (error) throw error;
      return { success: true, message: 'Trade logged successfully in Supabase.' };
    } catch (error) {
      console.error('[API Agent DB] Log trade failed:', error.message);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Database connection not available.' };
}

// System Prompt Template
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
9. logTrade(trade): Logs a trade with date, marketState, strategy, reason, risk, reward, result, and lessons.

Rules for recommendation:
- NEVER guess or make up maximum risk, maximum reward, net credit/debit, or break-even points. Always call 'calculateStrategy' to fetch the exact calculations before recommending any options spreads or strategies.
- Trade Validation: You MUST invoke 'validateTrade' on your final proposed strategy strikes to evaluate scores and warnings. Report the overall Opportunity Score and individual rating checklist returned by the tool.
- Strategy Selection: Do NOT invent strategies outside the 'candidateStrategies' list provided in the getMarketSummary() output. Recommend the single best strategy from those candidates.
- Why Not? Section: For every recommendation, you must include a detailed "Why Not?" section explaining why you rejected the other options in the 'candidateStrategies' list (and compare it to common alternatives like an Iron Condor or other spreads).
- Confidence Score: Evaluate and explain your trade confidence based on the 'confidenceInputs' (the count of signalsAligned and signalsConflicting) returned by getMarketSummary(). Justify the final confidence (High, Medium, or Low) using these signals. Do not invent arbitrary percentages.
- Payout P&L Limits: Calculate strategy lot sizes relative to the users Capital and Risk Tolerance stored in their profile. If Capital is $500 and Risk Tolerance is 2%, the max risk for the recommended trade must not exceed $10 (Capital * Risk). Explain this lot size math in your recommendation.
- Output Format: Present your response in a clear, formatted layout with sections: Market Bias, Reason, Recommended Strategy, Opportunity Score, Suggested Strikes, Maximum Risk, Maximum Reward, Lot Size Sizing, Confidence (explaining Aligned vs Conflicting signals), Why not [alternative strategy candidates]?.`;

function getSystemPrompt(profile) {
  let profileSection = '\n\n=== USER PROFILE (MEMORY) ===\n';
  if (!profile || Object.keys(profile).length === 0) {
    profileSection += 'No user preferences or capital constraints stored yet. Ask the user for their capital and risk preferences if relevant, or save them when they state them.';
  } else {
    if (profile.capital) profileSection += `- Capital: $${profile.capital.toLocaleString('en-US')}\n`;
    if (profile.riskTolerance) profileSection += `- Risk Tolerance: ${(profile.riskTolerance * 100).toFixed(1)}% per trade\n`;
    if (profile.minRR) profileSection += `- Minimum Risk/Reward (minRR): ${profile.minRR.toFixed(2)}\n`;
    if (profile.preferredExpiry) profileSection += `- Preferred Expiry: ${profile.preferredExpiry}\n`;
    if (profile.preferredStrategies && profile.preferredStrategies.length > 0) {
      profileSection += `- Preferred Strategies: ${profile.preferredStrategies.join(', ')}\n`;
    }
    if (profile.notes) profileSection += `- Additional Notes: ${profile.notes}\n`;
  }
  return SYSTEM_PROMPT_BASE + profileSection;
}

// Function tools configuration
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
            description: "Optional custom expiry date in DDMMYY format or selection index."
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getStrikeDetails',
      description: 'Get detailed Call and Put option metrics for a specific strike price.',
      parameters: {
        type: 'object',
        properties: {
          strike: { type: 'number', description: 'The strike price to inspect.' },
          expiry: { type: 'string', description: "Optional custom expiry date." }
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
          expiry: { type: 'string' },
          fromStrike: { type: 'number' },
          toStrike: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculateStrategy',
      description: 'Calculate payoffs, maximum risk, maximum reward, and net credit/debit for options strategies.',
      parameters: {
        type: 'object',
        properties: {
          strategy: { type: 'string' },
          expiry: { type: 'string' },
          shortStrike: { type: 'number' },
          longStrike: { type: 'number' },
          shortStrike2: { type: 'number' },
          longStrike2: { type: 'number' }
        },
        required: ['strategy', 'shortStrike', 'longStrike']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getUserProfile',
      description: 'Get the stored user profile preferences.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'updateUserProfile',
      description: 'Update the stored user profile preferences.',
      parameters: {
        type: 'object',
        properties: {
          capital: { type: 'number' },
          riskTolerance: { type: 'number' },
          minRR: { type: 'number' },
          preferredExpiry: { type: 'string' },
          preferredStrategies: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'getTradeJournal',
      description: 'Get the logged history of previous options trades.',
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
          date: { type: 'string' },
          marketState: { type: 'string' },
          strategy: { type: 'string' },
          reason: { type: 'string' },
          risk: { type: 'string' },
          reward: { type: 'string' },
          result: { type: 'string' },
          lessons: { type: 'string' },
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
      description: 'Programmatically validate a proposed options trade and compute an Opportunity Score.',
      parameters: {
        type: 'object',
        properties: {
          strategy: { type: 'string' },
          expiry: { type: 'string' },
          shortStrike: { type: 'number' },
          longStrike: { type: 'number' },
          shortStrike2: { type: 'number' },
          longStrike2: { type: 'number' }
        },
        required: ['strategy', 'shortStrike', 'longStrike']
      }
    }
  }
];

// Mapping tools to execution functions
const availableFunctions = {
  getCurrentBTCPrice,
  getMarketSummary: async (args) => {
    return await getMarketSummary({ expiry: args.expiry });
  },
  getStrikeDetails: async (args) => {
    return await getStrikeDetails({ strike: args.strike, expiry: args.expiry });
  },
  getOptionChain: async (args) => {
    return await getOptionChain({ expiry: args.expiry, fromStrike: args.fromStrike, toStrike: args.toStrike });
  },
  calculateStrategy: async (args) => {
    return await calculateStrategy({
      strategy: args.strategy,
      expiry: args.expiry,
      shortStrike: args.shortStrike,
      longStrike: args.longStrike,
      shortStrike2: args.shortStrike2,
      longStrike2: args.longStrike2
    });
  },
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
    const newTrade = {
      date: args.date || new Date().toISOString().slice(0, 10),
      marketState: args.marketState || 'Unknown',
      strategy: args.strategy || 'Unknown',
      reason: args.reason || '',
      risk: args.risk || '$0.00',
      reward: args.reward || '$0.00',
      result: args.result || 'Pending',
      lessons: args.lessons || '',
      legs: args.legs || []
    };
    return await logTradeToSupabase(newTrade);
  },
  validateTrade: async (args) => {
    return await validateTrade({
      strategy: args.strategy,
      expiry: args.expiry,
      shortStrike: args.shortStrike,
      longStrike: args.longStrike,
      shortStrike2: args.shortStrike2,
      longStrike2: args.longStrike2
    });
  }
};

// POST Handler
export async function POST(request) {
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: 'OPENAI_API_KEY is not defined in the environment. Please add it to your project settings in Vercel to activate the AI Trading Assistant.'
    }, { status: 400 });
  }

  try {
    const { messages } = await request.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ success: false, error: 'Messages array is required.' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey });

    // Fetch the latest database user profile
    const profile = await readUserProfile();
    const systemPromptContent = getSystemPrompt(profile);

    // Keep the latest dynamic system prompt at the top
    const conversationHistory = [
      { role: 'system', content: systemPromptContent },
      ...messages.filter(m => m.role !== 'system')
    ];

    let run = true;
    let turns = 0;
    let loggedTradeDetected = false;
    let profileUpdatedDetected = false;

    while (run && turns < 10) {
      turns++;
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: conversationHistory,
        tools: tools,
        tool_choice: 'auto'
      });

      const responseMessage = response.choices[0].message;

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        conversationHistory.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          const functionName = toolCall.function.name;
          const functionToCall = availableFunctions[functionName];
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[API Agent] Calling tool: ${functionName}(${JSON.stringify(functionArgs)})`);

          if (functionName === 'logTrade') {
            loggedTradeDetected = true;
          }
          if (functionName === 'updateUserProfile') {
            profileUpdatedDetected = true;
          }

          try {
            const toolResponse = await functionToCall(functionArgs);

            if (functionName === 'validateTrade' && toolResponse.rejected) {
              return NextResponse.json({
                success: true,
                message: `Rejected\n--------\nReason: ${toolResponse.reason}`,
                loggedTrade: false,
                profileUpdated: false
              });
            }

            conversationHistory.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              name: functionName,
              content: JSON.stringify(toolResponse)
            });
          } catch (error) {
            console.error(`[API Agent] Tool ${functionName} failed:`, error.message);
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
        return NextResponse.json({
          success: true,
          message: responseMessage.content,
          loggedTrade: loggedTradeDetected,
          profileUpdated: profileUpdatedDetected
        });
      }
    }

    throw new Error('Maximum agent reasoning turns exceeded.');

  } catch (error) {
    console.error('API Agent route error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
