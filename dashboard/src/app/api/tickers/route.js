import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://api.india.delta.exchange/v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=BTC');
    if (!res.ok) {
      throw new Error(`Failed to fetch tickers from Delta Exchange: ${res.statusText}`);
    }
    const data = await res.json();
    if (!data.result) {
      throw new Error('Delta Exchange tickers result is empty');
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

    return NextResponse.json({ success: true, tickers: tickersMap });
  } catch (error) {
    console.error('API Tickers Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
