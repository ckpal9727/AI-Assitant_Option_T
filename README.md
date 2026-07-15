# Delta Exchange India AI Trading Assistant

A lightweight Node.js utility and AI trading agent that connects to the Delta Exchange India API, retrieves real-time market snapshots and options quotes, and uses a GPT-5 reasoning agent to evaluate market metrics and suggest options strategies.

## Prerequisites

- [Node.js](https://nodejs.org/) (Version 18.0.0 or higher is recommended, as the script uses native `fetch`).
- An OpenAI API Key.

## Setup

1. Clone or download this project.
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the project root:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-5-mini
   ```

## Usage

You can run the script to view the current BTC spot price, available expiry dates, and the option chain in three different ways:

### 1. Default (Nearest Active Expiry)
To view the option chain for the nearest active expiry date:
```bash
node index.js
```

### 2. Selection by List Number
To view the option chain for a specific expiry by its number in the displayed list (e.g., select index `4`):
```bash
node index.js 4
```

### 3. Selection by Expiry String
To view the option chain for a specific expiry date string (in `DDMMYY` format, e.g., `170726`):
```bash
node index.js 170726
```

### 4. Detailed Strike Price Inspection
To view a deep side-by-side comparison of Call and Put options for a specific strike price, add the `--strike` parameter:
```bash
node index.js --strike 63000
# Or combined with a specific expiry date / index:
node index.js 170726 --strike 63000
```

### 5. Market Summary Only
To view only the Market Summary rule-engine analysis (ATM, support/resistance, Max Pain, ATM average IV, funding rate sentiment, and ATM Greeks) without the full option chain matrix:
```bash
node index.js --summary
# Or combined with a specific expiry date / index:
node index.js 170726 --summary
```

## AI Trading Assistant Agent

You can interact with the GPT-5 options trading assistant:

### 1. Single Prompt Execution
Provide a prompt directly as arguments:
```bash
node agent.js "Analyze today's BTC market."
```

### 2. Interactive Chat Session
Start a persistent chat loop to ask follow-up questions, update user capital, or journal trades:
```bash
node agent.js
```

### 3. Trade Journal Actions
You can ask the agent to log trades or read history:
- *Log a trade*: `node agent.js "Log a Bull Put Spread trade on BTC. Short strike is 62000, long strike is 61000. Risk is $8.00, reward is $2.00. Reason: positive funding. Lessons: Watch support."`
- *View history*: `node agent.js "Show my trade journal history."`
Trades are stored in `trade_journal.json`.

---

## Programmatic Usage

You can import the options analysis rule engine into other JavaScript/Node.js scripts:

```javascript
import { getMarketSummary, getStrikeDetails, getOptionChain, calculateStrategy } from './index.js';

// Get high-level market summary (default nearest expiry)
const summary = await getMarketSummary();

// Calculate payoffs for a Bull Put spread
const strategy = await calculateStrategy({
  strategy: 'bullputcreditspread',
  shortStrike: 62000,
  longStrike: 61000
});
```

---

## Features

- **Base URL**: Set to Delta Exchange India (`https://api.india.delta.exchange`).
- **Grouping**: Options are grouped by expiry date.
- **Sorting**: Option strikes are displayed in ascending order.
- **Contract Types**: Displays both Call (CE) and Put (PE) options for each strike.
- **Side-by-Side Matrix View**: Displaying Open Interest (OI), Implied Volatility (IV%), Delta, Bid, Ask, LTP, and Volume side-by-side.
- **Detailed Strike Inspector**: Compares 12 parameters side-by-side for a specific strike price.
- **Code-Based Strategy Selection**: Automatically maps market states (`Trending Up`, `Trending Down`, `Sideways`, `Range Bound`, `Breakout`, `High/Low Volatility`) to specific candidate strategies, letting the AI reason on tradeoffs and strikes.
- **Trade Journaling**: Persists logged trades, rationale, risk/reward, results, and lessons in a structured JSON database.
- **Confidence Signal Counting**: Evaluates trade confidence based on mathematically calculated aligned vs conflicting signals in code.
- **Granular Trade Validation Engine**: Evaluates proposed strategies and calculates scores for Risk/Reward, Liquidity, Spreads, OI, Expiry, and Market Alignment in code.
- **Immediate Rejection Safeguards**: Rejects risk breaches immediately at the JavaScript layer to save AI tokens.
- **User Configurable Constraints**: Supports `"minRR"` (minimum Risk/Reward) inside `user_profile.json` along with capital and risk tolerance.

