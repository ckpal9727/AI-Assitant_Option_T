import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'fs';
import path from 'path';
import { env } from 'process';
import { getCurrentBTCPrice, getMarketSummary } from './index.js';
import { executeAutoTradeForAlert } from './autoTrader.js';

const ALERTS_FILE = 'telegram_alerts.json';

/**
 * Get Telegram Bot Configuration from environment
 */
export function getTelegramConfig() {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  return { token, chatId };
}

/**
 * Send a raw message to a Telegram Chat using Telegram Bot API
 * @param {string} text - Message text (HTML or Markdown)
 * @param {object} options - Optional parameters (chatId, parseMode, replyToMessageId)
 */
export async function sendTelegramMessage(text, options = {}) {
  const { token, chatId: defaultChatId } = getTelegramConfig();
  const chatId = options.chatId || defaultChatId;
  const parseMode = options.parseMode || 'HTML';

  if (!token) {
    console.error('\x1b[31m[Telegram Error] TELEGRAM_BOT_TOKEN is not defined in .env\x1b[0m');
    return { success: false, error: 'TELEGRAM_BOT_TOKEN missing' };
  }

  if (!chatId) {
    console.error('\x1b[31m[Telegram Error] TELEGRAM_CHAT_ID is not provided or set in .env\x1b[0m');
    return { success: false, error: 'TELEGRAM_CHAT_ID missing' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
      ...options
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.ok) {
      return { success: true, result: data.result };
    } else {
      console.error(`\x1b[31m[Telegram Error] ${data.description}\x1b[0m`);
      return { success: false, error: data.description };
    }
  } catch (err) {
    console.error(`\x1b[31m[Telegram Exception] ${err.message}\x1b[0m`);
    return { success: false, error: err.message };
  }
}

/**
 * Send a structured price alert notification
 */
export async function sendPriceAlertNotification({ symbol = 'BTC', currentPrice, targetPrice, direction, chatId }) {
  const isAbove = direction === 'above' || currentPrice >= targetPrice;
  const icon = isAbove ? '🚀 📈' : '🔻 📉';
  
  const message = `
${icon} <b>PRICE ALERT TRIGGERED!</b>

<b>Asset:</b> ${symbol}
<b>Current Price:</b> $${Number(currentPrice).toLocaleString('en-US')}
<b>Target Price:</b> $${Number(targetPrice).toLocaleString('en-US')}
<b>Condition:</b> Price crossed ${direction.toUpperCase()} target

<i>Timestamp: ${new Date().toLocaleString()}</i>
  `.trim();

  return await sendTelegramMessage(message, { chatId });
}

/**
 * Send a Market Snapshot summary to Telegram
 */
export async function sendMarketSnapshotTelegram(snapshot, chatId) {
  if (!snapshot) return;

  const btcPrice = snapshot.btcPrice ? `$${Number(snapshot.btcPrice).toLocaleString('en-US')}` : 'N/A';
  const iv = snapshot.iv !== undefined ? `${snapshot.iv}%` : 'N/A';
  const funding = snapshot.fundingRate !== undefined ? `${(snapshot.fundingRate * 100).toFixed(4)}%` : 'N/A';
  const pcr = snapshot.pcr !== undefined ? snapshot.pcr : 'N/A';

  const message = `
📊 <b>DELTA MARKET SNAPSHOT</b>

<b>BTC Price:</b> ${btcPrice}
<b>Atm IV:</b> ${iv}
<b>Funding Rate:</b> ${funding}
<b>Put-Call Ratio (PCR):</b> ${pcr}
<b>Highest Call OI:</b> ${snapshot.highestCallOI ? snapshot.highestCallOI.toLocaleString() : 'N/A'}
<b>Highest Put OI:</b> ${snapshot.highestPutOI ? snapshot.highestPutOI.toLocaleString() : 'N/A'}

<i>Generated at: ${new Date().toLocaleString()}</i>
  `.trim();

  return await sendTelegramMessage(message, { chatId });
}

/**
 * Manage Active Alerts (Save & Load locally)
 */
export function loadAlerts() {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      const data = fs.readFileSync(ALERTS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load alerts file:', e.message);
  }
  return [];
}

export function saveAlerts(alerts) {
  try {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save alerts file:', e.message);
  }
}

export function addPriceAlert(targetPrice, direction = 'above', chatId = null) {
  const alerts = loadAlerts();
  const newAlert = {
    id: Date.now().toString(),
    targetPrice: Number(targetPrice),
    direction: direction.toLowerCase(),
    chatId: chatId || env.TELEGRAM_CHAT_ID,
    createdAt: new Date().toISOString()
  };
  alerts.push(newAlert);
  saveAlerts(alerts);
  return newAlert;
}

export function clearAlerts(chatId = null) {
  if (!chatId) {
    saveAlerts([]);
    return 0;
  }
  const alerts = loadAlerts();
  const filtered = alerts.filter(a => a.chatId !== chatId);
  const removed = alerts.length - filtered.length;
  saveAlerts(filtered);
  return removed;
}

/**
 * Check active alerts against current price and trigger notifications
 */
export async function checkAndTriggerAlerts(currentPrice) {
  const alerts = loadAlerts();
  if (alerts.length === 0) return { triggeredCount: 0, triggered: false };

  const remainingAlerts = [];
  const numCurrent = Number(currentPrice);
  let triggeredCount = 0;

  if (isNaN(numCurrent)) return { triggeredCount: 0, triggered: false };

  for (const alert of alerts) {
    let triggered = false;
    const numTarget = Number(alert.targetPrice);

    if (alert.direction === 'above' && numCurrent >= numTarget) {
      triggered = true;
    } else if (alert.direction === 'below' && numCurrent <= numTarget) {
      triggered = true;
    }

    if (triggered) {
      triggeredCount++;
      console.log(`\x1b[32m[Telegram Alert] Triggered alert for BTC $${numTarget} (${alert.direction}). Current Price: $${numCurrent}\x1b[0m`);
      
      // Execute trade tool & log result (SUCCESS or FAILURE)
      try {
        await executeAutoTradeForAlert({ alert, currentPrice: numCurrent });
      } catch (err) {
        console.error('AutoTrader Execution Exception:', err.message);
        await sendPriceAlertNotification({
          symbol: 'BTC',
          currentPrice: numCurrent,
          targetPrice: numTarget,
          direction: alert.direction,
          chatId: alert.chatId
        });
      }
    } else {
      remainingAlerts.push(alert);
    }
  }

  if (remainingAlerts.length !== alerts.length) {
    saveAlerts(remainingAlerts);
  }

  return { triggeredCount, triggered: triggeredCount > 0 };
}

/**
 * Telegram Long Polling Bot Listener
 * Allows users to send commands to the bot directly from Telegram!
 */
export async function startTelegramBot(fetchMarketDataFn) {
  const { token } = getTelegramConfig();
  if (!token) {
    console.error('\x1b[31m[Telegram Bot] Cannot start bot. TELEGRAM_BOT_TOKEN missing in .env\x1b[0m');
    return;
  }

  console.log('\x1b[32m[Telegram Bot] Listener started! Waiting for messages...\x1b[0m');
  
  // Get Bot Info
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok) {
      console.log(`\x1b[36m[Telegram Bot] Connected as @${data.result.username} (${data.result.first_name})\x1b[0m`);
    }
  } catch (e) {
    console.error('Failed to get Telegram bot info:', e.message);
  }

  let offset = 0;

  while (true) {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message && update.message.text) {
            await handleTelegramCommand(update.message, fetchMarketDataFn);
          }
        }
      }
    } catch (err) {
      console.error('[Telegram Bot Loop Error]:', err.message);
      await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds before retrying
    }
  }
}

/**
 * Handle incoming commands from Telegram
 */
async function handleTelegramCommand(message, fetchMarketDataFn) {
  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();

  console.log(`[Telegram Command] Received: "${text}" from Chat ID: ${chatId}`);

  if (command === '/start' || command === '/help') {
    const helpMsg = `
🤖 <b>AI Trading Agent - Telegram Bot</b>

Available Commands:
🔹 <b>/price</b> - Get current BTC price & funding rate
🔹 <b>/snapshot</b> - Get complete market snapshot & Greeks summary
🔹 <b>/alert &lt;above/below&gt; &lt;price&gt;</b> - Set a price alert (e.g. <code>/alert above 70000</code>)
🔹 <b>/alerts</b> - View your active price alerts
🔹 <b>/clearalerts</b> - Clear all active price alerts
🔹 <b>/myid</b> - Get your Telegram Chat ID for your <code>.env</code> file
    `.trim();
    await sendTelegramMessage(helpMsg, { chatId });
  } 
  else if (command === '/myid') {
    await sendTelegramMessage(`🆔 Your Telegram Chat ID is: <code>${chatId}</code>`, { chatId });
  }
  else if (command === '/price' || command === '/btc') {
    await sendTelegramMessage('⏳ Fetching latest price data...', { chatId });
    try {
      let btcPrice = null;
      let fundingRate = null;

      if (fetchMarketDataFn) {
        const data = await fetchMarketDataFn();
        if (data) {
          btcPrice = data.btcPrice;
          fundingRate = data.fundingRate;
        }
      } else {
        btcPrice = await getCurrentBTCPrice();
      }

      if (btcPrice) {
        let msg = `💰 <b>BTC Price:</b> $${Number(btcPrice).toLocaleString()}`;
        if (fundingRate !== null && fundingRate !== undefined) {
          msg += `\n📈 <b>Funding Rate:</b> ${(fundingRate * 100).toFixed(4)}%`;
        }
        await sendTelegramMessage(msg, { chatId });
      } else {
        await sendTelegramMessage('⚠️ Could not fetch current BTC price.', { chatId });
      }
    } catch (e) {
      await sendTelegramMessage(`❌ Error fetching price: ${e.message}`, { chatId });
    }
  }
  else if (command === '/snapshot') {
    await sendTelegramMessage('⏳ Fetching market snapshot...', { chatId });
    try {
      const data = fetchMarketDataFn ? await fetchMarketDataFn() : await getMarketSummary();
      if (data) {
        await sendMarketSnapshotTelegram(data, chatId);
      } else {
        await sendTelegramMessage('⚠️ Could not fetch market snapshot.', { chatId });
      }
    } catch (e) {
      await sendTelegramMessage(`❌ Error: ${e.message}`, { chatId });
    }
  }
  else if (command === '/alert') {
    // Format: /alert above 70000 or /alert below 65000 or /alert 70000
    let direction = 'above';
    let targetPrice = null;

    if (parts.length === 2) {
      targetPrice = parseFloat(parts[1]);
    } else if (parts.length >= 3) {
      if (['above', 'below', '>', '<'].includes(parts[1].toLowerCase())) {
        direction = parts[1].toLowerCase() === '<' ? 'below' : (parts[1].toLowerCase() === '>' ? 'above' : parts[1].toLowerCase());
        targetPrice = parseFloat(parts[2]);
      } else {
        targetPrice = parseFloat(parts[1]);
      }
    }

    if (!targetPrice || isNaN(targetPrice)) {
      await sendTelegramMessage('⚠️ Usage: <code>/alert above 70000</code> or <code>/alert below 65000</code>', { chatId });
      return;
    }

    const alert = addPriceAlert(targetPrice, direction, chatId);
    await sendTelegramMessage(`✅ <b>Alert Set!</b>\nWe will notify you when BTC price goes <b>${alert.direction.toUpperCase()}</b> $${alert.targetPrice.toLocaleString()}.`, { chatId });
  }
  else if (command === '/alerts') {
    const alerts = loadAlerts().filter(a => a.chatId === chatId || a.chatId == chatId);
    if (alerts.length === 0) {
      await sendTelegramMessage('ℹ️ You have no active price alerts.', { chatId });
    } else {
      let list = '🔔 <b>Your Active Price Alerts:</b>\n\n';
      alerts.forEach((a, i) => {
        list += `${i + 1}. BTC ${a.direction.toUpperCase()} $${Number(a.targetPrice).toLocaleString()}\n`;
      });
      await sendTelegramMessage(list, { chatId });
    }
  }
  else if (command === '/clearalerts') {
    const removed = clearAlerts(chatId);
    await sendTelegramMessage(`🗑️ Cleared ${removed} alert(s).`, { chatId });
  }
}

/**
 * Periodically monitor current price against stored Telegram alerts
 */
export function startPriceMonitorLoop(intervalMs = 15000) {
  console.log(`\x1b[34m[Price Monitor] Background price check active (every ${intervalMs / 1000}s)\x1b[0m`);
  
  const check = async () => {
    try {
      const alerts = loadAlerts();
      if (alerts.length > 0) {
        const currentPrice = await getCurrentBTCPrice();
        if (currentPrice) {
          await checkAndTriggerAlerts(currentPrice);
        }
      }
    } catch (e) {
      console.error('[Price Monitor Error]:', e.message);
    }
  };

  check();
  return setInterval(check, intervalMs);
}

// Allow direct execution to test or run Telegram bot listener & price monitor
if (process.argv[1] && path.basename(process.argv[1]) === 'telegram.js') {
  console.log('Starting Telegram Bot standalone listener & price monitor...');
  startPriceMonitorLoop();
  startTelegramBot();
}
