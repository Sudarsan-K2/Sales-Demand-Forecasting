import React, { useState, useRef, useEffect } from 'react';
import { Activity, Package, ChevronDown, ChevronRight, Cpu, Bot, User, Send } from 'lucide-react';
import InventoryWidget from './inventoryWidget';

// ─── Purchase Order Widget ────────────────────────────────────────────────────
const PurchaseOrderWidget = ({ data, onOrderApproved }) => {
  const [status, setStatus] = useState('pending');

  const handleAction = async (action) => {
    setStatus('loading');
    try {
      const res = await fetch('http://127.0.0.1:8000/submit_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' },
        body: JSON.stringify({ store_id: 1, family: data.family, quantity: data.suggested_qty, action }),
      });
      if (res.ok) {
        setStatus(action === 'approve' ? 'approved' : 'rejected');
        if (action === 'approve' && onOrderApproved) onOrderApproved(data.suggested_qty);
      } else { setStatus('pending'); alert('Failed to submit order.'); }
    } catch { setStatus('pending'); }
  };

  return (
    <div className="po-widget">
      <h4>Draft Purchase Order</h4>
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
        {(status === 'pending' || status === 'loading') && (
          <>
            <button className="btn btn-success" onClick={() => handleAction('approve')} disabled={status === 'loading'}>
              {status === 'loading' ? 'Processing...' : 'Approve & Order'}
            </button>
            <button className="btn btn-danger" onClick={() => handleAction('reject')} disabled={status === 'loading'}>
              Reject
            </button>
          </>
        )}
        {status === 'approved' && (
          <span className="badge badge-success" style={{ padding: '8px 14px', fontSize: 13 }}>✓ Order Placed</span>
        )}
        {status === 'rejected' && (
          <span className="badge badge-danger" style={{ padding: '8px 14px', fontSize: 13 }}>✕ Order Cancelled</span>
        )}
      </div>
    </div>
  );
};

// ─── Thought Process ──────────────────────────────────────────────────────────
const ThoughtProcess = ({ steps }) => {
  const [open, setOpen] = useState(false);
  if (!steps?.length) return null;

  const toolLabel = (n) => n === 'check_inventory' ? 'Checking Inventory' : n === 'draft_purchase_order' ? 'Drafting PO' : n;

  return (
    <div className="thought-process">
      <button className="thought-toggle" onClick={() => setOpen(!open)}>
        <Cpu size={12} />
        {open ? 'Hide agent thoughts' : `${steps.length} tool${steps.length > 1 ? 's' : ''} used`}
        <span style={{ marginLeft: 'auto' }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      {open && (
        <div className="thought-body">
          {steps.map((step, i) => (
            <div className="thought-step" key={i}>
              <div className="thought-step-icon">
                {step.tool.includes('inventory') ? <Package size={10} /> : <Activity size={10} />}
              </div>
              <div>
                <div className="thought-step-tool">{toolLabel(step.tool)}</div>
                <div className="thought-step-args">args: {JSON.stringify(step.args)}</div>
                <div className="thought-step-ok">✓ Retrieved</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main Chat ────────────────────────────────────────────────────────────────
export default function AgentChat() {
  const [messages, setMessages] = useState([
    { sender: 'bot', type: 'message', content: "Hello! I'm your Supply Chain Agent. I can check stock levels, draft purchase orders, and forecast demand. How can I help?", thoughts: [] }
  ]);
  const [input, setInput]           = useState('');
  const [currentStock, setCurrentStock] = useState(15);
  const [isLoading, setIsLoading]   = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = { sender: 'user', type: 'message', content: input };
    setMessages(p => [...p, userMsg]);
    setInput('');
    setIsLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secret-token' },
        body: JSON.stringify({ message: input, store_id: 1, family: 'GROCERY I', current_stock: currentStock }),
      });
      const data = await res.json();
      setMessages(p => [...p, { sender: 'bot', type: data.type, content: data.content, widget_data: data.widget_data, thoughts: data.thought_process }]);
    } catch {
      setMessages(p => [...p, { sender: 'bot', type: 'error', content: 'Error connecting to Agent backend.' }]);
    } finally { setIsLoading(false); }
  };

  return (
    <div className="page-container">

      {/* Header */}
      <div className="page-header page-header-row" style={{ marginBottom: 20 }}>
        <div>
          <h1>
            AI Supply Chain Agent
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', padding: '3px 10px', borderRadius: 6, marginLeft: 12, fontWeight: 500, letterSpacing: '0.04em', verticalAlign: 'middle' }}>
              Llama 3.1
            </span>
          </h1>
          <p>Agentic inventory intelligence with tool-use</p>
        </div>
        {/* Stock control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Current Stock</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px' }}>
            <input
              type="number" min="0"
              value={currentStock}
              onChange={e => setCurrentStock(Number(e.target.value))}
              style={{ width: 56, background: 'transparent', border: 'none', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, textAlign: 'center', outline: 'none' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>units</span>
          </div>
        </div>
      </div>

      {/* Chat Window */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="chat-window">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.sender}`}>
              <div className="msg-avatar">
                {msg.sender === 'bot' ? <Bot size={15} /> : <User size={15} />}
              </div>
              <div style={{ maxWidth: '72%' }}>
                {msg.sender === 'bot' && <ThoughtProcess steps={msg.thoughts} />}
                <div className="bubble">
                  <span dangerouslySetInnerHTML={{ __html: msg.content }} />
                  {msg.type === 'purchase_order' && msg.widget_data && (
                    <PurchaseOrderWidget data={msg.widget_data} onOrderApproved={qty => setCurrentStock(p => p + qty)} />
                  )}
                  {msg.type === 'inventory_check' && msg.widget_data && (
                    <InventoryWidget data={msg.widget_data} />
                  )}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="message bot">
              <div className="msg-avatar"><Bot size={15} /></div>
              <div className="bubble" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)', fontStyle: 'italic', fontSize: 13 }}>
                <Cpu size={13} color="var(--accent)" />
                Thinking &amp; running tools...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="chat-input-area">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Ask about inventory, anomalies, or forecasts..."
            disabled={isLoading}
          />
          <button className="btn btn-primary" onClick={sendMessage} disabled={isLoading} style={{ padding: '10px 18px', gap: 6 }}>
            <Send size={14} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}
