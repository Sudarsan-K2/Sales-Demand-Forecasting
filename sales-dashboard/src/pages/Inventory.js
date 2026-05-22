import React, { useState, useEffect } from 'react';
import {
  Package, AlertTriangle, CheckCircle, TrendingDown, DollarSign,
  Settings, ShieldAlert, BarChart2, Activity, Download, Users,
  Briefcase, Cpu
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Result Metric Tile ───────────────────────────────────────────────────────
const MetricTile = ({ icon: Icon, label, value, accent = 'var(--accent)' }) => (
  <div style={{
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon size={14} style={{ color: accent }} />
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-2)' }}>{label}</span>
    </div>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{value}</div>
  </div>
);

// ─── Gauge Ring ───────────────────────────────────────────────────────────────
const GaugeRing = ({ pct }) => {
  const r = 50, circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct > 60 ? 'var(--danger)' : pct > 30 ? 'var(--warning)' : 'var(--success)';
  return (
    <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
      <svg width="130" height="130" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="65" cy="65" r={r} stroke="var(--border)" strokeWidth={10} fill="none" />
        <circle
          cx="65" cy="65" r={r}
          stroke={color} strokeWidth={10} fill="none"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-out, stroke 0.3s' }}
          filter={`drop-shadow(0 0 6px ${color})`}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color }}>{pct}%</span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Risk</span>
      </div>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const Inventory = () => {
  const [categories, setCategories]     = useState(['GROCERY I']);
  const [family, setFamily]             = useState('GROCERY I');

  // Track per-family stocks globally
  const [familyStocks, setFamilyStocks] = useState(() => {
    const saved = localStorage.getItem('familyStocks');
    return saved !== null ? JSON.parse(saved) : {};
  });

  const currentStock = familyStocks[family] !== undefined ? familyStocks[family] : 50;

  const updateCurrentStock = (newVal) => {
    setFamilyStocks(prev => ({ ...prev, [family]: newVal }));
  };

  useEffect(() => {
    localStorage.setItem('familyStocks', JSON.stringify(familyStocks));
  }, [familyStocks]);

  const [leadTime, setLeadTime]         = useState(7);
  const [unitPrice, setUnitPrice]       = useState(2.50);
  const [orderCost, setOrderCost]       = useState(50.0);
  const [holdingCost, setHoldingCost]   = useState(0.15);
  const [advice, setAdvice]             = useState(null);
  const [isLoading, setIsLoading]       = useState(false);

  useEffect(() => {
    fetch('http://127.0.0.1:8000/available_categories?store_id=1', { headers: { 'X-API-Key': 'secret-token' } })
      .then(r => r.json())
      .then(d => {
        if (d.categories?.length) {
          setCategories(d.categories);
          setFamily(p => d.categories.includes(p) ? p : d.categories[0]);
        }
      }).catch(console.error);
  }, []);

  const getAdvice = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' },
        body: JSON.stringify({
          store_id: 1, family,
          current_stock: parseInt(currentStock),
          lead_time_days: parseInt(leadTime),
          unit_price: parseFloat(unitPrice),
          order_cost: parseFloat(orderCost),
          holding_cost: parseFloat(holdingCost),
          is_perishable: true,
        }),
      });
      if (!res.ok) {
        alert("Failed to calculate inventory. Please check inputs.");
        setAdvice(null);
        return;
      }
      setAdvice(await res.json());
    } catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  };

  // ── PDF Export ──────────────────────────────────────────────────────────────
  const generatePDF = () => {
    if (!advice) return;
    const doc = new jsPDF();
    const dateStr = new Date().toLocaleDateString();

    doc.setFontSize(20);
    doc.text('Inventory Optimization Report', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated: ${dateStr} | Category: ${family} | Store: 1`, 14, 30);

    autoTable(doc, {
      startY: 40,
      head: [['Status', 'Suggested Order Qty', 'Stockout Risk']],
      body: [[
        advice.decision.status.split(' (')[0],
        `${advice.decision.suggested_order_qty} units`,
        `${advice.decision.stockout_probability_pct}%`,
      ]],
      theme: 'grid',
      headStyles: { fillColor: [0, 207, 255], textColor: [7, 12, 24] },
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 15,
      head: [['Metric', 'Value']],
      body: [
        ['Expected Demand',             `${advice.breakdown.expected_sales} units`],
        ['Safety Stock Required',        `${advice.breakdown.safety_stock_buffer} units`],
        ['Economic Order Quantity (EOQ)', `${advice.financial_optimization.economic_order_quantity} units`],
        ['Current Stock Level',          `${currentStock} units`],
        ['Supplier Lead Time',           `${leadTime} days`],
      ],
      theme: 'striped',
    });

    if (advice.stakeholders) {
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 15,
        head: [['Role', 'Contact Info']],
        body: [
          ['Primary Vendor',          advice.stakeholders.vendor],
          ['Internal Category Manager', advice.stakeholders.internal_buyer],
          ['Top B2B Clients',          advice.stakeholders.top_clients.join(', ')],
        ],
        theme: 'grid',
        headStyles: { fillColor: [26, 36, 56] },
      });
    }

    doc.save(`Inventory_Report_${family.replace(/[^a-zA-Z0-9]/g, '_')}_${dateStr.replace(/\//g, '-')}.pdf`);
  };

  const statusStr  = advice?.decision?.status || '';
  const isCritical = statusStr.includes('CRITICAL');
  const isWarning  = statusStr.includes('WARNING');
  const statusColor = isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--success)';
  const statusBg    = isCritical ? 'var(--danger-dim)' : isWarning ? 'var(--warning-dim)' : 'var(--success-dim)';
  const statusBorder = isCritical ? 'rgba(255,71,87,0.3)' : isWarning ? 'rgba(255,171,46,0.3)' : 'rgba(0,217,126,0.3)';

  return (
    <div className="page-container">

      {/* ── Header ── */}
      <div className="page-header page-header-row">
        <div>
          <h1>Inventory Optimizer</h1>
          <p>EOQ · Safety Stock · Monte Carlo stockout simulation</p>
        </div>
        <button
          className="btn"
          onClick={generatePDF}
          disabled={!advice || isLoading}
          style={{
            background: (!advice || isLoading) ? 'var(--surface-3)' : 'var(--surface-2)',
            color: (!advice || isLoading) ? 'var(--text-3)' : 'var(--text-1)',
            border: `1px solid ${(!advice || isLoading) ? 'var(--border)' : 'var(--border-glow)'}`,
            cursor: (!advice || isLoading) ? 'not-allowed' : 'pointer',
            gap: 8,
          }}
        >
          <Download size={15} /> Export PDF Report
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 28 }}>

        {/* ── Left Column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Simulation Parameters */}
          <div className="card" style={{ padding: 24 }}>
            <div className="section-title">
              <span className="icon-wrap"><Settings size={14} /></span>
              Parameters
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="form-label">Product Category</label>
              <select value={family} onChange={e => { setFamily(e.target.value); setAdvice(null); }}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div>
                <label className="form-label">Current Stock ({family})</label>
                <input type="number" value={currentStock} onChange={e => updateCurrentStock(Number(e.target.value))} />
              </div>
              <div>
                <label className="form-label">Lead Time (d)</label>
                <input type="number" value={leadTime} onChange={e => setLeadTime(e.target.value)} />
              </div>
            </div>

            <div className="divider" />

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <DollarSign size={13} color="var(--text-2)" />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Financial (EOQ)</span>
            </div>

            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div>
                <label className="form-label">Unit Price ($)</label>
                <input type="number" step="0.1" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
              </div>
              <div>
                <label className="form-label">Order Cost ($)</label>
                <input type="number" step="1" value={orderCost} onChange={e => setOrderCost(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 28 }}>
              <label className="form-label">Annual Holding Cost (%)</label>
              <input type="number" step="0.01" value={holdingCost} onChange={e => setHoldingCost(e.target.value)} />
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={getAdvice}
              disabled={isLoading}
            >
              {isLoading ? <><Cpu size={14} /> Simulating...</> : 'Calculate Optimal Order'}
            </button>
          </div>

          {/* Stakeholder Directory — only shown when response includes it */}
          {advice?.stakeholders && (
            <div className="card fade-in" style={{ padding: 24 }}>
              <div className="section-title">
                <span className="icon-wrap" style={{ background: 'var(--violet-dim)', color: 'var(--violet)' }}>
                  <Users size={14} />
                </span>
                Stakeholder Directory
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
                    Primary Vendor
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Package size={14} color="var(--accent)" />
                    <span style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 500 }}>
                      {advice.stakeholders.vendor}
                    </span>
                  </div>
                </div>

                <div className="divider" style={{ margin: 0 }} />

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
                    Category Manager
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Briefcase size={14} color="var(--success)" />
                    <span style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 500 }}>
                      {advice.stakeholders.internal_buyer}
                    </span>
                  </div>
                </div>

                <div className="divider" style={{ margin: 0 }} />

                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                    Top B2B Clients
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {advice.stakeholders.top_clients.map((client, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'var(--surface-2)', border: '1px solid var(--border)',
                        borderRadius: 6, padding: '6px 10px',
                        fontSize: 13, color: 'var(--text-2)',
                      }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {i + 1}
                        </span>
                        {client}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Column: Results ── */}
        <div>
          {!advice && !isLoading && (
            <div className="card" style={{ height: '100%' }}>
              <div className="empty-state">
                <Activity size={40} strokeWidth={1} color="var(--text-3)" />
                <h3>Awaiting Simulation</h3>
                <p>Configure parameters and run the engine to generate a probabilistic inventory strategy.</p>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="card fade-in" style={{ height: '100%' }}>
              <div className="empty-state">
                <Cpu size={32} color="var(--accent)" />
                <h3 style={{ color: 'var(--accent)' }}>Running Monte Carlo...</h3>
                <p>Simulating thousands of demand scenarios</p>
              </div>
            </div>
          )}

          {advice && !isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} className="fade-in">

              {/* Status Banner */}
              <div style={{
                background: statusBg,
                border: `1px solid ${statusBorder}`,
                borderRadius: 12,
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}>
                {isCritical ? <AlertTriangle size={28} color={statusColor} />
                  : isWarning ? <ShieldAlert size={28} color={statusColor} />
                  : <CheckCircle size={28} color={statusColor} />}
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: statusColor }}>
                    {statusStr.split(' (')[0]}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>
                    {statusStr.includes('(') ? statusStr.split('(')[1].replace(')', '') : 'Inventory levels are optimal.'}
                  </div>
                </div>
              </div>

              {/* Primary Metrics */}
              <div className="grid-2">
                <div className="card" style={{ padding: '28px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 12 }}>
                    Order Now
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 60, fontWeight: 700, color: 'var(--accent)', lineHeight: 1, marginBottom: 6, textShadow: '0 0 20px var(--accent-glow)' }}>
                    {advice.decision.suggested_order_qty}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Units to order immediately</div>
                </div>

                <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
                    Stockout Risk
                  </div>
                  <GaugeRing pct={advice.decision.stockout_probability_pct} />
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>During lead time window</div>
                </div>
              </div>

              {/* Secondary Metrics */}
              <div className="grid-3">
                <MetricTile icon={BarChart2}   label="Expected Demand" value={`${advice.breakdown.expected_sales} units`}                               accent="var(--accent)" />
                <MetricTile icon={ShieldAlert} label="Safety Stock"    value={`${advice.breakdown.safety_stock_buffer} units`}                           accent="var(--violet)" />
                <MetricTile icon={TrendingDown} label="EOQ"            value={`${advice.financial_optimization.economic_order_quantity} units`}           accent="var(--success)" />
              </div>

              {/* Spoilage Row */}
              <div style={{
                background: 'var(--danger-dim)',
                border: '1px solid rgba(255,71,87,0.25)',
                borderRadius: 10,
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <DollarSign size={15} color="var(--danger)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>Spoilage Risk Exposure</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--danger)' }}>
                  ${advice.financial_optimization.est_spoilage_risk_usd}
                </span>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Inventory;