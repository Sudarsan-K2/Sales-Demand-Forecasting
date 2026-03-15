from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from prophet.serialize import model_from_json
from sqlalchemy import create_engine, text
from typing import List, Dict, Any
import json
import os
import numpy as np
import requests
import math
import scipy.stats as st

app = FastAPI(title="Sales & Inventory Decision System")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REGISTRY_DIR = os.path.join(BASE_DIR, "model_registry")

# --- CORS SETUP ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_USER = "postgres"
DB_PASS = "ELEPHANT" 
DB_HOST = "localhost"
DB_NAME = "SalesForecast"
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:5432/{DB_NAME}"
engine = create_engine(DATABASE_URL)

# --- DATABASE SCHEMA CONTEXT ---
# This is the "map" the AI uses to navigate your database. 
# Adjust the columns to match your actual PostgreSQL tables.
DB_SCHEMA = """
Table: historical_sales
Columns: 
- date (DATE): The date of the sales record.
- store_id (INTEGER): The numerical ID of the store.
- family (VARCHAR): The product category (e.g., 'GROCERY I', 'AUTOMOTIVE').
- sales (FLOAT): The number of units sold.
- onpromotion (INTEGER): Number of items currently on promotion.
- oil_price (FLOAT): The daily price of crude oil.
"""

def execute_text_to_sql(question: str) -> str:
    """
    Translates natural language to SQL, executes it, and returns the raw data.
    """
    # 1. Strict Prompting for SQL Generation
    sql_prompt = f"""You are an expert PostgreSQL data analyst. 
    Write a SQL query to answer this question: {question}
    
    Use ONLY this exact schema:
    {DB_SCHEMA}
    
    DATASET CONTEXT (CRITICAL):
    - The database strictly contains historical data that ends in August 2017. 
    - The user's frontend UI is displaying dates shifted to the present day. 
    - If the user asks about "today," "yesterday," "this month," or "recent" data, THEY MEAN the latest available data in this database.
    - NEVER use CURRENT_DATE, NOW(), or filter by the current calendar year.
    - To answer questions about "recent" or "latest" data, ALWAYS use: ORDER BY date DESC LIMIT [X].
    - 'GROCERY I' is a complete string value for the 'family' column.
    
    Return ONLY the raw SQL query. Do not add markdown, explanations, or ```sql tags. 
    Always LIMIT your results to 10 rows to prevent overwhelming the system.
    """
    
    try:
        # 2. Ask the LLM to write the query (Zero creativity allowed)
        response = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": "llama3.1",
                "messages": [{"role": "system", "content": sql_prompt}],
                "stream": False,
                "options": {"temperature": 0.0} # Enforce deterministic output
            }
        ).json()
        
        raw_sql = response.get("message", {}).get("content", "").strip()
        
        # Aggressive stripping to catch LLM conversational habits
        raw_sql = raw_sql.replace("```sql", "").replace("```", "")
        if "SELECT" in raw_sql.upper():
            raw_sql = raw_sql[raw_sql.upper().find("SELECT"):] 
        raw_sql = raw_sql.strip()
        
        print(f"🔍 Agent Generated SQL: {raw_sql}")
        
        # 3. Execute the query against PostgreSQL safely
        with engine.connect() as connection:
            result = connection.execute(text(raw_sql))
            rows = result.fetchall()
            
            if not rows:
                return f"Executed SQL: {raw_sql}\nResult: No data found for this query."
            
            # Format results into a clean JSON string for the Analyst Agent to read
            keys = result.keys()
            data = [dict(zip(keys, row)) for row in rows] 
            
            return f"Executed SQL: {raw_sql}\nResult: {json.dumps(data, default=str)}"
            
    except Exception as e:
        return f"Database Error. Could not execute query. Details: {str(e)}"

# --- DATA MODELS ---
class PredictionRequest(BaseModel):
    store_id: int
    family: str
    months: int = 3
    simulate_promo: bool = False
    custom_oil_price: float = None

class InventoryRequest(BaseModel):
    store_id: int
    family: str
    lead_time_days: int = 7       # Time from supplier order to delivery
    current_stock: int = 0        # Units currently on shelf
    service_level: float = 0.95   # Desired confidence (95% standard)
    order_cost: float = 50.0      # Cost to process a PO/Delivery
    holding_cost: float = 0.15    # Cost to store 1 unit for a year
    unit_price: float = 2.50      # Average price of the grocery item
    is_perishable: bool = True    # Flag for grocery spoilage
    
class ChatRequest(BaseModel):
    message: str
    store_id: int
    family: str
    current_stock: int = 0
    history: List[Dict[str, Any]] = []

class OrderSubmitRequest(BaseModel):
    store_id: int
    family: str
    quantity: int
    action: str

# --- HELPER: LOAD MODEL ---
def load_model(store_id: int, family: str):
    filename = f"s{store_id}_{family}.json"
    metrics_filename = f"s{store_id}_{family}_metrics.json"
    model_path = os.path.join(REGISTRY_DIR, filename)
    metrics_path = os.path.join(REGISTRY_DIR, metrics_filename)

    if not os.path.exists(model_path):
        return None, None, False

    with open(model_path, 'r') as fin:
        m = model_from_json(json.load(fin))
    
    metrics = {"mape": 0.0}
    if os.path.exists(metrics_path):
        with open(metrics_path, 'r') as fin:
            metrics = json.load(fin)
            
    return m, metrics, True

# --- MOCK STAKEHOLDER DATABASE ---
STAKEHOLDER_DB = {
    "GROCERY I": {
        "vendor": "Nestle Wholesale Distributors",
        "internal_buyer": "Sarah Jenkins (Category Manager)",
        "top_clients": ["City Center Hospital", "Metro Public Schools"]
    },
    "BEVERAGES": {
        "vendor": "Coca-Cola Bottling Co.",
        "internal_buyer": "Marcus Vance (Beverage Director)",
        "top_clients": ["Downtown Arena", "Regal Cinemas", "Local Vending Co."]
    }
}
# Fallback for categories not explicitly listed above
DEFAULT_STAKEHOLDERS = {
    "vendor": "Standard General Distributors",
    "internal_buyer": "Unassigned (Operations Team)",
    "top_clients": ["Various Local Retailers"]
}

# --- ADVANCED INVENTORY MATH ---
def predict_inventory_advanced(req: InventoryRequest):
    m, metrics, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail="Model not found")

    # 1. Predict for the lead time window
    future = m.make_future_dataframe(periods=req.lead_time_days)
    future['onpromotion'] = 0 
    future['oil_price'] = m.history['oil_price'].iloc[-1] if 'oil_price' in m.history else 90.0
    
    future['onpromotion'] = future['onpromotion'].fillna(0)
    future['oil_price'] = future['oil_price'].fillna(method='ffill').fillna(method='bfill')

    forecast = m.predict(future)
    future_data = forecast.tail(req.lead_time_days)

    # 2. Extract Demand Distributions
    expected_demand = future_data['yhat'].sum()
    worst_case_demand = future_data['yhat_upper'].sum()
    std_dev = (worst_case_demand - expected_demand) / 1.645 
    
    # 3. Probabilistic Stockout Risk
    if req.current_stock <= 0:
        stockout_prob = 0.99
    else:
        z_score = (req.current_stock - expected_demand) / (std_dev if std_dev > 0 else 1)
        stockout_prob = 1.0 - st.norm.cdf(z_score)

    # 4. Financial Optimization (EOQ)
    annualized_demand = (expected_demand / req.lead_time_days) * 365 
    if annualized_demand > 0:
        optimal_order_qty = math.sqrt((2 * annualized_demand * req.order_cost) / (req.holding_cost * req.unit_price))
    else:
        optimal_order_qty = 0

    # 5. Spoilage Penalty 
    spoilage_risk = 0
    if req.is_perishable and req.current_stock > expected_demand * 1.5:
        spoilage_risk = (req.current_stock - expected_demand) * (req.unit_price * 0.4) 

    # 6. Final Decision Logic
    safety_stock = worst_case_demand - expected_demand
    needed_stock = expected_demand + safety_stock
    suggested_order = max((needed_stock - req.current_stock), optimal_order_qty)

    status = "OPTIMAL"
    if stockout_prob > 0.70:
        status = "CRITICAL (High Stockout Probability)"
    elif stockout_prob > 0.30:
        status = "WARNING (Reorder Soon)"
    elif spoilage_risk > 0:
        status = "OVERSTOCKED (Spoilage Risk Active)"

    return {
        "decision": {
            "status": status,
            "suggested_order_qty": int(max(0, suggested_order)),
            "stockout_probability_pct": round(stockout_prob * 100, 1)
        },
        "financial_optimization": {
            "economic_order_quantity": int(optimal_order_qty),
            "est_spoilage_risk_usd": round(spoilage_risk, 2)
        },
        "breakdown": {
            "expected_sales": int(expected_demand),
            "safety_stock_buffer": int(safety_stock),
            "current_stock": req.current_stock
        },
        "stakeholders": stakeholders
    }
# --- ANALYST ENGINE (The "Brain") ---
def get_market_sentiment(m, periods=30):
    """
    Analyzes the model to generate a 'Market State' report.
    """
    # 1. Generate Forecast
    future = m.make_future_dataframe(periods=periods)
    future['onpromotion'] = 0
    future['oil_price'] = m.history['oil_price'].iloc[-1] if 'oil_price' in m.history else 90.0
    future['onpromotion'] = future['onpromotion'].fillna(0)
    future['oil_price'] = future['oil_price'].fillna(method='ffill').fillna(method='bfill')
    
    forecast = m.predict(future)
    
    # 2. Extract Key Metrics
    # A. Volume
    next_7_days = forecast.tail(periods).head(7)['yhat'].sum()
    next_30_days = forecast.tail(periods)['yhat'].sum()
    
    # B. Trend (Compare next 7 days vs previous 7 days)
    # We approximate "previous" by looking at the start of the forecast curve
    # (In a real DB scenario, we'd query history. Here we use the trend component)
    current_trend = forecast['trend'].iloc[-1]
    start_trend = forecast['trend'].iloc[-periods]
    trend_diff = ((current_trend - start_trend) / start_trend) * 100
    
    trend_direction = "Stable ➡️"
    if trend_diff > 2: trend_direction = "Growing 📈"
    elif trend_diff < -2: trend_direction = "Declining 📉"

    # C. Volatility / Risk
    # Width of the confidence interval
    avg_width = (forecast.tail(periods)['yhat_upper'] - forecast.tail(periods)['yhat_lower']).mean()
    avg_pred = forecast.tail(periods)['yhat'].mean()
    risk_score = (avg_width / avg_pred) * 100
    
    risk_level = "Low"
    if risk_score > 20: risk_level = "Medium"
    if risk_score > 40: risk_level = "High"

    # D. Peak Day
    future_only = forecast.tail(periods).copy()
    peak_day_row = future_only.loc[future_only['yhat'].idxmax()]

    # Shift the peak date forward to match the UI
    last_historical_date = m.history['ds'].max()
    time_offset = pd.Timestamp.now().normalize() - last_historical_date
    shifted_peak_date = peak_day_row['ds'] + time_offset

    peak_date = shifted_peak_date.strftime('%A, %b %d')

    return {
        "next_7_total": int(next_7_days),
        "next_30_total": int(next_30_days),
        "trend_pct": round(trend_diff, 1),
        "trend_desc": trend_direction,
        "risk_level": risk_level,
        "peak_day": peak_date
    }

# --- EXTERNAL API MOCK (For the Risk Agent) ---
def get_live_market_data(query: str) -> str:
    """
    Simulates fetching real-time data from an external API (like Bloomberg or Open-Meteo).
    """
    query = query.lower()
    print(f"🌍 Fetching live API data for: {query}")
    
    if "oil" in query or "price" in query:
        # Simulate an oil price spike
        return json.dumps({
            "commodity": "Crude Oil (WTI)",
            "current_price_usd": 94.50,
            "status": "ELEVATED",
            "news_alert": "Prices surging due to unexpected OPEC production cuts."
        })
    elif "weather" in query or "storm" in query:
        # Simulate a shipping disruption
        return json.dumps({
            "location": "Primary West Coast Port",
            "weather_status": "Severe Hurricane Warning",
            "shipping_delay_days": 4,
            "recommendation": "Increase safety stock immediately."
        })
    else:
        return json.dumps({"status": "Normal", "alert": "No major disruptions detected."})

# --- ENDPOINT 1: PREDICTION & EXPLANATION ---
@app.post("/predict")
def predict_sales(req: PredictionRequest):
    m, metrics, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail=f"Model not found for Store {req.store_id} - {req.family}")

    # 1. Setup Future Dataframe
    future = m.make_future_dataframe(periods=req.months * 30)
    future_dates = future['ds'] > m.history['ds'].max()
    
    # 2. Apply Simulation Logic (Promotions & Oil)
    if req.simulate_promo:
        future.loc[future_dates, 'onpromotion'] = 1
    else:
        future.loc[future_dates, 'onpromotion'] = 0

    # Oil Price Logic
    artificial_impact = 0
    if req.custom_oil_price is not None:
        future.loc[future_dates, 'oil_price'] = req.custom_oil_price
        last_price = m.history['oil_price'].iloc[-1]
        price_change = req.custom_oil_price - last_price
        artificial_impact = price_change * -5 
    else:
        last_known_oil = 90.0
        if 'oil_price' in m.history:
             last_known_oil = m.history['oil_price'].iloc[-1]
        future.loc[future_dates, 'oil_price'] = last_known_oil

    # Fill NaNs
    future['onpromotion'] = future['onpromotion'].fillna(0)
    future['oil_price'] = future['oil_price'].fillna(method='ffill').fillna(method='bfill')

    # 3. Predict
    forecast = m.predict(future)
    
    # Apply Manual Hack (Demo Sensitivity)
    if req.custom_oil_price is not None:
         future_idx = forecast['ds'] > m.history['ds'].max()
         forecast.loc[future_idx, 'yhat'] += artificial_impact

    # 4. Extract "Why" Components (Explainability)
    # We take the average contribution over the forecast period to summarize "Impact"
    future_forecast = forecast[forecast['ds'] > m.history['ds'].max()]
    
    impact_factors = {
        "trend_base": round(future_forecast['trend'].mean(), 2),
        "weekly_seasonality": round(future_forecast['weekly'].mean(), 2) if 'weekly' in future_forecast else 0,
        "yearly_seasonality": round(future_forecast['yearly'].mean(), 2) if 'yearly' in future_forecast else 0,
        "promo_effect": round(future_forecast['extra_regressors_additive'].mean(), 2) if 'extra_regressors_additive' in future_forecast else 0
    }

    # Return Result
    result_cols = ['ds', 'yhat', 'yhat_lower', 'yhat_upper'] # Added confidence intervals

    # --- NEW: SHIFT DATES TO CURRENT DAY FOR THE UI ---
    last_historical_date = m.history['ds'].max()
    time_offset = pd.Timestamp.now().normalize() - last_historical_date
    forecast['ds'] = forecast['ds'] + time_offset
    # --------------------------------------------------

    return {
        "metrics": metrics,
        "impact_factors": impact_factors,
        "forecast": forecast[result_cols].tail(req.months * 30).to_dict(orient="records")
    }

# --- ENDPOINT 2: INVENTORY DECISION SUPPORT ---
@app.post("/inventory")
def predict_inventory(req: InventoryRequest):
    m, metrics, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail="Model not found")

    # 1. Predict for the lead time window
    future = m.make_future_dataframe(periods=req.lead_time_days)
    future['onpromotion'] = 0
    future['oil_price'] = m.history['oil_price'].iloc[-1] if 'oil_price' in m.history else 90.0
    forecast = m.predict(future)
    future_data = forecast.tail(req.lead_time_days)

    # 2. Extract Demand Distributions
    expected_demand = future_data['yhat'].sum()
    worst_case_demand = future_data['yhat_upper'].sum()
    std_dev = (worst_case_demand - expected_demand) / 1.645 # Approx standard deviation from Prophet 90% CI

    # 3. Probabilistic Stockout Risk
    # What is the probability that actual demand exceeds our current stock?
    if req.current_stock <= 0:
        stockout_prob = 0.99
    else:
        # Z-score of our current stock against the demand distribution
        z_score = (req.current_stock - expected_demand) / (std_dev if std_dev > 0 else 1)
        stockout_prob = 1.0 - st.norm.cdf(z_score)

    # 4. Financial Optimization (EOQ)
    # Convert lead time demand to an annualized rate for the formula
    annualized_demand = (expected_demand / req.lead_time_days) * 365

    if annualized_demand > 0:
        optimal_order_qty = math.sqrt((2 * annualized_demand * req.order_cost) / (req.holding_cost * req.unit_price))
    else:
        optimal_order_qty = 0

    # 5. Spoilage Penalty (Newsvendor logic for Groceries)
    spoilage_risk = 0
    if req.is_perishable and req.current_stock > expected_demand * 1.5:
        # If we have 50% more stock than expected demand, flag high spoilage risk
        spoilage_risk = (req.current_stock - expected_demand) * (req.unit_price * 0.4) # Assume 40% loss on clearance/spoilage

    # 6. Final Decision Logic
    safety_stock = worst_case_demand - expected_demand
    needed_stock = expected_demand + safety_stock

    # We order the EOQ, but ensure it at least covers our immediate safety needs
    suggested_order = max((needed_stock - req.current_stock), optimal_order_qty)

    status = "OPTIMAL"
    if stockout_prob > 0.70:
        status = "CRITICAL (High Stockout Probability)"
    elif stockout_prob > 0.30:
        status = "WARNING (Reorder Soon)"
    elif spoilage_risk > 0:
        status = "OVERSTOCKED (Spoilage Risk Active)"

    return {
        "decision": {
            "status": status,
            "suggested_order_qty": int(max(0, suggested_order)),
            "stockout_probability_pct": round(stockout_prob * 100, 1)
        },
        "financial_optimization": {
            "economic_order_quantity": int(optimal_order_qty),
            "est_spoilage_risk_usd": round(spoilage_risk, 2)
        },
        "breakdown": {
            "expected_sales": int(expected_demand),
            "safety_stock_buffer": int(safety_stock),
            "current_stock": req.current_stock
        }
    }

# --- ENDPOINT 3: HISTORICAL ANOMALIES (NEW) ---
@app.post("/analyze_history")
def analyze_history(req: InventoryRequest): # Reusing InventoryRequest for simplicity
    m, _, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail="Model not found")

    # 1. Predict on History
    # Prophet stores history in m.history. We just need to predict on it to get the confidence bands.
    forecast = m.predict(m.history)
    
    # 2. Find Outliers
    # Compare 'y' (actual) with 'yhat_upper' and 'yhat_lower'
    forecast['y'] = m.history['y'].reset_index(drop=True)
    
    last_historical_date = m.history['ds'].max()
    time_offset = pd.Timestamp.now().normalize() - last_historical_date

    anomalies = []
    for idx, row in forecast.iterrows():
        actual = row['y']
        lower = row['yhat_lower']
        upper = row['yhat_upper']

        if actual > upper or actual < lower:
            severity = "High" if (actual > upper * 1.2 or actual < lower * 0.8) else "Moderate"

            # Shift the anomaly date
            shifted_date = row['ds'] + time_offset

            anomalies.append({
                "date": shifted_date.strftime("%Y-%m-%d"),
                "actual": float(actual),
                "expected": float(row['yhat']),
                "type": "Spike" if actual > upper else "Dip",
                "severity": severity
            })
    
    # Sort by date descending (newest first)
    anomalies.reverse()
    
    return {
        "anomaly_count": len(anomalies),
        "recent_anomalies": anomalies[:10] # Top 10 most recent
    }

# --- AGENT TOOLBOX: Functions the LLM can invoke ---
supply_chain_tools = [
    {
        "type": "function",
        "function": {
            "name": "check_inventory",
            "description": "Checks current stock levels and alerts if stock is low.",
            "parameters": {
                "type": "object",
                "properties": {
                    "family": {"type": "string", "description": "The product family"}
                },
                "required": ["family"]
            }
        }
    },
    {
            "type": "function",
            "function": {
                "name": "draft_purchase_order",
                "description": "Generates a purchase order widget. You MUST extract the product category from the user's message and format it EXACTLY as one of these uppercase strings: GROCERY I, BEVERAGES, PRODUCE, CLEANING, DAIRY, BREAD/BAKERY.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "family": {
                            "type": "string", 
                            "description": "The EXACT uppercase product family (e.g., BEVERAGES, CLEANING). Do not use lowercase."
                        },
                        "suggested_qty": {
                            "type": "integer", 
                            "description": "Amount to order. If the user doesn't specify an exact amount, invent a reasonable default like 50."
                        }
                    },
                    "required": ["family", "suggested_qty"]
                }
            }
        },
    {
        "type": "function",
        "function": {
            "name": "ask_database",
            "description": "Queries the PostgreSQL database. USE ONLY FOR HISTORICAL PAST DATA. Note: The database data ends in 2017. If the user asks for 'yesterday' or 'recent' sales, pass that intent directly in your question so the database queries the absolute latest available records.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The exact question about PAST data."}
                },
                "required": ["question"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "check_market_conditions",
            "description": "Fetches live, real-world API data about weather disruptions, shipping delays, or commodity prices (like oil).",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for, e.g., 'oil prices' or 'port weather'"}
                },
                "required": ["query"]
            }
        }
    }
]
@app.post("/dashboard/summary")
def get_dashboard_summary(req: PredictionRequest):
    # We use PredictionRequest since it already has store_id and family
    m, metrics, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail="Model not found")

    # 1. Get Market Sentiment (Forecast totals and trends)
    sentiment = get_market_sentiment(m, periods=30)

    # 2. Get Recent Anomalies
    forecast = m.predict(m.history)
    forecast['y'] = m.history['y'].reset_index(drop=True)
    
    anomaly_count = 0
    high_severity_count = 0
    for idx, row in forecast.tail(60).iterrows(): # Look at the last 60 days of history
        actual = row['y']
        upper = row['yhat_upper']
        lower = row['yhat_lower']
        
        if actual > upper or actual < lower:
            anomaly_count += 1
            if actual > upper * 1.2 or actual < lower * 0.8:
                high_severity_count += 1

    # 3. Format data specifically for the React StatCards
    return {
        "cards": [
            {
                "title": "30-Day Forecast Volume",
                "value": f"{sentiment['next_30_total']:,}",
                "trend": sentiment['trend_pct'],
                "trend_label": "vs previous 30 days"
            },
            {
                "title": "Market Trend",
                "value": sentiment['trend_desc'].replace(" 📈", "").replace(" 📉", "").replace(" ➡️", ""),
                "trend": sentiment['trend_pct'], # Neutral indicator
                "trend_label": "Based on moving average"
            },
            {
                "title": "Forecast Risk Level",
                "value": sentiment['risk_level'].upper(),
                "status_color": "red" if sentiment['risk_level'] == "High" else ("yellow" if sentiment['risk_level'] == "Medium" else "green"),
                "trend_label": "Based on confidence intervals"
            },
            {
                "title": "Recent Anomalies (60d)",
                "value": str(anomaly_count),
                "status_color": "red" if high_severity_count > 0 else "gray",
                "trend_label": f"{high_severity_count} high severity events"
            }
        ]
    }

@app.get("/available_categories")
def get_available_categories(store_id: int = 1):
    """Scans the model_registry folder and returns a list of trained categories."""
    
    # 👇 Use the absolute REGISTRY_DIR here
    if not os.path.exists(REGISTRY_DIR):
        print(f"⚠️ Warning: Could not find folder at {REGISTRY_DIR}")
        return {"categories": ["GROCERY I"]} 

    categories = set()
    for filename in os.listdir(REGISTRY_DIR):
        if filename.startswith(f"s{store_id}_") and filename.endswith(".json") and not filename.endswith("_metrics.json"):
            family_name = filename.replace(f"s{store_id}_", "").replace(".json", "")
            categories.add(family_name)
            
    return {"categories": sorted(list(categories)) or ["GROCERY I"]}

@app.post("/chat")
def chat_with_multi_agent_system(req: ChatRequest):
    # 1. Load Context (Prophet Model)
    m, _, exists = load_model(req.store_id, req.family)
    forecast_context = ""
    if exists:
        stats = get_market_sentiment(m)
        forecast_context = (
            f"FORECAST DATA for {req.family}: "
            f"Next 7-day demand is {stats['next_7_total']}. Trend: {stats['trend_desc']}."
        )

    # ---------------------------------------------------------
    # AGENT 1: THE ORCHESTRATOR (ROUTER)
    # ---------------------------------------------------------
    router_prompt = (
        "You are the Orchestrator. Read the user's message and route it to the correct specialist.\n"
        "Reply EXACTLY with one of these four words: ANALYST, EXECUTIVE, RISK, or GENERAL.\n"
        "- Use ANALYST if the user asks about forecasts, past sales, trends, or the database.\n"
        "- Use EXECUTIVE if the user asks to check inventory, current stock, stock levels, or draft an order.\n"
        "- Use RISK if the user asks about weather, oil prices, storms, shipping delays, or outside news.\n"
        "- Use GENERAL if it is a standard greeting."
    )
    
    try:
        routing_response = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": "llama3.1",
                "messages": [
                    {"role": "system", "content": router_prompt},
                    {"role": "user", "content": req.message}
                ],
                "stream": False
            }
        ).json()
        selected_agent = routing_response.get("message", {}).get("content", "").strip().upper()
    except Exception as e:
        return {"type": "message", "content": "Orchestrator offline. System error."}

    if selected_agent not in ["ANALYST", "EXECUTIVE", "GENERAL"]:
        selected_agent = "GENERAL"

    print(f"🧠 Orchestrator routed task to: {selected_agent}")

    # ---------------------------------------------------------
    # AGENT EXECUTION (ROUTING LOGIC)
    # ---------------------------------------------------------
    agent_thoughts = [{"tool": f"Orchestrator routed to {selected_agent}", "args": {}}]
    
    if selected_agent == "ANALYST":
        system_msg = (
            "You are the Quantitative Analyst.\n"
            f"Here is the data you already know: {forecast_context}\n"
            "CRITICAL RULES:\n"
            "1. IF THE USER ASKS ABOUT THE FUTURE (forecasts, next X days): DO NOT trigger any tools. Answer directly using the text provided above. If they ask for 4 days, take the 7-day total, divide by 7, and multiply by 4. Just do the math and reply in plain text.\n"
            "2. IF THE USER ASKS ABOUT THE PAST: Only then should you trigger the `ask_database` tool.\n"
            "3. 'GROCERY I' is the full product name. Never ask for sub-categories.\n"
            "4. NEVER output raw JSON in your text."
        )
        tools_to_use = supply_chain_tools
    
    elif selected_agent == "EXECUTIVE":
        system_msg = (
            f"You are the Operations Executive managing the {req.family} category. "
            f"CRITICAL RULES: "
            f"1. NEVER invent, guess, or hallucinate inventory levels, item names (like bread or milk), or quantities. Do not list individual grocery items. We only track bulk categories like {req.family}. "
            f"2. ALWAYS use the `check_inventory` tool to get the real mathematical data before answering inventory questions. "
            f"3. ANSWER ONLY WHAT IS ASKED. If the user asks for current stock, report the stock and status, then STOP. DO NOT volunteer to draft a purchase order unless explicitly commanded to 'draft an order', 'buy more', or 'restock'. "
            f"4. If drafting a PO, ALWAYS use the `suggested_qty` from your most recent `check_inventory` tool call. Only use {stats['next_7_total'] if exists else 50} as a fallback if you have not checked inventory yet. "
            f"5. Never explain your math, mention 'fallbacks', or show your internal calculations to the user. Speak like a concise, professional corporate executive."
        )
        tools_to_use = supply_chain_tools

    elif selected_agent == "RISK":
        system_msg = (
            "You are the Risk Management Agent. Your job is to monitor real-world disruptions "
            "like weather delays or oil price spikes. Use your tools to fetch live data and "
            "advise the user on how it affects the supply chain."
        )
        tools_to_use = supply_chain_tools

    else:
        system_msg = "You are a helpful Supply Chain AI. Greet the user and ask how you can help."
        tools_to_use = []

    # ---------------------------------------------------------
    # FINAL LLM GENERATION WITH SELECTED AGENT & MEMORY
    # ---------------------------------------------------------
    messages = [{"role": "system", "content": system_msg}]

    # Inject the last 4 messages to give the AI short-term memory
    for h in req.history[-4:]:
        role = "user" if h.get("sender") == "user" else "assistant"
        # Only inject text content, strip out widget data to save tokens
        messages.append({"role": role, "content": h.get("content", "")})

    # Append the current user message
    messages.append({"role": "user", "content": req.message})

    response = requests.post(
        "http://localhost:11434/api/chat",
        json={
            "model": "llama3.1",
            "messages": messages,
            "tools": tools_to_use,
            "stream": False
        }
    ).json()

    assistant_message = response.get("message", {})

    # ── FALLBACK: Llama sometimes writes tool JSON in content instead of tool_calls ──
    if not assistant_message.get("tool_calls") and assistant_message.get("content"):
        import re
        content = assistant_message["content"]
        matches = re.findall(r'\{"name":\s*"(\w+)",\s*"parameters":\s*(\{.*?\})\}', content, re.DOTALL)
        if matches:
            parsed_calls = []
            for name, params_str in matches:
                try:
                    parsed_calls.append({
                        "function": {
                            "name": name,
                            "arguments": json.loads(params_str)
                        }
                    })
                except json.JSONDecodeError:
                    pass
            if parsed_calls:
                assistant_message["tool_calls"] = parsed_calls
    # ── END FALLBACK ──

    # DID THE SPECIALIST USE A TOOL?
    if assistant_message.get("tool_calls"):
        messages.append(assistant_message)

        # Holds inventory data if check_inventory runs — used as fallback widget
        # only if draft_purchase_order is NOT subsequently called in the same turn.
        pending_inventory_widget = None

        for tool_call in assistant_message["tool_calls"]:
            func_name = tool_call["function"]["name"]
            args = tool_call["function"]["arguments"]
            agent_thoughts.append({"tool": func_name, "args": args})

            # --- DRAFT PURCHASE ORDER (Generative UI) ---
            if func_name == "draft_purchase_order":
                # Extract and forcefully uppercase it
                extracted_family = str(args.get('family', '')).upper().strip()

                # If they said "GROCERY" instead of "GROCERY I", fix it
                if extracted_family == "GROCERY":
                    extracted_family = "GROCERY I"
                if extracted_family == "BREAD":
                    extracted_family = "BREAD/BAKERY"

                # Use the AI's choice if valid, otherwise fallback to the UI dropdown
                valid_categories = ["GROCERY I", "BEVERAGES", "PRODUCE", "CLEANING", "DAIRY", "BREAD/BAKERY", "AUTOMOTIVE"]
                target_family = extracted_family if extracted_family in valid_categories else (req.family or "GROCERY I")

                raw_qty = args.get('suggested_qty')

                # Priority 1: qty came from the LLM args directly
                # Priority 2: a check_inventory ran earlier in this same turn
                if not raw_qty and pending_inventory_widget:
                    raw_qty = pending_inventory_widget["decision"]["suggested_order_qty"]

                # Priority 3: no qty anywhere — run the inventory math right now
                # so we never fall back to an arbitrary default like 50
                if not raw_qty:
                    try:
                        fallback_inv = predict_inventory_advanced(InventoryRequest(
                            store_id=req.store_id,
                            family=target_family,
                            current_stock=req.current_stock
                        ))
                        raw_qty = fallback_inv["decision"]["suggested_order_qty"]
                    except Exception as e:
                        print(f"⚠️ Could not compute qty for PO: {str(e)}")
                        raw_qty = int(stats['next_7_total']) if exists else 50

                qty = int(raw_qty)
                estimated_cost = float(qty) * 15.5

                return {
                    "type": "purchase_order",
                    "content": f"**Executive Agent:** I have drafted a purchase order for {qty} units of {target_family}.",
                    "widget_data": {
                        "family": target_family,
                        "suggested_qty": qty,
                        "supplier": "Default Supplier Inc.",
                        "estimated_cost": estimated_cost
                    },
                    "thought_process": agent_thoughts
                }

            # --- CHECK INVENTORY ---
            elif func_name == "check_inventory":
                target_family = args.get('family', req.family)

                inventory_req = InventoryRequest(
                    store_id=req.store_id,
                    family=target_family,
                    current_stock=req.current_stock
                )

                try:
                    real_inventory_data = predict_inventory_advanced(inventory_req)

                    # Store the result so draft_purchase_order (if called next)
                    # can use the real suggested_qty instead of guessing.
                    pending_inventory_widget = real_inventory_data

                    # Feed a compact summary back into the message chain so the LLM
                    # knows the numbers and can decide its next action (e.g. draft PO).
                    messages.append({
                        "role": "tool",
                        "name": func_name,
                        "content": json.dumps({
                            "current_stock": req.current_stock, # <--- MUST HAVE THIS!
                            "suggested_qty": real_inventory_data["decision"]["suggested_order_qty"],
                            "stockout_probability_pct": real_inventory_data["decision"]["stockout_probability_pct"],
                            "status": real_inventory_data["decision"]["status"]
                        })
                    })

                except Exception as e:
                    print(f"❌ Inventory Tool Crash: {str(e)}")
                    messages.append({
                        "role": "tool",
                        "name": func_name,
                        "content": json.dumps({"error": str(e)})
                    })

            # --- TEXT TO SQL: ASK DATABASE ---
            elif func_name == "ask_database":
                target_question = args.get('question')
                try:
                    db_result = execute_text_to_sql(target_question)
                    tool_result = {"data": db_result}
                except Exception as e:
                    tool_result = {"error": str(e)}
                
                messages.append({
                    "role": "tool",
                    "name": func_name,
                    "content": json.dumps(tool_result)
                })

            # --- LIVE API: CHECK MARKET CONDITIONS ---
            elif func_name == "check_market_conditions":
                target_query = args.get('query', 'general')
                try:
                    market_result = get_live_market_data(target_query)
                    tool_result = {"live_data": market_result}
                except Exception as e:
                    tool_result = {"error": str(e)}

                messages.append({
                    "role": "tool",
                    "name": func_name,
                    "content": json.dumps(tool_result)
                })

        # If check_inventory ran but draft_purchase_order was never called,
        # return the inventory widget now (user asked to check stock, not draft a PO).
        if pending_inventory_widget:
            return {
                "type": "inventory_check",
                "content": f"**Executive Agent:** I've run the probabilistic risk models on the {req.family} category. Here is your decision dashboard:",
                "widget_data": pending_inventory_widget,
                "thought_process": agent_thoughts
            }

        # Get final text response after all tools finish
        final_response = requests.post(
            "http://localhost:11434/api/chat",
            json={"model": "llama3.1", "messages": messages, "stream": False}
        ).json()

        return {
            "type": "message",
            "content": f"**{selected_agent.capitalize()} Agent:** {final_response.get('message', {}).get('content', '')}",
            "thought_process": agent_thoughts
        }

    final_text = assistant_message.get("content", "I didn't quite catch that.")
    return {
        "type": "message",
        "content": f"**{selected_agent.capitalize()} Agent:** {final_text}",
        "thought_process": agent_thoughts
    }

@app.post("/submit_order")
def submit_order(req: OrderSubmitRequest):
    # In a real app, this is where you would run an SQL UPDATE command 
    # to insert the new Purchase Order into your database.
    
    if req.action == "approve":
        print(f"✅ SUCCESS: Ordered {req.quantity} of {req.family} for Store {req.store_id}")
        return {"status": "success", "message": f"Order for {req.quantity} units placed successfully!"}
    
    elif req.action == "reject":
        print(f"❌ REJECTED: Cancelled order for {req.family}")
        return {"status": "cancelled", "message": "Order was rejected."}
        
    return {"status": "error", "message": "Invalid action."}
    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)