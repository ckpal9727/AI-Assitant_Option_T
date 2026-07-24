import { NextResponse } from 'next/server';
import { checkAndTriggerAlerts } from '../../../../../telegram.js';

export async function GET() {
  try {
    const [resTickers, resBtc] = await Promise.all([
      fetch('https://api.india.delta.exchange/v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=BTC'),
      fetch('https://api.india.delta.exchange/v2/tickers/BTCUSD')
    ]);

    if (!resTickers.ok) {
      throw new Error(`Failed to fetch tickers from Delta Exchange: ${resTickers.statusText}`);
    }
    const data = await resTickers.json();
    if (!data.result) {
      throw new Error('Delta Exchange tickers result is empty');
    }

    let btcSpotPrice = null;
    if (resBtc.ok) {
      const btcData = await resBtc.json();
      if (btcData.result && btcData.result.spot_price) {
        btcSpotPrice = parseFloat(btcData.result.spot_price);
      }
    }

    const tickersMap = {};
    for (const item of data.result) {
      const quotes = item.quotes || {};
      tickersMap[item.symbol] = {
        markPrice: item.mark_price !== null && item.mark_price !== undefined ? parseFloat(item.mark_price) : null,
        bid: quotes.best_bid !== null && quotes.best_bid !== undefined ? parseFloat(quotes.best_bid) : null,
        ask: quotes.best_ask !== null && quotes.best_ask !== undefined ? parseFloat(quotes.best_ask) : null,
        ltp: item.close !== null && item.close !== undefined ? parseFloat(item.close) : null,
      };
    }

    let hasNewAutoTrade = false;
    // Evaluate active Telegram price alerts every 2 seconds with live BTC spot price
    if (btcSpotPrice) {
      try {
        const triggerResult = await checkAndTriggerAlerts(btcSpotPrice);
        if (triggerResult && triggerResult.triggered) {
          hasNewAutoTrade = true;
        }
      } catch (err) {
        console.error('Ticker alert trigger check error:', err.message);
      }
    }

    return NextResponse.json({ success: true, tickers: tickersMap, btcSpotPrice, hasNewAutoTrade });
  } catch (error) {
    console.error('API Tickers Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
