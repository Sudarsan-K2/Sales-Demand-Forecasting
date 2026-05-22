import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    ShoppingCart, Clock, CheckCircle, Package, XCircle,
    DollarSign, Filter, Download, RefreshCw, Truck,
    Search, TrendingUp, BarChart2, Bot, User
} from 'lucide-react';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
    CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend
} from 'recharts';

const API = 'http://127.0.0.1:8000';
const H = { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' };

// ─── Status Config ────────────────────────────────────────────────────────────
const STATUS = {
    pending: { label: 'Pending', color: 'var(--warning)', dim: 'var(--warning-dim)', Icon: Clock },
    approved: { label: 'Approved', color: 'var(--accent)', dim: 'var(--accent-dim)', Icon: CheckCircle },
    ordered: { label: 'Ordered', color: 'var(--violet)', dim: 'var(--violet-dim)', Icon: Truck },
    delivered: { label: 'Delivered', color: 'var(--success)', dim: 'var(--success-dim)', Icon: Package },
    rejected: { label: 'Rejected', color: 'var(--danger)', dim: 'var(--danger-dim)', Icon: XCircle },
};

// ─── Demo Seed Orders (used when backend has no /orders endpoint yet) ─────────
const SEED_ORDERS = [
    { id: 'ORD-001', family: 'GROCERY I', qty: 120, cost: 1860, supplier: 'Metro Foods', status: 'delivered', date: '2025-03-10', source: 'AI' },
    { id: 'ORD-002', family: 'BEVERAGES', qty: 80, cost: 1240, supplier: 'DrinksCo', status: 'approved', date: '2025-03-14', source: 'Manual' },
    { id: 'ORD-003', family: 'CLEANING', qty: 45, cost: 697, supplier: 'CleanPro', status: 'pending', date: '2025-03-17', source: 'AI' },
    { id: 'ORD-004', family: 'GROCERY II', qty: 200, cost: 3100, supplier: 'FreshMart', status: 'pending', date: '2025-03-18', source: 'AI' },
    { id: 'ORD-005', family: 'PRODUCE', qty: 60, cost: 930, supplier: 'GreenLeaf', status: 'ordered', date: '2025-03-15', source: 'AI' },
    { id: 'ORD-006', family: 'DAIRY', qty: 90, cost: 1395, supplier: 'DairyCo', status: 'rejected', date: '2025-03-12', source: 'Manual' },
    { id: 'ORD-007', family: 'GROCERY I', qty: 150, cost: 2325, supplier: 'Metro Foods', status: 'delivered', date: '2025-03-08', source: 'AI' },
    { id: 'ORD-008', family: 'BEVERAGES', qty: 100, cost: 1550, supplier: 'DrinksCo', status: 'ordered', date: '2025-03-16', source: 'AI' },
    { id: 'ORD-009', family: 'CLEANING', qty: 70, cost: 1085, supplier: 'CleanPro', status: 'delivered', date: '2025-03-05', source: 'AI' },
    { id: 'ORD-010', family: 'PRODUCE', qty: 55, cost: 852, supplier: 'GreenLeaf', status: 'approved', date: '2025-03-19', source: 'AI' },
    { id: 'ORD-011', family: 'DAIRY', qty: 110, cost: 1705, supplier: 'DairyCo', status: 'delivered', date: '2025-03-01', source: 'Manual' },
    { id: 'ORD-012', family: 'GROCERY II', qty: 130, cost: 2015, supplier: 'FreshMart', status: 'delivered', date: '2025-02-28', source: 'AI' },
];

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: 'var(--surface-2)', border: '1px solid var(--border-glow)',
            borderRadius: 8, padding: '10px 14px',
            fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>
            <div style={{ color: 'var(--text-2)', marginBottom: 6, fontFamily: 'var(--font-body)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
            {payload.map((p, i) => (
                <div key={i} style={{ color: p.color, display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-2)' }}>{p.name}</span>
                    <span style={{ fontWeight: 700 }}>{p.name === 'Spend' ? `$${p.value.toLocaleString()}` : p.value}</span>
                </div>
            ))}
        </div>
    );
};

// ─── Kanban Card ──────────────────────────────────────────────────────────────
const KanbanCard = ({ order, onStatusChange }) => {
    const [isUpdating, setIsUpdating] = useState(false);

    const advanceStatus = async (newStatus) => {
        setIsUpdating(true);
        // If approving from pending, also sync with backend
        if (newStatus === 'approved') {
            try {
                await fetch(`${API}/submit_order`, {
                    method: 'POST', headers: H,
                    body: JSON.stringify({ store_id: 1, family: order.family, quantity: order.qty, action: 'approve' }),
                });
            } catch (e) { console.warn('Backend sync failed, updating locally', e); }
        }
        if (newStatus === 'rejected') {
            try {
                await fetch(`${API}/submit_order`, {
                    method: 'POST', headers: H,
                    body: JSON.stringify({ store_id: 1, family: order.family, quantity: order.qty, action: 'reject' }),
                });
            } catch (e) { console.warn('Backend sync failed', e); }
        }
        onStatusChange(order.id, newStatus);
        setIsUpdating(false);
    };

    const cfg = STATUS[order.status];

    return (
        <div className="card fade-in" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{order.id}</span>
                <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                    background: order.source === 'AI' ? 'var(--violet-dim)' : 'var(--surface-2)',
                    color: order.source === 'AI' ? 'var(--violet)' : 'var(--text-3)',
                    display: 'flex', alignItems: 'center', gap: 3,
                }}>
                    {order.source === 'AI' ? <Bot size={9} /> : <User size={9} />} {order.source}
                </span>
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 3 }}>{order.family}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>{order.supplier}</div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6 }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>QTY</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700 }}>{order.qty}</div>
                </div>
                <div style={{ width: '1px', background: 'var(--border)' }} />
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>COST</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                        ${order.cost.toLocaleString()}
                    </div>
                </div>
            </div>

            {/* Action buttons by current status */}
            {order.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary" onClick={() => advanceStatus('approved')} disabled={isUpdating}
                        style={{ flex: 1, padding: '5px 0', fontSize: 11 }}>
                        {isUpdating ? '...' : 'Approve'}
                    </button>
                    <button className="btn" onClick={() => advanceStatus('rejected')} disabled={isUpdating}
                        style={{ padding: '5px 10px', fontSize: 11, color: 'var(--danger)' }}>
                        Reject
                    </button>
                </div>
            )}
            {order.status === 'approved' && (
                <button className="btn" onClick={() => advanceStatus('ordered')} disabled={isUpdating}
                    style={{ width: '100%', padding: '5px 0', fontSize: 11, color: 'var(--violet)' }}>
                    {isUpdating ? '...' : '→ Mark as Ordered'}
                </button>
            )}
            {order.status === 'ordered' && (
                <button className="btn" onClick={() => advanceStatus('delivered')} disabled={isUpdating}
                    style={{ width: '100%', padding: '5px 0', fontSize: 11, color: 'var(--success)' }}>
                    {isUpdating ? '...' : '✓ Mark as Delivered'}
                </button>
            )}

            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: order.status === 'delivered' || order.status === 'rejected' ? 0 : 8 }}>
                {new Date(order.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
        </div>
    );
};

// ─── Main Orders Component ────────────────────────────────────────────────────
export default function Orders() {
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('kanban');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortField, setSortField] = useState('date');
    const [sortDir, setSortDir] = useState('desc');

    // ── Load Orders ─────────────────────────────────────────────────────────────
    const loadOrders = useCallback(async () => {
        setIsLoading(true);
        try {
            // Try the /orders endpoint (add GET /orders to main.py — see orders_endpoint.py)
            const res = await fetch(`${API}/orders?store_id=1`, { headers: H });
            if (res.ok) {
                const data = await res.json();
                const mapped = (data.orders || []).map(o => ({
                    id: `ORD-${String(o.id).padStart(3, '0')}`,
                    family: o.family,
                    qty: o.quantity,
                    cost: Math.round(o.estimated_cost),
                    supplier: o.supplier || 'Unknown Supplier',
                    status: (o.status || 'approved').toLowerCase(),
                    date: (o.created_at || '').split('T')[0],
                    source: 'AI',
                }));
                const merged = mergeWithLocal(mapped);
                setOrders(merged);
                setIsLoading(false);
                return;
            }
        } catch (e) { /* backend endpoint not yet added */ }

        // Fall back to localStorage, seed with demo data if empty
        const saved = localStorage.getItem('orderHistory');
        if (saved) {
            setOrders(JSON.parse(saved));
        } else {
            setOrders(SEED_ORDERS);
            localStorage.setItem('orderHistory', JSON.stringify(SEED_ORDERS));
        }
        setIsLoading(false);
    }, []);

    // Merge backend orders with any locally-tracked status updates
    const mergeWithLocal = (backendOrders) => {
        const localUpdates = JSON.parse(localStorage.getItem('orderStatusUpdates') || '{}');
        return backendOrders.map(o => ({
            ...o,
            status: localUpdates[o.id] || o.status,
        }));
    };

    useEffect(() => { loadOrders(); }, [loadOrders]);

    // Persist to localStorage
    useEffect(() => {
        if (orders.length) localStorage.setItem('orderHistory', JSON.stringify(orders));
    }, [orders]);

    // ── Status Update ────────────────────────────────────────────────────────────
    const updateStatus = (orderId, newStatus) => {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        // Track local overrides so merging with backend doesn't revert them
        const updates = JSON.parse(localStorage.getItem('orderStatusUpdates') || '{}');
        updates[orderId] = newStatus;
        localStorage.setItem('orderStatusUpdates', JSON.stringify(updates));
    };

    // ── KPIs ─────────────────────────────────────────────────────────────────────
    const kpis = useMemo(() => {
        const total = orders.length;
        const pending = orders.filter(o => o.status === 'pending').length;
        const spend = orders.filter(o => ['approved', 'ordered', 'delivered'].includes(o.status))
            .reduce((s, o) => s + o.cost, 0);
        const delivered = orders.filter(o => o.status === 'delivered').length;
        const fulfillment = total > 0 ? Math.round((delivered / total) * 100) : 0;
        return { total, pending, spend, fulfillment };
    }, [orders]);

    // ── Spend Chart Data ──────────────────────────────────────────────────────────
    const spendData = useMemo(() => {
        const byFamily = {};
        orders.filter(o => ['approved', 'ordered', 'delivered'].includes(o.status))
            .forEach(o => { byFamily[o.family] = (byFamily[o.family] || 0) + o.cost; });
        return Object.entries(byFamily)
            .map(([family, spend]) => ({ family: family.length > 12 ? family.slice(0, 10) + '…' : family, fullFamily: family, spend: Math.round(spend) }))
            .sort((a, b) => b.spend - a.spend).slice(0, 8);
    }, [orders]);

    // ── Status Breakdown (Pie data) ───────────────────────────────────────────────
    const statusPieData = useMemo(() => {
        return Object.keys(STATUS).map(s => ({
            name: STATUS[s].label,
            value: orders.filter(o => o.status === s).length,
            color: STATUS[s].color,
        })).filter(d => d.value > 0);
    }, [orders]);

    // ── Filtered + Sorted Table ───────────────────────────────────────────────────
    const filteredOrders = useMemo(() => {
        return orders
            .filter(o => statusFilter === 'all' || o.status === statusFilter)
            .filter(o => !search || [o.id, o.family, o.supplier].some(v => v.toLowerCase().includes(search.toLowerCase())))
            .sort((a, b) => {
                let va = a[sortField], vb = b[sortField];
                if (sortField === 'cost' || sortField === 'qty') { va = Number(va); vb = Number(vb); }
                if (sortField === 'date') { va = new Date(va); vb = new Date(vb); }
                return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
            });
    }, [orders, statusFilter, search, sortField, sortDir]);

    const toggleSort = (field) => {
        if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('desc'); }
    };

    // ── CSV Export ────────────────────────────────────────────────────────────────
    const exportCSV = () => {
        const cols = ['id', 'family', 'qty', 'cost', 'supplier', 'status', 'date', 'source'];
        const rows = [cols, ...filteredOrders.map(o => cols.map(c => o[c]))];
        const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `orders_${new Date().toISOString().split('T')[0]}.csv` });
        a.click();
    };

    const KANBAN_COLS = ['pending', 'approved', 'ordered', 'delivered'];
    const TABS = ['kanban', 'history', 'analytics'];

    return (
        <div className="page-container">

            {/* ── Header ── */}
            <div className="page-header page-header-row">
                <div style={{ flex: '1 1 auto' }}>
                    <h1>Orders &amp; Procurement</h1>
                    <p>Store 1 · Full order lifecycle — from AI suggestion to delivered stock</p>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button className="btn" onClick={exportCSV}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12 }}>
                        <Download size={12} /> Export CSV
                    </button>
                    <button className="btn" onClick={loadOrders}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12 }}>
                        <RefreshCw size={12} /> Refresh
                    </button>
                </div>
            </div>

            {/* ── KPI Strip ── */}
            {isLoading ? (
                <div className="stat-grid">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="card stat-card">
                            <div className="skeleton" style={{ height: 12, width: '60%', marginBottom: 14 }} />
                            <div className="skeleton" style={{ height: 28, width: '45%', marginBottom: 10 }} />
                            <div className="skeleton" style={{ height: 10, width: '40%' }} />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="stat-grid">
                    {[
                        { label: 'Total Orders', value: kpis.total, sub: 'all time', color: 'var(--text-1)', icon: ShoppingCart },
                        { label: 'Pending Approval', value: kpis.pending, sub: 'awaiting action', color: 'var(--warning)', icon: Clock },
                        { label: 'Total Spend', value: `$${kpis.spend.toLocaleString()}`, sub: 'approved + ordered + delivered', color: 'var(--accent)', icon: DollarSign },
                        { label: 'Fulfillment Rate', value: `${kpis.fulfillment}%`, sub: 'orders delivered', color: kpis.fulfillment >= 70 ? 'var(--success)' : 'var(--warning)', icon: TrendingUp },
                    ].map((card, i) => (
                        <div key={i} className="card stat-card">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                                <card.icon size={12} style={{ color: card.color }} />
                                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)' }}>
                                    {card.label}
                                </span>
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 700, color: card.color, lineHeight: 1, marginBottom: 6 }}>
                                {card.value}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{card.sub}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Tab Nav ── */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 0 }}>
                {TABS.map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} style={{
                        padding: '10px 18px', background: 'none', border: 'none',
                        borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                        color: activeTab === tab ? 'var(--accent)' : 'var(--text-2)',
                        fontWeight: activeTab === tab ? 600 : 400,
                        cursor: 'pointer', fontSize: 13, textTransform: 'capitalize',
                        fontFamily: 'var(--font-body)', transition: 'all 0.15s',
                    }}>
                        {tab === 'kanban' ? 'Kanban Board' : tab === 'history' ? 'Order History' : 'Analytics'}
                    </button>
                ))}
            </div>

            {/* ══ TAB: KANBAN BOARD ══════════════════════════════════════════════════ */}
            {activeTab === 'kanban' && (
                <>
                    {/* Rejected strip at top if any */}
                    {orders.filter(o => o.status === 'rejected').length > 0 && (
                        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--danger-dim)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <XCircle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
                                <strong>{orders.filter(o => o.status === 'rejected').length}</strong> rejected orders ·{' '}
                                {orders.filter(o => o.status === 'rejected').map(o => o.id).join(', ')}
                            </span>
                        </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'start' }}>
                        {KANBAN_COLS.map(status => {
                            const cfg = STATUS[status];
                            const colOrders = orders.filter(o => o.status === status);
                            return (
                                <div key={status}>
                                    {/* Column header */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '6px 10px', background: cfg.dim, borderRadius: 8 }}>
                                        <cfg.Icon size={12} style={{ color: cfg.color }} />
                                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color }}>
                                            {cfg.label}
                                        </span>
                                        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: cfg.color, fontFamily: 'var(--font-mono)' }}>
                                            {colOrders.length}
                                        </span>
                                    </div>

                                    {/* Cards */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 }}>
                                        {colOrders.length === 0 ? (
                                            <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '24px 16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                                                No orders
                                            </div>
                                        ) : (
                                            colOrders.map(order => (
                                                <KanbanCard key={order.id} order={order} onStatusChange={updateStatus} />
                                            ))
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* ══ TAB: HISTORY TABLE ════════════════════════════════════════════════ */}
            {activeTab === 'history' && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Filters bar */}
                    <div style={{ padding: '14px 20px', display: 'flex', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
                            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by ID, category, supplier…"
                                style={{ width: '100%', paddingLeft: 28, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px 7px 28px', color: 'var(--text-1)', fontSize: 12, outline: 'none' }} />
                        </div>
                        <div className="fancy-select">
                            <label>Status</label>
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                                <option value="all">All Statuses</option>
                                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                        </div>
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
                            {filteredOrders.length} results
                        </span>
                    </div>

                    {/* Table */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {[
                                        { key: 'id', label: 'Order ID' },
                                        { key: 'family', label: 'Category' },
                                        { key: 'qty', label: 'Qty' },
                                        { key: 'cost', label: 'Cost' },
                                        { key: 'supplier', label: 'Supplier' },
                                        { key: 'status', label: 'Status' },
                                        { key: 'date', label: 'Date' },
                                        { key: 'source', label: 'Source' },
                                    ].map(col => (
                                        <th key={col.key} onClick={() => toggleSort(col.key)}
                                            style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: sortField === col.key ? 'var(--accent)' : 'var(--text-3)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                                            {col.label} {sortField === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    [1, 2, 3, 4, 5].map(i => (
                                        <tr key={i}><td colSpan={8} style={{ padding: '12px 16px' }}>
                                            <div className="skeleton" style={{ height: 12, width: '100%' }} />
                                        </td></tr>
                                    ))
                                ) : filteredOrders.map((order, i) => {
                                    const s = STATUS[order.status];
                                    return (
                                        <tr key={order.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 !== 0 ? 'rgba(255,255,255,0.01)' : 'transparent', transition: 'background 0.1s' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = i % 2 !== 0 ? 'rgba(255,255,255,0.01)' : 'transparent'}>
                                            <td style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>{order.id}</td>
                                            <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>{order.family}</td>
                                            <td style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{order.qty}</td>
                                            <td style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>${order.cost.toLocaleString()}</td>
                                            <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-2)' }}>{order.supplier}</td>
                                            <td style={{ padding: '11px 16px' }}>
                                                <span style={{ background: s.dim, color: s.color, padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{s.label}</span>
                                            </td>
                                            <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                                                {new Date(order.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </td>
                                            <td style={{ padding: '11px 16px' }}>
                                                <span style={{ fontSize: 11, fontWeight: 600, color: order.source === 'AI' ? 'var(--violet)' : 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {order.source === 'AI' ? <Bot size={10} /> : <User size={10} />} {order.source}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {!isLoading && filteredOrders.length === 0 && (
                            <div className="empty-state" style={{ padding: '40px 0' }}>
                                <Package size={28} strokeWidth={1} />
                                <p>No orders match your filters.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ══ TAB: ANALYTICS ════════════════════════════════════════════════════ */}
            {activeTab === 'analytics' && (
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>

                    {/* Spend by Category */}
                    <div className="card" style={{ padding: 24 }}>
                        <div className="section-title">
                            <span className="icon-wrap"><DollarSign size={14} /></span>
                            Spend by Category
                        </div>
                        {spendData.length === 0 ? (
                            <div className="empty-state" style={{ minHeight: 280 }}><BarChart2 size={28} strokeWidth={1} /><p>No spend data yet</p></div>
                        ) : (
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={spendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                    <XAxis dataKey="family" tick={{ fill: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                    <Bar dataKey="spend" name="Spend" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    {/* Right column: status + source breakdown */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                        {/* Status breakdown */}
                        <div className="card" style={{ padding: 20 }}>
                            <div className="section-title" style={{ marginBottom: 16 }}>
                                <span className="icon-wrap"><Filter size={14} /></span>
                                Status Breakdown
                            </div>
                            {Object.keys(STATUS).map(status => {
                                const count = orders.filter(o => o.status === status).length;
                                const pct = orders.length > 0 ? (count / orders.length) * 100 : 0;
                                const cfg = STATUS[status];
                                return (
                                    <div key={status} style={{ marginBottom: 12 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                                            <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                                            <span style={{ color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>{count}</span>
                                        </div>
                                        <div style={{ background: 'var(--border)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', background: cfg.color, borderRadius: 4, transition: 'width 0.6s ease' }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* AI vs Manual */}
                        <div className="card" style={{ padding: 20 }}>
                            <div className="section-title" style={{ marginBottom: 16 }}>
                                <span className="icon-wrap"><Bot size={14} /></span>
                                Order Source
                            </div>
                            {['AI', 'Manual'].map(src => {
                                const count = orders.filter(o => o.source === src).length;
                                const pct = orders.length > 0 ? Math.round((count / orders.length) * 100) : 0;
                                return (
                                    <div key={src} style={{ marginBottom: 14 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                                            <span style={{ color: src === 'AI' ? 'var(--violet)' : 'var(--text-2)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                {src === 'AI' ? <Bot size={11} /> : <User size={11} />} {src}
                                            </span>
                                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{pct}%</span>
                                        </div>
                                        <div style={{ background: 'var(--border)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                                            <div style={{ width: `${pct}%`, height: '100%', background: src === 'AI' ? 'var(--violet)' : 'var(--text-2)', borderRadius: 4, transition: 'width 0.6s ease' }} />
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{count} orders</div>
                                    </div>
                                );
                            })}
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
}