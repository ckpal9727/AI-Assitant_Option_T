import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const JOURNAL_PATH = path.resolve(process.cwd(), '../trade_journal.json');

// Helper to read local journal
function readJournal() {
  try {
    if (fs.existsSync(JOURNAL_PATH)) {
      const data = fs.readFileSync(JOURNAL_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading trade_journal.json:', err);
  }
  return [];
}

// Helper to write local journal
function writeJournal(data) {
  try {
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing trade_journal.json:', err);
    return false;
  }
}

export async function GET() {
  const trades = readJournal();
  let modified = false;
  trades.forEach((t, index) => {
    if (t.id === undefined || t.id === null) {
      t.id = Math.floor(Math.random() * 1000000000) + index;
      modified = true;
    }
    if (t.entry_factors === undefined && t.entryFactors !== undefined) {
      t.entry_factors = t.entryFactors;
      modified = true;
    }
    if (t.market_state === undefined && t.marketState !== undefined) {
      t.market_state = t.marketState;
      modified = true;
    }
  });
  if (modified) {
    writeJournal(trades);
  }
  return NextResponse.json({ success: true, trades });
}

export async function POST(request) {
  try {
    const trade = await request.json();
    const trades = readJournal();
    
    // Normalize properties to support both camelCase and snake_case
    if (trade.entry_factors !== undefined && trade.entryFactors === undefined) {
      trade.entryFactors = trade.entry_factors;
    }
    if (trade.entryFactors !== undefined && trade.entry_factors === undefined) {
      trade.entry_factors = trade.entryFactors;
    }
    if (trade.market_state !== undefined && trade.marketState === undefined) {
      trade.marketState = trade.market_state;
    }
    if (trade.marketState !== undefined && trade.market_state === undefined) {
      trade.market_state = trade.marketState;
    }

    // Check if it is an update
    if (trade.id !== undefined && trade.id !== null) {
      // Find matching item by ID or unique properties
      const idx = trades.findIndex(t => t.id === trade.id || (t.date === trade.date && t.strategy === trade.strategy && parseFloat(t.risk) === parseFloat(trade.risk)));
      if (idx !== -1) {
        trades[idx] = { ...trades[idx], ...trade };
      } else {
        trades.unshift(trade);
      }
    } else {
      // Assign a random ID
      trade.id = Math.floor(Math.random() * 1000000);
      trades.unshift(trade);
    }
    
    writeJournal(trades);
    return NextResponse.json({ success: true, trades });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id'));
    if (isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Valid trade ID is required' }, { status: 400 });
    }
    
    let trades = readJournal();
    trades = trades.filter(t => t.id !== id);
    writeJournal(trades);
    
    return NextResponse.json({ success: true, trades });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
