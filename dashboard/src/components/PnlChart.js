'use client';

import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';

export default function PnlChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl bg-slate-900/50 border border-slate-800 text-slate-500">
        No trade data available to plot P&L.
      </div>
    );
  }

  // Find min/max values for better Y-axis padding
  const pnlValues = data.map((d) => d.pnl);
  const minPnl = Math.min(...pnlValues, 0);
  const maxPnl = Math.max(...pnlValues, 100);
  const yPadding = (maxPnl - minPnl) * 0.1 || 10;

  // Check if overall performance is positive or negative for colors
  const isNetPositive = data[data.length - 1]?.pnl >= 0;
  const strokeColor = isNetPositive ? '#10B981' : '#F43F5E';
  const fillColor = isNetPositive ? 'url(#colorPnlGreen)' : 'url(#colorPnlRed)';

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorPnlGreen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
            </linearGradient>
            <linearGradient id="colorPnlRed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
          <XAxis
            dataKey="name"
            stroke="#64748B"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#64748B"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            domain={[minPnl - yPadding, maxPnl + yPadding]}
            tickFormatter={(value) => `$${value}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0F172A',
              borderColor: '#334155',
              borderRadius: '8px',
              color: '#F8FAFC'
            }}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Cumulative P&L']}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Area
            type="monotone"
            dataKey="pnl"
            stroke={strokeColor}
            strokeWidth={2}
            fillOpacity={1}
            fill={fillColor}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
