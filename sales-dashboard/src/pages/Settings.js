import React, { useState, useEffect, useMemo } from 'react';
import {
    Settings, Package, Users, Bell, Cpu, Link,
    Plus, Pencil, Trash2, Save, X, Check,
    ChevronRight, RefreshCw, Shield, Sliders,
    AlertCircle, CheckCircle, Database
} from 'lucide-react';

const API = 'http://127.0.0.1:8000';
const H = { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' };

// ─── Default settings ────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
    forecastMonths: 1,
    anomalySigma: 2.5,
    autoRetrainEnabled: false,
    autoRetrainMAEPct: 15,
    showHighAnomalies: true,
    showMediumAnomalies: true,
    showLowAnomalies: false,
    apiKey: 'secret-token',
    backendUrl: 'http://127.0.0.1:8000',
    storeId: 1,
};

const DEFAULT_SUPPLIERS = [
    { id: 'SUP-001', name: 'Metro Foods', contact: 'metro@foods.com', leadDays: 3, categories: 'GROCERY I, GROCERY II', lastOrder: '2025-03-10' },
    { id: 'SUP-002', name: 'DrinksCo', contact: 'orders@drinksco.io', leadDays: 5, categories: 'BEVERAGES', lastOrder: '2025-03-16' },
    { id: 'SUP-003', name: 'CleanPro', contact: 'supply@cleanpro.com', leadDays: 7, categories: 'CLEANING', lastOrder: '2025-03-17' },
    { id: 'SUP-004', name: 'GreenLeaf', contact: 'hello@greenleaf.co', leadDays: 2, categories: 'PRODUCE', lastOrder: '2025-03-15' },
    { id: 'SUP-005', name: 'DairyCo', contact: 'ops@dairyco.net', leadDays: 4, categories: 'DAIRY', lastOrder: '2025-03-12' },
    { id: 'SUP-006', name: 'FreshMart', contact: 'buy@freshmart.com', leadDays: 6, categories: 'GROCERY II, FROZEN', lastOrder: '2025-02-28' },
];

// ─── Toggle Switch ────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange, label, sub }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
        <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', marginBottom: 2 }}>{label}</div>
            {sub && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{sub}</div>}
        </div>
        <button
            onClick={() => onChange(!checked)}
            style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: checked ? 'var(--accent)' : 'var(--border)',
                position: 'relative', flexShrink: 0, transition: 'background 0.2s',
            }}>
            <span style={{
                position: 'absolute', top: 3, left: checked ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
        </button>
    </div>
);

// ─── Section Title ─────────────────────────────────────────────────────────────
const SectionTitle = ({ icon: Icon, children, iconBg, iconColor }) => (
    <div className="section-title" style={{ marginBottom: 20 }}>
        <span className="icon-wrap" style={{ background: iconBg, color: iconColor }}>
            <Icon size={14} />
        </span>
        {children}
    </div>
);

// ─── Supplier Form (inline) ───────────────────────────────────────────────────
const SupplierForm = ({ initial, onSave, onCancel }) => {
    const [form, setForm] = useState(initial || { name: '', contact: '', leadDays: 5, categories: '' });
    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            {[
                { key: 'name', label: 'Supplier Name', type: 'text', span: false },
                { key: 'contact', label: 'Contact / Email', type: 'email', span: false },
                { key: 'leadDays', label: 'Lead Time (days)', type: 'number', span: false },
                { key: 'categories', label: 'Categories served (comma-sep)', type: 'text', span: true },
            ].map(field => (
                <div key={field.key} style={{ gridColumn: field.span ? '1 / -1' : 'auto' }}>
                    <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>
                        {field.label}
                    </label>
                    <input
                        type={field.type}
                        value={form[field.key]}
                        onChange={e => set(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                        style={{ width: '100%', background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', color: 'var(--text-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                    />
                </div>
            ))}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn" onClick={onCancel} style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <X size={12} /> Cancel
                </button>
                <button className="btn btn-primary" onClick={() => onSave(form)} style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Save size={12} /> Save
                </button>
            </div>
        </div>
    );
};

// ─── Main Settings Component ──────────────────────────────────────────────────
export default function SettingsPage() {
    const [activeSection, setActiveSection] = useState('suppliers');
    const [categories, setCategories] = useState(['GROCERY I']);
    const [saved, setSaved] = useState(false);

    // Suppliers
    const [suppliers, setSuppliers] = useState(() => {
        const s = localStorage.getItem('supplierDirectory');
        return s ? JSON.parse(s) : DEFAULT_SUPPLIERS;
    });
    const [editingSupplierId, setEditingSupplierId] = useState(null);
    const [addingSupplier, setAddingSupplier] = useState(false);

    // Thresholds (per-category)
    const [thresholds, setThresholds] = useState(() => {
        const t = localStorage.getItem('categoryThresholds');
        return t ? JSON.parse(t) : {};
    });

    // App settings
    const [settings, setSettings] = useState(() => {
        const s = localStorage.getItem('appSettings');
        return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS;
    });

    // Connection status
    const [connStatus, setConnStatus] = useState(null); // null | 'ok' | 'fail'
    const [isTesting, setIsTesting] = useState(false);

    // ── Load categories ──────────────────────────────────────────────────────────
    useEffect(() => {
        fetch(`${API}/available_categories?store_id=1`, { headers: H })
            .then(r => r.json())
            .then(d => { if (d.categories?.length) setCategories(d.categories); })
            .catch(console.error);
    }, []);

    // ── Persist on change ────────────────────────────────────────────────────────
    useEffect(() => { localStorage.setItem('supplierDirectory', JSON.stringify(suppliers)); }, [suppliers]);
    useEffect(() => { localStorage.setItem('categoryThresholds', JSON.stringify(thresholds)); }, [thresholds]);
    useEffect(() => { localStorage.setItem('appSettings', JSON.stringify(settings)); }, [settings]);

    const setSetting = (k, v) => setSettings(p => ({ ...p, [k]: v }));

    // ── Threshold helpers ────────────────────────────────────────────────────────
    const getThreshold = (family, key, fallback) =>
        thresholds[family]?.[key] ?? fallback;
    const setThreshold = (family, key, value) =>
        setThresholds(p => ({ ...p, [family]: { ...(p[family] || {}), [key]: value } }));

    // ── Supplier CRUD ────────────────────────────────────────────────────────────
    const addSupplier = (form) => {
        const id = `SUP-${String(suppliers.length + 1).padStart(3, '0')}`;
        setSuppliers(p => [...p, { ...form, id, lastOrder: '—' }]);
        setAddingSupplier(false);
    };
    const updateSupplier = (id, form) => {
        setSuppliers(p => p.map(s => s.id === id ? { ...s, ...form } : s));
        setEditingSupplierId(null);
    };
    const deleteSupplier = (id) => {
        if (window.confirm('Remove this supplier?')) setSuppliers(p => p.filter(s => s.id !== id));
    };

    // ── Test connection ──────────────────────────────────────────────────────────
    const testConnection = async () => {
        setIsTesting(true);
        setConnStatus(null);
        try {
            const res = await fetch(`${settings.backendUrl}/available_categories?store_id=${settings.storeId}`, {
                headers: { 'X-API-Key': settings.apiKey },
            });
            setConnStatus(res.ok ? 'ok' : 'fail');
        } catch { setConnStatus('fail'); }
        finally { setIsTesting(false); }
    };

    // ── Flash save indicator ──────────────────────────────────────────────────────
    const flashSave = () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const NAV = [
        { id: 'suppliers', label: 'Supplier Directory', icon: Users, iconBg: 'var(--accent-dim)', iconColor: 'var(--accent)' },
        { id: 'thresholds', label: 'Category Thresholds', icon: Sliders, iconBg: 'var(--violet-dim)', iconColor: 'var(--violet)' },
        { id: 'alerts', label: 'Alerts & Retraining', icon: Bell, iconBg: 'var(--warning-dim)', iconColor: 'var(--warning)' },
        { id: 'api', label: 'API & Connection', icon: Link, iconBg: 'var(--success-dim)', iconColor: 'var(--success)' },
    ];

    return (
        <div className="page-container">

            {/* ── Header ── */}
            <div className="page-header page-header-row">
                <div style={{ flex: '1 1 auto' }}>
                    <h1>Settings</h1>
                    <p>Suppliers, thresholds, alert rules, model behaviour &amp; API config</p>
                </div>
                {saved && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)', background: 'var(--success-dim)', padding: '6px 14px', borderRadius: 8 }}>
                        <Check size={12} /> Saved
                    </div>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, alignItems: 'start' }}>

                {/* ── Sidebar nav ── */}
                <div className="card" style={{ padding: 8 }}>
                    {NAV.map(item => (
                        <button key={item.id} onClick={() => setActiveSection(item.id)}
                            style={{
                                width: '100%', padding: '10px 12px', border: 'none', borderRadius: 8,
                                background: activeSection === item.id ? 'var(--surface-2)' : 'transparent',
                                color: activeSection === item.id ? 'var(--text-1)' : 'var(--text-2)',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                                fontSize: 13, fontFamily: 'var(--font-body)', textAlign: 'left',
                                transition: 'all 0.15s',
                            }}>
                            <span style={{ width: 28, height: 28, borderRadius: 6, background: item.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <item.icon size={13} style={{ color: item.iconColor }} />
                            </span>
                            {item.label}
                            {activeSection === item.id && <ChevronRight size={12} style={{ marginLeft: 'auto', color: 'var(--text-3)' }} />}
                        </button>
                    ))}
                </div>

                {/* ── Content area ── */}
                <div>

                    {/* ══ SUPPLIERS ═══════════════════════════════════════════════════ */}
                    {activeSection === 'suppliers' && (
                        <div className="card" style={{ padding: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <SectionTitle icon={Users} iconBg="var(--accent-dim)" iconColor="var(--accent)">
                                    Supplier Directory
                                </SectionTitle>
                                <button className="btn btn-primary" onClick={() => setAddingSupplier(true)} disabled={addingSupplier}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12 }}>
                                    <Plus size={12} /> Add Supplier
                                </button>
                            </div>

                            {addingSupplier && (
                                <div style={{ marginBottom: 16 }}>
                                    <SupplierForm onSave={addSupplier} onCancel={() => setAddingSupplier(false)} />
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {suppliers.map(sup => (
                                    <div key={sup.id}>
                                        {editingSupplierId === sup.id ? (
                                            <SupplierForm initial={sup} onSave={(f) => updateSupplier(sup.id, f)} onCancel={() => setEditingSupplierId(null)} />
                                        ) : (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 80px 1.5fr 120px auto', gap: 0, alignItems: 'center', padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                                                <div>
                                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{sup.name}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{sup.id}</div>
                                                </div>
                                                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{sup.contact}</div>
                                                <div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>Lead time</div>
                                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: sup.leadDays <= 3 ? 'var(--success)' : sup.leadDays <= 5 ? 'var(--warning)' : 'var(--danger)' }}>
                                                        {sup.leadDays}d
                                                    </div>
                                                </div>
                                                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{sup.categories}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                                                    Last order: {sup.lastOrder !== '—' ? new Date(sup.lastOrder).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                                </div>
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    <button onClick={() => setEditingSupplierId(sup.id)}
                                                        style={{ padding: '5px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>
                                                        <Pencil size={12} />
                                                    </button>
                                                    <button onClick={() => deleteSupplier(sup.id)}
                                                        style={{ padding: '5px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--danger)', display: 'flex', alignItems: 'center' }}>
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ══ THRESHOLDS ═══════════════════════════════════════════════════ */}
                    {activeSection === 'thresholds' && (
                        <div className="card" style={{ padding: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <SectionTitle icon={Sliders} iconBg="var(--violet-dim)" iconColor="var(--violet)">
                                    Per-Category Thresholds
                                </SectionTitle>
                                <button className="btn btn-primary" onClick={flashSave}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12 }}>
                                    <Save size={12} /> Save All
                                </button>
                            </div>

                            <div style={{ display: 'grid', gap: 10 }}>
                                {/* Header row */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 12, padding: '6px 12px' }}>
                                    {['Category', 'Min Stock', 'Reorder Point', 'Max Order Qty'].map(h => (
                                        <span key={h} style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)' }}>{h}</span>
                                    ))}
                                </div>

                                {categories.map(family => (
                                    <div key={family} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 12, padding: '12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{family}</div>
                                            {getThreshold(family, 'minStock', null) != null && (
                                                <div style={{ fontSize: 10, color: 'var(--success)', marginTop: 2 }}>✓ Configured</div>
                                            )}
                                        </div>
                                        {[
                                            { key: 'minStock', placeholder: '20', label: 'units' },
                                            { key: 'reorderPoint', placeholder: '50', label: 'units' },
                                            { key: 'maxOrderQty', placeholder: '500', label: 'units' },
                                        ].map(field => (
                                            <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px' }}>
                                                <input
                                                    type="number" min="0"
                                                    value={getThreshold(family, field.key, '')}
                                                    onChange={e => setThreshold(family, field.key, Number(e.target.value))}
                                                    placeholder={field.placeholder}
                                                    style={{ width: '70%', background: 'transparent', border: 'none', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, outline: 'none' }}
                                                />
                                                <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{field.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>

                            <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <AlertCircle size={12} />
                                Thresholds are stored locally and used by the AI assistant's inventory check tool to determine restock urgency.
                            </div>
                        </div>
                    )}

                    {/* ══ ALERTS & RETRAINING ═════════════════════════════════════════ */}
                    {activeSection === 'alerts' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                            {/* Anomaly alerts */}
                            <div className="card" style={{ padding: 24 }}>
                                <SectionTitle icon={Bell} iconBg="var(--warning-dim)" iconColor="var(--warning)">
                                    Anomaly Alert Visibility
                                </SectionTitle>
                                <Toggle
                                    checked={settings.showHighAnomalies}
                                    onChange={v => setSetting('showHighAnomalies', v)}
                                    label="High severity anomalies"
                                    sub="Spikes or drops > 3σ from expected — always recommended"
                                />
                                <Toggle
                                    checked={settings.showMediumAnomalies}
                                    onChange={v => setSetting('showMediumAnomalies', v)}
                                    label="Medium severity anomalies"
                                    sub="Deviations between 2–3σ"
                                />
                                <Toggle
                                    checked={settings.showLowAnomalies}
                                    onChange={v => setSetting('showLowAnomalies', v)}
                                    label="Low severity anomalies"
                                    sub="Minor deviations < 2σ — can be noisy"
                                />

                                <div style={{ marginTop: 20 }}>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                                        Anomaly Detection Sensitivity (σ multiplier)
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Loose (1.5σ)</span>
                                        <input type="range" min="1.5" max="4" step="0.1" value={settings.anomalySigma}
                                            onChange={e => setSetting('anomalySigma', parseFloat(e.target.value))}
                                            style={{ flex: 1 }} />
                                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Strict (4σ)</span>
                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--accent)', minWidth: 40 }}>
                                            {settings.anomalySigma.toFixed(1)}σ
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                                        Lower = more sensitive (more anomalies flagged). Current: {settings.anomalySigma}σ
                                    </div>
                                </div>
                            </div>

                            {/* Model retraining */}
                            <div className="card" style={{ padding: 24 }}>
                                <SectionTitle icon={Cpu} iconBg="var(--violet-dim)" iconColor="var(--violet)">
                                    Model Retraining Rules
                                </SectionTitle>
                                <Toggle
                                    checked={settings.autoRetrainEnabled}
                                    onChange={v => setSetting('autoRetrainEnabled', v)}
                                    label="Auto-retrain on staleness"
                                    sub="Automatically trigger retrain when model accuracy degrades beyond threshold"
                                />
                                <div style={{ marginTop: 16, opacity: settings.autoRetrainEnabled ? 1 : 0.4, transition: 'opacity 0.2s' }}>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                                        Retrain trigger threshold (MAE degradation %)
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <input type="range" min="5" max="40" step="1" value={settings.autoRetrainMAEPct}
                                            onChange={e => setSetting('autoRetrainMAEPct', Number(e.target.value))}
                                            disabled={!settings.autoRetrainEnabled} style={{ flex: 1 }} />
                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--violet)', minWidth: 50 }}>
                                            {settings.autoRetrainMAEPct}%
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                                        Retrain fires when MAE increases by more than {settings.autoRetrainMAEPct}% vs baseline
                                    </div>
                                </div>

                                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                                        Default Forecast Horizon
                                    </label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <input type="range" min="1" max="12" step="1" value={settings.forecastMonths}
                                            onChange={e => setSetting('forecastMonths', Number(e.target.value))}
                                            style={{ flex: 1 }} />
                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--accent)', minWidth: 80 }}>
                                            {settings.forecastMonths} mo{settings.forecastMonths > 1 ? 's' : ''}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                                        Currently hardcoded to 1 month in Dashboard — this setting will be respected once the API call is updated.
                                    </div>
                                </div>

                                <button className="btn btn-primary" onClick={flashSave}
                                    style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12 }}>
                                    <Save size={12} /> Save Settings
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ══ API & CONNECTION ════════════════════════════════════════════ */}
                    {activeSection === 'api' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                            <div className="card" style={{ padding: 24 }}>
                                <SectionTitle icon={Link} iconBg="var(--success-dim)" iconColor="var(--success)">
                                    API Configuration
                                </SectionTitle>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    {[
                                        { key: 'backendUrl', label: 'Backend URL', type: 'url', placeholder: 'http://127.0.0.1:8000' },
                                        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'secret-token' },
                                        { key: 'storeId', label: 'Store ID', type: 'number', placeholder: '1' },
                                    ].map(field => (
                                        <div key={field.key}>
                                            <label style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>
                                                {field.label}
                                            </label>
                                            <input
                                                type={field.type}
                                                value={settings[field.key]}
                                                onChange={e => setSetting(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                                                placeholder={field.placeholder}
                                                style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', color: 'var(--text-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: field.type === 'password' ? 'var(--font-mono)' : 'inherit' }}
                                            />
                                        </div>
                                    ))}

                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
                                        <button onClick={testConnection} disabled={isTesting}
                                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', cursor: isTesting ? 'default' : 'pointer', fontFamily: 'var(--font-body)' }}>
                                            <RefreshCw size={12} className={isTesting ? 'spin-animation' : ''} />
                                            {isTesting ? 'Testing…' : 'Test Connection'}
                                        </button>
                                        {connStatus === 'ok' && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--success)' }}>
                                                <CheckCircle size={13} /> Connected successfully
                                            </span>
                                        )}
                                        {connStatus === 'fail' && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--danger)' }}>
                                                <AlertCircle size={13} /> Connection failed — check URL and API key
                                            </span>
                                        )}
                                    </div>

                                    <button className="btn btn-primary" onClick={flashSave}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, alignSelf: 'flex-start' }}>
                                        <Save size={12} /> Save Config
                                    </button>
                                </div>
                            </div>

                            {/* Database info */}
                            <div className="card" style={{ padding: 24 }}>
                                <SectionTitle icon={Database} iconBg="var(--surface-2)" iconColor="var(--text-2)">
                                    Database Schema Context
                                </SectionTitle>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', lineHeight: 1.7 }}>
                                    <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 8 }}>Table: historical_sales</div>
                                    {[
                                        ['date', 'DATE', 'Sales record date'],
                                        ['store_id', 'INTEGER', 'Store identifier'],
                                        ['family', 'VARCHAR', "Product category (e.g. 'GROCERY I')"],
                                        ['sales', 'FLOAT', 'Units sold'],
                                        ['onpromotion', 'INTEGER', 'Items on promotion'],
                                        ['oil_price', 'FLOAT', 'Daily crude oil price'],
                                    ].map(([col, type, desc]) => (
                                        <div key={col} style={{ display: 'grid', gridTemplateColumns: '130px 90px 1fr', gap: 8, marginBottom: 4 }}>
                                            <span style={{ color: 'var(--text-1)' }}>{col}</span>
                                            <span style={{ color: 'var(--warning)' }}>{type}</span>
                                            <span style={{ color: 'var(--text-3)' }}>{desc}</span>
                                        </div>
                                    ))}
                                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 11 }}>
                                        Also: purchase_orders (id, tenant_id, family, quantity, estimated_cost, status, created_at)
                                    </div>
                                </div>
                            </div>

                            {/* Reset section */}
                            <div className="card" style={{ padding: 24 }}>
                                <SectionTitle icon={Shield} iconBg="var(--danger-dim)" iconColor="var(--danger)">
                                    Reset &amp; Data Management
                                </SectionTitle>
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                    {[
                                        { label: 'Reset Suppliers', key: 'supplierDirectory', value: JSON.stringify(DEFAULT_SUPPLIERS), color: 'var(--warning)' },
                                        { label: 'Reset Thresholds', key: 'categoryThresholds', value: '{}', color: 'var(--warning)' },
                                        { label: 'Reset Settings', key: 'appSettings', value: JSON.stringify(DEFAULT_SETTINGS), color: 'var(--danger)' },
                                        { label: 'Clear Order History', key: 'orderHistory', value: null, color: 'var(--danger)' },
                                        { label: 'Clear Retrain History', key: 'retrainHistory', value: '[]', color: 'var(--danger)' },
                                    ].map(item => (
                                        <button key={item.key}
                                            onClick={() => {
                                                if (!window.confirm(`Reset ${item.label}? This cannot be undone.`)) return;
                                                if (item.value === null) localStorage.removeItem(item.key);
                                                else localStorage.setItem(item.key, item.value);
                                                window.location.reload();
                                            }}
                                            style={{ padding: '7px 14px', fontSize: 12, background: 'transparent', border: `1px solid ${item.color}`, borderRadius: 8, color: item.color, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                                <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-3)' }}>
                                    All data is stored in your browser's localStorage. Resetting will reload the page.
                                </div>
                            </div>

                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}