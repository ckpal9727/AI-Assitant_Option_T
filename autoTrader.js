import fs from 'fs';
import path from 'path';
import { env } from 'process';
import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';
import { getMarketSummary, validateTrade } from './index.js';
import { sendTelegramMessage } from './telegram.js';

const EXECUTION_LOGS_FILE = 'trade_execution_logs.json';
const JOURNAL_FILE = 'trade_journal.json';

/**
 * Load all execution logs from file
 */
export function loadExecutionLogs() {
  try {
    if (fs.existsSync(EXECUTION_LOGS_FILE)) {
      const data = fs.readFileSync(EXECUTION_LOGS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading trade execution logs:', e.message);
  }
  return [];
}

/**
 * Save a new execution log entry
 */
export function saveExecutionLog(logItem) {
  try {
    const logs = loadExecutionLogs();
    logs.unshift(logItem); // Newest log first
    fs.writeFileSync(EXECUTION_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving trade execution log:', e.message);
    return false;
  }
}

/**
 * Clear all execution logs
 */
export function clearExecutionLogs() {
  try {
    fs.writeFileSync(EXECUTION_LOGS_FILE, JSON.stringify([], null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error clearing execution logs:', e.message);
    return false;
  }
}

/**
 * Write a trade entry to trade_journal.json AND Supabase database (if enabled)
 */
export async function logTradeToJournal(trade) {
  let fileSaved = false;

  // 1. Write to local trade_journal.json
  try {
    let trades = [];
    if (fs.existsSync(JOURNAL_FILE)) {
      const data = fs.readFileSync(JOURNAL_FILE, 'utf8');
      trades = JSON.parse(data);
    }
    trades.unshift(trade);
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(trades, null, 2), 'utf8');
    fileSaved = true;
    console.log(`\x1b[32m[Trade Journal] Auto-trade logged to ${JOURNAL_FILE}\x1b[0m`);
  } catch (e) {
    console.error('Error appending to local trade journal file:', e.message);
  }

  // 2. Write to Supabase trade_journal table if configured
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const dbTrade = {
        date: trade.date,
        market_state: trade.market_state || trade.marketState,
        strategy: trade.strategy,
        reason: trade.reason,
        risk: trade.risk,
        reward: trade.reward,
        result: trade.result || 'Pending',
        pnl: trade.pnl !== undefined ? trade.pnl : null,
        lessons: trade.lessons || '',
        legs: trade.legs || []
      };
      const { error } = await supabase.from('trade_journal').insert([dbTrade]);
      if (error) {
        console.error('\x1b[31m[Supabase Journal Error]\x1b[0m', error.message);
      } else {
        console.log('\x1b[32m[Supabase Journal] Auto-trade inserted into Supabase trade_journal table!\x1b[0m');
      }
    } catch (err) {
      console.error('[Supabase Journal Exception]', err.message);
    }
  }

  return fileSaved;
}

/**
 * Run Post-Trigger AI Market Analysis
 */
export async function runPostTriggerAIAnalysis(summary, alert, spotPrice, strategy) {
  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        executed: false,
        summary: "Post-trigger analysis skipped (OPENAI_API_KEY not configured in .env).",
        error: "OPENAI_API_KEY missing"
      };
    }

    const openai = new OpenAI({ apiKey });
    const prompt = `
A price alert trigger fired and executed a PRE-APPROVED automated option trade:
- Alert Target: $${alert.targetPrice} (${alert.direction.toUpperCase()})
- Actual Spot Price at Trigger: $${spotPrice}
- Strategy Executed: ${strategy}
- Current Market State: ${summary?.marketState || 'Breakout'}
- PCR: ${summary?.pcr || 'N/A'}
- ATM IV: ${summary?.averageIV || 'N/A'}%
- Funding Rate: ${summary?.funding?.rate || 'N/A'}%

Provide a concise 3-bullet post-trigger market analysis covering:
1. Post-trigger momentum & bias
2. Immediate support & resistance levels
3. Risk management tip for this pre-approved ${strategy}
    `.trim();

    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL || 'gpt-5-mini',
      messages: [{ role: 'user', content: prompt }]
    });

    const aiText = response.choices[0]?.message?.content || 'Post-trigger analysis completed.';
    return {
      executed: true,
      summary: aiText,
      error: null
    };
  } catch (err) {
    console.error('Post-trigger AI Analysis Error:', err.message);
    return {
      executed: false,
      summary: null,
      error: err.message
    };
  }
}

/**
 * Execute automated trade when a price alert triggers & log system events
 */
export async function executeAutoTradeForAlert({ alert, currentPrice }) {
  const timestamp = new Date().toISOString();
  const direction = (alert.direction || 'above').toLowerCase();
  const targetPrice = Number(alert.targetPrice);
  const spotPrice = Number(currentPrice);

  const strategy = direction === 'above' ? 'Bull Put Credit Spread' : 'Bear Call Credit Spread';
  
  console.log(`\x1b[35m[AutoTrader] Executing PRE-APPROVED trade for alert target $${targetPrice} (${direction}). Spot: $${spotPrice}\x1b[0m`);

  let shortStrike = null;
  let longStrike = null;
  let summary = null;

  try {
    // 1. Fetch Market Summary for Strike Selection & Post Analysis
    summary = await getMarketSummary();
    const atmStrike = summary.atmStrike || Math.round(spotPrice / 500) * 500;

    if (direction === 'above') {
      shortStrike = atmStrike;
      longStrike = shortStrike - 1000;
    } else {
      shortStrike = atmStrike;
      longStrike = shortStrike + 1000;
    }

    // 2. Validate Trade Strategy against Risk Limits & Options Chain
    const validation = await validateTrade({
      strategy,
      shortStrike,
      longStrike
    });

    if (validation.approved === false || validation.rejected === true) {
      const failureReason = validation.reason || 'Trade rejected by risk validation policy';

      const logItem = {
        id: `exec_${Date.now()}`,
        timestamp,
        eventSummary: `Validation Error: ${failureReason}`,
        systemStatus: 'FAILURE',
        preApproved: true,
        triggerEvent: { targetPrice, direction, spotPrice },
        autoTradeExecution: { status: 'FAILED', strategy, shortStrike, longStrike, failureReason },
        journalStatus: { logged: false, tradeId: null },
        postTriggerAIAnalysis: { executed: false, summary: null, error: failureReason },
        systemError: failureReason,
        chatId: alert.chatId
      };

      saveExecutionLog(logItem);

      // Send Telegram notification with System Event details
      await sendTelegramMessage(`
⚠️ <b>ALERT TRIGGERED - TRADE VALIDATION FAILURE</b>

<b>Event Status:</b> Validation Rejected
<b>Target Price:</b> $${targetPrice.toLocaleString()} (${direction.toUpperCase()})
<b>Spot Price:</b> $${spotPrice.toLocaleString()}
<b>Strategy Attempted:</b> ${strategy} (${shortStrike}/${longStrike})
<b>Failure Reason:</b> ${failureReason}

<i>Recorded in System Execution History.</i>
      `.trim(), { chatId: alert.chatId });

      return { success: false, log: logItem };
    }

    // 3. Trade Pre-Approved & Validated - Create Trade Entry for Journal
    const maxRisk = validation.maxRisk !== undefined ? Number(validation.maxRisk.toFixed(2)) : 100;
    const maxReward = validation.maxReward !== undefined ? Number(validation.maxReward.toFixed(2)) : 25;

    const newTrade = {
      id: Math.floor(Math.random() * 1000000),
      date: new Date().toISOString().split('T')[0],
      market_state: summary.marketState || (direction === 'above' ? 'Trending Up' : 'Trending Down'),
      strategy: strategy,
      reason: `Pre-approved automated trade triggered by Telegram alert (BTC ${direction.toUpperCase()} $${targetPrice.toLocaleString()})`,
      risk: maxRisk,
      reward: maxReward,
      result: 'Pending',
      pnl: null,
      is_preapproved: true,
      execution_mode: 'Auto-Executed on Alert Trigger',
      lessons: `Auto-executed on trigger at BTC spot $${spotPrice.toLocaleString()}`,
      legs: [
        {
          symbol: `${direction === 'above' ? 'P' : 'C'}-BTC-${shortStrike}`,
          strike: shortStrike,
          type: direction === 'above' ? 'P' : 'C',
          action: 'sell',
          entry_price: 15.00,
          quantity: 1
        },
        {
          symbol: `${direction === 'above' ? 'P' : 'C'}-BTC-${longStrike}`,
          strike: longStrike,
          type: direction === 'above' ? 'P' : 'C',
          action: 'buy',
          entry_price: 10.00,
          quantity: 1
        }
      ]
    };

    // 4. Log Pre-Approved Trade to Journal
    const logged = await logTradeToJournal(newTrade);

    if (!logged) {
      const failureReason = 'Failed to write trade entry to trade_journal.json';
      const logItem = {
        id: `exec_${Date.now()}`,
        timestamp,
        eventSummary: `System Error: ${failureReason}`,
        systemStatus: 'FAILURE',
        preApproved: true,
        triggerEvent: { targetPrice, direction, spotPrice },
        autoTradeExecution: { status: 'FAILED', strategy, shortStrike, longStrike, failureReason },
        journalStatus: { logged: false, tradeId: null },
        postTriggerAIAnalysis: { executed: false, summary: null, error: failureReason },
        systemError: failureReason,
        chatId: alert.chatId
      };
      
      saveExecutionLog(logItem);

      await sendTelegramMessage(`
⚠️ <b>ALERT TRIGGERED - JOURNAL LOG SYSTEM ERROR</b>

<b>Event Status:</b> System File Write Error
<b>Target Price:</b> $${targetPrice.toLocaleString()} (${direction.toUpperCase()})
<b>Spot Price:</b> $${spotPrice.toLocaleString()}
<b>Error:</b> Could not write trade entry to journal file.

<i>Recorded in System Execution History.</i>
      `.trim(), { chatId: alert.chatId });

      return { success: false, log: logItem };
    }

    // 5. Run Post-Trigger AI Market Analysis
    console.log(`\x1b[36m[AutoTrader] Running Post-Trigger AI Market Analysis...\x1b[0m`);
    const aiAnalysis = await runPostTriggerAIAnalysis(summary, alert, spotPrice, strategy);

    // 6. Save "Everything Gone Well" System Event Log
    const logItem = {
      id: `exec_${Date.now()}`,
      timestamp,
      eventSummary: 'Everything Gone Well',
      systemStatus: 'SUCCESS',
      preApproved: true,
      triggerEvent: { targetPrice, direction, spotPrice },
      autoTradeExecution: { 
        status: 'SUCCESS', 
        strategy, 
        shortStrike, 
        longStrike, 
        risk: maxRisk, 
        reward: maxReward 
      },
      journalStatus: { logged: true, tradeId: newTrade.id },
      postTriggerAIAnalysis: aiAnalysis,
      systemError: null,
      chatId: alert.chatId
    };

    saveExecutionLog(logItem);

    // 7. Send Comprehensive Telegram Event Message
    let telegramMsg = `
🚀 <b>PRE-APPROVED AUTO-TRADE EXECUTED!</b>

<b>System Event Status:</b> ✅ Everything Gone Well

<b>Trigger Event:</b> BTC ${direction.toUpperCase()} $${targetPrice.toLocaleString()}
<b>Spot Price at Trigger:</b> $${spotPrice.toLocaleString()}
<b>Strategy Executed:</b> ${strategy} (${shortStrike}/${longStrike})
<b>Risk / Reward:</b> Risk $${maxRisk} | Reward $${maxReward}
<b>Trade Journal:</b> ✅ Pre-Approved & Logged as Trade #${newTrade.id}
    `.trim();

    if (aiAnalysis.executed && aiAnalysis.summary) {
      telegramMsg += `\n\n🧠 <b>Post-Trigger AI Market Analysis:</b>\n${aiAnalysis.summary}`;
    }

    await sendTelegramMessage(telegramMsg, { chatId: alert.chatId });

    return { success: true, log: logItem, trade: newTrade, aiAnalysis };

  } catch (error) {
    console.error('AutoTrader Execution System Error:', error.message);
    
    const logItem = {
      id: `exec_${Date.now()}`,
      timestamp,
      eventSummary: `System Error: ${error.message}`,
      systemStatus: 'FAILURE',
      preApproved: true,
      triggerEvent: { targetPrice, direction, spotPrice },
      autoTradeExecution: { status: 'FAILED', strategy, shortStrike: shortStrike || 0, longStrike: longStrike || 0, failureReason: error.message },
      journalStatus: { logged: false, tradeId: null },
      postTriggerAIAnalysis: { executed: false, summary: null, error: error.message },
      systemError: error.message,
      chatId: alert.chatId
    };

    saveExecutionLog(logItem);

    await sendTelegramMessage(`
❌ <b>ALERT TRIGGERED - SYSTEM EXCEPTION ERROR</b>

<b>Event Status:</b> System Exception Error
<b>Target Price:</b> $${targetPrice.toLocaleString()} (${direction.toUpperCase()})
<b>Spot Price:</b> $${spotPrice.toLocaleString()}
<b>System Error:</b> ${error.message}

<i>Recorded in System Execution History.</i>
    `.trim(), { chatId: alert.chatId });

    return { success: false, log: logItem, error: error.message };
  }
}
