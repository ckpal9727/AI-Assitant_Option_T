import dotenv from 'dotenv';
dotenv.config({ override: true });
import path from 'path';
import { env } from 'process';

export * from './dashboard/src/lib/telegram.js';
import { startTelegramBot, startPriceMonitorLoop } from './dashboard/src/lib/telegram.js';

// Allow direct execution for CLI (node telegram.js or npm run telegram)
if (process.argv[1] && path.basename(process.argv[1]) === 'telegram.js') {
  console.log('Starting Telegram Bot standalone listener & price monitor...');
  startPriceMonitorLoop();
  startTelegramBot();
}
