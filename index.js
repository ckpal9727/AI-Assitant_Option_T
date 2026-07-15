import { argv } from 'process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const BASE_URL = 'https://api.india.delta.exchange';
const STRIKE_RANGE = 10; // Configure strike range around ATM for Support/Resistance search (e.g. ±10 strikes)

/**
 * Parses expiry string in DDMMYY format to Date object.
 */
function parseExpiry(expiryStr) {
  const day = parseInt(expiryStr.slice(0, 2), 10);
  const month = parseInt(expiryStr.slice(2, 4), 10) - 1; // 0-indexed
  const year = 2000 + parseInt(expiryStr.slice(4, 6), 10);
  return new Date(year, month, day, 17, 30, 0); // 5:30 PM IST settlement
}

/**
 * Calculates remaining days from now to the expiry date.
 */
function getDaysRemaining(expiryDate) {
  const now = new Date();
  const diffTime = expiryDate - now;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays;
}

/**
 * Formats the days remaining in a human-readable way.
 */
function formatDaysRemaining(days) {
  if (days < 0) {
    return 'expired';
  }
  if (days < 0.1) {
    return 'expiring today';
  }
  const roundedDays = Math.ceil(days);
  if (roundedDays === 1) {
    return '1 day remaining (Daily)';
  }
  if (roundedDays === 7) {
    return '7 days remaining (Weekly)';
  }
  return `${roundedDays} days remaining`;
}

/**
 * Safely parses a float value, returning null if invalid or missing.
 */
function safeFloat(val) {
  if (val === null || val === undefined) return null;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Align text to a specific length.
 */
function pad(val, length, align = 'right') {
  const str = String(val);
  if (str.length >= length) return str.slice(0, length);
  const diff = length - str.length;
  if (align === 'right') {
    return ' '.repeat(diff) + str;
  } else if (align === 'left') {
    return str + ' '.repeat(diff);
  } else {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }
}

/**
 * Format a cells value for display in the table.
 */
function formatCell(val, type, width) {
  if (val === null || val === undefined) {
    return pad('-', width, 'center');
  }
  let str = '';
  if (type === 'price') {
    str = val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  } else if (type === 'percent') {
    str = (val * 100).toFixed(1) + '%';
  } else if (type === 'greek') {
    str = val.toFixed(3);
  } else if (type === 'number') {
    str = val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  } else if (type === 'strike') {
    str = val.toLocaleString('en-US');
    return pad(str, width, 'center');
  } else {
    str = String(val);
  }
  return pad(str, width, 'right');
}

/**
 * Calculates Next Funding Time schedule in UTC and converts to local time.
 * Standard 8-hour schedule: 00:00, 08:00, 16:00 UTC.
 */
function getNextFundingDetails() {
  const now = new Date();
  const next = new Date(now);
  const currentHourUTC = now.getUTCHours();
  
  let nextHourUTC;
  if (currentHourUTC < 0) {
    nextHourUTC = 0;
  } else if (currentHourUTC < 8) {
    nextHourUTC = 8;
  } else if (currentHourUTC < 16) {
    nextHourUTC = 16;
  } else {
    nextHourUTC = 24; // tomorrow 00:00 UTC
  }
  
  if (nextHourUTC === 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
  } else {
    next.setUTCHours(nextHourUTC, 0, 0, 0);
  }
  
  const diffMs = next - now;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  let remainingStr = '';
  if (diffHours > 0) {
    remainingStr += `${diffHours}h `;
  }
  remainingStr += `${diffMins}m`;

  return {
    time: next,
    remainingStr
  };
}

/**
 * Renders the full side-by-side Option Chain table.
 */
function renderOptionChainTable(sortedStrikes, strikesMap) {
  const hr = '-'.repeat(117);
  console.log(hr);
  console.log(`|${pad('CALLS', 52, 'center')}| Strike |${pad('PUTS', 52, 'center')}|`);
  console.log(`|  OI   |  IV%  | Delta |  Bid  |  Ask  |  LTP  |  Vol  |        |  Vol  |  LTP  |  Bid  |  Ask  | Delta |  IV%  |  OI   |`);
  console.log(hr);

  for (const strike of sortedStrikes) {
    const entry = strikesMap.get(strike);
    const c = entry.call || {};
    const p = entry.put || {};

    const cOI = formatCell(c.oi, 'number', 6);
    const cIV = formatCell(c.iv, 'percent', 5);
    const cDelta = formatCell(c.delta, 'greek', 5);
    const cBid = formatCell(c.bidPrice, 'price', 5);
    const cAsk = formatCell(c.askPrice, 'price', 5);
    const cLTP = formatCell(c.ltp, 'price', 5);
    const cVol = formatCell(c.volume, 'number', 5);

    const strikeStr = formatCell(strike, 'strike', 8);

    const pVol = formatCell(p.volume, 'number', 5);
    const pLTP = formatCell(p.ltp, 'price', 5);
    const pBid = formatCell(p.bidPrice, 'price', 5);
    const pAsk = formatCell(p.askPrice, 'price', 5);
    const pDelta = formatCell(p.delta, 'greek', 5);
    const pIV = formatCell(p.iv, 'percent', 5);
    const pOI = formatCell(p.oi, 'number', 6);

    console.log(`|${cOI}|${cIV}|${cDelta}|${cBid}|${cAsk}|${cLTP}|${cVol}|${strikeStr}|${pVol}|${pLTP}|${pBid}|${pAsk}|${pDelta}|${pIV}|${pOI}|`);
  }
  console.log(hr);
}

/**
 * Renders the detailed view of a single strike price.
 */
function renderDetailedStrike(strike, entry, expiryStr, expiryDate, daysRemaining) {
  const hr = '-'.repeat(50);
  const strikeFormatted = strike.toLocaleString('en-US');
  
  console.log(`Strike: ${strikeFormatted} | Expiry: ${expiryStr} (${expiryDate.toDateString()} - ${formatDaysRemaining(daysRemaining)})`);
  console.log(hr);
  console.log(`${pad('Field', 20, 'left')} ${pad('Call (CE)', 13)} ${pad('Put (PE)', 13)}`);
  console.log(hr);

  const fields = [
    { label: 'Mark Price', key: 'markPrice', type: 'price' },
    { label: 'Bid Price', key: 'bidPrice', type: 'price' },
    { label: 'Ask Price', key: 'askPrice', type: 'price' },
    { label: 'LTP (Close)', key: 'ltp', type: 'price' },
    { label: 'Volume', key: 'volume', type: 'number' },
    { label: 'Open Interest', key: 'oi', type: 'number' },
    { label: 'IV (Implied Vol)', key: 'iv', type: 'percent' },
    { label: 'Delta', key: 'delta', type: 'greek_detailed' },
    { label: 'Gamma', key: 'gamma', type: 'greek_detailed_6' },
    { label: 'Theta', key: 'theta', type: 'greek_detailed' },
    { label: 'Vega', key: 'vega', type: 'greek_detailed' },
    { label: 'Rho', key: 'rho', type: 'greek_detailed' }
  ];

  const c = entry ? entry.call : null;
  const p = entry ? entry.put : null;

  for (const field of fields) {
    const cVal = c ? c[field.key] : null;
    const pVal = p ? p[field.key] : null;

    let cStr = '-';
    let pStr = '-';

    if (cVal !== null && cVal !== undefined) {
      if (field.type === 'price') {
        cStr = cVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else if (field.type === 'percent') {
        cStr = (cVal * 100).toFixed(2) + '%';
      } else if (field.type === 'greek_detailed') {
        cStr = cVal.toFixed(4);
      } else if (field.type === 'greek_detailed_6') {
        cStr = cVal.toFixed(6);
      } else {
        cStr = cVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }

    if (pVal !== null && pVal !== undefined) {
      if (field.type === 'price') {
        pStr = pVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else if (field.type === 'percent') {
        pStr = (pVal * 100).toFixed(2) + '%';
      } else if (field.type === 'greek_detailed') {
        pStr = pVal.toFixed(4);
      } else if (field.type === 'greek_detailed_6') {
        pStr = pVal.toFixed(6);
      } else {
        pStr = pVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }

    console.log(`${pad(field.label, 20, 'left')} ${pad(cStr, 13)} ${pad(pStr, 13)}`);
  }
  console.log(hr);
}

/**
 * Calculates Max Pain strike price.
 */
function calculateMaxPain(sortedStrikes, strikesMap) {
  let minPain = Infinity;
  let maxPainStrike = null;

  for (const testPrice of sortedStrikes) {
    let totalPain = 0;
    for (const entry of strikesMap.values()) {
      const strike = entry.strike;
      if (entry.call && entry.call.oi > 0) {
        totalPain += Math.max(testPrice - strike, 0) * entry.call.oi;
      }
      if (entry.put && entry.put.oi > 0) {
        totalPain += Math.max(strike - testPrice, 0) * entry.put.oi;
      }
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = testPrice;
    }
  }
  return maxPainStrike;
}

/**
 * Classifies IV on Average ATM IV.
 */
function classifyIV(avgIV) {
  if (avgIV < 0.35) return 'Low';
  if (avgIV <= 0.55) return 'Normal';
  return 'High';
}

/**
 * Internal helper to fetch and parse Delta India options ticker data.
 * Returns sortedStrikes, strikesMap, and metadata.
 */
async function fetchAndProcessOptions(expirySelection = null) {
  // Fetch options tickers
  const optionsRes = await fetch(`${BASE_URL}/v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=BTC`);
  if (!optionsRes.ok) {
    throw new Error(`Failed to fetch options tickers: ${optionsRes.statusText}`);
  }
  const optionsData = await optionsRes.json();
  if (!optionsData.result || optionsData.result.length === 0) {
    throw new Error('No options contracts found');
  }

  // Parse and group options
  const expiriesMap = new Map();

  for (const opt of optionsData.result) {
    const match = opt.symbol.match(/^(C|P)-BTC-(\d+)-(\d{6})$/);
    if (!match) continue;

    const type = match[1]; // C or P
    const strike = parseInt(match[2], 10);
    const expiry = match[3]; // DDMMYY

    const quotes = opt.quotes || {};
    const greeks = opt.greeks || {};

    const parsedOption = {
      symbol: opt.symbol,
      strike,
      type,
      markPrice: safeFloat(opt.mark_price),
      bidPrice: safeFloat(quotes.best_bid),
      askPrice: safeFloat(quotes.best_ask),
      ltp: safeFloat(opt.close),
      volume: safeFloat(opt.volume),
      oi: safeFloat(opt.oi),
      iv: safeFloat(quotes.mark_iv),
      delta: safeFloat(greeks.delta),
      gamma: safeFloat(greeks.gamma),
      theta: safeFloat(greeks.theta),
      vega: safeFloat(greeks.vega),
      rho: safeFloat(greeks.rho),
      oi_change_usd_6h: safeFloat(opt.oi_change_usd_6h)
    };

    if (!expiriesMap.has(expiry)) {
      expiriesMap.set(expiry, []);
    }
    expiriesMap.get(expiry).push(parsedOption);
  }

  // Sort expiries by date
  const sortedExpiries = Array.from(expiriesMap.keys()).sort((a, b) => {
    return parseExpiry(a) - parseExpiry(b);
  });

  // Map index string selection (e.g. "2") to actual expiry code
  if (expirySelection && /^\d+$/.test(expirySelection) && expirySelection.length <= 2) {
    const idx = parseInt(expirySelection, 10) - 1;
    if (idx >= 0 && idx < sortedExpiries.length) {
      expirySelection = sortedExpiries[idx];
    }
  }

  // Default selection
  let selectedExpiry = expirySelection;
  if (!selectedExpiry || !expiriesMap.has(selectedExpiry)) {
    selectedExpiry = sortedExpiries.find(exp => {
      const date = parseExpiry(exp);
      return getDaysRemaining(date) >= 0;
    }) || sortedExpiries[0];
  }

  const expiryDate = parseExpiry(selectedExpiry);
  const daysRemaining = getDaysRemaining(expiryDate);
  const optionsForExpiry = expiriesMap.get(selectedExpiry);

  // Group options by strike price
  const strikesMap = new Map();
  for (const opt of optionsForExpiry) {
    if (!strikesMap.has(opt.strike)) {
      strikesMap.set(opt.strike, { strike: opt.strike, call: null, put: null });
    }
    if (opt.type === 'C') {
      strikesMap.get(opt.strike).call = opt;
    } else if (opt.type === 'P') {
      strikesMap.get(opt.strike).put = opt;
    }
  }

  const sortedStrikes = Array.from(strikesMap.keys()).sort((a, b) => a - b);

  return {
    sortedExpiries,
    selectedExpiry,
    expiryDate,
    daysRemaining,
    sortedStrikes,
    strikesMap
  };
}

/**
 * TOOL 1: Get Current BTC Price.
 * Fetches BTCUSD perpetual ticker and returns the current spot price.
 */
export async function getCurrentBTCPrice() {
  const tickerRes = await fetch(`${BASE_URL}/v2/tickers/BTCUSD`);
  if (!tickerRes.ok) {
    throw new Error(`Failed to fetch BTCUSD price: ${tickerRes.statusText}`);
  }
  const tickerData = await tickerRes.json();
  if (!tickerData.result) {
    throw new Error('BTCUSD price result empty');
  }
  return parseFloat(tickerData.result.spot_price);
}

/**
 * Classifies the current market state based on options and futures data.
 */
function detectMarketState(spotPrice, support, resistance, pcr, avgIVPercentage, fundingSentiment) {
  // 1. Volatility checks
  if (avgIVPercentage > 55) {
    return 'High Volatility';
  }
  if (avgIVPercentage < 35) {
    return 'Low Volatility';
  }

  // 2. Breakout checks (within 0.75% of Support or Resistance)
  const breakoutThreshold = spotPrice * 0.0075;
  if (Math.abs(spotPrice - resistance) < breakoutThreshold || spotPrice > resistance) {
    return 'Breakout';
  }
  if (Math.abs(spotPrice - support) < breakoutThreshold || spotPrice < support) {
    return 'Breakout';
  }

  // 3. Trend checks
  if (pcr < 0.6 && fundingSentiment === 'Bullish') {
    return 'Trending Up';
  }
  if (pcr > 1.2 && fundingSentiment === 'Bearish') {
    return 'Trending Down';
  }

  // 4. Range Bound vs Sideways
  if (pcr >= 0.7 && pcr <= 1.1) {
    return 'Range Bound';
  }

  return 'Sideways';
}

/**
 * Maps the market state and IV classification to strategy options.
 */
function getCandidateStrategies(marketState, ivClassification, fundingSentiment) {
  if (marketState === 'Sideways' || marketState === 'Range Bound') {
    return ['Iron Condor'];
  }
  if (marketState === 'High Volatility') {
    return ['Iron Condor', 'Bull Put Credit Spread', 'Bear Call Credit Spread'];
  }
  if (marketState === 'Low Volatility') {
    return ['Bull Call Debit Spread', 'Bear Put Debit Spread'];
  }
  
  if (marketState === 'Trending Up') {
    if (ivClassification === 'Low') {
      return ['Bull Call Debit Spread'];
    }
    return ['Bull Put Credit Spread', 'Bull Call Debit Spread'];
  }
  
  if (marketState === 'Trending Down') {
    if (ivClassification === 'Low') {
      return ['Bear Put Debit Spread'];
    }
    return ['Bear Call Credit Spread', 'Bear Put Debit Spread'];
  }
  
  if (marketState === 'Breakout') {
    if (fundingSentiment === 'Bullish') {
      return ['Bull Call Debit Spread'];
    }
    if (fundingSentiment === 'Bearish') {
      return ['Bear Put Debit Spread'];
    }
    return ['Bull Call Debit Spread', 'Bear Put Debit Spread'];
  }
  
  return ['Iron Condor', 'Bull Put Credit Spread', 'Bear Call Credit Spread'];
}

/**
 * Calculates aligned and conflicting signals based on rules-engine criteria.
 */
function calculateConfidenceSignals(spotPrice, support, resistance, pcr, ivClassification, fundingSentiment, marketState) {
  let signalsAligned = 0;
  let signalsConflicting = 0;

  // Let's establish a base bias direction: Bullish, Bearish, or Neutral
  let baseBias = 'Neutral';
  if (marketState === 'Trending Up') baseBias = 'Bullish';
  else if (marketState === 'Trending Down') baseBias = 'Bearish';
  else if (marketState === 'Breakout') {
    if (fundingSentiment === 'Bullish' || pcr < 0.6) baseBias = 'Bullish';
    else if (fundingSentiment === 'Bearish' || pcr > 1.2) baseBias = 'Bearish';
  }

  // 1. Check PCR signal
  if (baseBias === 'Bullish') {
    if (pcr < 0.6) signalsAligned++;
    else if (pcr > 0.9) signalsConflicting++;
  } else if (baseBias === 'Bearish') {
    if (pcr > 1.2) signalsAligned++;
    else if (pcr < 0.8) signalsConflicting++;
  } else {
    // Neutral base bias (Sideways / Range Bound)
    if (pcr >= 0.7 && pcr <= 1.1) signalsAligned++;
    else signalsConflicting++;
  }

  // 2. Check Funding Rate signal
  if (baseBias === 'Bullish') {
    if (fundingSentiment === 'Bullish') signalsAligned++;
    else if (fundingSentiment === 'Bearish') signalsConflicting++;
  } else if (baseBias === 'Bearish') {
    if (fundingSentiment === 'Bearish') signalsAligned++;
    else if (fundingSentiment === 'Bullish') signalsConflicting++;
  } else {
    // Neutral base bias
    if (fundingSentiment === 'Neutral') signalsAligned++;
    else signalsConflicting++;
  }

  // 3. Check IV signal alignment
  if (marketState === 'High Volatility' || ivClassification === 'High') {
    signalsAligned++;
  } else if (marketState === 'Low Volatility' || ivClassification === 'Low') {
    signalsAligned++;
  } else {
    signalsAligned++;
  }

  // 4. Check Price location relative to S/R
  const totalRange = resistance - support;
  if (totalRange > 0) {
    const relativePos = (spotPrice - support) / totalRange; // 0 to 1
    if (baseBias === 'Bullish') {
      if (relativePos < 0.3) signalsAligned++; 
      else if (relativePos > 0.8) signalsConflicting++;
    } else if (baseBias === 'Bearish') {
      if (relativePos > 0.7) signalsAligned++;
      else if (relativePos < 0.2) signalsConflicting++;
    } else {
      if (relativePos >= 0.3 && relativePos <= 0.7) signalsAligned++;
      else signalsConflicting++;
    }
  }

  return {
    signalsAligned: Math.max(1, signalsAligned),
    signalsConflicting: signalsConflicting
  };
}

/**
 * TOOL 2: Get Market Summary.
 * Calculates high-level options market metrics for a selected expiry.
 * Writes snapshot to project root.
 */
export async function getMarketSummary({ expiry = null } = {}) {
  const expirySelection = expiry;
  // Fetch price first
  const tickerRes = await fetch(`${BASE_URL}/v2/tickers/BTCUSD`);
  if (!tickerRes.ok) throw new Error(`Failed to fetch BTCUSD ticker: ${tickerRes.statusText}`);
  const tickerData = await tickerRes.json();
  if (!tickerData.result) throw new Error('BTCUSD ticker result empty');

  const spotPrice = parseFloat(tickerData.result.spot_price);
  const fundingRate = parseFloat(tickerData.result.funding_rate) || 0;

  // Process option contracts
  const data = await fetchAndProcessOptions(expirySelection);
  const { sortedExpiries, sortedStrikes, strikesMap, selectedExpiry, expiryDate, daysRemaining } = data;

  // Calculate ATM Strike & Distance
  let minDiff = Infinity;
  let atmStrike = null;
  for (const strike of sortedStrikes) {
    const diff = Math.abs(strike - spotPrice);
    if (diff < minDiff) {
      minDiff = diff;
      atmStrike = strike;
    }
  }
  const distanceFromATM = Math.abs(spotPrice - atmStrike);

  // ATM index range search for S/R
  const atmIndex = sortedStrikes.indexOf(atmStrike);
  const startIdx = Math.max(0, atmIndex - STRIKE_RANGE);
  const endIdx = Math.min(sortedStrikes.length - 1, atmIndex + STRIKE_RANGE);
  const relevantStrikes = sortedStrikes.slice(startIdx, endIdx + 1);

  // Max Call & Put OI across the entire chain
  let maxCallOIVal = -1;
  let maxCallOIStrike = null;
  let maxPutOIVal = -1;
  let maxPutOIStrike = null;

  let totalCallOI = 0;
  let totalPutOI = 0;

  for (const entry of strikesMap.values()) {
    if (entry.call && entry.call.oi > maxCallOIVal) {
      maxCallOIVal = entry.call.oi;
      maxCallOIStrike = entry.strike;
    }
    if (entry.put && entry.put.oi > maxPutOIVal) {
      maxPutOIVal = entry.put.oi;
      maxPutOIStrike = entry.strike;
    }
    if (entry.call) totalCallOI += entry.call.oi;
    if (entry.put) totalPutOI += entry.put.oi;
  }

  // PCR (Put Call Ratio)
  const pcr = totalCallOI > 0 ? (totalPutOI / totalCallOI) : 0;

  // Support & Resistance using weighted score in the ±10 ATM strike range
  let bestSupportScore = -1;
  let supportStrike = null;
  let bestResistanceScore = -1;
  let resistanceStrike = null;

  for (const strike of relevantStrikes) {
    const entry = strikesMap.get(strike);
    if (!entry) continue;

    if (strike < spotPrice && entry.put) {
      const putOI = entry.put.oi || 0;
      const putVol = entry.put.volume || 0;
      const putOIChangeUSD = entry.put.oi_change_usd_6h || 0;
      const score = putOI + putVol + (putOIChangeUSD / spotPrice);
      if (score > bestSupportScore) {
        bestSupportScore = score;
        supportStrike = strike;
      }
    }

    if (strike > spotPrice && entry.call) {
      const callOI = entry.call.oi || 0;
      const callVol = entry.call.volume || 0;
      const callOIChangeUSD = entry.call.oi_change_usd_6h || 0;
      const score = callOI + callVol + (callOIChangeUSD / spotPrice);
      if (score > bestResistanceScore) {
        bestResistanceScore = score;
        resistanceStrike = strike;
      }
    }
  }

  if (!supportStrike) supportStrike = atmStrike - 500;
  if (!resistanceStrike) resistanceStrike = atmStrike + 500;

  // ATM IV Call, Put, Average
  const atmEntry = strikesMap.get(atmStrike) || {};
  const atmCallIV = atmEntry.call ? (atmEntry.call.iv || 0) : 0;
  const atmPutIV = atmEntry.put ? (atmEntry.put.iv || 0) : 0;
  const avgIV = (atmCallIV + atmPutIV) / 2;
  const ivClassification = classifyIV(avgIV);

  // Funding Sentiment
  let fundingSentiment = 'Neutral';
  if (fundingRate > 0.00005) {
    fundingSentiment = 'Bullish';
  } else if (fundingRate < -0.00005) {
    fundingSentiment = 'Bearish';
  }

  // Max Pain
  const maxPainStrike = calculateMaxPain(sortedStrikes, strikesMap);

  // Next Funding details
  const fundingDetails = getNextFundingDetails();

  // ATM Greeks
  const atmC = atmEntry.call || {};
  const atmP = atmEntry.put || {};
  const greeksObj = {
    callDelta: atmC.delta !== null && atmC.delta !== undefined ? parseFloat(atmC.delta.toFixed(4)) : null,
    putDelta: atmP.delta !== null && atmP.delta !== undefined ? parseFloat(atmP.delta.toFixed(4)) : null,
    callGamma: atmC.gamma !== null && atmC.gamma !== undefined ? parseFloat(atmC.gamma.toFixed(6)) : null,
    putGamma: atmP.gamma !== null && atmP.gamma !== undefined ? parseFloat(atmP.gamma.toFixed(6)) : null,
    callTheta: atmC.theta !== null && atmC.theta !== undefined ? parseFloat(atmC.theta.toFixed(4)) : null,
    putTheta: atmP.theta !== null && atmP.theta !== undefined ? parseFloat(atmP.theta.toFixed(4)) : null,
    callVega: atmC.vega !== null && atmC.vega !== undefined ? parseFloat(atmC.vega.toFixed(4)) : null,
    putVega: atmP.vega !== null && atmP.vega !== undefined ? parseFloat(atmP.vega.toFixed(4)) : null,
    callRho: atmC.rho !== null && atmC.rho !== undefined ? parseFloat(atmC.rho.toFixed(4)) : null,
    putRho: atmP.rho !== null && atmP.rho !== undefined ? parseFloat(atmP.rho.toFixed(4)) : null
  };

  // 8. Market State Detection
  const marketState = detectMarketState(spotPrice, supportStrike, resistanceStrike, pcr, avgIV * 100, fundingSentiment);

  // 9. Candidate Strategy selection & Confidence Inputs
  const candidateStrategies = getCandidateStrategies(marketState, ivClassification, fundingSentiment);
  const confidenceInputs = calculateConfidenceSignals(
    spotPrice,
    supportStrike,
    resistanceStrike,
    pcr,
    ivClassification,
    fundingSentiment,
    marketState
  );

  const result = {
    btcPrice: spotPrice,
    atmStrike,
    distanceFromAtm: parseFloat(distanceFromATM.toFixed(1)),
    support: supportStrike,
    resistance: resistanceStrike,
    maxPutOI: { strike: maxPutOIStrike, oi: maxPutOIVal },
    maxCallOI: { strike: maxCallOIStrike, oi: maxCallOIVal },
    pcr: parseFloat(pcr.toFixed(2)),
    averageIV: parseFloat((avgIV * 100).toFixed(1)),
    ivClassification,
    marketState,
    candidateStrategies,
    confidenceInputs,
    funding: {
      rate: parseFloat((fundingRate * 100).toFixed(4)),
      sentiment: fundingSentiment
    },
    nextFunding: {
      time: fundingDetails.time.toISOString(),
      remainingTime: fundingDetails.remainingStr
    },
    maxPain: maxPainStrike,
    greeks: greeksObj,
    
    // Internal metadata for CLI printing
    _internal: {
      sortedExpiries,
      selectedExpiry,
      expiryDate,
      daysRemaining,
      sortedStrikes,
      strikesMap,
      atmEntry,
      atmCallIV,
      atmPutIV
    }
  };

  // Write snapshot file to workspace (excluding internal properties)
  const { _internal, ...snapshot } = result;
  fs.writeFileSync('market_snapshot.json', JSON.stringify(snapshot, null, 2));

  return result;
}

/**
 * TOOL 3: Get Strike Details.
 * Returns detailed Call and Put option metrics for a specific strike price.
 */
export async function getStrikeDetails({ strike, expiry = null }) {
  const expirySelection = expiry;
  const data = await fetchAndProcessOptions(expirySelection);
  const entry = data.strikesMap.get(strike);
  
  if (!entry) {
    throw new Error(`Strike price ${strike} is not available for expiry ${data.selectedExpiry}.`);
  }
  return {
    strike,
    expiry: data.selectedExpiry,
    call: entry.call,
    put: entry.put
  };
}

/**
 * TOOL 4: Get Option Chain (Filtered).
 * Returns options chain array for the expiry, filtered optionally by strike range.
 */
export async function getOptionChain({ expiry = null, fromStrike = null, toStrike = null } = {}) {
  const expirySelection = expiry;
  const data = await fetchAndProcessOptions(expirySelection);
  const chainArray = data.sortedStrikes.map(strike => {
    const entry = data.strikesMap.get(strike);
    return {
      strike,
      call: entry.call,
      put: entry.put
    };
  });

  let filteredChain = chainArray;
  if (fromStrike !== null) {
    filteredChain = filteredChain.filter(item => item.strike >= fromStrike);
  }
  if (toStrike !== null) {
    filteredChain = filteredChain.filter(item => item.strike <= toStrike);
  }
  return filteredChain;
}

/**
 * TOOL 5: Calculate Strategy.
 * Calculates net debit/credit, max risk, and max reward for a spreads strategy.
 */
export async function calculateStrategy({ strategy, expiry = null, shortStrike, longStrike, shortStrike2 = null, longStrike2 = null }) {
  const data = await fetchAndProcessOptions(expiry);
  const strikesMap = data.strikesMap;
  
  const getOpt = (strike, type) => {
    const entry = strikesMap.get(strike);
    if (!entry) return null;
    return type === 'C' ? entry.call : entry.put;
  };
  
  let netCredit = 0;
  let netDebit = 0;
  let maxRisk = 0;
  let maxReward = 0;
  let details = {};

  const strat = strategy.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (strat === 'bullputspread' || strat === 'bullputcreditspread') {
    const shortPut = getOpt(shortStrike, 'P');
    const longPut = getOpt(longStrike, 'P');
    
    if (!shortPut || !longPut) {
      throw new Error(`Invalid strikes for Bull Put Spread: ${shortStrike} or ${longStrike} not found.`);
    }
    
    const shortBid = shortPut.bidPrice || shortPut.ltp || 0;
    const longAsk = longPut.askPrice || longPut.ltp || 0;
    
    netCredit = shortBid - longAsk;
    maxReward = netCredit;
    maxRisk = (shortStrike - longStrike) - netCredit;
    
    details = {
      shortPut: { strike: shortStrike, bid: shortBid },
      longPut: { strike: longStrike, ask: longAsk },
      netCredit,
      breakEven: shortStrike - netCredit
    };
  } else if (strat === 'bearcallspread' || strat === 'bearcallcreditspread') {
    const shortCall = getOpt(shortStrike, 'C');
    const longCall = getOpt(longStrike, 'C');
    
    if (!shortCall || !longCall) {
      throw new Error(`Invalid strikes for Bear Call Spread: ${shortStrike} or ${longStrike} not found.`);
    }
    
    const shortBid = shortCall.bidPrice || shortCall.ltp || 0;
    const longAsk = longCall.askPrice || longCall.ltp || 0;
    
    netCredit = shortBid - longAsk;
    maxReward = netCredit;
    maxRisk = (longStrike - shortStrike) - netCredit;
    
    details = {
      shortCall: { strike: shortStrike, bid: shortBid },
      longCall: { strike: longStrike, ask: longAsk },
      netCredit,
      breakEven: shortStrike + netCredit
    };
  } else if (strat === 'bullcalldebitspread' || strat === 'bullcallspread' || strat === 'bullcalldebit') {
    const shortCall = getOpt(shortStrike, 'C');
    const longCall = getOpt(longStrike, 'C');
    
    if (!shortCall || !longCall) {
      throw new Error(`Invalid strikes for Bull Call Debit Spread: ${shortStrike} or ${longStrike} not found.`);
    }
    
    const shortBid = shortCall.bidPrice || shortCall.ltp || 0;
    const longAsk = longCall.askPrice || longCall.ltp || 0;
    
    netDebit = longAsk - shortBid;
    maxRisk = netDebit;
    maxReward = (shortStrike - longStrike) - netDebit;
    
    details = {
      longCall: { strike: longStrike, ask: longAsk },
      shortCall: { strike: shortStrike, bid: shortBid },
      netDebit,
      breakEven: longStrike + netDebit
    };
  } else if (strat === 'bearputdebitspread' || strat === 'bearputspread' || strat === 'bearputdebit') {
    const shortPut = getOpt(shortStrike, 'P');
    const longPut = getOpt(longStrike, 'P');
    
    if (!shortPut || !longPut) {
      throw new Error(`Invalid strikes for Bear Put Debit Spread: ${shortStrike} or ${longStrike} not found.`);
    }
    
    const shortBid = shortPut.bidPrice || shortPut.ltp || 0;
    const longAsk = longPut.askPrice || longPut.ltp || 0;
    
    netDebit = longAsk - shortBid;
    maxRisk = netDebit;
    maxReward = (longStrike - shortStrike) - netDebit;
    
    details = {
      longPut: { strike: longStrike, ask: longAsk },
      shortPut: { strike: shortStrike, bid: shortBid },
      netDebit,
      breakEven: longStrike - netDebit
    };
  } else if (strat === 'ironcondor') {
    const shortPut = getOpt(shortStrike, 'P');
    const longPut = getOpt(longStrike, 'P');
    const shortCall = getOpt(shortStrike2, 'C');
    const longCall = getOpt(longStrike2, 'C');
    
    if (!shortPut || !longPut || !shortCall || !longCall) {
      throw new Error(`Invalid strikes for Iron Condor.`);
    }
    
    const spBid = shortPut.bidPrice || shortPut.ltp || 0;
    const lpAsk = longPut.askPrice || longPut.ltp || 0;
    const scBid = shortCall.bidPrice || shortCall.ltp || 0;
    const lcAsk = longCall.askPrice || longCall.ltp || 0;
    
    netCredit = (spBid + scBid) - (lpAsk + lcAsk);
    maxReward = netCredit;
    
    const putSpreadWidth = shortStrike - longStrike;
    const callSpreadWidth = longStrike2 - shortStrike2;
    maxRisk = Math.max(putSpreadWidth, callSpreadWidth) - netCredit;
    
    details = {
      putSpread: { shortPut: shortStrike, longPut: longStrike, shortBid: spBid, longAsk: lpAsk },
      callSpread: { shortCall: shortStrike2, longCall: longStrike2, shortBid: scBid, longAsk: lcAsk },
      netCredit,
      breakEvenLower: shortStrike - netCredit,
      breakEvenUpper: shortStrike2 + netCredit
    };
  } else {
    throw new Error(`Strategy '${strategy}' calculations are not supported yet.`);
  }

  return {
    strategy,
    maxRisk: parseFloat(maxRisk.toFixed(2)),
    maxReward: parseFloat(maxReward.toFixed(2)),
    details
  };
}

/**
 * Helper to read user profile constraints in code.
 */
function readUserProfile() {
  try {
    const PROFILE_PATH = 'user_profile.json';
    if (fs.existsSync(PROFILE_PATH)) {
      const data = fs.readFileSync(PROFILE_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    // Ignore and return empty
  }
  return {};
}

/**
 * TOOL 6: Validate Trade.
 * Runs strategy math and calculates structured, granular validation scores.
 * Rejects immediately if strategy risk exceeds profile limits.
 */
export async function validateTrade({ strategy, expiry = null, shortStrike, longStrike, shortStrike2 = null, longStrike2 = null }) {
  const profile = readUserProfile();
  const capital = profile.capital || 0;
  const riskTolerance = profile.riskTolerance || 0;
  const minRR = profile.minRR || 0.15;
  const maxLossLimit = capital * riskTolerance;

  // Run strategy math
  const stratResult = await calculateStrategy({ strategy, expiry, shortStrike, longStrike, shortStrike2, longStrike2 });
  const maxRisk = stratResult.maxRisk;
  const maxReward = stratResult.maxReward;

  // 1. Immediate rejection if risk exceeds user profile limits
  if (maxLossLimit > 0 && maxRisk > maxLossLimit) {
    return {
      approved: false,
      rejected: true,
      reason: `Max Risk ($${maxRisk.toFixed(2)}) exceeds user profile trade risk limit ($${maxLossLimit.toFixed(2)} based on $${capital} capital and ${(riskTolerance * 100).toFixed(1)}% risk).`
    };
  }

  // 2. Fetch options details to evaluate scores
  const summary = await getMarketSummary({ expiry });
  const strikesMap = summary._internal.strikesMap;
  const daysRemaining = summary._internal.daysRemaining;

  const getOpt = (strike, type) => {
    const entry = strikesMap.get(strike);
    if (!entry) return null;
    return type === 'C' ? entry.call : entry.put;
  };

  const options = [];
  const strat = strategy.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (strat === 'bullputspread' || strat === 'bullputcreditspread') {
    options.push(getOpt(shortStrike, 'P'), getOpt(longStrike, 'P'));
  } else if (strat === 'bearcallspread' || strat === 'bearcallcreditspread') {
    options.push(getOpt(shortStrike, 'C'), getOpt(longStrike, 'C'));
  } else if (strat === 'bullcalldebitspread' || strat === 'bullcallspread' || strat === 'bullcalldebit') {
    options.push(getOpt(shortStrike, 'C'), getOpt(longStrike, 'C'));
  } else if (strat === 'bearputdebitspread' || strat === 'bearputspread' || strat === 'bearputdebit') {
    options.push(getOpt(shortStrike, 'P'), getOpt(longStrike, 'P'));
  } else if (strat === 'ironcondor') {
    options.push(
      getOpt(shortStrike, 'P'),
      getOpt(longStrike, 'P'),
      getOpt(shortStrike2, 'C'),
      getOpt(longStrike2, 'C')
    );
  }

  const validOptions = options.filter(o => o !== null);
  if (validOptions.length === 0) {
    return {
      approved: false,
      rejected: false,
      reason: "Could not retrieve contract details for the specified strikes.",
      warnings: ["No valid option contracts found."]
    };
  }

  // 3. Score Calculations
  // A. Risk/Reward Score
  const calculatedRR = maxRisk > 0 ? (maxReward / maxRisk) : 0;
  let riskRewardScore = 0;
  if (calculatedRR >= minRR) {
    riskRewardScore = Math.min(100, Math.round(70 + (calculatedRR - minRR) * 150));
  } else {
    riskRewardScore = Math.max(0, Math.round((calculatedRR / minRR) * 70));
  }

  // B. Spread Score (Tightness)
  let totalSpreadPercent = 0;
  for (const opt of validOptions) {
    const spread = (opt.askPrice || opt.ltp || 0) - (opt.bidPrice || opt.ltp || 0);
    const mark = opt.markPrice || opt.ltp || 1;
    totalSpreadPercent += spread / mark;
  }
  const avgSpreadPercent = totalSpreadPercent / validOptions.length;
  let spreadScore = 100;
  if (avgSpreadPercent > 0.01) {
    spreadScore = Math.max(0, Math.round(100 - (avgSpreadPercent - 0.01) * 300));
  }

  // C. Open Interest (OI) Score
  let totalOI = 0;
  for (const opt of validOptions) {
    totalOI += opt.oi || 0;
  }
  const avgOI = totalOI / validOptions.length;
  const oiScore = Math.min(100, Math.round((avgOI / 15) * 100));

  // D. Liquidity Score (Spread & OI combined)
  const liquidityScore = Math.round(spreadScore * 0.6 + oiScore * 0.4);

  // E. Expiry Score (DTE sweet spot is 1 to 14 days)
  let expiryScore = 100;
  if (daysRemaining < 1) {
    expiryScore = Math.round(daysRemaining * 100);
  } else if (daysRemaining > 14) {
    expiryScore = Math.max(50, Math.round(100 - (daysRemaining - 14) * 2));
  }

  // F. Market Alignment
  let alignmentScore = 50;
  const bias = summary.marketState;
  const isCredit = strat.includes('credit') || strat === 'ironcondor';
  const isDebit = strat.includes('debit');

  if (bias === 'Trending Up') {
    if (strat.includes('bull') || strat.includes('putspread')) {
      alignmentScore = isCredit ? 90 : 85;
    } else if (strat.includes('bear')) {
      alignmentScore = 20;
    }
  } else if (bias === 'Trending Down') {
    if (strat.includes('bear') || strat.includes('callspread')) {
      alignmentScore = isCredit ? 90 : 85;
    } else if (strat.includes('bull')) {
      alignmentScore = 20;
    }
  } else if (bias === 'Sideways' || bias === 'Range Bound') {
    if (strat === 'ironcondor') {
      alignmentScore = 95;
    } else {
      alignmentScore = 40;
    }
  } else if (bias === 'Breakout') {
    if (isDebit) {
      alignmentScore = 90;
    } else {
      alignmentScore = 30;
    }
  }

  // 4. Overall Opportunity Score (Weighted Average)
  const opportunityScore = Math.round(
    liquidityScore * 0.20 +
    riskRewardScore * 0.30 +
    spreadScore * 0.10 +
    oiScore * 0.10 +
    expiryScore * 0.10 +
    alignmentScore * 0.20
  );

  // 5. Warnings Collection
  const warnings = [];
  if (calculatedRR < minRR) {
    warnings.push(`Risk/Reward ratio of ${calculatedRR.toFixed(2)} is below your profile minimum limit of ${minRR.toFixed(2)}.`);
  }
  if (avgSpreadPercent > 0.10) {
    warnings.push(`Poor liquidity: Average Bid/Ask spread is wide (${(avgSpreadPercent * 100).toFixed(1)}% of mark price).`);
  }
  if (avgOI < 3) {
    warnings.push(`Low contract Open Interest (average ${avgOI.toFixed(2)} BTC).`);
  }
  if (daysRemaining < 0.5) {
    warnings.push(`Strategy is expiring very soon (in ${(daysRemaining * 24).toFixed(1)} hours).`);
  }

  const approved = warnings.length === 0;

  return {
    approved,
    opportunityScore,
    scores: {
      riskReward: riskRewardScore,
      liquidity: liquidityScore,
      spread: spreadScore,
      oi: oiScore,
      expiry: expiryScore,
      marketAlignment: alignmentScore
    },
    warnings
  };
}

/**
 * Main CLI logic
 */
async function main() {
  try {
    const args = argv.slice(2);
    
    // Check for --strike argument
    let selectedStrike = null;
    const strikeArgIdx = args.indexOf('--strike');
    if (strikeArgIdx !== -1 && args[strikeArgIdx + 1]) {
      selectedStrike = parseInt(args[strikeArgIdx + 1], 10);
      args.splice(strikeArgIdx, 2);
    }

    // Check for --summary argument
    const summaryFlagIdx = args.indexOf('--summary');
    const onlySummary = summaryFlagIdx !== -1;
    if (onlySummary) {
      args.splice(summaryFlagIdx, 1);
    }

    // Check for --json argument
    const jsonFlagIdx = args.indexOf('--json');
    const onlyJson = jsonFlagIdx !== -1;
    if (onlyJson) {
      args.splice(jsonFlagIdx, 1);
    }

    const expirySelection = args[0] || null;

    // Call modular summary builder
    const summary = await getMarketSummary({ expiry: expirySelection });
    const meta = summary._internal;

    // If --json is specified, output only the clean snapshot object
    if (onlyJson) {
      const { _internal, ...cleanSnapshot } = summary;
      console.log(JSON.stringify(cleanSnapshot, null, 2));
      return;
    }

    console.log(`BTC Price: ${summary.btcPrice.toLocaleString('en-US')}\n`);

    // Output all available expiries list (for console logging only)
    console.log('Available Expiries:');
    meta.sortedExpiries.forEach((exp, index) => {
      const date = parseExpiry(exp);
      const days = getDaysRemaining(date);
      console.log(`[${index + 1}] ${exp} - ${date.toDateString()} (${formatDaysRemaining(days)})`);
    });
    console.log('');

    if (selectedStrike !== null) {
      // Detailed view of a single strike price
      const strikeDetails = await getStrikeDetails({ strike: selectedStrike, expiry: expirySelection });
      const entry = { call: strikeDetails.call, put: strikeDetails.put };
      renderDetailedStrike(selectedStrike, entry, meta.selectedExpiry, meta.expiryDate, meta.daysRemaining);
    } else {
      // Print Market Summary Console Dashboard
      console.log('=========================');
      console.log('Market Summary');
      console.log('=========================');
      console.log(`BTC Price           : ${summary.btcPrice.toLocaleString('en-US')}`);
      console.log(`ATM Strike          : ${summary.atmStrike.toLocaleString('en-US')}`);
      console.log(`Distance From ATM   : ${summary.distanceFromAtm.toFixed(1)} points`);
      console.log(`Nearest Support     : ${summary.support.toLocaleString('en-US')}`);
      console.log(`Nearest Resistance  : ${summary.resistance.toLocaleString('en-US')}`);
      console.log(`Market State        : ${summary.marketState}`);
      console.log(`Strategy Candidates : ${summary.candidateStrategies.join(', ')}`);
      console.log(`Confidence Signals  : Aligned: ${summary.confidenceInputs.signalsAligned}, Conflicting: ${summary.confidenceInputs.signalsConflicting}`);
      console.log(`Max Put OI Strike   : ${summary.maxPutOI.strike.toLocaleString('en-US')} (OI: ${summary.maxPutOI.oi.toFixed(2)} BTC)`);
      console.log(`Max Call OI Strike  : ${summary.maxCallOI.strike.toLocaleString('en-US')} (OI: ${summary.maxCallOI.oi.toFixed(2)} BTC)`);
      console.log(`PCR (Put/Call Ratio): ${summary.pcr.toFixed(2)}`);
      console.log(`ATM Average IV      : ${summary.averageIV.toFixed(1)}% (${summary.ivClassification})  [Call: ${(meta.atmCallIV * 100).toFixed(1)}%, Put: ${(meta.atmPutIV * 100).toFixed(1)}%]`);
      console.log(`Funding Rate        : ${summary.funding.rate.toFixed(4)}% (${summary.funding.sentiment})`);
      
      const fTime = new Date(summary.nextFunding.time);
      console.log(`Next Funding Time   : ${fTime.toLocaleString()} (in ${summary.nextFunding.remainingTime})`);
      console.log(`Max Pain Strike     : ${summary.maxPain.toLocaleString('en-US')}`);
      console.log('=========================');

      // ATM Greeks Summary
      console.log(`\nATM Greeks (Strike: ${summary.atmStrike.toLocaleString('en-US')}):`);
      console.log('-'.repeat(50));
      console.log(`${pad('Greek', 20, 'left')} ${pad('Call (CE)', 13)} ${pad('Put (PE)', 13)}`);
      console.log('-'.repeat(50));

      const greeks = ['delta', 'gamma', 'theta', 'vega', 'rho'];
      const atmC = meta.atmEntry.call || {};
      const atmP = meta.atmEntry.put || {};

      for (const gk of greeks) {
        const cVal = atmC[gk];
        const pVal = atmP[gk];

        const cStr = cVal !== null && cVal !== undefined ? (gk === 'gamma' ? cVal.toFixed(6) : cVal.toFixed(4)) : '-';
        const pStr = pVal !== null && pVal !== undefined ? (gk === 'gamma' ? pVal.toFixed(6) : pVal.toFixed(4)) : '-';

        const label = gk.charAt(0).toUpperCase() + gk.slice(1);
        console.log(`${pad(label, 20, 'left')} ${pad(cStr, 13)} ${pad(pStr, 13)}`);
      }
      console.log('-'.repeat(50));
      console.log('');

      if (!onlySummary) {
        console.log(`Option Chain Matrix (Expiry: ${meta.selectedExpiry} - ${meta.expiryDate.toDateString()} - ${formatDaysRemaining(meta.daysRemaining)}):`);
        renderOptionChainTable(meta.sortedStrikes, meta.strikesMap);
        console.log('\n* To inspect a specific strike price in detail with all Greeks, run:');
        console.log(`  node index.js ${meta.selectedExpiry} --strike <strike_price>`);
        console.log('* To view ONLY the Market Summary, run:');
        console.log(`  node index.js ${meta.selectedExpiry} --summary`);
      }
    }
  } catch (error) {
    console.error('Error in CLI main:', error.message);
  }
}

// Check if this script is executed directly as the entrypoint
const nodePath = path.resolve(process.argv[1] || '');
const modulePath = path.resolve(fileURLToPath(import.meta.url));

if (nodePath === modulePath) {
  main();
}
