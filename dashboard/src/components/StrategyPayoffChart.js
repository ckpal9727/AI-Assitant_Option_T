'use client';

import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

const StrategyPayoffChart = ({
  strategy,
  shortStrike,
  longStrike,
  shortStrike2,
  longStrike2,
  maxRisk,
  maxReward,
  breakeven,
  currentPrice
}) => {
  const chartData = useMemo(() => {
    if (!strategy || !currentPrice) return [];

    // Determine the center and range for the chart
    let minPrice = currentPrice * 0.8;
    let maxPrice = currentPrice * 1.2;

    const strikes = [shortStrike, longStrike, shortStrike2, longStrike2].filter(Boolean);
    if (strikes.length > 0) {
      const minStrike = Math.min(...strikes);
      const maxStrike = Math.max(...strikes);
      minPrice = minStrike * 0.9;
      maxPrice = maxStrike * 1.1;
    }

    const data = [];
    const steps = 100;
    const stepSize = (maxPrice - minPrice) / steps;

    for (let i = 0; i <= steps; i++) {
      const price = minPrice + i * stepSize;
      let pnl = 0;

      switch (strategy.toLowerCase()) {
        case 'bull put credit spread':
          if (price >= shortStrike) pnl = maxReward;
          else if (price <= longStrike) pnl = -maxRisk;
          else {
            // Linear transition
            pnl = -maxRisk + ((price - longStrike) / (shortStrike - longStrike)) * (maxRisk + maxReward);
          }
          break;
        case 'bear call credit spread':
          if (price <= shortStrike) pnl = maxReward;
          else if (price >= longStrike) pnl = -maxRisk;
          else {
            pnl = maxReward - ((price - shortStrike) / (longStrike - shortStrike)) * (maxRisk + maxReward);
          }
          break;
        case 'iron condor':
          // Assume shortStrike < shortStrike2 and longStrike < shortStrike and longStrike2 > shortStrike2
          // Example: long put, short put, short call, long call
          if (price >= shortStrike && price <= shortStrike2) {
            pnl = maxReward;
          } else if (price <= longStrike || price >= longStrike2) {
            pnl = -maxRisk;
          } else if (price < shortStrike && price > longStrike) {
            pnl = -maxRisk + ((price - longStrike) / (shortStrike - longStrike)) * (maxRisk + maxReward);
          } else if (price > shortStrike2 && price < longStrike2) {
            pnl = maxReward - ((price - shortStrike2) / (longStrike2 - shortStrike2)) * (maxRisk + maxReward);
          }
          break;
        case 'long call':
          if (price <= longStrike) pnl = -maxRisk;
          else pnl = -maxRisk + (price - longStrike);
          // Adjust if maxReward is set for a cap, usually undefined for long call
          break;
        case 'long put':
          if (price >= longStrike) pnl = -maxRisk;
          else pnl = -maxRisk + (longStrike - price);
          break;
        default:
          pnl = 0;
      }
      data.push({ price: Math.round(price), pnl: Number(pnl.toFixed(2)) });
    }
    return data;
  }, [strategy, shortStrike, longStrike, shortStrike2, longStrike2, maxRisk, maxReward, currentPrice]);

  const gradientOffset = () => {
    const dataMax = Math.max(...chartData.map((i) => i.pnl));
    const dataMin = Math.min(...chartData.map((i) => i.pnl));

    if (dataMax <= 0) return 0;
    if (dataMin >= 0) return 1;

    return dataMax / (dataMax - dataMin);
  };

  const off = useMemo(gradientOffset, [chartData]);

  if (!strategy || chartData.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-[300px] rounded-xl border border-slate-800 bg-[#0B0F19]/50 backdrop-blur-md shadow-xl">
        <p className="text-slate-400 font-medium">Select a strategy to view payoff diagram</p>
      </div>
    );
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const isProfit = payload[0].value >= 0;
      return (
        <div className="bg-[#0B0F19]/90 border border-slate-700 p-3 rounded-lg shadow-xl backdrop-blur-sm">
          <p className="text-slate-300 font-medium mb-1">Price: <span className="text-white">${label.toLocaleString()}</span></p>
          <p className={`font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            P&L: ${payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full flex flex-col p-5 rounded-2xl border border-slate-800/80 bg-[#0B0F19]/80 backdrop-blur-md shadow-2xl relative overflow-hidden group">
      {/* Decorative gradient blob */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl -z-10 group-hover:bg-cyan-500/10 transition-colors duration-700" />
      
      <div className="flex justify-between items-center mb-6 z-10">
        <h3 className="text-lg font-semibold text-slate-200 capitalize bg-clip-text text-transparent bg-gradient-to-r from-slate-200 to-slate-400">
          {strategy} Payoff
        </h3>
        {breakeven && (
          <div className="px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700/50">
            <span className="text-xs text-slate-400">Break-Even: </span>
            <span className="text-sm font-semibold text-slate-200">${breakeven}</span>
          </div>
        )}
      </div>

      <div className="w-full h-[280px] z-10">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset={off} stopColor="#10b981" stopOpacity={0.4} />
                <stop offset={off} stopColor="#f43f5e" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis 
              dataKey="price" 
              tick={{ fill: '#64748b', fontSize: 12 }} 
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(value) => `$${value}`}
            />
            <YAxis 
              tick={{ fill: '#64748b', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
            {currentPrice && (
              <ReferenceLine 
                x={currentPrice} 
                stroke="#06b6d4" 
                strokeDasharray="4 4"
                label={{ position: 'top', value: 'Spot', fill: '#06b6d4', fontSize: 12 }} 
              />
            )}
            {breakeven && (
              <ReferenceLine 
                x={breakeven} 
                stroke="#94a3b8" 
                strokeDasharray="2 2"
                label={{ position: 'bottom', value: 'B/E', fill: '#94a3b8', fontSize: 10 }}
              />
            )}
            <Area
              type="monotone"
              dataKey="pnl"
              stroke="url(#splitColor)"
              strokeWidth={3}
              fill="url(#splitColor)"
              activeDot={{ r: 6, fill: '#0ea5e9', stroke: '#0284c7', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 z-10">
        <div className="flex flex-col p-3 rounded-xl bg-slate-900/50 border border-slate-800/50">
          <span className="text-xs text-slate-500 mb-1 font-medium">Max Profit</span>
          <span className="text-lg font-bold text-emerald-400">
            {maxReward !== undefined ? `$${maxReward.toLocaleString()}` : 'Unlimited'}
          </span>
        </div>
        <div className="flex flex-col p-3 rounded-xl bg-slate-900/50 border border-slate-800/50">
          <span className="text-xs text-slate-500 mb-1 font-medium">Max Risk</span>
          <span className="text-lg font-bold text-rose-400">
            {maxRisk !== undefined ? `$${maxRisk.toLocaleString()}` : 'Unlimited'}
          </span>
        </div>
        <div className="flex flex-col p-3 rounded-xl bg-slate-900/50 border border-slate-800/50">
          <span className="text-xs text-slate-500 mb-1 font-medium">Break-Even</span>
          <span className="text-lg font-bold text-slate-300">
            {breakeven ? `$${breakeven.toLocaleString()}` : '-'}
          </span>
        </div>
        <div className="flex flex-col p-3 rounded-xl bg-slate-900/50 border border-slate-800/50">
          <span className="text-xs text-slate-500 mb-1 font-medium">Current Spot</span>
          <span className="text-lg font-bold text-cyan-400">
            {currentPrice ? `$${currentPrice.toLocaleString()}` : '-'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default StrategyPayoffChart;
