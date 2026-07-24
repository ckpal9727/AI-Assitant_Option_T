'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Activity, 
  RotateCw, 
  Plus, 
  X, 
  Check, 
  Settings, 
  AlertCircle, 
  Trash2,
  BookOpen,
  HelpCircle,
  Percent,
  Calendar,
  Layers,
  Sparkles,
  Send,
  MessageSquare,
  Bot,
  Eye,
  FileText,
  Clock,
  Brain,
  ArrowUpDown,
  Crosshair,
  PenLine,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Bell
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import PriceAlertModal from '../components/PriceAlertModal';

// Utility to parse currency values
function parseCurrency(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Dynamically import the charts to avoid SSR/hydration issues
const PnlChart = dynamic(() => import('../components/PnlChart'), { ssr: false });
const StrategyPayoffChart = dynamic(() => import('../components/StrategyPayoffChart'), { ssr: false });

const DEMO_TRADES = [
  {
    id: -1,
    date: '2026-07-10',
    market_state: 'Trending Up',
    strategy: 'Bull Put Credit Spread',
    reason: 'BTC holding strong above 65,000 support, high ATM put open interest.',
    risk: 100.00,
    reward: 25.00,
    result: 'Profit +$25.00',
    pnl: 25.00,
    lessons: 'Entered spread at 62k/61k strike, perfect support hold.'
  },
  {
    id: -2,
    date: '2026-07-11',
    market_state: 'Range Bound',
    strategy: 'Iron Condor',
    reason: 'Consolidating near 66,500. IV elevated at 54% due to weekend lull.',
    risk: 150.00,
    reward: 45.00,
    result: 'Profit +$45.00',
    pnl: 45.00,
    lessons: 'Theta decay worked beautifully over Saturday-Sunday.'
  },
  {
    id: -3,
    date: '2026-07-13',
    market_state: 'Trending Down',
    strategy: 'Bear Call Credit Spread',
    reason: 'Rejected at 68,000 resistance. Max pain at 66,000.',
    risk: 100.00,
    reward: 30.00,
    result: 'Loss -$100.00',
    pnl: -100.00,
    lessons: 'BTC spiked unexpectedly on funding rate squeeze. Watch stop-loss.'
  },
  {
    id: -4,
    date: '2026-07-14',
    market_state: 'Breakout',
    strategy: 'Bull Put Credit Spread',
    reason: 'Broke out above 67k, funding rate positive, bullish bias.',
    risk: 120.00,
    reward: 30.00,
    result: 'Pending',
    pnl: null,
    lessons: '',
    legs: [
      {
        symbol: 'P-BTC-62000-170726',
        strike: 62000,
        type: 'P',
        action: 'sell',
        entry_price: 15.00,
        quantity: 2
      },
      {
        symbol: 'P-BTC-61000-170726',
        strike: 61000,
        type: 'P',
        action: 'buy',
        entry_price: 10.00,
        quantity: 2
      }
    ]
  }
];

const DEMO_PROFILE = {
  capital: 50000,
  riskTolerance: 0.02,
  minRR: 0.15,
  preferredExpiry: 'Weekly',
  preferredStrategies: ['Bull Put Spread', 'Iron Condor'],
  notes: 'Personal portfolio, targeting options spreads with probability of profit > 70%.'
};

function LivePnlValue({ value, isHeaderCard = false }) {
  const prevValueRef = useRef(value);
  const [flashClass, setFlashClass] = useState('');

  useEffect(() => {
    const prevValue = prevValueRef.current;
    if (value !== prevValue && prevValue !== undefined && value !== undefined) {
      if (value > prevValue) {
        setFlashClass('bg-emerald-500/25 text-emerald-300 font-bold scale-105 px-1 py-0.5 rounded transition-all duration-300');
      } else if (value < prevValue) {
        setFlashClass('bg-rose-500/25 text-rose-300 font-bold scale-105 px-1 py-0.5 rounded transition-all duration-300');
      }
      prevValueRef.current = value;

      const timer = setTimeout(() => {
        setFlashClass('');
      }, 800);

      return () => clearTimeout(timer);
    } else {
      prevValueRef.current = value;
    }
  }, [value]);

  const displayVal = value !== null && value !== undefined ? value : 0;
  const formattedVal = (displayVal >= 0 ? '+' : '') + '$' + displayVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const colorClass = displayVal >= 0 ? 'text-emerald-400 font-mono font-semibold' : 'text-rose-500 font-mono font-semibold';

  if (isHeaderCard) {
    return (
      <span className={`inline-block transition-all duration-500 transform ${flashClass || colorClass}`}>
        {formattedVal}
      </span>
    );
  }

  return (
    <span className={`text-[11px] font-bold transition-all duration-500 transform ${flashClass || colorClass}`}>
      {formattedVal}
    </span>
  );
}

function getTradeUnrealizedPnL(trade, liveTickers) {
  if (!trade.legs || trade.legs.length === 0) return 0;
  let tradePnL = 0;
  for (const leg of trade.legs) {
    const ticker = liveTickers[leg.symbol];
    if (ticker && ticker.markPrice !== null && ticker.markPrice !== undefined) {
      const multiplier = leg.action === 'buy' ? 1 : -1;
      tradePnL += multiplier * (ticker.markPrice - leg.entry_price) * (leg.quantity || 1);
    }
  }
  return tradePnL;
}

export default function Dashboard() {
  const [trades, setTrades] = useState([]);
  const [profile, setProfile] = useState(DEMO_PROFILE);
  const [marketSummary, setMarketSummary] = useState(null);
  const [liveTickers, setLiveTickers] = useState({});
  const [selectedInspectTrade, setSelectedInspectTrade] = useState(null);
  
  // Running notes & post-trade review states
  const [runningNoteInput, setRunningNoteInput] = useState('');
  const [postTradeReview, setPostTradeReview] = useState(null);
  const [generatingReview, setGeneratingReview] = useState(false);
  const [inspectTab, setInspectTab] = useState('overview'); // 'overview' | 'notes' | 'review'
  
  // Loading states
  const [loadingTrades, setLoadingTrades] = useState(true);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const [refreshingMarket, setRefreshingMarket] = useState(false);
  const [isDemo, setIsDemo] = useState(true);

  // Modals / Panels
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);

  // AI Chat states
  const [chatMessages, setChatMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I am your AI Options Trading Assistant. I can check real-time price feeds, analyze Greeks from Delta Exchange, calculate spreads, validate risk limits, and log trades to your journal.\n\nClick one of the quick actions on the left or type your query below to get started!'
    }
  ]);
  const [promptInput, setPromptInput] = useState('');
  const [sendingPrompt, setSendingPrompt] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatBottomRef = useRef(null);

  // Form states
  const [newTrade, setNewTrade] = useState({
    date: new Date().toISOString().split('T')[0],
    market_state: 'Range Bound',
    strategy: 'Bull Put Credit Spread',
    reason: '',
    risk: '',
    reward: '',
    result: 'Pending',
    lessons: '',
    legs: [],
    legsText: '',
    // Enhanced market view fields
    trendDirection4H: 'Side Base',
    swingForecast: 'Stay Between Price',
    supportLevel: '',
    resistanceLevel: '',
    entryPrice: '',
    traderRationale: ''
  });
  
  const [profileForm, setProfileForm] = useState({
    capital: '',
    riskTolerance: '',
    minRR: '',
    preferredExpiry: '',
    preferredStrategies: '',
    notes: ''
  });

  const hasSupabase = !!supabase;

  // Load initial data
  useEffect(() => {
    async function init() {
      if (hasSupabase) {
        setIsDemo(false);
        await Promise.all([fetchTradesFromDB(), fetchProfileFromDB()]);
      } else {
        setIsDemo(true);
        await Promise.all([fetchLocalTrades(), fetchLocalProfile()]);
      }
      await fetchMarketData();
    }
    init();
  }, [hasSupabase]);

  // Scroll to bottom of chat when new messages arrive
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, sendingPrompt]);

  // Poll live tickers for real-time P&L tracking
  useEffect(() => {
    let intervalId;
    async function fetchLiveTickers() {
      try {
        const res = await fetch('/api/tickers');
        const data = await res.json();
        if (data.success && data.tickers) {
          setLiveTickers(data.tickers);
          if (data.hasNewAutoTrade) {
            if (hasSupabase) {
              fetchTradesFromDB();
            } else {
              fetchLocalTrades();
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch live tickers:', err);
      }
    }

    fetchLiveTickers();
    intervalId = setInterval(fetchLiveTickers, 2000); // Poll every 2 seconds

    return () => clearInterval(intervalId);
  }, []);

  // Local File CRUD Functions (when Supabase is disabled)
  async function fetchLocalTrades() {
    try {
      setLoadingTrades(true);
      const res = await fetch('/api/trades');
      const data = await res.json();
      if (data.success) {
        setTrades(data.trades || []);
      } else {
        setTrades(DEMO_TRADES);
      }
    } catch (e) {
      console.error('Failed to fetch local trades:', e);
      setTrades(DEMO_TRADES);
    } finally {
      setLoadingTrades(false);
    }
  }

  async function fetchLocalProfile() {
    try {
      const res = await fetch('/api/profile');
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile({
          capital: Number(data.profile.capital) || 500,
          riskTolerance: Number(data.profile.riskTolerance) || 0.02,
          minRR: Number(data.profile.minRR) || 0.20,
          preferredExpiry: data.profile.preferredExpiry || 'Weekly',
          preferredStrategies: data.profile.preferredStrategies || [],
          notes: data.profile.notes || ''
        });
      }
    } catch (e) {
      console.error('Failed to fetch local profile:', e);
    }
  }

  // DB Fetching Functions
  async function fetchTradesFromDB() {
    try {
      setLoadingTrades(true);
      const { data, error } = await supabase
        .from('trade_journal')
        .select('*')
        .order('date', { ascending: false })
        .order('id', { ascending: false });

      if (error) throw error;
      setTrades(data || []);
    } catch (e) {
      console.error('Failed to fetch trades:', e.message);
      setTrades(DEMO_TRADES);
      setIsDemo(true);
    } finally {
      setLoadingTrades(false);
    }
  }

  async function fetchProfileFromDB() {
    try {
      const { data, error } = await supabase
        .from('user_profile')
        .select('*')
        .eq('key', 'default')
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setProfile({
          capital: Number(data.capital),
          riskTolerance: Number(data.risk_tolerance),
          minRR: Number(data.min_rr),
          preferredExpiry: data.preferred_expiry || 'Weekly',
          preferredStrategies: data.preferred_strategies || [],
          notes: data.notes || ''
        });
      }
    } catch (e) {
      console.error('Failed to fetch user profile:', e.message);
    }
  }

  async function fetchMarketData() {
    try {
      setRefreshingMarket(true);
      const res = await fetch('/api/market');
      const data = await res.json();
      if (data.success && data.summary) {
        setMarketSummary(data.summary);
      }
    } catch (e) {
      console.error('Failed to fetch market summary:', e);
    } finally {
      setLoadingMarket(false);
      setRefreshingMarket(false);
    }
  }

  // AI Chat handler
  async function sendPrompt(customText) {
    const text = customText || promptInput;
    if (!text.trim() || sendingPrompt) return;

    setPromptInput('');
    setChatError('');
    setSendingPrompt(true);

    const userMessage = { role: 'user', content: text };
    const updatedMessages = [...chatMessages, userMessage];
    setChatMessages(updatedMessages);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages })
      });

      const data = await res.json();
      if (data.success) {
        setChatMessages([...updatedMessages, { role: 'assistant', content: data.message }]);
        
        // Auto-refresh tables if agent performed operations
        if (data.loggedTrade) {
          if (!isDemo) {
            await fetchTradesFromDB();
          } else {
            await fetchLocalTrades();
          }
        }
        if (data.profileUpdated) {
          if (!isDemo) {
            await fetchProfileFromDB();
          } else {
            await fetchLocalProfile();
          }
        }
      } else {
        setChatError(data.error || 'Failed to get a response from the assistant.');
      }
    } catch (err) {
      setChatError('Communication error: ' + err.message);
    } finally {
      setSendingPrompt(false);
    }
  }

  // Database mutations
  async function handleAddTrade(e) {
    e.preventDefault();
    const riskNum = parseFloat(newTrade.risk);
    const rewardNum = parseFloat(newTrade.reward);

    if (isNaN(riskNum) || isNaN(rewardNum)) {
      alert('Risk and Reward must be valid numbers.');
      return;
    }

    const tradeToSave = {
      date: newTrade.date,
      market_state: newTrade.market_state,
      strategy: newTrade.strategy,
      reason: newTrade.reason,
      risk: riskNum,
      reward: rewardNum,
      result: newTrade.result,
      lessons: newTrade.lessons,
      pnl: (newTrade.result && (newTrade.result.includes('Profit') || newTrade.result.includes('Loss')))
        ? (newTrade.result.includes('Profit') ? rewardNum : -riskNum)
        : null,
      legs: newTrade.legs || [],
      entry_factors: marketSummary ? {
        btcPrice: marketSummary.btcPrice || null,
        averageIV: marketSummary.averageIV || null,
        ivClassification: marketSummary.ivClassification || null,
        support: marketSummary.support || null,
        resistance: marketSummary.resistance || null,
        chartSupport: marketSummary.chartSupport || null,
        chartResistance: marketSummary.chartResistance || null,
        chartTrend: marketSummary.chartTrend || null,
        pcr: marketSummary.pcr || null,
        fundingRate: marketSummary.funding?.rate !== undefined ? marketSummary.funding.rate : null,
        fundingSentiment: marketSummary.funding?.sentiment || null,
        signalsAligned: marketSummary.confidenceInputs?.signalsAligned || 0,
        signalsConflicting: marketSummary.confidenceInputs?.signalsConflicting || 0
      } : null,
      market_view: {
        trendDirection4H: newTrade.trendDirection4H || 'Side Base',
        swingForecast: newTrade.swingForecast || 'Stay Between Price',
        supportLevel: parseFloat(newTrade.supportLevel) || null,
        resistanceLevel: parseFloat(newTrade.resistanceLevel) || null,
        entryPrice: parseFloat(newTrade.entryPrice) || null,
        traderRationale: newTrade.traderRationale || ''
      },
      running_notes: [],
      post_trade_review: null
    };

    if (isDemo) {
      try {
        const res = await fetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tradeToSave)
        });
        const data = await res.json();
        if (data.success) {
          setTrades(data.trades);
        } else {
          alert('Log trade failed: ' + data.error);
        }
      } catch (err) {
        alert('Communication error: ' + err.message);
      }
    } else {
      try {
        const { error } = await supabase
          .from('trade_journal')
          .insert([tradeToSave]);
        if (error) throw error;
        await fetchTradesFromDB();
      } catch (err) {
        alert('DB Write Error: ' + err.message);
      }
    }

    setShowAddModal(false);
    setNewTrade({
      date: new Date().toISOString().split('T')[0],
      market_state: 'Range Bound',
      strategy: 'Bull Put Credit Spread',
      reason: '',
      risk: '',
      reward: '',
      result: 'Pending',
      lessons: '',
      legs: [],
      legsText: '',
      trendDirection4H: 'Side Base',
      swingForecast: 'Stay Between Price',
      supportLevel: '',
      resistanceLevel: '',
      entryPrice: '',
      traderRationale: ''
    });
  }

  async function handleUpdateResult(id, outcome) {
    const trade = trades.find(t => t.id === id);
    if (!trade) return;

    let resultString = '';
    let pnlValue = null;

    if (outcome === 'win') {
      const rewardVal = parseCurrency(trade.reward);
      resultString = `Profit +$${rewardVal.toFixed(2)}`;
      pnlValue = rewardVal;
    } else if (outcome === 'loss') {
      const riskVal = parseCurrency(trade.risk);
      resultString = `Loss -$${riskVal.toFixed(2)}`;
      pnlValue = -riskVal;
    } else {
      resultString = 'Pending';
      pnlValue = null;
    }

    if (isDemo) {
      try {
        const updatedTrade = { ...trade, result: resultString, pnl: pnlValue };
        const res = await fetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedTrade)
        });
        const data = await res.json();
        if (data.success) {
          setTrades(data.trades);
        }
      } catch (err) {
        console.error('Failed to update trade locally:', err);
      }
    } else {
      try {
        const { error } = await supabase
          .from('trade_journal')
          .update({ result: resultString, pnl: pnlValue })
          .eq('id', id);

        if (error) throw error;
        await fetchTradesFromDB();
      } catch (err) {
        alert('DB Update Error: ' + err.message);
      }
    }
  }

  async function handleDeleteTrade(id) {
    if (!confirm('Are you sure you want to delete this trade?')) return;

    if (isDemo) {
      try {
        const res = await fetch(`/api/trades?id=${id}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          setTrades(data.trades);
        } else {
          alert('Delete failed: ' + data.error);
        }
      } catch (err) {
        alert('Communication error: ' + err.message);
      }
    } else {
      try {
        const { error } = await supabase
          .from('trade_journal')
          .delete()
          .eq('id', id);
        
        if (error) throw error;
        await fetchTradesFromDB();
      } catch (err) {
        alert('DB Delete Error: ' + err.message);
      }
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    const capNum = parseFloat(profileForm.capital);
    const rtNum = parseFloat(profileForm.riskTolerance);
    const minRRNum = parseFloat(profileForm.minRR);

    if (isNaN(capNum) || isNaN(rtNum) || isNaN(minRRNum)) {
      alert('Capital, Risk Tolerance, and Min R/R must be valid numbers.');
      return;
    }

    const updatedProfile = {
      capital: capNum,
      riskTolerance: rtNum,
      minRR: minRRNum,
      preferredExpiry: profileForm.preferredExpiry,
      preferredStrategies: profileForm.preferredStrategies.split(',').map(s => s.trim()).filter(Boolean),
      notes: profileForm.notes
    };

    if (isDemo) {
      try {
        const res = await fetch('/api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedProfile)
        });
        const data = await res.json();
        if (data.success) {
          setProfile(data.profile);
        }
      } catch (err) {
        console.error('Failed to save settings locally:', err);
      }
    } else {
      try {
        const dbProfile = {
          capital: updatedProfile.capital,
          risk_tolerance: updatedProfile.riskTolerance,
          min_rr: updatedProfile.minRR,
          preferred_expiry: updatedProfile.preferredExpiry,
          preferred_strategies: updatedProfile.preferredStrategies,
          notes: updatedProfile.notes,
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase
          .from('user_profile')
          .upsert({ key: 'default', ...dbProfile }, { onConflict: 'key' });

        if (error) throw error;
        setProfile(updatedProfile);
      } catch (err) {
        alert('DB Update Profile Error: ' + err.message);
      }
    }
    setShowSettingsModal(false);
  }

  const openSettings = () => {
    setProfileForm({
      capital: profile.capital,
      riskTolerance: profile.riskTolerance,
      minRR: profile.minRR,
      preferredExpiry: profile.preferredExpiry,
      preferredStrategies: profile.preferredStrategies.join(', '),
      notes: profile.notes
    });
    setShowSettingsModal(true);
  };

  // â”€â”€ Running Notes Handler â”€â”€
  async function handleAddRunningNote(tradeId) {
    if (!runningNoteInput.trim()) return;
    const timestamp = new Date().toISOString();
    const note = { timestamp, text: runningNoteInput.trim() };
    
    const trade = trades.find(t => t.id === tradeId);
    if (!trade) return;
    
    const existingNotes = trade.running_notes || [];
    const updatedNotes = [...existingNotes, note];
    
    if (isDemo) {
      setTrades(trades.map(t => t.id === tradeId ? { ...t, running_notes: updatedNotes } : t));
      setSelectedInspectTrade(prev => prev ? { ...prev, running_notes: updatedNotes } : prev);
    } else {
      try {
        const { error } = await supabase
          .from('trade_journal')
          .update({ running_notes: updatedNotes })
          .eq('id', tradeId);
        if (error) throw error;
        await fetchTradesFromDB();
        setSelectedInspectTrade(prev => prev ? { ...prev, running_notes: updatedNotes } : prev);
      } catch (err) {
        alert('Failed to add note: ' + err.message);
      }
    }
    setRunningNoteInput('');
  }

  // â”€â”€ View Comparison Update â”€â”€
  async function handleUpdateViewCorrectness(tradeId, field, value) {
    const trade = trades.find(t => t.id === tradeId);
    if (!trade) return;

    const currentReview = trade.post_trade_review || {};
    const updatedReview = { ...currentReview, [field]: value };

    if (isDemo) {
      setTrades(trades.map(t => t.id === tradeId ? { ...t, post_trade_review: updatedReview } : t));
      setSelectedInspectTrade(prev => prev ? { ...prev, post_trade_review: updatedReview } : prev);
    } else {
      try {
        const { error } = await supabase
          .from('trade_journal')
          .update({ post_trade_review: updatedReview })
          .eq('id', tradeId);
        if (error) throw error;
        await fetchTradesFromDB();
        setSelectedInspectTrade(prev => prev ? { ...prev, post_trade_review: updatedReview } : prev);
      } catch (err) {
        alert('Failed to update view: ' + err.message);
      }
    }
  }

  // â”€â”€ AI Post-Mortem Review Generator â”€â”€
  async function handleGeneratePostMortem(trade) {
    setGeneratingReview(true);
    setPostTradeReview(null);
    try {
      const res = await fetch('/api/trade-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade: {
            date: trade.date,
            strategy: trade.strategy,
            market_state: trade.market_state,
            risk: trade.risk,
            reward: trade.reward,
            result: trade.result,
            pnl: trade.pnl,
            lessons: trade.lessons,
            legs: trade.legs,
            entry_factors: trade.entry_factors,
            market_view: trade.market_view,
            running_notes: trade.running_notes,
            post_trade_review: trade.post_trade_review
          }
        })
      });
      const data = await res.json();
      if (data.success && data.review) {
        setPostTradeReview(data.review);
        // Also save the AI review to the trade record
        const currentReview = trade.post_trade_review || {};
        const updatedReview = { ...currentReview, aiPostMortem: data.review, aiReviewDate: new Date().toISOString() };
        if (isDemo) {
          setTrades(prev => prev.map(t => t.id === trade.id ? { ...t, post_trade_review: updatedReview } : t));
          setSelectedInspectTrade(prev => prev ? { ...prev, post_trade_review: updatedReview } : prev);
        } else {
          try {
            await supabase
              .from('trade_journal')
              .update({ post_trade_review: updatedReview })
              .eq('id', trade.id);
            await fetchTradesFromDB();
            setSelectedInspectTrade(prev => prev ? { ...prev, post_trade_review: updatedReview } : prev);
          } catch (e) {
            console.error('Failed to save AI review:', e);
          }
        }
      } else {
        setPostTradeReview('Failed to generate review: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      setPostTradeReview('Error communicating with review API: ' + err.message);
    } finally {
      setGeneratingReview(false);
    }
  }

  // Markdown Parser
  function parseInlineBold(text) {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={idx} className="text-slate-100 font-bold">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }

  function renderMarkdown(text) {
    if (!text) return null;
    const lines = text.split('\n');
    let inCodeBlock = false;
    let codeLines = [];

    return lines.map((line, idx) => {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          inCodeBlock = false;
          const codeText = codeLines.join('\n');
          codeLines = [];
          return (
            <pre key={idx} className="bg-slate-950 border border-slate-900 rounded-lg p-3.5 font-mono text-xs text-slate-350 my-3 overflow-x-auto select-text">
              <code>{codeText}</code>
            </pre>
          );
        } else {
          inCodeBlock = true;
          return null;
        }
      }

      if (inCodeBlock) {
        codeLines.push(line);
        return null;
      }

      if (line.startsWith('### ')) {
        return <h4 key={idx} className="text-sm font-bold text-cyan-400 mt-4 mb-2">{parseInlineBold(line.slice(4))}</h4>;
      }
      if (line.startsWith('## ')) {
        return <h3 key={idx} className="text-base font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-300 mt-6 mb-3 border-b border-slate-800 pb-1">{parseInlineBold(line.slice(3))}</h3>;
      }
      if (line.startsWith('# ')) {
        return <h2 key={idx} className="text-lg font-bold text-slate-100 mt-6 mb-4">{parseInlineBold(line.slice(2))}</h2>;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <li key={idx} className="ml-4 list-disc text-slate-300 my-1 leading-relaxed">
            {parseInlineBold(line.slice(2))}
          </li>
        );
      }

      if (line.trim() === '') {
        return <div key={idx} className="h-2" />;
      }

      return (
        <p key={idx} className="text-slate-300 my-1 leading-relaxed">
          {parseInlineBold(line)}
        </p>
      );
    });
  }

  // P&L Calculations
  const resolvedTrades = trades.filter(t => t.result && (t.result.toLowerCase().includes('profit') || t.result.toLowerCase().includes('loss')));
  const totalPnL = resolvedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
  const winCount = resolvedTrades.filter(t => (t.pnl || 0) > 0).length;
  const winRate = resolvedTrades.length > 0 ? (winCount / resolvedTrades.length) * 100 : 0;

  const activeTrades = trades.filter(t => !t.result || t.result === 'Pending' || (!t.result.toLowerCase().includes('profit') && !t.result.toLowerCase().includes('loss')));
  const pendingCount = activeTrades.length;
  const netUnrealizedPnL = activeTrades.reduce((acc, t) => {
    if (!t.legs || t.legs.length === 0) return acc;
    let tradePnL = 0;
    for (const leg of t.legs) {
      const ticker = liveTickers[leg.symbol];
      if (ticker && ticker.markPrice !== null && ticker.markPrice !== undefined) {
        const multiplier = leg.action === 'buy' ? 1 : -1;
        tradePnL += multiplier * (ticker.markPrice - leg.entry_price) * (leg.quantity || 1);
      }
    }
    return acc + tradePnL;
  }, 0);

  const chronologicalTrades = [...trades]
    .filter(t => t.result && (t.result.toLowerCase().includes('profit') || t.result.toLowerCase().includes('loss')))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let currentSum = 0;
  const chartData = chronologicalTrades.map((t) => {
    currentSum += (t.pnl || 0);
    return {
      name: t.date,
      pnl: parseFloat(currentSum.toFixed(2))
    };
  });

  return (
    <main className="flex-1 bg-[#090D16] text-[#F1F5F9] font-sans antialiased min-h-screen">
      {/* Top Banner if in Demo Mode */}
      {isDemo && (
        <div className="bg-gradient-to-r from-amber-600/20 to-orange-500/20 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-400 shrink-0" />
            <span>
              <strong>Demo/Mock Mode Active.</strong> To connect your real live journal, create a Supabase project and set <code className="bg-black/40 px-1 py-0.5 rounded text-amber-200">NEXT_PUBLIC_SUPABASE_URL</code> & <code className="bg-black/40 px-1 py-0.5 rounded text-amber-200">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code className="bg-black/40 px-1.5 py-0.5 rounded font-mono">dashboard/.env.local</code>.
            </span>
          </div>
          <button 
            onClick={() => {
              if (hasSupabase) {
                setIsDemo(false);
                fetchTradesFromDB();
                fetchProfileFromDB();
              } else {
                alert('No Supabase credentials detected in environment variables.');
              }
            }}
            className="hover:underline font-bold text-amber-200 ml-4 cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Main Header */}
      <header className="border-b border-slate-900 bg-[#0B0F19]/90 backdrop-blur sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 bg-gradient-to-tr from-cyan-500 to-indigo-500 rounded-lg flex items-center justify-center font-bold text-black shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            Î”
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-300">
              DELTA EXCH AI ASSISTANT
            </h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Options Trading Journal</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-800 bg-slate-900/60 px-2.5 py-1 rounded-full">
            <span className={`h-2 w-2 rounded-full ${isDemo ? 'bg-indigo-400 animate-pulse' : 'bg-emerald-500'}`} />
            {isDemo ? 'Local File DB' : 'Supabase Live'}
          </span>

          <button
            onClick={() => {
              if (!isDemo) {
                fetchTradesFromDB();
              } else {
                fetchLocalTrades();
              }
              fetchMarketData();
            }}
            disabled={refreshingMarket}
            className="p-2 border border-slate-800 bg-[#161C2C]/50 hover:bg-[#1C253B] rounded-lg transition text-slate-400 hover:text-white"
            title="Refresh Data"
          >
            <RotateCw size={16} className={refreshingMarket ? 'animate-spin text-cyan-400' : ''} />
          </button>

          <button
            onClick={() => setShowAlertModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 rounded-lg transition cursor-pointer shadow-sm shadow-emerald-500/10"
            title="Configure Telegram Price Alerts"
          >
            <Bell size={14} className="text-emerald-400 animate-pulse" />
            <span>Telegram Alerts</span>
          </button>

          <button
            onClick={openSettings}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 border border-slate-800 bg-[#161C2C]/50 hover:bg-[#1C253B] rounded-lg transition text-slate-300"
          >
            <Settings size={14} />
            <span>Profile Settings</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 text-xs font-bold px-3 py-2 bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-black rounded-lg transition shadow-md shadow-cyan-500/10 cursor-pointer"
          >
            <Plus size={14} />
            <span>Log Trade</span>
          </button>
        </div>
      </header>

      {/* Dashboard Body */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Core Stats Overview */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Total Profit */}
          <div className="bg-[#121824]/60 backdrop-blur border border-slate-800/80 rounded-xl p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 text-slate-400 group-hover:scale-110 transition duration-300">
              <DollarSign size={48} />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Net P&L (Closed)</p>
            <h3 className={`text-2xl font-bold tracking-tight drop-shadow-md ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h3>
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
              {totalPnL >= 0 ? (
                <span className="text-emerald-400 flex items-center font-semibold"><TrendingUp size={10} /> Positive Return</span>
              ) : (
                <span className="text-rose-500 flex items-center font-semibold"><TrendingDown size={10} /> Net Loss</span>
              )}
              across all resolved trades
            </p>
          </div>

          {/* Card 2: Win Rate */}
          <div className="bg-[#121824]/60 backdrop-blur border border-slate-800/80 rounded-xl p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 text-slate-400 group-hover:scale-110 transition duration-300">
              <Percent size={48} />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Win Rate</p>
            <h3 className="text-2xl font-bold tracking-tight text-cyan-400">
              {winRate.toFixed(1)}%
            </h3>
            <p className="text-[10px] text-slate-500 mt-2">
              <span className="text-slate-300 font-semibold">{winCount} wins</span> out of {resolvedTrades.length} trades closed
            </p>
          </div>

          {/* Card 3: Total Trades */}
          <div className="bg-[#121824]/60 backdrop-blur border border-slate-800/80 rounded-xl p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 text-slate-400 group-hover:scale-110 transition duration-300">
              <Layers size={48} />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Journal Status</p>
            <h3 className="text-2xl font-bold tracking-tight text-indigo-400">
              {trades.length} Total
            </h3>
            <p className="text-[10px] text-slate-500 mt-2">
              <span className="text-slate-300 font-semibold">{pendingCount} active pending</span> trades to resolve
            </p>
          </div>

          {/* Card 4: Sizing limit */}
          <div className="bg-[#121824]/60 backdrop-blur border border-slate-800/80 rounded-xl p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 text-slate-400 group-hover:scale-110 transition duration-300">
              <Activity size={48} />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Max Risk per Trade</p>
            <h3 className="text-2xl font-bold tracking-tight text-purple-400">
              ${(profile.capital * profile.riskTolerance).toLocaleString('en-US')}
            </h3>
            <p className="text-[10px] text-slate-500 mt-2">
              Based on <span className="text-slate-300 font-semibold">${profile.capital.toLocaleString()}</span> cap @ <span className="text-slate-300 font-semibold">{(profile.riskTolerance * 100).toFixed(1)}%</span> risk limit
            </p>
          </div>

          {/* Card 5: Live Unrealized P&L */}
          <div className="bg-[#121824]/60 backdrop-blur border border-slate-800/80 rounded-xl p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 text-slate-400 group-hover:scale-110 transition duration-300">
              <TrendingUp size={48} className={netUnrealizedPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'} />
            </div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Unrealized P&L (Live)</p>
            <h3 className="text-2xl font-bold tracking-tight">
              <LivePnlValue value={netUnrealizedPnL} isHeaderCard={true} />
            </h3>
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
              {netUnrealizedPnL >= 0 ? (
                <span className="text-emerald-400 flex items-center font-semibold"><TrendingUp size={10} /> Positive Return</span>
              ) : (
                <span className="text-rose-500 flex items-center font-semibold"><TrendingDown size={10} /> Net Loss</span>
              )}
              across {pendingCount} open positions
            </p>
          </div>
        </section>

        {/* Chart & Profile Settings Section */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* P&L Performance Graph */}
          <div className="bg-[#0B0F19]/70 backdrop-blur border border-slate-850 rounded-xl p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Cumulative Profit Curve ($)</h3>
              <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded">Real-time</span>
            </div>
            <PnlChart data={chartData} />
          </div>

          {/* User Profile Settings Card */}
          <div className="bg-[#0B0F19]/70 backdrop-blur border border-slate-850 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-1.5">
                <BookOpen size={16} className="text-cyan-400" />
                <span>AI Agent Memory Profile</span>
              </h3>
              
              <div className="space-y-3.5 text-sm">
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Active Capital:</span>
                  <span className="font-semibold text-slate-200">${profile.capital.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Risk Tolerance:</span>
                  <span className="font-semibold text-slate-200">{(profile.riskTolerance * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Min Risk/Reward:</span>
                  <span className="font-semibold text-slate-200">{profile.minRR}</span>
                </div>
                <div className="flex justify-between border-b border-slate-900 pb-2">
                  <span className="text-slate-400">Preferred Expiry:</span>
                  <span className="font-semibold text-slate-200">{profile.preferredExpiry}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Preferred Strategies:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.preferredStrategies.map((s, i) => (
                      <span key={i} className="text-[10px] font-semibold bg-slate-900 border border-slate-800 text-indigo-400 px-2 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-900">
              <p className="text-[10px] text-slate-500 italic">
                "{profile.notes || 'No notes saved.'}"
              </p>
            </div>
          </div>
        </section>

        {/* AI Trading Assistant Section */}
        <section className="bg-[#0B0F19]/70 backdrop-blur border border-slate-850 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6 border-b border-slate-900 pb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-350 flex items-center gap-1.5">
              <Bot size={18} className="text-cyan-400 animate-pulse" />
              <span>Interactive AI Trading Assistant</span>
            </h3>
            <span className="text-xs text-slate-500 font-semibold flex items-center gap-1">
              <Sparkles size={12} className="text-indigo-400" /> Options reasoning agent
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Quick Actions Panel */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">AI Agent Cockpit</h4>
                <p className="text-xs text-slate-500 leading-relaxed mb-4">
                  Deploy the Options reasoning agent directly from your dashboard. It scans live Delta Exchange quotes, computes greeks, builds strategy candidates, and evaluates lot sizes.
                </p>

                <div className="space-y-2">
                  <button
                    onClick={() => sendPrompt("Please analyze the current BTC market state and option chain, validate the candidates, and recommend the best strategy based on my profile.")}
                    disabled={sendingPrompt}
                    className="w-full text-left text-xs font-semibold px-3 py-2.5 border border-slate-800 hover:border-cyan-500/50 bg-[#161C2C]/30 hover:bg-[#1C253B]/50 rounded-lg transition text-cyan-400 flex items-center justify-between group cursor-pointer"
                  >
                    <span>âœ¨ Recommend Options Strategy</span>
                    <Plus size={12} className="opacity-0 group-hover:opacity-100 transition" />
                  </button>

                  <button
                    onClick={() => sendPrompt("Analyze the ATM options Greeks, IV levels, and funding rate to explain the current market bias.")}
                    disabled={sendingPrompt}
                    className="w-full text-left text-xs font-semibold px-3 py-2.5 border border-slate-800 hover:border-indigo-500/50 bg-[#161C2C]/30 hover:bg-[#1C253B]/50 rounded-lg transition text-indigo-400 flex items-center justify-between group cursor-pointer"
                  >
                    <span>ðŸ“Š Explain ATM Greeks & Bias</span>
                    <Plus size={12} className="opacity-0 group-hover:opacity-100 transition" />
                  </button>

                  <button
                    onClick={() => sendPrompt("Show my trade journal history and analyze if my risk sizing is consistent with my user profile.")}
                    disabled={sendingPrompt}
                    className="w-full text-left text-xs font-semibold px-3 py-2.5 border border-slate-800 hover:border-purple-500/50 bg-[#161C2C]/30 hover:bg-[#1C253B]/50 rounded-lg transition text-purple-400 flex items-center justify-between group cursor-pointer"
                  >
                    <span>ðŸ“ˆ Evaluate Sizing & History</span>
                    <Plus size={12} className="opacity-0 group-hover:opacity-100 transition" />
                  </button>
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 text-[11px] text-slate-500 leading-relaxed">
                ðŸ’¡ <strong>Tip:</strong> Ask the assistant to log trades in conversation (e.g. <em>"Log a trade. Strategy is Bull Put Spread, risk is $100, reward is $25..."</em>). The database logs will auto-sync on the dashboard!
              </div>
            </div>

            {/* Chat Conversation Box */}
            <div className="lg:col-span-2 flex flex-col h-[400px] border border-slate-850 rounded-xl bg-slate-950/30 overflow-hidden">
              {/* Message History */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 select-text">
                {chatMessages.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div key={idx} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                      {!isUser && (
                        <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-500 flex items-center justify-center font-bold text-black shrink-0 text-xs shadow-md">
                          AI
                        </div>
                      )}
                      
                      <div className={`p-3.5 rounded-2xl max-w-[85%] text-xs shadow-sm border ${
                        isUser 
                          ? 'bg-[#161C2C] text-slate-100 border-slate-700/40 rounded-tr-none' 
                          : 'bg-[#0E1320]/60 text-slate-300 border-slate-850 rounded-tl-none space-y-2'
                      }`}>
                        {isUser ? msg.content : renderMarkdown(msg.content)}
                      </div>
                    </div>
                  );
                })}

                {sendingPrompt && (
                  <div className="flex gap-3 justify-start items-center">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-500 flex items-center justify-center font-bold text-black shrink-0 text-xs shadow-md animate-pulse">
                      AI
                    </div>
                    <div className="text-slate-500 text-xs italic flex items-center gap-2">
                      <RotateCw size={12} className="animate-spin text-cyan-500" />
                      AI is evaluating Option Chains & Greeks...
                    </div>
                  </div>
                )}

                {chatError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-lg text-xs flex items-start gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{chatError}</span>
                  </div>
                )}
                
                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  sendPrompt();
                }}
                className="p-3 border-t border-slate-900 bg-[#0E1320] flex gap-2"
              >
                <input
                  type="text"
                  placeholder="Ask the AI assistant to recommend a trade, analyze metrics or log a journal entry..."
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  disabled={sendingPrompt}
                  className="flex-1 bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-slate-200 placeholder-slate-600 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={sendingPrompt || !promptInput.trim()}
                  className="bg-cyan-500 hover:bg-cyan-400 text-black px-3.5 rounded-lg flex items-center justify-center transition disabled:opacity-40 cursor-pointer"
                >
                  <Send size={14} />
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* Live Market Analysis Card */}
        <section className="bg-[#0B0F19]/70 backdrop-blur border border-slate-850 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6 border-b border-slate-900 pb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-355 flex items-center gap-1.5">
              <Sparkles size={16} className="text-cyan-400" />
              <span>Live Market snapshot (Delta Exchange)</span>
            </h3>
            {marketSummary && (
              <span className="text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                Expiry: {marketSummary.nextExpiry || 'Nearest'}
              </span>
            )}
          </div>

          {loadingMarket ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
              <RotateCw className="animate-spin text-cyan-400" size={24} />
              <p className="text-xs">Fetching options details from Delta Exchange India API...</p>
            </div>
          ) : !marketSummary ? (
            <div className="text-center py-10 text-slate-500">
              Failed to fetch option chain statistics. Check network settings.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* High-level metrics */}
              <div className="lg:col-span-1 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-3">
                    <p className="text-[10px] uppercase font-bold text-slate-500">BTC Spot Price</p>
                    <p className="text-lg font-bold text-slate-200 mt-1">${marketSummary.btcPrice?.toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-3">
                    <p className="text-[10px] uppercase font-bold text-slate-500">ATM Strike</p>
                    <p className="text-lg font-bold text-slate-200 mt-1">${marketSummary.atmStrike?.toLocaleString()}</p>
                  </div>
                </div>

                <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Market State Bias:</span>
                    <span className="font-semibold text-cyan-400">{marketSummary.marketState}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Put/Call Ratio (PCR):</span>
                    <span className="font-semibold text-slate-200">{marketSummary.pcr?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">ATM Average IV:</span>
                    <span className="font-semibold text-slate-200">{marketSummary.averageIV?.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Max Pain Strike:</span>
                    <span className="font-semibold text-slate-200">${marketSummary.maxPain?.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs pt-1 border-t border-slate-800">
                    <span className="text-slate-400">Options S/R (OI):</span>
                    <span className="font-semibold text-slate-300">${marketSummary.support?.toLocaleString()} / ${marketSummary.resistance?.toLocaleString()}</span>
                  </div>
                  {marketSummary.chartSupport !== undefined && marketSummary.chartSupport !== null && (
                    <>
                      <div className="flex justify-between text-xs pt-1 border-t border-slate-900/60">
                        <span className="text-slate-400">4H Chart S/R (Price):</span>
                        <span className="font-semibold text-indigo-400">${marketSummary.chartSupport?.toLocaleString()} / ${marketSummary.chartResistance?.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-xs pt-1">
                        <span className="text-slate-400">4H Chart Trend:</span>
                        <span className={`font-semibold ${
                          marketSummary.chartTrend === 'Uptrend' 
                            ? 'text-emerald-400' 
                            : marketSummary.chartTrend === 'Downtrend' 
                              ? 'text-rose-400' 
                              : 'text-amber-400'
                        }`}>{marketSummary.chartTrend}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ATM Greeks Matrix */}
              <div className="lg:col-span-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">ATM Options Greeks Matrix</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-850 text-slate-400">
                        <th className="py-2.5 px-3">Greeks</th>
                        <th className="py-2.5 px-3 text-right">Call Option (CE)</th>
                        <th className="py-2.5 px-3 text-right">Put Option (PE)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900 text-slate-300">
                      {['delta', 'gamma', 'theta', 'vega', 'rho'].map((gk) => {
                        const callVal = marketSummary.atmGreeks?.call?.[gk];
                        const putVal = marketSummary.atmGreeks?.put?.[gk];
                        return (
                          <tr key={gk} className="hover:bg-slate-900/30">
                            <td className="py-2.5 px-3 font-semibold uppercase text-slate-400">{gk}</td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {callVal !== undefined && callVal !== null 
                                ? (gk === 'gamma' ? callVal.toFixed(6) : callVal.toFixed(4))
                                : '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {putVal !== undefined && putVal !== null 
                                ? (gk === 'gamma' ? putVal.toFixed(6) : putVal.toFixed(4))
                                : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Trade Journal Listings */}
        <section className="bg-[#0B0F19]/70 backdrop-blur border border-slate-855 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Option Trades Log</h3>
            <span className="text-xs text-slate-500">{trades.length} entries registered</span>
          </div>

          {loadingTrades ? (
            <div className="text-center py-10 text-slate-500">
              <RotateCw className="animate-spin inline-block mr-2" size={16} /> Loading journal database...
            </div>
          ) : trades.length === 0 ? (
            <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-lg">
              <AlertCircle className="mx-auto mb-2 text-slate-600" size={32} />
              <p className="text-sm">No trades logged yet.</p>
              <button 
                onClick={() => setShowAddModal(true)} 
                className="mt-3 text-xs bg-slate-900 border border-slate-800 hover:bg-slate-800 text-cyan-400 px-3 py-1.5 rounded transition cursor-pointer"
              >
                Log Your First Trade
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="py-3 px-4 w-10"></th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Strategy</th>
                    <th className="py-3 px-4">Market State</th>
                    <th className="py-3 px-4">Max Risk</th>
                    <th className="py-3 px-4">Max Reward</th>
                    <th className="py-3 px-4">Result / P&L</th>
                    <th className="py-3 px-4 hidden md:table-cell">Lessons & Notes</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900 text-slate-350">
                  {trades.map((trade) => {
                    const isPending = !trade.result || trade.result === 'Pending' || (!trade.result.toLowerCase().includes('profit') && !trade.result.toLowerCase().includes('loss'));
                    const isWin = trade.pnl > 0;

                    return (
                      <tr key={trade.id} className="hover:bg-slate-900/35 transition">
                        <td className="py-3.5 px-4 w-10 text-center">
                          <button
                            onClick={() => setSelectedInspectTrade(trade)}
                            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-cyan-400 rounded transition cursor-pointer"
                            title="Inspect Legs & Entry Factors"
                          >
                            <Eye size={13} />
                          </button>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-400">{trade.date}</td>
                        <td className="py-3.5 px-4 font-semibold text-slate-100">{trade.strategy}</td>
                        <td className="py-3.5 px-4">
                          <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-300 px-2 py-0.5 rounded">
                            {trade.market_state}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-rose-300">
                          ${typeof trade.risk === 'number' ? trade.risk.toFixed(2) : parseFloat(String(trade.risk).replace(/[^0-9.-]/g, '') || '0').toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-emerald-300">
                          ${typeof trade.reward === 'number' ? trade.reward.toFixed(2) : parseFloat(String(trade.reward).replace(/[^0-9.-]/g, '') || '0').toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4">
                          {isPending ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
                                Active / Pending
                              </span>
                              {trade.legs && trade.legs.length > 0 && (
                                <div className="flex items-center gap-1 mt-0.5 animate-pulse">
                                  <span className="text-[9px] text-slate-500">Live P&L:</span>
                                  <LivePnlValue value={getTradeUnrealizedPnL(trade, liveTickers)} />
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                              isWin 
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            }`}>
                              {trade.result}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 max-w-xs truncate hidden md:table-cell text-slate-400" title={trade.lessons}>
                          {trade.lessons || <span className="text-slate-600">-</span>}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isPending && (
                              <>
                                <button
                                  onClick={() => handleUpdateResult(trade.id, 'win')}
                                  className="p-1 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 rounded transition cursor-pointer"
                                  title="Mark as Profit (Win)"
                                >
                                  <Check size={12} />
                                </button>
                                <button
                                  onClick={() => handleUpdateResult(trade.id, 'loss')}
                                  className="p-1 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:text-rose-300 rounded transition cursor-pointer"
                                  title="Mark as Loss (Loss)"
                                >
                                  <X size={12} />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => handleDeleteTrade(trade.id)}
                              className="p-1 hover:bg-slate-800 text-slate-500 hover:text-rose-400 rounded transition cursor-pointer"
                              title="Delete Record"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* MODAL 1: Enhanced Log Trade Form */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#0B0F19] border border-slate-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 bg-gradient-to-tr from-cyan-500 to-indigo-500 rounded-lg flex items-center justify-center">
                  <FileText size={14} className="text-black" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-200">Log Options Trade</h3>
                  <p className="text-[10px] text-slate-500">Record your pre-trade view & market analysis</p>
                </div>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddTrade} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              {/* Section: Trade Basics */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 mb-3 flex items-center gap-1.5">
                  <Layers size={12} /> Trade Setup
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Date</label>
                    <input
                      type="date"
                      required
                      value={newTrade.date}
                      onChange={(e) => setNewTrade({ ...newTrade, date: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Market State</label>
                    <select
                      value={newTrade.market_state}
                      onChange={(e) => setNewTrade({ ...newTrade, market_state: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                    >
                      <option value="Trending Up">Trending Up</option>
                      <option value="Trending Down">Trending Down</option>
                      <option value="Range Bound">Range Bound</option>
                      <option value="Breakout">Breakout</option>
                      <option value="Sideways">Sideways</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Strategy</label>
                  <select
                    value={newTrade.strategy}
                    onChange={(e) => setNewTrade({ ...newTrade, strategy: e.target.value })}
                    className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                  >
                    <option value="Bull Put Credit Spread">Bull Put Credit Spread</option>
                    <option value="Bear Call Credit Spread">Bear Call Credit Spread</option>
                    <option value="Iron Condor">Iron Condor</option>
                    <option value="Long Call (CE)">Long Call (CE)</option>
                    <option value="Long Put (PE)">Long Put (PE)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Max Risk ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="e.g. 10.00"
                      value={newTrade.risk}
                      onChange={(e) => setNewTrade({ ...newTrade, risk: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Max Reward ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="e.g. 2.50"
                      value={newTrade.reward}
                      onChange={(e) => setNewTrade({ ...newTrade, reward: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-slate-800" />

              {/* Section: Your Market View (4H Chart Analysis) */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-3 flex items-center gap-1.5">
                  <BarChart3 size={12} /> Your Market View (4H Chart)
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">4H Trend Direction</label>
                    <div className="flex gap-1.5">
                      {['Up', 'Side Base', 'Down'].map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setNewTrade({ ...newTrade, trendDirection4H: dir })}
                          className={`flex-1 text-xs font-bold py-2 rounded border transition cursor-pointer ${
                            newTrade.trendDirection4H === dir
                              ? dir === 'Up' 
                                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                                : dir === 'Down' 
                                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                                  : 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                              : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600'
                          }`}
                        >
                          {dir === 'Up' && 'â–²'} {dir === 'Down' && 'â–¼'} {dir === 'Side Base' && 'â—†'} {dir}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">24-48H Swing Forecast</label>
                    <select
                      value={newTrade.swingForecast}
                      onChange={(e) => setNewTrade({ ...newTrade, swingForecast: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                    >
                      <option value="Swing Up">â†— Swing Up (Next 24-48H)</option>
                      <option value="Swing Low">â†˜ Swing Low (Next 24-48H)</option>
                      <option value="Stay Between Price">â†” Stay Between Price</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Support Level ($)</label>
                    <input
                      type="number"
                      step="1"
                      placeholder={marketSummary?.support?.toLocaleString() || 'e.g. 92000'}
                      value={newTrade.supportLevel}
                      onChange={(e) => setNewTrade({ ...newTrade, supportLevel: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-emerald-500 text-emerald-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Resistance Level ($)</label>
                    <input
                      type="number"
                      step="1"
                      placeholder={marketSummary?.resistance?.toLocaleString() || 'e.g. 100000'}
                      value={newTrade.resistanceLevel}
                      onChange={(e) => setNewTrade({ ...newTrade, resistanceLevel: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-rose-500 text-rose-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Entry Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={marketSummary?.btcPrice?.toLocaleString() || 'e.g. 96500'}
                      value={newTrade.entryPrice}
                      onChange={(e) => setNewTrade({ ...newTrade, entryPrice: e.target.value })}
                      className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-cyan-300 font-mono"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Your Trading Rationale & View</label>
                  <textarea
                    rows="2"
                    placeholder="What is the payoff chart showing? Why are you taking this trade? What does your analysis say..."
                    value={newTrade.traderRationale}
                    onChange={(e) => setNewTrade({ ...newTrade, traderRationale: e.target.value })}
                    className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-indigo-500 text-slate-200"
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-slate-800" />

              {/* Section: AI & Execution Details */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-3 flex items-center gap-1.5">
                  <Bot size={12} /> AI Rationale & Execution
                </h4>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">AI Reason / Rationale</label>
                  <textarea
                    rows="2"
                    placeholder="Why did the AI assistant propose this trade?"
                    value={newTrade.reason}
                    onChange={(e) => setNewTrade({ ...newTrade, reason: e.target.value })}
                    className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Lessons Learned (Optional)</label>
                  <textarea
                    rows="2"
                    placeholder="Post-trade evaluation (can fill later)"
                    value={newTrade.lessons}
                    onChange={(e) => setNewTrade({ ...newTrade, lessons: e.target.value })}
                    className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Option Legs (JSON Array - Optional)</label>
                  <textarea
                    rows="2"
                    placeholder='e.g. [{"symbol":"P-BTC-62000-170726", "strike":62000, "type":"P", "action":"sell", "entry_price":15.00, "quantity":2}]'
                    value={newTrade.legsText || ''}
                    onChange={(e) => {
                      let parsed = [];
                      try {
                        parsed = JSON.parse(e.target.value);
                      } catch (err) {}
                      setNewTrade({ ...newTrade, legsText: e.target.value, legs: parsed });
                    }}
                    className="w-full text-xs font-mono bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-cyan-500 to-indigo-500 text-black py-2.5 font-bold rounded hover:opacity-90 transition cursor-pointer"
                >
                  Save Trade Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Profile Settings */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#0B0F19] border border-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-900 flex items-center justify-between">
              <h3 className="font-bold text-slate-200">AI Assistant Settings Profile</h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSaveSettings} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Account Capital ($)</label>
                <input
                  type="number"
                  required
                  value={profileForm.capital}
                  onChange={(e) => setProfileForm({ ...profileForm, capital: e.target.value })}
                  className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Risk Limit (%)</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    placeholder="e.g. 0.02 for 2%"
                    value={profileForm.riskTolerance}
                    onChange={(e) => setProfileForm({ ...profileForm, riskTolerance: e.target.value })}
                    className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Decimal representation (e.g. 0.02)</span>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Min Risk/Reward</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="e.g. 0.15"
                    value={profileForm.minRR}
                    onChange={(e) => setProfileForm({ ...profileForm, minRR: e.target.value })}
                    className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Preferred Expiry Description</label>
                <input
                  type="text"
                  placeholder="e.g. Weekly, Friday, 3 Days"
                  value={profileForm.preferredExpiry}
                  onChange={(e) => setProfileForm({ ...profileForm, preferredExpiry: e.target.value })}
                  className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Preferred Strategies (comma-separated)</label>
                <input
                  type="text"
                  placeholder="Bull Put Spread, Iron Condor"
                  value={profileForm.preferredStrategies}
                  onChange={(e) => setProfileForm({ ...profileForm, preferredStrategies: e.target.value })}
                  className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Additional Notes</label>
                <textarea
                  rows="2"
                  value={profileForm.notes}
                  onChange={(e) => setProfileForm({ ...profileForm, notes: e.target.value })}
                  className="w-full text-sm bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500 text-slate-200"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-cyan-500 to-indigo-500 text-black py-2.5 font-bold rounded hover:opacity-90 transition cursor-pointer"
                >
                  Save Profile Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL 3: Enhanced Trade Inspection & Journal */}
      {selectedInspectTrade && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#0B0F19] border border-slate-800 rounded-xl w-full max-w-3xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-gradient-to-tr from-cyan-500 to-indigo-500 rounded-lg flex items-center justify-center font-bold text-black text-xs shadow-md">TJ</div>
                <div>
                  <h3 className="font-bold text-slate-200 text-base">{selectedInspectTrade.strategy}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-500 font-mono">Date: {selectedInspectTrade.date}</span>
                    <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{selectedInspectTrade.market_state}</span>
                    {selectedInspectTrade.result && selectedInspectTrade.result !== 'Pending' && (selectedInspectTrade.result.toLowerCase().includes('profit') || selectedInspectTrade.result.toLowerCase().includes('loss')) ? (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${selectedInspectTrade.pnl > 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>{selectedInspectTrade.result}</span>
                    ) : (
                      <span className="text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded animate-pulse">LIVE</span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => { setSelectedInspectTrade(null); setPostTradeReview(null); setInspectTab('overview'); }} className="text-slate-400 hover:text-white cursor-pointer"><X size={18} /></button>
            </div>
            
            {/* Tab Navigation */}
            <div className="flex border-b border-slate-900 bg-[#0E1320]/50">
              {[
                { key: 'overview', label: 'Overview & View', icon: <Eye size={13} /> },
                { key: 'notes', label: 'Running Notes', icon: <PenLine size={13} /> },
                { key: 'review', label: 'Post-Trade Review', icon: <Brain size={13} /> }
              ].map((tab) => (
                <button key={tab.key} onClick={() => setInspectTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-3 transition cursor-pointer border-b-2 ${inspectTab === tab.key ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5' : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/30'}`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-6 max-h-[65vh] overflow-y-auto space-y-6">
              
              {/* â”€â”€â”€ TAB: Overview â”€â”€â”€ */}
              {inspectTab === 'overview' && (<>
                {/* Pre-Trade Market View */}
                {selectedInspectTrade.market_view && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-3 flex items-center gap-1.5"><BarChart3 size={14} /> Your Pre-Trade Market View (4H Chart)</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">4H Trend</p>
                        <p className={`text-sm font-bold mt-0.5 ${selectedInspectTrade.market_view.trendDirection4H === 'Up' ? 'text-emerald-400' : selectedInspectTrade.market_view.trendDirection4H === 'Down' ? 'text-rose-400' : 'text-amber-400'}`}>
                          {selectedInspectTrade.market_view.trendDirection4H === 'Up' && 'â–² '}{selectedInspectTrade.market_view.trendDirection4H === 'Down' && 'â–¼ '}{selectedInspectTrade.market_view.trendDirection4H === 'Side Base' && 'â—† '}{selectedInspectTrade.market_view.trendDirection4H}
                        </p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">24-48H Swing</p>
                        <p className={`text-sm font-bold mt-0.5 ${selectedInspectTrade.market_view.swingForecast === 'Swing Up' ? 'text-emerald-400' : selectedInspectTrade.market_view.swingForecast === 'Swing Low' ? 'text-rose-400' : 'text-cyan-400'}`}>
                          {selectedInspectTrade.market_view.swingForecast}
                        </p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Entry Price</p>
                        <p className="text-sm font-bold text-cyan-300 font-mono mt-0.5">${selectedInspectTrade.market_view.entryPrice?.toLocaleString() || '-'}</p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Support</p>
                        <p className="text-sm font-bold text-emerald-300 font-mono mt-0.5">${selectedInspectTrade.market_view.supportLevel?.toLocaleString() || '-'}</p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Resistance</p>
                        <p className="text-sm font-bold text-rose-300 font-mono mt-0.5">${selectedInspectTrade.market_view.resistanceLevel?.toLocaleString() || '-'}</p>
                      </div>
                    </div>
                    {selectedInspectTrade.market_view.traderRationale && (
                      <div className="mt-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3">
                        <p className="text-[10px] text-indigo-400 uppercase font-semibold mb-1">Your Rationale</p>
                        <p className="text-xs text-slate-300 leading-relaxed">{selectedInspectTrade.market_view.traderRationale}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Payoff Chart */}
                {selectedInspectTrade.legs && selectedInspectTrade.legs.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2.5 flex items-center gap-1.5"><Activity size={14} /> Strategy Payoff Chart</h4>
                    <StrategyPayoffChart
                      strategy={selectedInspectTrade.strategy}
                      shortStrike={selectedInspectTrade.legs.find(l => l.action === 'sell')?.strike}
                      longStrike={selectedInspectTrade.legs.find(l => l.action === 'buy')?.strike}
                      maxRisk={typeof selectedInspectTrade.risk === 'number' ? selectedInspectTrade.risk : parseFloat(String(selectedInspectTrade.risk).replace(/[^0-9.-]/g, ''))}
                      maxReward={typeof selectedInspectTrade.reward === 'number' ? selectedInspectTrade.reward : parseFloat(String(selectedInspectTrade.reward).replace(/[^0-9.-]/g, ''))}
                      currentPrice={selectedInspectTrade.market_view?.entryPrice || selectedInspectTrade.entry_factors?.btcPrice || marketSummary?.btcPrice}
                    />
                  </div>
                )}

                {/* Live P&L */}
                {(!selectedInspectTrade.result || selectedInspectTrade.result === 'Pending') && selectedInspectTrade.legs?.length > 0 && (
                  <div className="bg-gradient-to-r from-slate-900/80 to-slate-800/30 border border-slate-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Current Live P&L</p>
                        <div className="text-lg font-bold mt-1"><LivePnlValue value={getTradeUnrealizedPnL(selectedInspectTrade, liveTickers)} isHeaderCard={true} /></div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">BTC Spot</p>
                        <p className="text-lg font-bold text-slate-200 font-mono mt-1">${marketSummary?.btcPrice?.toLocaleString() || 'â€”'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Legs Table */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2.5">Trade Legs</h4>
                  {selectedInspectTrade.legs?.length > 0 ? (
                    <div className="border border-slate-900 rounded-lg overflow-hidden bg-slate-950/40">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead><tr className="border-b border-slate-900 text-slate-400 bg-slate-950/80">
                          <th className="py-2.5 px-3">Symbol</th><th className="py-2.5 px-3">Strike</th><th className="py-2.5 px-3">Type</th><th className="py-2.5 px-3">Action</th><th className="py-2.5 px-3 text-right">Entry</th><th className="py-2.5 px-3 text-right">Qty</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-900 text-slate-300 font-mono">
                          {selectedInspectTrade.legs.map((leg, idx) => (
                            <tr key={idx} className="hover:bg-slate-900/20">
                              <td className="py-2.5 px-3 text-slate-400 font-semibold">{leg.symbol}</td>
                              <td className="py-2.5 px-3">{leg.strike?.toLocaleString()}</td>
                              <td className="py-2.5 px-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-bold ${leg.type === 'C' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'}`}>{leg.type === 'C' ? 'Call' : 'Put'}</span></td>
                              <td className="py-2.5 px-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-bold ${leg.action === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{leg.action?.toUpperCase()}</span></td>
                              <td className="py-2.5 px-3 text-right">${leg.entry_price?.toFixed(2)}</td>
                              <td className="py-2.5 px-3 text-right">{leg.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (<p className="text-xs text-slate-500 italic">No leg structures stored.</p>)}
                </div>

                {/* Entry Factors */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2.5">Entry Market Factors</h4>
                  {selectedInspectTrade.entry_factors ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">BTC Price</p>
                        <p className="text-sm font-bold text-slate-200 font-mono mt-0.5">${selectedInspectTrade.entry_factors.btcPrice?.toLocaleString() || '-'}</p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">ATM IV</p>
                        <p className="text-sm font-bold text-slate-200 font-mono mt-0.5">{selectedInspectTrade.entry_factors.averageIV ? `${selectedInspectTrade.entry_factors.averageIV}%` : '-'} <span className="text-[10px] text-slate-400 font-sans ml-1">({selectedInspectTrade.entry_factors.ivClassification || '-'})</span></p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">PCR</p>
                        <p className="text-sm font-bold text-slate-200 font-mono mt-0.5">{selectedInspectTrade.entry_factors.pcr || '-'}</p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Funding</p>
                        <p className="text-sm font-bold text-slate-200 font-mono mt-0.5">{selectedInspectTrade.entry_factors.fundingRate ? `${selectedInspectTrade.entry_factors.fundingRate.toFixed(4)}%` : '-'}</p>
                      </div>
                      <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Signals</p>
                        <p className="text-sm font-bold text-slate-200 font-mono mt-0.5">{selectedInspectTrade.entry_factors.signalsAligned || 0}A / {selectedInspectTrade.entry_factors.signalsConflicting || 0}C</p>
                      </div>
                    </div>
                  ) : (<p className="text-xs text-slate-500 italic">No entry factors logged.</p>)}
                </div>
              </>)}

              {/* â”€â”€â”€ TAB: Running Notes â”€â”€â”€ */}
              {inspectTab === 'notes' && (<>
                {(!selectedInspectTrade.result || selectedInspectTrade.result === 'Pending') && (
                  <div className="bg-gradient-to-r from-amber-500/5 to-orange-500/5 border border-amber-500/20 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                        <span className="text-xs text-amber-400 font-semibold">Trade is LIVE</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div><span className="text-[10px] text-slate-500 uppercase block">BTC</span><span className="text-sm font-bold font-mono text-slate-200">${marketSummary?.btcPrice?.toLocaleString() || 'â€”'}</span></div>
                        <div><span className="text-[10px] text-slate-500 uppercase block">P&L</span><LivePnlValue value={getTradeUnrealizedPnL(selectedInspectTrade, liveTickers)} isHeaderCard={false} /></div>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-3 flex items-center gap-1.5"><Clock size={14} /> Trade Notes Timeline</h4>
                  {(selectedInspectTrade.running_notes?.length > 0) ? (
                    <div className="space-y-2.5">
                      {selectedInspectTrade.running_notes.map((note, idx) => (
                        <div key={idx} className="flex gap-3 items-start">
                          <div className="flex flex-col items-center shrink-0">
                            <div className="h-2.5 w-2.5 rounded-full bg-cyan-500/60 border-2 border-cyan-500/30 mt-1" />
                            {idx < selectedInspectTrade.running_notes.length - 1 && <div className="w-0.5 flex-1 bg-slate-800 mt-0.5" />}
                          </div>
                          <div className="flex-1 bg-[#121824]/50 border border-slate-900 rounded-lg p-3">
                            <p className="text-[10px] text-slate-500 font-mono mb-1">{new Date(note.timestamp).toLocaleString()}</p>
                            <p className="text-xs text-slate-300 leading-relaxed">{note.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 border border-dashed border-slate-800 rounded-lg">
                      <PenLine size={24} className="mx-auto text-slate-700 mb-2" />
                      <p className="text-xs text-slate-500">No notes logged yet for this trade.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Add notes below to track observations.</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <input type="text" placeholder="Write a note... (price hitting support, IV changing, adjusting stops)" value={runningNoteInput} onChange={(e) => setRunningNoteInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddRunningNote(selectedInspectTrade.id); } }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-cyan-500 text-slate-200 placeholder-slate-600" />
                  <button onClick={() => handleAddRunningNote(selectedInspectTrade.id)} disabled={!runningNoteInput.trim()}
                    className="bg-cyan-500 hover:bg-cyan-400 text-black px-4 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition disabled:opacity-40 cursor-pointer">
                    <Send size={12} /> Add
                  </button>
                </div>
              </>)}

              {/* â”€â”€â”€ TAB: Post-Trade Review â”€â”€â”€ */}
              {inspectTab === 'review' && (<>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-3 flex items-center gap-1.5"><ArrowUpDown size={14} /> View Correctness Comparison</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-4">
                      <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Your View (Human)</p>
                      <p className="text-xs text-slate-400 mb-3">Was your market analysis correct?</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdateViewCorrectness(selectedInspectTrade.id, 'userViewCorrect', true)}
                          className={`flex-1 text-xs font-bold py-2 rounded border transition cursor-pointer ${selectedInspectTrade.post_trade_review?.userViewCorrect === true ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-emerald-500/30'}`}>âœ“ Correct</button>
                        <button onClick={() => handleUpdateViewCorrectness(selectedInspectTrade.id, 'userViewCorrect', false)}
                          className={`flex-1 text-xs font-bold py-2 rounded border transition cursor-pointer ${selectedInspectTrade.post_trade_review?.userViewCorrect === false ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-rose-500/30'}`}>âœ• Incorrect</button>
                      </div>
                    </div>
                    <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-4">
                      <p className="text-[10px] text-slate-500 uppercase font-semibold mb-2">System View (AI)</p>
                      <p className="text-xs text-slate-400 mb-3">Was the AI recommendation correct?</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdateViewCorrectness(selectedInspectTrade.id, 'aiViewCorrect', true)}
                          className={`flex-1 text-xs font-bold py-2 rounded border transition cursor-pointer ${selectedInspectTrade.post_trade_review?.aiViewCorrect === true ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-emerald-500/30'}`}>âœ“ Correct</button>
                        <button onClick={() => handleUpdateViewCorrectness(selectedInspectTrade.id, 'aiViewCorrect', false)}
                          className={`flex-1 text-xs font-bold py-2 rounded border transition cursor-pointer ${selectedInspectTrade.post_trade_review?.aiViewCorrect === false ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-rose-500/30'}`}>âœ• Incorrect</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-slate-900/60 to-slate-800/20 border border-slate-800 rounded-lg p-4">
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-semibold">Max Risk</p>
                      <p className="text-sm font-bold text-rose-400 font-mono mt-1">${typeof selectedInspectTrade.risk === 'number' ? selectedInspectTrade.risk.toFixed(2) : parseFloat(String(selectedInspectTrade.risk).replace(/[^0-9.-]/g, '') || '0').toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-semibold">Max Reward</p>
                      <p className="text-sm font-bold text-emerald-400 font-mono mt-1">${typeof selectedInspectTrade.reward === 'number' ? selectedInspectTrade.reward.toFixed(2) : parseFloat(String(selectedInspectTrade.reward).replace(/[^0-9.-]/g, '') || '0').toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-semibold">Realized P&L</p>
                      <p className={`text-sm font-bold font-mono mt-1 ${selectedInspectTrade.pnl > 0 ? 'text-emerald-400' : selectedInspectTrade.pnl < 0 ? 'text-rose-400' : 'text-amber-400'}`}>
                        {selectedInspectTrade.pnl != null ? `${selectedInspectTrade.pnl >= 0 ? '+' : ''}$${selectedInspectTrade.pnl.toFixed(2)}` : 'Pending'}
                      </p>
                    </div>
                  </div>
                </div>

                {selectedInspectTrade.reason && (
                  <div className="bg-[#121824]/40 border border-slate-900 rounded-lg p-3">
                    <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">AI Rationale</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{selectedInspectTrade.reason}</p>
                  </div>
                )}

                {selectedInspectTrade.lessons && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                    <p className="text-[10px] text-amber-400 uppercase font-semibold mb-1">Lessons Learned</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{selectedInspectTrade.lessons}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-3 flex items-center gap-1.5"><Brain size={14} /> AI Post-Mortem Analysis</h4>
                  {selectedInspectTrade.post_trade_review?.aiPostMortem && !postTradeReview && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-purple-400 font-semibold">Last AI Review</p>
                        <p className="text-[10px] text-slate-500 font-mono">{selectedInspectTrade.post_trade_review.aiReviewDate ? new Date(selectedInspectTrade.post_trade_review.aiReviewDate).toLocaleString() : ''}</p>
                      </div>
                      <div className="text-xs text-slate-300 leading-relaxed space-y-1">{renderMarkdown(selectedInspectTrade.post_trade_review.aiPostMortem)}</div>
                    </div>
                  )}
                  {postTradeReview && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4 space-y-2 mt-3">
                      <p className="text-[10px] text-purple-400 font-semibold">ðŸ¤– Fresh AI Analysis</p>
                      <div className="text-xs text-slate-300 leading-relaxed space-y-1">{renderMarkdown(postTradeReview)}</div>
                    </div>
                  )}
                  <button onClick={() => handleGeneratePostMortem(selectedInspectTrade)} disabled={generatingReview}
                    className="mt-3 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-2.5 font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer">
                    {generatingReview ? (<><RotateCw size={14} className="animate-spin" /> Generating AI Post-Mortem Review...</>) : (<><Brain size={14} /> {selectedInspectTrade.post_trade_review?.aiPostMortem ? 'Regenerate AI Post-Mortem' : 'Generate AI Post-Mortem Review'}</>)}
                  </button>
                </div>
              </>)}
            </div>
            
            <div className="px-6 py-4 border-t border-slate-900 bg-slate-950/20 text-right">
              <button onClick={() => { setSelectedInspectTrade(null); setPostTradeReview(null); setInspectTab('overview'); }} 
                className="bg-[#1C253B] hover:bg-slate-800 hover:text-white text-slate-200 px-4 py-1.5 font-semibold text-xs rounded transition cursor-pointer">Close View</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Price Alert Configuration */}
      <PriceAlertModal 
        isOpen={showAlertModal} 
        onClose={() => setShowAlertModal(false)} 
        currentBtcPrice={marketSummary?.btcPrice} 
      />
    </main>
  );
}

