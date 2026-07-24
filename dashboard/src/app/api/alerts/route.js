import { NextResponse } from 'next/server';
import { 
  loadAlerts, 
  addPriceAlert, 
  clearAlerts, 
  sendTelegramMessage, 
  sendPriceAlertNotification 
} from '@/lib/telegram.js';
import { 
  loadExecutionLogs, 
  clearExecutionLogs 
} from '@/lib/autoTrader.js';
import fs from 'fs';
import path from 'path';

const ALERTS_FILE = path.join(process.cwd(), 'telegram_alerts.json');
const ENV_LOCAL_PATH = path.join(process.cwd(), '.env.local');
const ROOT_ENV_PATH = path.join(process.cwd(), '..', '.env');

// Helper to update .env files
function updateEnvFile(filePath, token, chatId) {
  try {
    let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    
    if (token !== undefined) {
      if (content.includes('TELEGRAM_BOT_TOKEN=')) {
        content = content.replace(/TELEGRAM_BOT_TOKEN=.*/g, `TELEGRAM_BOT_TOKEN=${token}`);
      } else {
        content += `\nTELEGRAM_BOT_TOKEN=${token}`;
      }
    }

    if (chatId !== undefined) {
      if (content.includes('TELEGRAM_CHAT_ID=')) {
        content = content.replace(/TELEGRAM_CHAT_ID=.*/g, `TELEGRAM_CHAT_ID=${chatId}`);
      } else {
        content += `\nTELEGRAM_CHAT_ID=${chatId}`;
      }
    }

    fs.writeFileSync(filePath, content, 'utf8');
  } catch (e) {
    console.error(`Failed to update ${filePath}:`, e.message);
  }
}

// Helper to read alerts file directly
function getAlertsList() {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading alerts:', e.message);
  }
  return loadAlerts();
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (type === 'logs') {
      const logs = loadExecutionLogs();
      return NextResponse.json({ success: true, logs });
    }

    const alerts = getAlertsList();
    const executionLogs = loadExecutionLogs();
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = process.env.TELEGRAM_CHAT_ID || '';
    
    const hasBotToken = !!(botToken && botToken.trim() && botToken !== 'your_bot_token_here');

    return NextResponse.json({ 
      success: true, 
      alerts,
      executionLogs,
      hasBotToken,
      botTokenMasked: botToken ? `${botToken.slice(0, 5)}...${botToken.slice(-4)}` : '',
      chatIdConfigured: chatId
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, targetPrice, direction, chatId, botToken } = body;

    // Handle Saving Configuration from UI
    if (action === 'saveConfig') {
      if (!botToken || !botToken.trim()) {
        return NextResponse.json({ success: false, error: 'Telegram Bot Token is required' }, { status: 400 });
      }

      const cleanToken = botToken.trim();
      const cleanChatId = chatId ? chatId.trim() : '';

      // Update runtime process.env
      process.env.TELEGRAM_BOT_TOKEN = cleanToken;
      if (cleanChatId) process.env.TELEGRAM_CHAT_ID = cleanChatId;

      // Update files
      updateEnvFile(ENV_LOCAL_PATH, cleanToken, cleanChatId);
      updateEnvFile(ROOT_ENV_PATH, cleanToken, cleanChatId);

      return NextResponse.json({ 
        success: true, 
        message: 'Telegram credentials saved successfully to .env!' 
      });
    }

    // Handle Test Message
    if (action === 'test') {
      const activeToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!activeToken) {
        return NextResponse.json({ success: false, error: 'TELEGRAM_BOT_TOKEN is missing. Please save your Token first.' }, { status: 400 });
      }

      const result = await sendTelegramMessage('🔔 <b>Test Alert from AI Trading Dashboard!</b>\n\nYour Telegram Bot is configured correctly and ready to deliver real-time price alerts & automated trade execution logs to your phone! 🚀', { chatId });
      
      if (result.success) {
        return NextResponse.json({ success: true, message: 'Test message sent to Telegram!' });
      } else {
        return NextResponse.json({ success: false, error: result.error || 'Failed to send test message' }, { status: 400 });
      }
    }

    // Handle Adding New Alert
    if (!targetPrice || isNaN(Number(targetPrice))) {
      return NextResponse.json({ success: false, error: 'Target price is required and must be a valid number' }, { status: 400 });
    }

    const alert = addPriceAlert(Number(targetPrice), direction || 'above', chatId || null);

    // Immediately fetch live BTC price and evaluate alert
    try {
      const resBtc = await fetch('https://api.india.delta.exchange/v2/tickers/BTCUSD');
      if (resBtc.ok) {
        const btcData = await resBtc.json();
        if (btcData.result && btcData.result.spot_price) {
          const currentPrice = parseFloat(btcData.result.spot_price);
          const { checkAndTriggerAlerts } = await import('@/lib/telegram.js');
          await checkAndTriggerAlerts(currentPrice);
        }
      }
    } catch (e) {
      console.error('Immediate alert check error:', e.message);
    }

    return NextResponse.json({ success: true, alert, message: 'Price alert created successfully!' });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alertId = searchParams.get('id');
    const type = searchParams.get('type');

    if (type === 'logs') {
      clearExecutionLogs();
      return NextResponse.json({ success: true, message: 'Trade execution logs cleared' });
    }

    if (alertId) {
      const alerts = getAlertsList();
      const filtered = alerts.filter(a => a.id !== alertId);
      fs.writeFileSync(ALERTS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      return NextResponse.json({ success: true, message: 'Alert deleted successfully' });
    } else {
      clearAlerts();
      return NextResponse.json({ success: true, message: 'All alerts cleared' });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
