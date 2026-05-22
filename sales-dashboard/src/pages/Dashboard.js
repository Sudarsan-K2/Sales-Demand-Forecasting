import React, { useState, useEffect } from 'react';
import { BarChart2, AlertCircle, Zap, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import StatCard from '../components/StatCard';

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border-glow)',
      borderRadius: '8px',
      padding: '12px 16px',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    }}>
      <div style={{ color: 'var(--text-2)', marginBottom: '8px', fontFamily: 'var(--font-body)', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      {payload.map((p, i) => {
        // We injected "confidence_band_formatted" into the payload from the backend
        const isBand = p.name === "Confidence Band";
        const displayValue = isBand && p.payload.confidence_band_formatted 
           ? p.payload.confidence_band_formatted 
           : p.value;
           
        return (
          <div key={i} style={{ color: p.color || 'var(--text-1)', display: 'flex', gap: '12px', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-2)' }}>{p.name}</span>
            <span style={{ fontWeight: 700 }}>{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
};

// ─── Forecast Chart ───────────────────────────────────────────────────────────
const ForecastChart = ({ data }) => {
  if (!data || data.length === 0) return (
    <div className="empty-state" style={{ minHeight: 300 }}>
      <BarChart2 size={32} strokeWidth={1} />
      <p>No forecast data available</p>
    </div>
  );

  const chartData = data.map(item => {
    const d = new Date(item.ds);
    return {
      ...item,
      displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sales: Math.round(item.yhat),
      confidenceBand: [Math.round(item.yhat_lower), Math.round(item.yhat_upper)],
    };
  });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.12} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="displayDate"
          stroke="transparent"
          tick={{ fill: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
          tickMargin={10}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          stroke="transparent"
          tick={{ fill: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-glow)', strokeWidth: 1 }} />
        <Legend
          wrapperStyle={{ paddingTop: '20px', fontSize: '12px', color: 'var(--text-2)' }}
        />
        <Area
          type="monotone"
          dataKey="confidenceBand"
          fill="url(#bandFill)"
          stroke="rgba(0,207,255,0.15)"
          strokeWidth={1}
          name="Confidence Band"
          strokeDasharray="4 2"
        />
        <Line
          type="monotone"
          dataKey="sales"
          stroke="var(--accent)"
          strokeWidth={2.5}
          name="Expected Sales"
          dot={false}
          activeDot={{ r: 5, fill: 'var(--accent)', strokeWidth: 0, filter: 'drop-shadow(0 0 6px var(--accent))' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [selectedFamily, setSelectedFamily] = useState('GROCERY I');

  // Global Family Stock tracking
  const [familyStocks, setFamilyStocks] = useState(() => {
    const saved = localStorage.getItem('familyStocks');
    return saved !== null ? JSON.parse(saved) : {};
  });

  const currentStock = familyStocks[selectedFamily] !== undefined ? familyStocks[selectedFamily] : 50;
  
  const updateCurrentStock = (newVal) => {
    setFamilyStocks(prev => ({ ...prev, [selectedFamily]: newVal }));
  };

  useEffect(() => {
    localStorage.setItem('familyStocks', JSON.stringify(familyStocks));
  }, [familyStocks]);

  const [summaryData, setSummaryData]       = useState([]);
  const [forecastData, setForecastData]     = useState([]);
  const [anomaliesData, setAnomaliesData]   = useState([]);
  const [modelMetrics, setModelMetrics]     = useState(null);
  const [isRetraining, setIsRetraining]     = useState(false);
  const [refreshKey, setRefreshKey]         = useState(0);
  const [isLoading, setIsLoading]           = useState(true);
  const [categories, setCategories]         = useState(['GROCERY I']);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res  = await fetch('http://127.0.0.1:8000/available_categories?store_id=1', { headers: { 'X-API-Key': 'secret-token' } });
        const data = await res.json();
        if (data.categories?.length) {
          setCategories(data.categories);
          setSelectedFamily(prev => data.categories.includes(prev) ? prev : data.categories[0]);
        }
      } catch (e) { console.error(e); }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const payload  = JSON.stringify({ store_id: 1, family: selectedFamily });
        const headers  = { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' };
        const [sRes, fRes, aRes] = await Promise.all([
          fetch('http://127.0.0.1:8000/dashboard/summary',  { method: 'POST', headers, body: payload }),
          fetch('http://127.0.0.1:8000/predict',            { method: 'POST', headers, body: JSON.stringify({ store_id: 1, family: selectedFamily, months: 1 }) }),
          fetch('http://127.0.0.1:8000/analyze_history',    { method: 'POST', headers, body: payload }),
        ]);
        const [sJson, fJson, aJson] = await Promise.all([
          sRes.ok ? sRes.json() : {}, 
          fRes.ok ? fRes.json() : {}, 
          aRes.ok ? aRes.json() : {}
        ]);
        if (!sRes.ok || !fRes.ok || !aRes.ok) {
            console.warn("One or more dashboard endpoints returned an error.");
        }
        setSummaryData(sJson.cards || []);
        setForecastData(fJson.forecast || []);
        setAnomaliesData(aJson.recent_anomalies || []);
        setModelMetrics(fJson.metrics || null);
      } catch (e) { console.error(e); }
      finally { setIsLoading(false); }
    };
    fetchData();
  }, [selectedFamily, refreshKey]);

  const handleRetrain = async () => {
    setIsRetraining(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/retrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' },
        body: JSON.stringify({ store_id: 1, family: selectedFamily })
      });
      if (res.ok) {
        setRefreshKey(prev => prev + 1);
      } else {
        console.error("Retrain failed");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRetraining(false);
    }
  };

  return (
    <div className="page-container">

      {/* Header */}
      <div className="page-header page-header-row" style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: '1 1 auto' }}>
          <h1>Command Center</h1>
          <p>Store 1 · Real-time supply chain intelligence</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flex: '0 0 auto' }}>
          <div className="fancy-select">
            <label>Category</label>
            <select value={selectedFamily} onChange={e => setSelectedFamily(e.target.value)}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              Current Stock ({selectedFamily})
            </label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 14px',
              minWidth: 110,
            }}>
              <input
                type="number"
                min="0"
                value={currentStock}
                onChange={e => updateCurrentStock(Number(e.target.value))}
                style={{
                  width: 90, background: 'transparent', border: 'none',
                  color: 'var(--accent)', fontFamily: 'var(--font-mono)',
                  fontSize: 16, fontWeight: 700, textAlign: 'center', outline: 'none',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>units</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      {isLoading ? (
        <div className="stat-grid">
          {[1,2,3,4].map(i => (
            <div key={i} className="card stat-card">
              <div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 28, width: '45%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 10, width: '40%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="stat-grid">
          {summaryData.map((card, i) => <StatCard key={i} {...card} />)}
        </div>
      )}

      {/* Chart + Anomaly Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>

        {/* Chart */}
        <div className="card" style={{ padding: '24px' }}>
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="icon-wrap"><BarChart2 size={14} /></span>
              Demand Forecast &amp; Confidence Bound
            </div>
            {modelMetrics && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                  background: modelMetrics.freshness_label?.includes('Stale') ? 'var(--danger-dim)' : 'var(--success-dim)',
                  color: modelMetrics.freshness_label?.includes('Stale') ? 'var(--danger)' : 'var(--success)',
                  border: `1px solid ${modelMetrics.freshness_label?.includes('Stale') ? 'rgba(255,71,87,0.3)' : 'rgba(0,217,126,0.3)'}`
                }}>
                  Model: {modelMetrics.freshness_label}
                </span>
                <button 
                  onClick={handleRetrain}
                  disabled={isRetraining}
                  style={{
                    background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px',
                    color: 'var(--text-2)', cursor: isRetraining ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px',
                    opacity: isRetraining ? 0.5 : 1
                  }}
                  title="Force Retrain Model"
                >
                  <RefreshCw size={12} className={isRetraining ? "spin-animation" : ""} />
                </button>
              </div>
            )}
          </div>
          {isLoading
            ? <div className="skeleton" style={{ height: 320, borderRadius: 8 }} />
            : <ForecastChart data={forecastData} />
          }
        </div>

        {/* Anomaly Feed */}
        <div className="card" style={{ padding: '24px', maxHeight: 480, overflowY: 'auto' }}>
          <div className="section-title" style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', paddingBottom: 12, marginBottom: 0, zIndex: 1 }}>
            <span className="icon-wrap" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>
              <AlertCircle size={14} />
            </span>
            Recent Anomalies
          </div>

          {isLoading ? (
            [1,2,3].map(i => (
              <div key={i} className="skeleton" style={{ height: 70, borderRadius: 8, marginBottom: 10, marginTop: i === 1 ? 12 : 0 }} />
            ))
          ) : anomaliesData.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              <Zap size={24} />
              <p>No anomalies detected in this period.</p>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              {anomaliesData.map((a, i) => {
                const isHigh   = a.severity === 'High';
                const isSpike  = a.type === 'Spike';
                return (
                  <div key={i} className={`anomaly-item ${isHigh ? 'anomaly-high' : 'anomaly-medium'}`}>
                    <div className="anomaly-title" style={{ color: isHigh ? 'var(--danger)' : 'var(--warning)' }}>
                      {a.severity} {a.type}
                    </div>
                    <div className="anomaly-body">
                      {isSpike ? 'Surged to' : 'Dropped to'}{' '}
                      <strong>{Math.round(a.actual)}</strong> units on{' '}
                      {new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.{' '}
                      Expected ~<strong>{Math.round(a.expected)}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
