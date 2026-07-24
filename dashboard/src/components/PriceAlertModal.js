'use client';

import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  X, 
  Trash2, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  TrendingUp, 
  TrendingDown, 
  Sparkles, 
  RefreshCw, 
  Key, 
  ShieldCheck, 
  ExternalLink, 
  Settings,
  History,
  FileText,
  AlertTriangle,
  Zap,
  Check,
  XCircle
} from 'lucide-react';

export default function PriceAlertModal({ isOpen, onClose, currentBtcPrice }) {
  const [activeTab, setActiveTab] = useState('alerts'); // 'alerts' | 'logs'
  
  const [targetPrice, setTargetPrice] = useState('');
  const [direction, setDirection] = useState('above');
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [hasBotToken, setHasBotToken] = useState(false);
  const [showConfigForm, setShowConfigForm] = useState(false);

  const [alerts, setAlerts] = useState([]);
  const [executionLogs, setExecutionLogs] = useState([]);
  
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchData();
      if (currentBtcPrice && !targetPrice) {
        setTargetPrice(Math.round(currentBtcPrice * 1.02).toString()); // Default +2%
      }
    }
  }, [isOpen, currentBtcPrice]);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      if (data.success) {
        setAlerts(data.alerts || []);
        setExecutionLogs(data.executionLogs || []);
        setHasBotToken(data.hasBotToken);
        if (data.chatIdConfigured && !chatId) {
          setChatId(data.chatIdConfigured);
        }
        if (!data.hasBotToken) {
          setShowConfigForm(true);
        }
      }
    } catch (e) {
      console.error('Failed to fetch alerts & logs:', e);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    if (!botToken.trim()) {
      setStatusMsg({ type: 'error', text: 'Please enter a valid Bot Token from @BotFather' });
      return;
    }

    setSavingConfig(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveConfig',
          botToken: botToken.trim(),
          chatId: chatId.trim()
        })
      });

      const data = await res.json();
      if (data.success) {
        setStatusMsg({ type: 'success', text: '✅ Telegram credentials saved to .env!' });
        setHasBotToken(true);
        setShowConfigForm(false);
        fetchData();
      } else {
        setStatusMsg({ type: 'error', text: `❌ ${data.error}` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `❌ Failed to save config: ${err.message}` });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCreateAlert = async (e) => {
    e.preventDefault();
    if (!targetPrice || isNaN(Number(targetPrice))) {
      setStatusMsg({ type: 'error', text: 'Please enter a valid target price.' });
      return;
    }

    setLoading(true);
    setStatusMsg(null);

    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPrice: Number(targetPrice),
          direction,
          chatId: chatId.trim() || undefined
        })
      });

      const data = await res.json();
      if (data.success) {
        setStatusMsg({ type: 'success', text: `✅ Alert set! When hit, tool will auto-execute ${direction === 'above' ? 'Bull Put Spread' : 'Bear Call Spread'} & log trade!` });
        setTargetPrice('');
        fetchData();
      } else {
        setStatusMsg({ type: 'error', text: `❌ ${data.error}` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `❌ Failed to create alert: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleTestTelegram = async () => {
    setTesting(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          chatId: chatId.trim() || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({ type: 'success', text: '🚀 Test message sent! Check your Telegram phone app.' });
      } else {
        setStatusMsg({ type: 'error', text: `❌ ${data.error}` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `❌ Test failed: ${err.message}` });
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteAlert = async (id) => {
    try {
      const res = await fetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      console.error('Delete alert failed:', err);
    }
  };

  const handleClearLogs = async () => {
    try {
      const res = await fetch('/api/alerts?type=logs', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (err) {
      console.error('Clear logs failed:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all duration-300">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl shadow-emerald-500/10">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-sky-500/20 to-emerald-500/20 border border-sky-500/30 text-sky-400">
              <Zap className="w-5 h-5 text-emerald-400 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Automated Price Alerts & Trade Tool
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">Auto-Trade</span>
              </h3>
              <p className="text-xs text-slate-400">Alerts auto-execute trades & record execution logs</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {hasBotToken && (
              <button 
                onClick={() => setShowConfigForm(!showConfigForm)}
                className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded-lg transition-colors"
                title="Edit Bot Credentials"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button 
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Selection */}
        {hasBotToken && !showConfigForm && (
          <div className="flex border-b border-slate-800 bg-slate-950/50 px-6 pt-2 gap-4 text-xs font-bold">
            <button
              onClick={() => setActiveTab('alerts')}
              className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === 'alerts'
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Active Alerts ({alerts.length})</span>
            </button>
            
            <button
              onClick={() => setActiveTab('logs')}
              className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-all ${
                activeTab === 'logs'
                  ? 'border-purple-500 text-purple-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Execution Logs ({executionLogs.length})</span>
              {executionLogs.some(l => l.status === 'FAILURE') && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
              )}
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          
          {/* Status Message */}
          {statusMsg && (
            <div className={`p-3 rounded-xl text-xs font-medium border flex items-center space-x-2 ${
              statusMsg.type === 'success' 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* Setup Config Form if Token Missing or Settings Clicked */}
          {(!hasBotToken || showConfigForm) ? (
            <div className="space-y-4 p-4 rounded-xl bg-slate-950/80 border border-sky-500/20 shadow-inner">
              <div className="flex items-center space-x-2 text-sky-400 text-xs font-bold uppercase tracking-wider">
                <Key className="w-4 h-4" />
                <span>Setup Telegram Credentials</span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Enter your Telegram <b>Bot Token</b> and <b>Chat ID</b> to receive instant alert notifications & auto-execution trade logs on your phone.
              </p>

              <form onSubmit={handleSaveConfig} className="space-y-3 pt-1">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Telegram Bot Token (from @BotFather)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 7123456789:AAEFghIJKlmno..."
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 focus:border-sky-500 rounded-xl text-xs font-mono text-slate-100 placeholder-slate-600 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Your Telegram Chat ID (from @userinfobot)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 987654321"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 focus:border-sky-500 rounded-xl text-xs font-mono text-slate-100 placeholder-slate-600 outline-none"
                    required
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={savingConfig}
                    className="flex-1 py-2 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-1.5"
                  >
                    {savingConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    <span>Save Credentials</span>
                  </button>

                  {hasBotToken && (
                    <button
                      type="button"
                      onClick={() => setShowConfigForm(false)}
                      className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
          ) : activeTab === 'alerts' ? (
            /* TAB 1: ACTIVE ALERTS & SETTING FORM */
            <>
              {/* Current Live Price Banner */}
              {currentBtcPrice && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                  <span className="text-xs text-slate-400 font-medium">Current BTC Price:</span>
                  <span className="text-sm font-extrabold text-emerald-400 font-mono">
                    ${Number(currentBtcPrice).toLocaleString('en-US')}
                  </span>
                </div>
              )}

              {/* Add Alert Form */}
              <form onSubmit={handleCreateAlert} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Target Price (USD)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-400 font-bold">$</span>
                    <input 
                      type="number"
                      placeholder="e.g. 68000"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      className="w-full pl-7 pr-4 py-2 bg-slate-950 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-sm font-mono text-slate-100 placeholder-slate-500 outline-none transition-all"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Trigger Condition & Auto-Trade Strategy
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setDirection('above')}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        direction === 'above'
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-500/10'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center space-x-1.5 font-bold text-xs">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        <span>Goes Above</span>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1">Auto-Executes Bull Put Spread</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setDirection('below')}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        direction === 'below'
                          ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-lg shadow-rose-500/10'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center space-x-1.5 font-bold text-xs">
                        <TrendingDown className="w-4 h-4 text-rose-400" />
                        <span>Goes Below</span>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1">Auto-Executes Bear Call Spread</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    <span>{loading ? 'Setting Alert...' : 'Set Alert & Auto-Trade'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleTestTelegram}
                    disabled={testing}
                    className="flex items-center justify-center space-x-1.5 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                    title="Send a test message to your Telegram phone app"
                  >
                    {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-sky-400" />}
                    <span>Test Telegram</span>
                  </button>
                </div>
              </form>

              {/* Active Alerts List */}
              <div className="pt-2 border-t border-slate-800">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center justify-between">
                  <span>Active Price Alerts ({alerts.length})</span>
                  <button onClick={fetchData} className="text-slate-400 hover:text-slate-200">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </h4>

                {alerts.length === 0 ? (
                  <div className="text-center py-5 border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
                    <Bell className="w-6 h-6 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="text-xs text-slate-500">No active price alerts set yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {alerts.map((alert) => (
                      <div 
                        key={alert.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center space-x-3">
                          <div className={`p-1.5 rounded-lg ${
                            alert.direction === 'above' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {alert.direction === 'above' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-200 font-mono">
                              BTC {alert.direction.toUpperCase()} ${Number(alert.targetPrice).toLocaleString('en-US')}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Triggers: {alert.direction === 'above' ? 'Bull Put Spread' : 'Bear Call Spread'}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteAlert(alert.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Delete alert"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* TAB 2: TRADE EXECUTION LOGS */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Automated Trade Logs ({executionLogs.length})
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={fetchData} className="text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                  {executionLogs.length > 0 && (
                    <button onClick={handleClearLogs} className="text-rose-400 hover:text-rose-300 text-xs flex items-center gap-1 ml-2">
                      <Trash2 className="w-3.5 h-3.5" /> Clear History
                    </button>
                  )}
                </div>
              </div>

              {executionLogs.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl bg-slate-950/40">
                  <History className="w-6 h-6 text-slate-600 mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-slate-500">No automated trade executions logged yet.</p>
                  <p className="text-[10px] text-slate-600 mt-1">Logs appear here automatically when price alert triggers fire.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {executionLogs.map((log) => {
                    const isSuccess = log.systemStatus === 'SUCCESS' || log.status === 'SUCCESS';
                    const eventText = log.eventSummary || (isSuccess ? 'Everything Gone Well' : 'System Error');
                    const targetPrice = log.triggerEvent?.targetPrice || log.targetPrice;
                    const direction = log.triggerEvent?.direction || log.direction;
                    const spotPrice = log.triggerEvent?.spotPrice || log.spotPrice;
                    const strategy = log.autoTradeExecution?.strategy || log.strategy;
                    const shortStrike = log.autoTradeExecution?.shortStrike || log.shortStrike;
                    const longStrike = log.autoTradeExecution?.longStrike || log.longStrike;
                    const risk = log.autoTradeExecution?.risk || log.risk;
                    const reward = log.autoTradeExecution?.reward || log.reward;
                    const tradeId = log.journalStatus?.tradeId || log.tradeId;

                    return (
                      <div 
                        key={log.id}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isSuccess
                            ? 'bg-emerald-500/5 border-emerald-500/30'
                            : 'bg-rose-500/5 border-rose-500/30'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            {isSuccess ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                <Check className="w-3 h-3" /> EVERYTHING GONE WELL
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                                <XCircle className="w-3 h-3" /> SYSTEM EVENT ERROR
                              </span>
                            )}

                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                              ⚡ Pre-Approved
                            </span>

                            <span className="text-xs font-bold text-slate-200">
                              {strategy}
                            </span>
                          </div>

                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        {/* Log details */}
                        <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px] border-t border-slate-800/60 pt-2 text-slate-400">
                          <div>
                            Alert Target: <span className="font-bold text-slate-200">${Number(targetPrice).toLocaleString()} ({direction?.toUpperCase()})</span>
                          </div>
                          <div>
                            Spot at Trigger: <span className="font-bold text-slate-200">${Number(spotPrice).toLocaleString()}</span>
                          </div>
                        </div>

                        {isSuccess ? (
                          <div className="mt-2 text-[11px] bg-emerald-950/30 border border-emerald-800/30 rounded-lg p-2.5 text-emerald-300 space-y-1">
                            <div className="flex justify-between">
                              <span>Strikes: <b>{shortStrike} / {longStrike}</b></span>
                              <span>Risk: <b>${risk}</b> | Reward: <b>${reward}</b></span>
                            </div>
                            <div className="text-[10px] text-emerald-400/90 font-mono flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Pre-approved & logged to Journal as <b>Trade #{tradeId}</b>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] bg-rose-950/40 border border-rose-800/30 rounded-lg p-2.5 text-rose-300">
                            <div className="font-semibold flex items-center gap-1 text-rose-400 mb-0.5">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>System Event Error Details:</span>
                            </div>
                            <div className="text-slate-300 text-[11px] font-mono leading-relaxed pl-4">
                              {log.eventSummary || log.failureReason || log.systemError || 'System validation failed'}
                            </div>
                          </div>
                        )}

                        {/* Post-Trigger AI Market Analysis Section */}
                        {log.postTriggerAIAnalysis?.executed && log.postTriggerAIAnalysis?.summary && (
                          <div className="mt-2.5 bg-purple-950/30 border border-purple-800/30 rounded-lg p-2.5 text-purple-200">
                            <div className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" /> Post-Trigger AI Market Analysis
                            </div>
                            <div className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                              {log.postTriggerAIAnalysis.summary}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
