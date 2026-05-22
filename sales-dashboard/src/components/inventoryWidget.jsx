import React from 'react';
import { AlertTriangle, TrendingDown, Package, DollarSign, CheckCircle } from 'lucide-react';

const InventoryWidget = ({ data }) => {
  if (!data?.decision) return null;

  const { decision, financial_optimization, breakdown } = data;
  const { status, suggested_order_qty, stockout_probability_pct } = decision;
  const { economic_order_quantity, est_spoilage_risk_usd } = financial_optimization;
  const { expected_sales, current_stock } = breakdown;

  let themeColor = 'var(--success)';
  let Icon = CheckCircle;
  if (stockout_probability_pct > 70) { themeColor = 'var(--danger)'; Icon = AlertTriangle; }
  else if (stockout_probability_pct > 30 || est_spoilage_risk_usd > 0) { themeColor = 'var(--warning)'; Icon = TrendingDown; }

  const r = 36, circ = 2 * Math.PI * r;
  const offset = circ - (stockout_probability_pct / 100) * circ;

  return (
    <div className="inv-widget">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)', marginBottom: 2 }}>Inventory AI</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Stock: {current_stock} units</div>
        </div>
        <span className="badge" style={{
          background: themeColor === 'var(--danger)' ? 'var(--danger-dim)' : themeColor === 'var(--warning)' ? 'var(--warning-dim)' : 'var(--success-dim)',
          color: themeColor,
        }}>
          <Icon size={11} /> {status}
        </span>
      </div>

      {/* Gauge + Order */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '16px 20px',
        marginBottom: 14,
      }}>
        {/* Mini Gauge */}
        <div style={{ position: 'relative', width: 90, height: 90 }}>
          <svg width="90" height="90" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="45" cy="45" r={r} stroke="var(--border)" strokeWidth={8} fill="none" />
            <circle
              cx="45" cy="45" r={r}
              stroke={themeColor} strokeWidth={8} fill="none"
              strokeDasharray={circ} strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: themeColor }}>{stockout_probability_pct}%</span>
            <span style={{ fontSize: 9, color: 'var(--text-3)', letterSpacing: '0.07em' }}>RISK</span>
          </div>
        </div>
        {/* Order qty */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4, fontWeight: 600 }}>Suggested Order</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{suggested_order_qty}</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>units to order</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid-2" style={{ gap: 10, marginBottom: 10 }}>
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <Package size={12} color="var(--accent)" />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Exp. Sales</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{expected_sales}</div>
        </div>
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <TrendingDown size={12} color="var(--violet)" />
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>EOQ</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{economic_order_quantity}</div>
        </div>
      </div>

      {/* Spoilage Row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'var(--danger-dim)', border: '1px solid rgba(255,71,87,0.2)',
        borderRadius: 8, padding: '10px 14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DollarSign size={12} color="var(--danger)" />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--danger)' }}>Spoilage Risk</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>${est_spoilage_risk_usd}</span>
      </div>
    </div>
  );
};

export default InventoryWidget;
