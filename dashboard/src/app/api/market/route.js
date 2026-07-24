import { NextResponse } from 'next/server';
import { getMarketSummary } from '../../../../../index.js';
import { checkAndTriggerAlerts } from '../../../../../telegram.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const expiry = searchParams.get('expiry') || null;
    
    const summary = await getMarketSummary({ expiry });
    
    // Check active price alerts against current BTC price
    if (summary && summary.btcPrice) {
      checkAndTriggerAlerts(summary.btcPrice).catch(err => {
        console.error('Alert trigger check error:', err.message);
      });
    }

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('API Market Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
