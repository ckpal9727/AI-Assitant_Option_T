import { NextResponse } from 'next/server';
import { getMarketSummary } from '../../../../../index.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const expiry = searchParams.get('expiry') || null;
    
    const summary = await getMarketSummary({ expiry });
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('API Market Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
