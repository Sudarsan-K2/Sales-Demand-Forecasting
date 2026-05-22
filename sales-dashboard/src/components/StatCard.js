import React from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

const StatCard = ({ title, value, trend, trendLabel, statusColor }) => {
  const isPositive = trend > 0;
  const isNeutral = trend === 0;

  let trendColor = 'var(--text-2)';
  if (statusColor === 'red')    trendColor = 'var(--danger)';
  if (statusColor === 'yellow') trendColor = 'var(--warning)';
  if (statusColor === 'green')  trendColor = 'var(--success)';
  if (!statusColor && trend !== undefined) {
    trendColor = isPositive ? 'var(--success)' : isNeutral ? 'var(--text-2)' : 'var(--danger)';
  }

  const TrendIcon = isPositive ? TrendingUp : isNeutral ? Activity : TrendingDown;

  return (
    <div className="card stat-card fade-in">
      <div className="label">{title}</div>
      <div className="value">{value}</div>
      <div className="trend" style={{ color: trendColor }}>
        {statusColor ? (
          <span className={`badge badge-${statusColor === 'red' ? 'danger' : statusColor === 'yellow' ? 'warning' : 'success'}`}>
            Status Alert
          </span>
        ) : (
          <>
            <TrendIcon size={13} />
            {trend !== undefined && <span>{trend > 0 ? '+' : ''}{trend}%</span>}
            <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{trendLabel}</span>
          </>
        )}
      </div>
    </div>
  );
};

export default StatCard;
