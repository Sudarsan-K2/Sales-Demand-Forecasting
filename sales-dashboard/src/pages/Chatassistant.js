import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Package, ChevronDown, ChevronRight, Cpu, Activity, Trash2, RefreshCcw } from 'lucide-react';
import InventoryWidget from '../components/inventoryWidget';

// ─── Utility: convert **bold** markdown → <strong> HTML ──────────────────────
const renderContent = (text) =>
  text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

// ─── 1. THOUGHT PROCESS (Agent trace) ────────────────────────────────────────
const ThoughtProcess = ({ steps }) => {
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;

  return (
    <div className="thought-process">
      <button className="thought-toggle" onClick={() => setOpen(!open)}>
        <Cpu size={12} />
        {open ? 'Hide agent thoughts' : `${steps.length} tool${steps.length > 1 ? 's' : ''} used`}
        <span style={{ marginLeft: 'auto' }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && (
        <div className="thought-body">
          {steps.map((step, i) => (
            <div className="thought-step" key={i}>
              <div className="thought-step-icon">
                {step.tool.toLowerCase().includes('inventory')
                  ? <Package size={10} />
                  : <Activity size={10} />}
              </div>
              <div>
                <div className="thought-step-tool">{step.tool}</div>
                {step.args && Object.keys(step.args).length > 0 && (
                  <div className="thought-step-args">
                    args: {JSON.stringify(step.args)}
                  </div>
                )}
                <div className="thought-step-ok">✓ Completed</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── 2. PURCHASE ORDER WIDGET ─────────────────────────────────────────────────
// onOrderApproved updates currentStock in parent after a successful approval
const PurchaseOrderWidget = ({ data, onOrderApproved, initialStatus, onStatusChange }) => {
  const [orderStatus, setOrderStatus] = useState(initialStatus || 'pending');

  const handleAction = async (action) => {
    setOrderStatus('loading');
    try {
      const res = await fetch('http://127.0.0.1:8000/submit_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' },
        body: JSON.stringify({
          store_id: 1,
          family: data.family,
          quantity: data.suggested_qty,
          action,
        }),
      });
      if (res.ok) {
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        setOrderStatus(newStatus);
        if (onStatusChange) onStatusChange(newStatus);
        // Keep currentStock in sync so the next inventory check uses the right number
        if (action === 'approve' && onOrderApproved) {
          onOrderApproved(data.suggested_qty);
        }
      } else {
        setOrderStatus('pending');
        alert('Failed to submit order.');
      }
    } catch {
      setOrderStatus('pending');
    }
  };

  return (
    <div className="po-widget">
      <h4>
        <Package
          size={13}
          style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6, color: 'var(--accent)' }}
        />
        Draft Purchase Order
      </h4>

      {[
        ['Item', data.family],
        ['Quantity', `${data.suggested_qty} units`],
        ['Est. Cost', `$${data.estimated_cost.toFixed(2)}`],
        ['Supplier', data.supplier],
      ].map(([k, v]) => (
        <div className="po-row" key={k}>
          <span className="po-key">{k}</span>
          <span className="po-val">{v}</span>
        </div>
      ))}

      <div className="po-actions">
        {(orderStatus === 'pending' || orderStatus === 'loading') && (
          <>
            <button
              className="btn btn-success"
              onClick={() => handleAction('approve')}
              disabled={orderStatus === 'loading'}
            >
              {orderStatus === 'loading' ? 'Processing...' : 'Approve & Order'}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => handleAction('reject')}
              disabled={orderStatus === 'loading'}
            >
              Reject
            </button>
          </>
        )}
        {orderStatus === 'approved' && (
          <span className="badge badge-success" style={{ padding: '8px 14px', fontSize: 13 }}>
            ✓ Order Placed
          </span>
        )}
        {orderStatus === 'rejected' && (
          <span className="badge badge-danger" style={{ padding: '8px 14px', fontSize: 13 }}>
            ✕ Order Cancelled
          </span>
        )}
      </div>
    </div>
  );
};

// ─── 3. MAIN CHAT COMPONENT ───────────────────────────────────────────────────
const ChatAssistant = () => {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('chatMessages');
    return saved !== null ? JSON.parse(saved) : [{
      sender: 'bot',
      type: 'message',
      content: 'Hello! I am your Supply Chain Assistant. Ask me about forecasts, trends, or tell me to restock.',
      thoughts: [],
    }];
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // States for category selection
  const [categories, setCategories] = useState(['GROCERY I']);
  const [selectedFamily, setSelectedFamily] = useState('GROCERY I');

  // Fetch available categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch('http://127.0.0.1:8000/available_categories?store_id=1', { headers: { 'X-API-Key': 'secret-token' } });
        const data = await res.json();
        if (data.categories?.length) {
          setCategories(data.categories);
          // If we had a previously selected family saved, try to restore that, else default
          const savedFamily = localStorage.getItem('selectedChatFamily');
          if (savedFamily && data.categories.includes(savedFamily)) {
            setSelectedFamily(savedFamily);
          } else {
            setSelectedFamily(data.categories[0]);
          }
        }
      } catch (e) { console.error(e); }
    };
    fetchCategories();
  }, []);

  // Sync selectedFamily to localStorage
  useEffect(() => {
    localStorage.setItem('selectedChatFamily', selectedFamily);
  }, [selectedFamily]);


  // Track per-family stocks
  const [familyStocks, setFamilyStocks] = useState(() => {
    const saved = localStorage.getItem('familyStocks');
    return saved !== null ? JSON.parse(saved) : {};
  });

  // Current stock for the *active* family, defaults to 15 if not set
  const currentStock = familyStocks[selectedFamily] !== undefined ? familyStocks[selectedFamily] : 15;

  const updateCurrentStock = (newVal) => {
    setFamilyStocks(prev => ({ ...prev, [selectedFamily]: newVal }));
  };

  // Persist familyStocks to local storage whenever it changes
  useEffect(() => {
    localStorage.setItem('familyStocks', JSON.stringify(familyStocks));
  }, [familyStocks]);

  // Persist messages to local storage whenever they change
  useEffect(() => {
    localStorage.setItem('chatMessages', JSON.stringify(messages));
  }, [messages]);

  // Reset Commands
  const clearChat = () => {
    if (window.confirm("Are you sure you want to delete the entire chat history?")) {
      setMessages([{
        sender: 'bot',
        type: 'message',
        content: 'Hello! I am your Supply Chain Assistant. Ask me about forecasts, trends, or tell me to restock.',
        thoughts: [],
      }]);
    }
  };

  const resetStock = () => {
    if (window.confirm("Are you sure you want to reset all per-family stock levels to default?")) {
      setFamilyStocks({});
    }
  };

  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = { sender: 'user', type: 'message', content: input, thoughts: [] };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' },
        body: JSON.stringify({
          message: input,
          store_id: 1,
          family: selectedFamily,
          current_stock: currentStock,
          history: newMessages.slice(-4).map(m => ({
            sender: m.sender,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        let errorMsg = `Server error: ${response.status}`;
        if (response.status === 429) errorMsg = "Rate limit exceeded! Please slow down and try again in a minute.";
        else if (response.status === 422) errorMsg = "Invalid input. Please do not use special characters.";
        else {
          try {
            const errData = await response.json();
            if (errData.detail) errorMsg = errData.detail;
          } catch (e) { }
        }

        setMessages(prev => [
          ...prev,
          { sender: 'bot', type: 'error', content: errorMsg, thoughts: [] }
        ]);
        return;
      }

      const aiData = await response.json();

      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          type: aiData.type || aiData.final_type || 'message',
          content: aiData.content || '',
          widget_data: aiData.widget_data,
          thoughts: aiData.thought_process || aiData.agent_thoughts || [],
        },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          type: 'error',
          content: 'Sorry, I lost connection to the server.',
          thoughts: [],
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="page-container">

      {/* ── Header ── */}
      <div className="page-header page-header-row" style={{ marginBottom: 20 }}>
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <h1 style={{ whiteSpace: 'nowrap', overflow: 'visible' }}>
            AI Assistant
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 11,
              background: 'var(--surface-2)', color: 'var(--text-2)',
              border: '1px solid var(--border)', padding: '3px 10px',
              borderRadius: 6, marginLeft: 12, fontWeight: 500,
              letterSpacing: '0.04em', verticalAlign: 'middle',
            }}>
              GPT-4o-mini
            </span>
          </h1>
          <p>Multi-agent intelligence · Analyst · Executive · Risk</p>
        </div>

        {/* Category Selector */}
        <div className="fancy-select" style={{ marginRight: 20 }}>
          <label>Category</label>
          <select value={selectedFamily} onChange={e => setSelectedFamily(e.target.value)}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Global Data Controls */}
        <div style={{ display: 'flex', gap: 10, marginRight: 20 }}>
          <button
            onClick={clearChat}
            className="btn"
            style={{ padding: '6px 12px', fontSize: 13, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--danger)' }}
            title="Clear Chat History"
          >
            <Trash2 size={13} /> Clear Chat
          </button>
          <button
            onClick={resetStock}
            className="btn"
            style={{ padding: '6px 12px', fontSize: 13, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--warning)' }}
            title="Reset All Stocks"
          >
            <RefreshCcw size={13} /> Reset Stocks
          </button>
        </div>

        {/* Current stock input — feeds req.current_stock to the EXECUTIVE agent */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 0 auto', justifyContent: 'flex-end' }}>
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

      {/* ── Chat card ── */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Messages */}
        <div className="chat-window">
          {messages.map((msg, idx) => (
            <div key={idx} className={`message ${msg.sender}`}>
              <div className="msg-avatar">
                {msg.sender === 'bot' ? <Bot size={15} /> : <User size={15} />}
              </div>

              <div style={{ maxWidth: '72%' }}>
                {/* Collapsible agent thought trace */}
                {msg.sender === 'bot' && <ThoughtProcess steps={msg.thoughts} />}

                <div className="bubble">
                  {/* Converts **Agent Name:** markdown to <strong> before rendering */}
                  <span dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }} />

                  {/* EXECUTIVE agent: draft_purchase_order tool response */}
                  {msg.type === 'purchase_order' && msg.widget_data && (
                    <PurchaseOrderWidget
                      data={msg.widget_data}
                      initialStatus={msg.orderStatus}
                      onStatusChange={(newStatus) => {
                        setMessages(prev => prev.map((m, mIdx) =>
                          mIdx === idx ? { ...m, orderStatus: newStatus } : m
                        ));
                      }}
                      // Add ordered qty to stock so subsequent checks are accurate.
                      onOrderApproved={qty => {
                        const familyToUpdate = msg.widget_data.family;
                        setFamilyStocks(prev => ({
                          ...prev,
                          [familyToUpdate]: (prev[familyToUpdate] === undefined ? 15 : prev[familyToUpdate]) + qty
                        }));
                      }}
                    />
                  )}

                  {/* EXECUTIVE agent: check_inventory tool response */}
                  {msg.type === 'inventory_check' && msg.widget_data && (
                    <div style={{ marginTop: 12 }}>
                      <InventoryWidget data={msg.widget_data} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing / tool-running indicator */}
          {isLoading && (
            <div className="message bot">
              <div className="msg-avatar"><Bot size={15} /></div>
              <div className="bubble" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(i => (
                    <span key={i} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: 'var(--accent)',
                      animation: 'pulse 1.2s infinite',
                      animationDelay: `${i * 0.2}s`,
                      display: 'inline-block',
                    }} />
                  ))}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic' }}>
                  Agent thinking &amp; running tools...
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="chat-input-area">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Ask about forecasts, stock levels, market risks..."
            disabled={isLoading}
          />
          <button
            className="btn btn-primary"
            onClick={sendMessage}
            disabled={isLoading}
            style={{ padding: '10px 18px', gap: 6 }}
          >
            <Send size={14} /> Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatAssistant;