import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Brain, AlertCircle, Activity, RefreshCw, Zap,
    Target, BarChart2, Clock, CheckCircle2, AlertTriangle,
    TrendingUp, Filter, ChevronDown, ChevronUp, History,
    Cpu, Search
} from 'lucide-react';
import {
    ResponsiveContainer, ComposedChart, Line, Area, Scatter,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    BarChart, Bar, ReferenceLine, Cell
} from 'recharts';

const API = 'http://127.0.0.1:8000';
const H = { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' };

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: 'var(--surface-2)', border: '1px solid var(--border-glow)',
            borderRadius: 8, padding: '10px 14px',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
            <div style={{ color: 'var(--text-2)', marginBottom: 6, fontFamily: 'var(--font-body)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
            {payload.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', color: p.color }}>
                    <span style={{ color: 'var(--text-2)' }}>{p.name}</span>
                    <span style={{ fontWeight: 700 }}>{typeof p.value === 'number' ? Math.round(p.value) : p.value}</span>
                </div>
            ))}
        </div>
    );
};

// ─── Metric Badge ─────────────────────────────────────────────────────────────
const MetricBadge = ({ label, value, unit = '', color = 'var(--accent)', icon: Icon }) => (
    <div className="card" style={{ padding: '16px 20px', display: 'flex', gap: 14, alignItems: 'center' }}>
        {Icon && (
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={16} style={{ color }} />
            </div>
        )}
        <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>
                {value ?? <span style={{ color: 'var(--text-3)', fontSize: 14 }}>—</span>}
                {value != null && unit && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-3)', marginLeft: 3 }}>{unit}</span>}
            </div>
        </div>
    </div>
);

// ─── Retrain Timeline Entry ───────────────────────────────────────────────────
const TimelineEntry = ({ entry, isLast }) => (
    <div style={{ display: 'flex', gap: 14, paddingBottom: isLast ? 0 : 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{
                width: 10, height: 10, borderRadius: '50%', marginTop: 3,
                background: entry.success ? 'var(--success)' : 'var(--danger)',
                boxShadow: `0 0 6px ${entry.success ? 'var(--success)' : 'var(--danger)'}`,
            }} />
            {!isLast && <div style={{ flex: 1, width: 1, background: 'var(--border)', marginTop: 4 }} />}
        </div>
        <div style={{ paddingBottom: isLast ? 0 : 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{entry.family}</span>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 8, background: entry.trigger === 'Manual' ? 'var(--accent-dim)' : 'var(--violet-dim)', color: entry.trigger === 'Manual' ? 'var(--accent)' : 'var(--violet)', fontWeight: 600 }}>
                    {entry.trigger}
                </span>
                {entry.accuracyDelta != null && (
                    <span style={{ fontSize: 10, color: entry.accuracyDelta > 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {entry.accuracyDelta > 0 ? '↑' : '↓'} {Math.abs(entry.accuracyDelta).toFixed(1)}% MAE
                    </span>
                )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {new Date(entry.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
        </div>
    </div>
);

// ─── Main Intelligence Component ──────────────────────────────────────────────
export default function Intelligence() {
    const [selectedFamily, setSelectedFamily] = useState('GROCERY I');
    const [categories, setCategories] = useState(['GROCERY I']);
    const [forecastData, setForecastData] = useState([]);
    const [metrics, setMetrics] = useState(null);
    const [anomalies, setAnomalies] = useState([]);
    const [isLoadingForecast, setIsLoadingForecast] = useState(true);
    const [isLoadingAnomalies, setIsLoadingAnomalies] = useState(true);
    const [isRetraining, setIsRetraining] = useState(false);
    const [retrainHistory, setRetrainHistory] = useState(() => {
        const saved = localStorage.getItem('retrainHistory');
        return saved ? JSON.parse(saved) : [];
    });

    // Anomaly filter state
    const [anomalySearch, setAnomalySearch] = useState('');
    const [severityFilter, setSeverityFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [sortField, setSortField] = useState('date');
    const [sortDir, setSortDir] = useState('desc');
    const [expandedAnomaly, setExpandedAnomaly] = useState(null);

    // ── Load categories ──────────────────────────────────────────────────────────
    useEffect(() => {
        fetch(`${API}/available_categories?store_id=1`, { headers: H })
            .then(r => r.json())
            .then(d => {
                if (d.categories?.length) {
                    setCategories(d.categories);
                    setSelectedFamily(p => d.categories.includes(p) ? p : d.categories[0]);
                }
            }).catch(console.error);
    }, []);

    // ── Load forecast + metrics ──────────────────────────────────────────────────
    const loadForecast = useCallback(async () => {
        setIsLoadingForecast(true);
        try {
            const res = await fetch(`${API}/predict`, {
                method: 'POST', headers: H,
                body: JSON.stringify({ store_id: 1, family: selectedFamily, months: 2 }),
            });
            if (res.ok) {
                const data = await res.json();
                setForecastData((data.forecast || []).map(item => ({
                    ...item,
                    displayDate: new Date(item.ds).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    sales: Math.round(item.yhat),
                    lower: Math.round(item.yhat_lower),
                    upper: Math.round(item.yhat_upper),
                })));
                setMetrics(data.metrics || null);
            }
        } catch (e) { console.error('Forecast fetch failed:', e); }
        finally { setIsLoadingForecast(false); }
    }, [selectedFamily]);

    // ── Load anomaly history ──────────────────────────────────────────────────────
    const loadAnomalies = useCallback(async () => {
        setIsLoadingAnomalies(true);
        try {
            const res = await fetch(`${API}/analyze_history`, {
                method: 'POST', headers: H,
                body: JSON.stringify({ store_id: 1, family: selectedFamily }),
            });
            if (res.ok) {
                const data = await res.json();
                setAnomalies(data.recent_anomalies || []);
            }
        } catch (e) { console.error('Anomaly fetch failed:', e); }
        finally { setIsLoadingAnomalies(false); }
    }, [selectedFamily]);

    useEffect(() => {
        loadForecast();
        loadAnomalies();
    }, [loadForecast, loadAnomalies]);

    // ── Retrain ───────────────────────────────────────────────────────────────────
    const handleRetrain = async () => {
        setIsRetraining(true);
        const prevMAE = metrics?.mae;
        try {
            const res = await fetch(`${API}/retrain`, {
                method: 'POST', headers: H,
                body: JSON.stringify({ store_id: 1, family: selectedFamily }),
            });
            const success = res.ok;
            const entry = {
                family: selectedFamily,
                trigger: 'Manual',
                success,
                at: new Date().toISOString(),
                accuracyDelta: null,
            };
            const updated = [entry, ...retrainHistory].slice(0, 30);
            setRetrainHistory(updated);
            localStorage.setItem('retrainHistory', JSON.stringify(updated));
            if (success) await loadForecast();
        } catch (e) {
            console.error(e);
        } finally {
            setIsRetraining(false);
        }
    };

    // ── Chart: overlay anomaly scatter on forecast ────────────────────────────────
    const overlayData = useMemo(() => {
        if (!forecastData.length) return [];
        const anomalyMap = {};
        anomalies.forEach(a => {
            const d = new Date(a.date);
            const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            anomalyMap[key] = { actual: Math.round(a.actual), severity: a.severity };
        });
        return forecastData.map(item => ({
            ...item,
            anomalyActual: anomalyMap[item.displayDate]?.actual ?? null,
            anomalySeverity: anomalyMap[item.displayDate]?.severity ?? null,
        }));
    }, [forecastData, anomalies]);

    // ── Filtered & sorted anomaly table ──────────────────────────────────────────
    const filteredAnomalies = useMemo(() => {
        return anomalies
            .filter(a => severityFilter === 'all' || a.severity === severityFilter)
            .filter(a => typeFilter === 'all' || a.type === typeFilter)
            .filter(a => !anomalySearch || new Date(a.date).toLocaleDateString().includes(anomalySearch))
            .sort((a, b) => {
                const va = sortField === 'date' ? new Date(a.date) : sortField === 'deviation' ? Math.abs(a.actual - a.expected) : a[sortField];
                const vb = sortField === 'date' ? new Date(b.date) : sortField === 'deviation' ? Math.abs(b.actual - b.expected) : b[sortField];
                return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
            });
    }, [anomalies, severityFilter, typeFilter, anomalySearch, sortField, sortDir]);

    const toggleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('desc'); }
    };

    // ── Anomaly frequency by type ─────────────────────────────────────────────────
    const anomalyBarData = useMemo(() => {
        const bySeverity = {};
        anomalies.forEach(a => {
            const key = a.type || 'Unknown';
            if (!bySeverity[key]) bySeverity[key] = { type: key, High: 0, Medium: 0, Low: 0 };
            bySeverity[key][a.severity] = (bySeverity[key][a.severity] || 0) + 1;
        });
        return Object.values(bySeverity);
    }, [anomalies]);

    const isFresh = !metrics?.freshness_label?.includes('Stale');

    return (
        <div className="page-container">

            {/* ── Header ── */}
            <div className="page-header page-header-row">
                <div style={{ flex: '1 1 auto' }}>
                    <h1>Intelligence Center</h1>
                    <p>Store 1 · Model health, forecast explainability &amp; anomaly deep-dives</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div className="fancy-select">
                        <label>Category</label>
                        <select value={selectedFamily} onChange={e => setSelectedFamily(e.target.value)}>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <button className="btn" onClick={() => { loadForecast(); loadAnomalies(); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12 }}>
                        <RefreshCw size={12} /> Refresh
                    </button>
                </div>
            </div>

            {/* ══ SECTION 1: MODEL HEALTH ════════════════════════════════════════════ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                <MetricBadge label="MAE" value={metrics?.mae != null ? metrics.mae.toFixed(1) : null} unit="units" color="var(--accent)" icon={Target} />
                <MetricBadge label="RMSE" value={metrics?.rmse != null ? metrics.rmse.toFixed(1) : null} unit="units" color="var(--violet)" icon={Activity} />
                <MetricBadge label="MAPE" value={metrics?.mape != null ? metrics.mape.toFixed(1) : null} unit="%" color="var(--warning)" icon={TrendingUp} />
                <div className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)' }}>Model Status</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                            background: isFresh ? 'var(--success-dim)' : 'var(--danger-dim)',
                            color: isFresh ? 'var(--success)' : 'var(--danger)',
                            border: `1px solid ${isFresh ? 'rgba(0,217,126,0.3)' : 'rgba(255,71,87,0.3)'}`,
                        }}>
                            {metrics?.freshness_label ?? '—'}
                        </span>
                    </div>
                    {metrics?.trained_at && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={10} />
                            {new Date(metrics.trained_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                    )}
                    <button onClick={handleRetrain} disabled={isRetraining}
                        style={{
                            marginTop: 4, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                            background: 'transparent', border: '1px solid var(--border)',
                            borderRadius: 6, color: 'var(--text-2)', cursor: isRetraining ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5, opacity: isRetraining ? 0.5 : 1,
                        }}>
                        <RefreshCw size={10} className={isRetraining ? 'spin-animation' : ''} />
                        {isRetraining ? 'Retraining…' : 'Force Retrain'}
                    </button>
                </div>
            </div>

            {/* ══ SECTION 2: FORECAST + ANOMALY OVERLAY ═════════════════════════════ */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>

                {/* Forecast Chart */}
                <div className="card" style={{ padding: 24 }}>
                    <div className="section-title" style={{ marginBottom: 16 }}>
                        <span className="icon-wrap"><BarChart2 size={14} /></span>
                        Forecast + Anomaly Overlay · {selectedFamily}
                        <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400, marginLeft: 8 }}>
                            Anomaly dots mark actual values on forecast dates
                        </span>
                    </div>
                    {isLoadingForecast ? (
                        <div className="skeleton" style={{ height: 280, borderRadius: 8 }} />
                    ) : overlayData.length === 0 ? (
                        <div className="empty-state" style={{ minHeight: 280 }}><BarChart2 size={28} strokeWidth={1} /><p>No forecast data</p></div>
                    ) : (
                        <ResponsiveContainer width="100%" height={280}>
                            <ComposedChart data={overlayData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="bandFill2" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.01} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="displayDate" tick={{ fill: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickMargin={8} />
                                <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-glow)', strokeWidth: 1 }} />
                                <Legend wrapperStyle={{ paddingTop: 16, fontSize: 12, color: 'var(--text-2)' }} />
                                <Area type="monotone" dataKey="upper" name="Upper Band" fill="url(#bandFill2)" stroke="rgba(0,207,255,0.1)" strokeWidth={1} dot={false} />
                                <Area type="monotone" dataKey="lower" name="Lower Band" fill="transparent" stroke="rgba(0,207,255,0.1)" strokeWidth={1} dot={false} />
                                <Line type="monotone" dataKey="sales" name="Forecast" stroke="var(--accent)" strokeWidth={2.5} dot={false}
                                    activeDot={{ r: 4, fill: 'var(--accent)', strokeWidth: 0 }} />
                                <Scatter dataKey="anomalyActual" name="Anomaly (actual)"
                                    fill="var(--danger)"
                                    shape={(props) => {
                                        if (props.anomalyActual == null) return null;
                                        const isSevere = props.anomalySeverity === 'High';
                                        return <circle cx={props.cx} cy={props.cy} r={isSevere ? 6 : 4} fill="var(--danger)" opacity={0.85} />;
                                    }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Retrain History */}
                <div className="card" style={{ padding: 24, maxHeight: 380, overflowY: 'auto' }}>
                    <div className="section-title" style={{ position: 'sticky', top: 0, background: 'var(--surface-1)', paddingBottom: 12, zIndex: 1 }}>
                        <span className="icon-wrap"><History size={14} /></span>
                        Retrain History
                    </div>
                    {retrainHistory.length === 0 ? (
                        <div className="empty-state" style={{ padding: '20px 0' }}>
                            <Cpu size={22} strokeWidth={1} />
                            <p style={{ fontSize: 12 }}>No retrains yet. Use the Force Retrain button above.</p>
                        </div>
                    ) : (
                        <div style={{ marginTop: 8 }}>
                            {retrainHistory.map((entry, i) => (
                                <TimelineEntry key={i} entry={entry} isLast={i === retrainHistory.length - 1} />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ══ SECTION 3: ANOMALY EXPLORER ═══════════════════════════════════════ */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>

                {/* Full anomaly table */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertCircle size={14} style={{ color: 'var(--danger)' }} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Anomaly Explorer</span>
                            <span style={{ fontSize: 11, background: 'var(--danger-dim)', color: 'var(--danger)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                                {filteredAnomalies.length}
                            </span>
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div className="fancy-select">
                                <label>Severity</label>
                                <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>
                                    <option value="all">All</option>
                                    <option value="High">High</option>
                                    <option value="Medium">Medium</option>
                                    <option value="Low">Low</option>
                                </select>
                            </div>
                            <div className="fancy-select">
                                <label>Type</label>
                                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                                    <option value="all">All</option>
                                    <option value="Spike">Spike</option>
                                    <option value="Drop">Drop</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {isLoadingAnomalies ? (
                        <div style={{ padding: 20 }}>
                            {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 56, borderRadius: 8, marginBottom: 10 }} />)}
                        </div>
                    ) : filteredAnomalies.length === 0 ? (
                        <div className="empty-state" style={{ padding: '40px 0' }}>
                            <Zap size={26} strokeWidth={1} />
                            <p>No anomalies detected for this selection.</p>
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                        {[
                                            { key: 'date', label: 'Date' },
                                            { key: 'severity', label: 'Severity' },
                                            { key: 'type', label: 'Type' },
                                            { key: 'actual', label: 'Actual' },
                                            { key: 'expected', label: 'Expected' },
                                            { key: 'deviation', label: 'Deviation' },
                                        ].map(col => (
                                            <th key={col.key} onClick={() => toggleSort(col.key)}
                                                style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: sortField === col.key ? 'var(--accent)' : 'var(--text-3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                {col.label} {sortField === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                                            </th>
                                        ))}
                                        <th style={{ padding: '10px 14px' }} />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredAnomalies.map((a, i) => {
                                        const isHigh = a.severity === 'High';
                                        const isSpike = a.type === 'Spike';
                                        const deviation = Math.round(Math.abs(a.actual - a.expected));
                                        const deviationPct = a.expected > 0 ? Math.round((deviation / a.expected) * 100) : 0;
                                        const isExpanded = expandedAnomaly === i;
                                        return (
                                            <React.Fragment key={i}>
                                                <tr style={{ borderBottom: '1px solid var(--border)', background: isExpanded ? 'rgba(255,71,87,0.04)' : i % 2 !== 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}>
                                                    <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                                                        {new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                    </td>
                                                    <td style={{ padding: '10px 14px' }}>
                                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: isHigh ? 'var(--danger-dim)' : 'var(--warning-dim)', color: isHigh ? 'var(--danger)' : 'var(--warning)' }}>
                                                            {a.severity}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '10px 14px' }}>
                                                        <span style={{ fontSize: 11, fontWeight: 600, color: isSpike ? 'var(--accent)' : 'var(--violet)' }}>
                                                            {isSpike ? '↑' : '↓'} {a.type}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700 }}>{Math.round(a.actual)}</td>
                                                    <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{Math.round(a.expected)}</td>
                                                    <td style={{ padding: '10px 14px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: isHigh ? 'var(--danger)' : 'var(--warning)' }}>
                                                                +{deviationPct}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '10px 14px' }}>
                                                        <button onClick={() => setExpandedAnomaly(isExpanded ? null : i)}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center' }}>
                                                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr>
                                                        <td colSpan={7} style={{ padding: '12px 14px 14px', background: 'rgba(255,71,87,0.03)', borderBottom: '1px solid var(--border)' }}>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                                                                {[
                                                                    { label: 'Actual Sales', value: `${Math.round(a.actual)} units`, color: 'var(--text-1)' },
                                                                    { label: 'Expected Sales', value: `${Math.round(a.expected)} units`, color: 'var(--text-2)' },
                                                                    { label: 'Deviation', value: `${deviation} units (${deviationPct}%)`, color: isHigh ? 'var(--danger)' : 'var(--warning)' },
                                                                ].map(({ label, value, color }) => (
                                                                    <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 6, padding: '8px 12px' }}>
                                                                        <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
                                                                        <div style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Anomaly frequency chart */}
                <div className="card" style={{ padding: 24 }}>
                    <div className="section-title" style={{ marginBottom: 16 }}>
                        <span className="icon-wrap" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}><AlertTriangle size={14} /></span>
                        Anomaly Frequency by Type
                    </div>
                    {anomalyBarData.length === 0 ? (
                        <div className="empty-state" style={{ minHeight: 200 }}>
                            <Zap size={22} strokeWidth={1} />
                            <p style={{ fontSize: 12 }}>No frequency data</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={anomalyBarData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="type" tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
                                <Bar dataKey="High" stackId="a" fill="var(--danger)" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="Medium" stackId="a" fill="var(--warning)" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="Low" stackId="a" fill="var(--success)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}

                    {/* Summary stats */}
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[
                            { label: 'High Severity', count: anomalies.filter(a => a.severity === 'High').length, color: 'var(--danger)' },
                            { label: 'Medium Severity', count: anomalies.filter(a => a.severity === 'Medium').length, color: 'var(--warning)' },
                            { label: 'Spike Events', count: anomalies.filter(a => a.type === 'Spike').length, color: 'var(--accent)' },
                            { label: 'Drop Events', count: anomalies.filter(a => a.type === 'Drop').length, color: 'var(--violet)' },
                        ].map(({ label, count, color }) => (
                            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color }}>{count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}