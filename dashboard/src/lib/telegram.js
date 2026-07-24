import fs from 'fs';
import path from 'path';

const ALERTS_FILE = path.join(process.cwd(), 'telegram_alerts.json');

/**
 * Get Telegram Bot Configuration from environment
 */
export function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return { token, chatId };
}

/**
 * Send a raw message to a Telegram Chat using Telegram Bot API
 * @param {string} text - Message text (HTML or Markdown)
 * @param {object} options - Optional parameters (chatId, parseMode)
 */
export async function sendTelegramMessage(text, options = {}) {
  const { token, chatId: defaultChatId } = getTelegramConfig();
  const chatId = options.chatId || defaultChatId;
  const parseMode = options.parseMode || 'HTML';

  if (!token) {
    console.error('\x1b[31m[Telegram Error] TELEGRAM_BOT_TOKEN is not defined in environment\x1b[0m');
    return { success: false, error: 'TELEGRAM_BOT_TOKEN missing' };
  }

  if (!chatId) {
    console.error('\x1b[31m[Telegram Error] TELEGRAM_CHAT_ID is not provided or set in environment\x1b[0m');
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
    chatId: chatId || process.env.TELEGRAM_CHAT_ID,
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
 * Check active alerts against current price and trigger notifications & pre-approved trades
 */
export async function checkAndTriggerAlerts(currentPrice) {
  const alerts = loadAlerts();
  if (alerts.length === 0) return { triggeredCount: 0, triggered: false };

  const remainingAlerts = [];
  const numCurrent = Number(currentPrice);
  let triggeredCount = 0;

  if (isNaN(numCurrent)) return { triggeredCount: 0, triggered: false };

  // Dynamically import executeAutoTradeForAlert to avoid circular dependencies
  let executeAutoTradeForAlertFn = null;
  try {
    const autoTraderModule = await import('./autoTrader.js');
    executeAutoTradeForAlertFn = autoTraderModule.executeAutoTradeForAlert;
  } catch (e) {
    console.error('Could not import autoTrader:', e.message);
  }

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
      
      // Execute pre-approved trade tool & log result (SUCCESS or FAILURE)
      if (executeAutoTradeForAlertFn) {
        try {
          await executeAutoTradeForAlertFn({ alert, currentPrice: numCurrent });
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
