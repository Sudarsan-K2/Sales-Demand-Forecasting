import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Box, MessageSquare, ShoppingCart, Brain, Settings, Zap } from 'lucide-react';

const Sidebar = () => {
  const location = useLocation();
  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <h2>Forecast<span>AI</span></h2>
      </div>

      <div className="sidebar-label">Navigation</div>
      <nav>
        <Link to="/" className={`nav-item ${isActive('/')}`}>
          <LayoutDashboard size={16} /> Dashboard
        </Link>
        <Link to="/inventory" className={`nav-item ${isActive('/inventory')}`}>
          <Box size={16} /> Inventory
        </Link>
        <Link to="/orders" className={`nav-item ${isActive('/orders')}`}>
          <ShoppingCart size={16} /> Orders
        </Link>
        <Link to="/chat" className={`nav-item ${isActive('/chat')}`}>
          <MessageSquare size={16} /> AI Assistant
        </Link>
        <Link to="/intelligence" className={`nav-item ${isActive('/intelligence')}`}>
          <Brain size={16} /> Intelligence
        </Link>
        <Link to="/settings" className={`nav-item ${isActive('/settings')}`}>
          <Settings size={16} /> Settings
        </Link>
      </nav>

      <div className="sidebar-footer">
        <div className="status-dot">API Connected · Store 1</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', fontSize: '11px', color: 'var(--text-3)' }}>
          <Zap size={12} color="var(--accent)" />
          GPT-4o-mini · Prophet v1
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
