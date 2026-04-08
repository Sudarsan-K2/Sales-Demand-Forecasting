# pyre-ignore-all-errors
from fastapi import FastAPI, HTTPException, Depends, Security, Request, Query
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pydantic import BaseModel, Field, field_validator, ValidationInfo
import pandas as pd
from prophet import Prophet
from prophet.serialize import model_from_json, model_to_json
from sqlalchemy import create_engine, text
from typing import List, Dict, Any, Optional
import json
import os
import requests
from contextvars import ContextVar

_current_tenant_id: ContextVar[str] = ContextVar("current_tenant_id", default="anonymous")
import re
import math
import scipy.stats as st
import httpx
import yfinance as yf

# --- NEW IMPORTS FOR LANGCHAIN AND RAG ---
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv
load_dotenv(override=True)
from langgraph.prebuilt import create_react_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
import chromadb
from sentence_transformers import SentenceTransformer

def get_llm():
    def log_rate_limits(response):
        rem = response.headers.get("x-ratelimit-remaining")
        reset = response.headers.get("x-ratelimit-reset")
        if rem is not None:
            pass # keep quiet or print

    http_client = httpx.Client(event_hooks={'response': [log_rate_limits]})
    return ChatOpenAI(
        model="gpt-4o-mini", 
        temperature=0,
        api_key=os.environ.get("GITHUB_TOKEN"),
        base_url="https://models.inference.ai.azure.com",
        http_client=http_client
    )

# Initialize ChromaDB Client
CHROMA_DB_DIR = "./chroma_db"
try:
    chroma_client = chromadb.PersistentClient(path=CHROMA_DB_DIR)
    knowledge_collection = chroma_client.get_collection("supply_chain_knowledge")
    embedder = SentenceTransformer("all-MiniLM-L6-v2")
    print("✅ Connected to local ChromaDB knowledge base.")
except Exception as e:
    knowledge_collection = None
    embedder = None
    print(f"⚠️ Could not load ChromaDB: {e}")

app = FastAPI(title="Sales & Inventory Decision System")
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

def verify_api_key(api_key: str = Security(api_key_header)):
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing API Key")
    
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS api_keys (
                id SERIAL PRIMARY KEY,
                key VARCHAR(255) UNIQUE,
                user_id VARCHAR(50)
            )
        """))
        try:
            conn.execute(text("INSERT INTO api_keys (key, user_id) VALUES ('secret-token', 'admin_user') ON CONFLICT DO NOTHING"))
            conn.commit()
        except Exception as e:
            print(f"Seed insert skipped: {e}")
            
        res = conn.execute(text("SELECT user_id FROM api_keys WHERE key = :k"), {"k": api_key}).fetchone()
        if not res:
            raise HTTPException(status_code=401, detail="Invalid API Key")
        
        return res[0]

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

@tool
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
        llm = get_llm()
        response = llm.invoke([{"role": "system", "content": sql_prompt}])
        
        raw_sql = response.content.strip()
        
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
    store_id: int = Field(..., gt=0, description="Store ID must be positive")
    family: str = Field(..., min_length=2, max_length=100)
    months: int = Field(3, gt=0, le=24, description="Forecast horizon in months")
    simulate_promo: bool = False
    custom_oil_price: Optional[float] = Field(None, gt=0, le=500)

    @field_validator('family')
    @classmethod
    def sanitize_family(cls, v: str, info: ValidationInfo) -> str:
        # Prevent obvious SQL injection characters
        if re.search(r"['\";=]", v):
            raise ValueError("Invalid characters in family name")
        return v.upper().strip()

class InventoryRequest(BaseModel):
    store_id: int = Field(..., gt=0)
    family: str = Field(..., min_length=2, max_length=100)
    lead_time_days: int = Field(7, ge=0, le=180) 
    current_stock: int = Field(0, ge=0)       
    service_level: float = Field(0.95, gt=0, lt=1)  
    order_cost: float = Field(50.0, ge=0)     
    holding_cost: float = Field(0.15, ge=0)   
    unit_price: float = Field(2.50, gt=0)     
    is_perishable: bool = True   
    
    @field_validator('family')
    @classmethod
    def sanitize_family(cls, v: str, info: ValidationInfo) -> str:
        if re.search(r"['\";=]", v):
            raise ValueError("Invalid characters in family name")
        return v.upper().strip()

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    store_id: int = Field(..., gt=0)
    family: str = Field(..., min_length=2, max_length=100)
    current_stock: int = Field(0, ge=0)
    history: List[Dict[str, Any]] = Field(default_factory=list)
    session_id: str = Field("default_session", max_length=100)

    @field_validator('family')
    @classmethod
    def sanitize_family(cls, v: str, info: ValidationInfo) -> str:
        if re.search(r"['\";=]", v):
            raise ValueError("Invalid characters in family name")
        return v.upper().strip()

class OrderSubmitRequest(BaseModel):
    store_id: int = Field(..., gt=0)
    family: str = Field(..., min_length=2, max_length=100)
    quantity: int = Field(..., gt=0)
    action: str = Field(..., pattern="^(approve|reject)$")
    
    @field_validator('family')
    @classmethod
    def sanitize_family(cls, v: str, info: ValidationInfo) -> str:
        if re.search(r"['\";=]", v):
            raise ValueError("Invalid characters in family name")
        return v.upper().strip()

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
    assert m is not None

    # 1. Predict for the lead time window
    future = m.make_future_dataframe(periods=req.lead_time_days)
    future['onpromotion'] = 0 
    future['oil_price'] = m.history['oil_price'].iloc[-1] if 'oil_price' in m.history.columns else 90.0
    
    future['onpromotion'] = future['onpromotion'].fillna(0)
    future['oil_price'] = future['oil_price'].ffill().bfill()

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
    annualized_demand = (expected_demand / req.lead_time_days) * 365 if req.lead_time_days > 0 else 0
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

    stakeholders = STAKEHOLDER_DB.get(req.family, DEFAULT_STAKEHOLDERS)

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
    future['oil_price'] = m.history['oil_price'].iloc[-1] if 'oil_price' in m.history.columns else 90.0
    future['onpromotion'] = future['onpromotion'].fillna(0)
    future['oil_price'] = future['oil_price'].ffill().bfill()
    
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
    trend_diff: float = ((current_trend - start_trend) / start_trend) * 100 if start_trend != 0 else 0.0
    
    trend_direction = "Stable ➡️"
    if trend_diff > 2: trend_direction = "Growing 📈"
    elif trend_diff < -2: trend_direction = "Declining 📉"

    # C. Volatility / Risk
    # Width of the confidence interval
    avg_width = (forecast.tail(periods)['yhat_upper'] - forecast.tail(periods)['yhat_lower']).mean()
    avg_pred = forecast.tail(periods)['yhat'].mean()
    risk_score = (avg_width / avg_pred) * 100 if avg_pred != 0 else 0.0
    
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
        "trend_pct": round(float(trend_diff), 1),
        "trend_desc": trend_direction,
        "risk_level": risk_level,
        "peak_day": peak_date
    }

# --- EXTERNAL API INTEGRATION (For the Risk Agent) ---
@tool
def get_live_market_data(query: str) -> str:
    """
    Fetches real-time data from external APIs (Weather from Open-Meteo, Oil from YFinance).
    """
    query = query.lower()
    print(f"🌍 Fetching live API data for: {query}")
    
    try:
        if "oil" in query or "price" in query:
            # Live Crude Oil Price (WTI)
            ticker = yf.Ticker("CL=F")
            data = ticker.history(period="1d")
            if not data.empty:
                current_price = round(float(data['Close'].iloc[-1]), 2)
                
                # Simple logic for elevated alert
                status = "ELEVATED" if current_price > 85.0 else "NORMAL"
                return json.dumps({
                    "commodity": "Crude Oil (WTI)",
                    "current_price_usd": current_price,
                    "status": status,
                    "source": "yfinance API"
                })
            else:
                return "Error: Could not retrieve live oil price."
                
        elif "weather" in query or "storm" in query:
            # Live Weather for Seattle (example primary port location)
            # 47.6062° N, 122.3321° W
            url = "https://api.open-meteo.com/v1/forecast?latitude=47.6062&longitude=-122.3321&current=temperature_2m,precipitation,wind_speed_10m&timezone=America%2FLos_Angeles"
            resp = requests.get(url, timeout=5)
            data = resp.json()
            current = data.get("current", {})
            
            wind_speed = current.get("wind_speed_10m", 0)
            precip = current.get("precipitation", 0)
            
            status = "Normal"
            alert = "No major disruptions."
            
            # Simple threshold for severe weather
            if wind_speed > 40 or precip > 10:
                status = "Severe Weather Warning"
                alert = f"High winds ({wind_speed} km/h) or heavy rain ({precip} mm) detected in Seattle port area."
                
            return json.dumps({
                "location": "Seattle (Primary Port)",
                "temperature_c": current.get("temperature_2m"),
                "wind_speed_kmh": wind_speed,
                "precipitation_mm": precip,
                "weather_status": status,
                "news_alert": alert
            })
            
        else:
            return json.dumps({"status": "Normal", "alert": "No targeted APIs available for this query."})
            
    except Exception as e:
        return f"External API Error: {str(e)}"

# --- ENDPOINT 1: PREDICTION & EXPLANATION ---
@app.post("/predict", dependencies=[Depends(verify_api_key)])
def predict_sales(req: PredictionRequest):
    m, metrics, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail=f"Model not found for Store {req.store_id} - {req.family}")
    assert m is not None

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
        if 'oil_price' in m.history.columns:
             last_known_oil = m.history['oil_price'].iloc[-1]
        future.loc[future_dates, 'oil_price'] = last_known_oil

    # Fill NaNs
    future['onpromotion'] = future['onpromotion'].fillna(0)
    future['oil_price'] = future['oil_price'].ffill().bfill()

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
    # Create formatted strings for easier consumption by the LLM and the UI
    forecast['confidence_band_formatted'] = forecast.apply(
        lambda row: f"Low: {int(row['yhat_lower'])}, High: {int(row['yhat_upper'])}", axis=1
    )
    result_cols = ['ds', 'yhat', 'yhat_lower', 'yhat_upper', 'confidence_band_formatted']

    # --- NEW: SHIFT DATES TO CURRENT DAY FOR THE UI ---
    last_historical_date = m.history['ds'].max()
    time_offset = pd.Timestamp.now().normalize() - last_historical_date
    forecast['ds'] = forecast['ds'] + time_offset
    # --------------------------------------------------

    # Model Freshness Label
    freshness = "Unknown"
    if metrics and "last_trained" in metrics:
        import datetime
        try:
            # Strip out microseconds if present before parsing
            last_dt_str = metrics["last_trained"].split('.')[0]
            last_dt = datetime.datetime.strptime(last_dt_str, "%Y-%m-%d %H:%M:%S")
            days_ago = (datetime.datetime.now() - last_dt).days
            if days_ago == 0:
                freshness = "Trained Today"
            elif days_ago < 7:
                freshness = f"Trained {days_ago} days ago"
            else:
                freshness = f"Stale ({days_ago} days old)"
        except:
            pass
    metrics["freshness_label"] = freshness

    return {
        "metrics": metrics,
        "impact_factors": impact_factors,
        "forecast": forecast[result_cols].tail(req.months * 30).to_dict(orient="records")
    }

# --- ENDPOINT 2: INVENTORY DECISION SUPPORT ---
@app.post("/inventory", dependencies=[Depends(verify_api_key)])
def predict_inventory(req: InventoryRequest):
    m, metrics, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail="Model not found")
    assert m is not None

    # 1. Predict for the lead time window
    future = m.make_future_dataframe(periods=req.lead_time_days)
    future['onpromotion'] = 0
    future['oil_price'] = m.history['oil_price'].iloc[-1] if 'oil_price' in m.history.columns else 90.0
    future['onpromotion'] = future['onpromotion'].fillna(0)
    future['oil_price'] = future['oil_price'].ffill().bfill()
    forecast = m.predict(future)
    future_data = forecast.tail(req.lead_time_days)

    # 2. Extract Demand Distributions
    expected_demand = future_data['yhat'].sum()
    worst_case_demand = future_data['yhat_upper'].sum()
    
    # Standard deviation of demand over the lead time window
    demand_std_dev_lt = (worst_case_demand - expected_demand) / 1.645 # Approx from Prophet 90% CI
    
    # ADVANCED EOQ MATH: Add Lead-Time Variability
    # Assume historical supplier lead time std dev is 2 days as a baseline proxy 
    daily_demand = expected_demand / req.lead_time_days if req.lead_time_days > 0 else 0
    lead_time_std_dev = 2.0 
    
    # Combined variance = (Variance of demand during LT) + (Daily Demand^2 * Variance of LT)
    variance_demand_lt = demand_std_dev_lt ** 2
    variance_lt = lead_time_std_dev ** 2
    
    total_std_dev = math.sqrt(variance_demand_lt + ((daily_demand ** 2) * variance_lt))

    # 3. Probabilistic Stockout Risk
    if req.current_stock <= 0:
        stockout_prob = 0.99
    else:
        # Z-score using the advanced combined standard deviation
        z_score = (req.current_stock - expected_demand) / (total_std_dev if total_std_dev > 0 else 1)
        stockout_prob = 1.0 - st.norm.cdf(z_score)

    # 4. Financial Optimization (EOQ)
    annualized_demand = daily_demand * 365
    if annualized_demand > 0:
        optimal_order_qty = math.sqrt((2 * annualized_demand * req.order_cost) / (req.holding_cost * req.unit_price))
    else:
        optimal_order_qty = 0

    # 5. Spoilage Penalty 
    spoilage_risk = 0
    if req.is_perishable and req.current_stock > expected_demand * 1.5:
        spoilage_risk = (req.current_stock - expected_demand) * (req.unit_price * 0.4) 

    # 6. Final Decision Logic
    # Safety stock based on the combined standard deviation hitting a 95% service level (Z=1.645)
    safety_stock = 1.645 * total_std_dev
    needed_stock = expected_demand + safety_stock

    # Order the EOQ, but ensure it at least covers our immediate safety needs
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
@app.post("/analyze_history", dependencies=[Depends(verify_api_key)])
def analyze_history(req: InventoryRequest): # Reusing InventoryRequest for simplicity
    m, _, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail="Model not found")
    assert m is not None

    # 1. Predict on History
    # Prophet stores history in m.history. We just need to predict on it to get the confidence bands.
    if 'oil_price' not in m.history.columns:
        m.history['oil_price'] = 90.0
    if 'onpromotion' not in m.history.columns:
        m.history['onpromotion'] = 0
    forecast = m.predict(m.history)
    
    # 2. Find Outliers
    # Compare 'y' (actual) with 'yhat_upper' and 'yhat_lower'
    history_df = m.history[['ds', 'y']].set_index('ds')
    forecast = forecast.set_index('ds')
    forecast['y'] = history_df['y']
    forecast = forecast.reset_index()
    
    last_historical_date = m.history['ds'].max()
    time_offset = pd.Timestamp.now().normalize() - last_historical_date

    anomalies = []
    for idx, row in forecast.iterrows():
        actual = row['y']
        lower = row['yhat_lower']
        upper = row['yhat_upper']

        if actual > upper or actual < lower:
            severity = "High" if (actual > upper * 1.2 or actual < lower * 0.8) else "Medium"

            # Shift the anomaly date
            shifted_date = row['ds'] + time_offset

            anomalies.append({
                "date": shifted_date.strftime("%Y-%m-%d"),
                "actual": float(actual),
                "expected": float(row['yhat']),
                "type": "Spike" if actual > upper else "Drop",
                "severity": severity
            })
    
    # Sort by date descending (newest first)
    anomalies.reverse()
    
    return {
        "anomaly_count": len(anomalies),
        "recent_anomalies": anomalies[:100]  # Return up to 100 for the Intelligence Center explorer
    }

# --- ENDPOINT 4: MODEL RETRAINING (NEW) ---
@app.post("/retrain", dependencies=[Depends(verify_api_key)])
def retrain_model(req: PredictionRequest):
    """
    Pulls fresh data from the database for the given store and family, 
    refits the Prophet model, and saves it to the model registry.
    """
    store_id = req.store_id
    family = req.family.upper()
    
    try:
        # 1. Fetch historical data from DB
        query = text("""
            SELECT date as ds, y, onpromotion, oil_price 
            FROM training_data 
            WHERE store_nbr = :s AND family = :f
            ORDER BY date ASC
        """)
        with engine.connect() as conn:
            df = pd.read_sql(query, conn, params={"s": store_id, "f": family})
            
        if df.empty:
            raise HTTPException(status_code=404, detail="No historical data found for this store and family.")
            
        # Ensure correct column types
        df['ds'] = pd.to_datetime(df['ds'])
        df['y'] = pd.to_numeric(df['y'])
        df['onpromotion'] = pd.to_numeric(df['onpromotion']).fillna(0)
        df['oil_price'] = pd.to_numeric(df['oil_price']).fillna(90.0)
        
        # 2. Initialize and fit new Prophet model
        m = Prophet(yearly_seasonality=True, weekly_seasonality=True, daily_seasonality=False)
        m.add_regressor('onpromotion')
        m.add_regressor('oil_price')
        
        m.fit(df)
        
        # 3. Save to Registry
        if not os.path.exists(REGISTRY_DIR):
            os.makedirs(REGISTRY_DIR)
            
        model_filename = f"s{store_id}_{family}.json"
        metrics_filename = f"s{store_id}_{family}_metrics.json"
        
        with open(os.path.join(REGISTRY_DIR, model_filename), 'w') as fout:
            json.dump(model_to_json(m), fout)
            
        # Update metrics to indicate fresh training date
        import datetime
        from sklearn.metrics import mean_absolute_error, mean_squared_error
        import numpy as np
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Compute in-sample MAE, RMSE, MAPE for Intelligence Center metric cards
        try:
            in_sample = m.predict(m.history)
            y_true = m.history['y'].values
            y_pred = in_sample['yhat'].values
            mae  = round(float(mean_absolute_error(y_true, y_pred)), 2)
            rmse = round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 2)
            # Use wMAPE (Volume-Weighted MAPE) to completely avoid the small-denominator explosion
            # wMAPE = SUM(|y_true - y_pred|) / SUM(|y_true|)
            total_actuals = np.sum(np.abs(y_true))
            if total_actuals > 0:
                mape = round(float(np.sum(np.abs(y_true - y_pred)) / total_actuals) * 100, 2)
            else:
                mape = 0.0
        except Exception as metric_err:
            print(f"⚠️ Could not compute metrics: {metric_err}")
            mae, rmse, mape = 0.0, 0.0, 0.0

        metrics = {
            "mae": mae,
            "rmse": rmse,
            "mape": mape,
            "last_trained": now_str,
            "status": "Healthy"
        }
        with open(os.path.join(REGISTRY_DIR, metrics_filename), 'w') as fout:
            json.dump(metrics, fout)
            
        return {
            "status": "success", 
            "message": f"Successfully retrained model for {family} at Store {store_id}",
            "last_trained": now_str,
            "data_points_used": len(df)
        }
    except Exception as e:
        print(f"Failed to retrain model: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrain: {str(e)}")

# --- AGENT TOOLBOX (LangChain Tools) ---

@tool
def get_sales_forecast(store_id: int, family: str, days_ahead: int = 30) -> str:
    """Gets the statistical Prophet forecast math for a specific store and product family.
    Returns the expected total volume, risk level, and trend."""
    try:
        m, metrics, exists = load_model(store_id, family)
        if not exists:
            return f"Error: No forecast model found for Store {store_id}, Family {family}."
        assert m is not None
        
        sentiment = get_market_sentiment(m, periods=days_ahead)
        return (
            f"FORECAST FOR {family}: "
            f"Expected {days_ahead}-day volume: {sentiment['next_30_total']}. "
            f"Trend: {sentiment['trend_pct']}% ({sentiment['trend_desc']}). "
            f"Risk Level: {sentiment['risk_level']}. Peak day expected: {sentiment['peak_day']}."
        )
    except Exception as e:
        return f"Error computing forecast: {str(e)}"

@tool
def search_company_knowledge(query: str) -> str:
    """Searches the company's unstructured internal documents (emails, briefs, news) for context.
    Use this to find out WHY demand might be changing (e.g., marketing campaigns, strikes, supplier delays)."""
    if not knowledge_collection or not embedder:
        return "Error: Internal knowledge vector database is offline."
    
    try:
        query_embedding = embedder.encode(query).tolist()
        results = knowledge_collection.query(
            query_embeddings=[query_embedding],
            n_results=2
        )
        
        if not results['documents'][0]:
            return "No relevant internal documents found."
            
        docs = results['documents'][0]
        return "Found the following internal context:\n" + "\n---\n".join(docs)
    except Exception as e:
        return f"Database error: {str(e)}"

@tool
def check_inventory_advanced(store_id: int, family: str, current_stock: int) -> str:
    """Checks inventory using probabilistic math (stockout risk) and calculates Economic Order Quantity (EOQ)."""
    try:
        req = InventoryRequest(store_id=store_id, family=family, current_stock=current_stock)
        data = predict_inventory_advanced(req)
        
        return json.dumps({
            "status": data["decision"]["status"],
            "stockout_probability_pct": data["decision"]["stockout_probability_pct"],
            "suggested_order_qty": data["decision"]["suggested_order_qty"]
        })
    except Exception as e:
        return f"Inventory math error: {str(e)}"

@tool
def draft_purchase_order(family: str, quantity: int) -> str:
    """Triggers the UI to display a draft purchase order widget to the user."""
    try:
        if quantity <= 0:
            return "Error: Quantity must be greater than zero."

        tenant_id = _current_tenant_id.get()
        estimated_cost = float(quantity) * 15.5
        
        # Actually write the draft order into the database
        with engine.connect() as connection:
            # Check if table exists, if not create a simple one
            connection.execute(text("""
                CREATE TABLE IF NOT EXISTS purchase_orders (
                    id SERIAL PRIMARY KEY,
                    tenant_id VARCHAR(50) DEFAULT 'admin_user',
                    family VARCHAR(255),
                    quantity INTEGER,
                    estimated_cost FLOAT,
                    status VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            
            # Insert the draft order
            connection.execute(text("""
                INSERT INTO purchase_orders (tenant_id, family, quantity, estimated_cost, status)
                VALUES (:tenant_id, :family, :quantity, :cost, 'DRAFT')
            """), {"tenant_id": tenant_id, "family": family.upper(), "quantity": quantity, "cost": estimated_cost})
            
            connection.commit()
            print(f"✅ Draft PO saved to database for {quantity} units of {family} under tenant {tenant_id}.")

        return json.dumps({
            "WIDGET_TRIGGER": "purchase_order",
            "family": family.upper(),
            "suggested_qty": quantity,
            "estimated_cost": estimated_cost,
            "supplier": "Standard General Distributors"
        })
    except Exception as e:
        print(f"⚠️ Failed to save PO to database: {e}")
        return f"Error drafting purchase order: {str(e)}"

@tool
def lookup_stakeholders(family: str) -> str:
    """Looks up the vendor and internal buyer for a given product family."""
    stakeholders = STAKEHOLDER_DB.get(family.upper(), DEFAULT_STAKEHOLDERS)
    return json.dumps(stakeholders)

@tool
def check_recent_anomalies(store_id: int, family: str) -> str:
    """Checks the historical data to detect past spikes or dips in demand for this product family."""
    try:
        req = InventoryRequest(store_id=store_id, family=family)
        data = analyze_history(req)
        return f"Found {data['anomaly_count']} historical anomalies. Top recent: {json.dumps(data['recent_anomalies'][:3])}"
    except Exception as e:
        return f"Error checking anomalies: {str(e)}"

# The tools list for LangChain
langchain_tools = [
    get_sales_forecast,
    search_company_knowledge,
    check_inventory_advanced,
    draft_purchase_order,
    execute_text_to_sql,
    get_live_market_data,
    lookup_stakeholders,
    check_recent_anomalies
]

@app.post("/dashboard/summary", dependencies=[Depends(verify_api_key)])
def get_dashboard_summary(req: PredictionRequest):
    # We use PredictionRequest since it already has store_id and family
    m, metrics, exists = load_model(req.store_id, req.family)
    if not exists:
        raise HTTPException(status_code=404, detail="Model not found")
    assert m is not None

    # 1. Get Market Sentiment (Forecast totals and trends)
    sentiment = get_market_sentiment(m, periods=30)

    # 2. Get Recent Anomalies
    if 'oil_price' not in m.history.columns:
        m.history['oil_price'] = 90.0
    if 'onpromotion' not in m.history.columns:
        m.history['onpromotion'] = 0
    forecast = m.predict(m.history)
    history_df = m.history[['ds', 'y']].set_index('ds')
    forecast = forecast.set_index('ds')
    forecast['y'] = history_df['y']
    forecast = forecast.reset_index()
    
    anomaly_count: int = 0
    high_severity_count: int = 0
    for idx, row in forecast.tail(60).iterrows(): # Look at the last 60 days of history
        actual: float = float(row['y'])
        upper: float = float(row['yhat_upper'])
        lower: float = float(row['yhat_lower'])
        
        if actual > upper or actual < lower:
            anomaly_count = anomaly_count + 1
            if actual > upper * 1.2 or actual < lower * 0.8:
                high_severity_count = high_severity_count + 1

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
                "value": str(sentiment['trend_desc']).replace(" 📈", "").replace(" 📉", "").replace(" ➡️", ""),
                "trend": sentiment['trend_pct'], # Neutral indicator
                "trend_label": "Based on moving average"
            },
            {
                "title": "Forecast Risk Level",
                "value": str(sentiment['risk_level']).upper(),
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

@app.get("/available_categories", dependencies=[Depends(verify_api_key)])
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

@app.get("/orders", dependencies=[Depends(verify_api_key)])
def get_orders(store_id: int = Query(1, gt=0), user_id: str = Depends(verify_api_key)):
    """
    Returns all purchase orders for the given store from the purchase_orders table.
    Used by the Orders & Procurement Hub page.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS purchase_orders (
                    id              SERIAL PRIMARY KEY,
                    tenant_id       VARCHAR(50),
                    family          VARCHAR(255),
                    quantity        INTEGER,
                    estimated_cost  FLOAT,
                    status          VARCHAR(50),
                    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()

            rows = conn.execute(text("""
                SELECT id, family, quantity, estimated_cost, status, created_at
                FROM   purchase_orders
                WHERE  tenant_id = :uid
                ORDER  BY created_at DESC
                LIMIT  200
            """), {"uid": user_id}).fetchall()

            orders = [
                {
                    "id":             row[0],
                    "family":         row[1],
                    "quantity":       row[2],
                    "estimated_cost": round(row[3], 2) if row[3] else 0,
                    "status":         (row[4] or "approved").lower(),
                    "created_at":     row[5].isoformat() if row[5] else None,
                    "supplier":       None,
                }
                for row in rows
            ]
            return {"orders": orders, "total": len(orders)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {str(e)}")


@app.post("/chat", dependencies=[Depends(verify_api_key)])
@limiter.limit("20/minute")
def chat_with_multi_agent_system(req: ChatRequest, request: Request, user_id: str = Depends(verify_api_key)):
    """
    Overhauled Chat Endpoint using LangChain and Llama3.1.
    """
    
    # 1. Initialize the LLM
    _current_tenant_id.set(user_id)
    try:
        llm = get_llm()
    except Exception as e:
        return {"type": "message", "content": f"Failed to connect to API: {str(e)}"}

    # 2. Build the System Prompt
    system_content = (
        "You are an AI Supply Chain Exec. Be concise.\n\n"
        "RULES:\n"
        "1. USE TOOLS to get data (forecasts, inventory, SQL) before answering.\n"
        "2. To restock, use check_inventory_advanced then draft_purchase_order.\n"
        "3. NEVER output raw JSON tool calls to the user. Speak naturally.\n\n"
        "EXAMPLES:\n"
        "User: Restock beverages\n"
        "AI: [Calls tools...]\n"
        "AI: I checked inventory and drafted an order for Beverages.\n\n"
        f"Active Context: Store {req.store_id}, Family '{req.family}', Stock {req.current_stock}."
    )

    # Database-backed conversation memory
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    id SERIAL PRIMARY KEY,
                    session_id VARCHAR(50),
                    role VARCHAR(20),
                    content TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()

            # Save user message
            conn.execute(text("INSERT INTO chat_history (session_id, role, content) VALUES (:s, :r, :c)"),
                         {"s": req.session_id, "r": "user", "c": req.message})
            conn.commit()

            # Fetch last 10 messages from DB
            res = conn.execute(text("SELECT role, content FROM chat_history WHERE session_id = :s ORDER BY id DESC LIMIT 10"), {"s": req.session_id})
            db_history = res.fetchall()
            db_history.reverse()

        messages = [(row[0], row[1]) for row in db_history]
    except Exception as e:
        print(f"Database memory error: {e}")
        # Fallback to stateless req.history if DB fails
        messages = []
        for msg in req.history[-4:]:
            role = "assistant" if msg.get("sender") == "assistant" else "user"
            messages.append((role, msg.get("content", "")))
        messages.append(("user", req.message))

    # 3. Create the LangGraph Agent
    agent_executor = create_react_agent(llm, tools=langchain_tools, prompt=system_content)

    # 4. Execute standard user turn
    try:
        print(f"🤖 User query: {req.message}")
        result = agent_executor.invoke({"messages": messages})
        
        # 5. Extract thoughts and widgets from intermediate messages
        agent_thoughts = []
        raw_output = result["messages"][-1].content
        if not isinstance(raw_output, str):
            raw_output = str(raw_output)
            
        final_type = "message"
        widget_data = None
        
        # Extract from LangGraph intermediate steps
        for msg in result["messages"]:
            # Capture tool calls for thoughts
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                for tc in msg.tool_calls:
                    agent_thoughts.append({
                        "tool": tc.get("name", "tool"),
                        "args": tc.get("args", {})
                    })
            # Capture widget trigger from tool results
            if getattr(msg, 'type', '') == 'tool' or msg.__class__.__name__ == 'ToolMessage':
                if getattr(msg, 'name', '') == 'draft_purchase_order':
                    try:
                        content_str = msg.content
                        if "WIDGET_TRIGGER" in content_str:
                            parsed = json.loads(content_str)
                            if parsed.get("WIDGET_TRIGGER") == "purchase_order":
                                final_type = "purchase_order"
                                widget_data = parsed
                    except Exception as e:
                        pass

        # Fallback: using JsonOutputParser
        if "WIDGET_TRIGGER" in raw_output:
            try:
                start = raw_output.find('{')
                end = raw_output.rfind('}') + 1
                if start >= 0 and end > start:
                    parser = JsonOutputParser()
                    parsed_widget = parser.invoke(raw_output[start:end])
                    if parsed_widget.get("WIDGET_TRIGGER") == "purchase_order":
                        final_type = "purchase_order"
                        widget_data = parsed_widget
                        raw_output = raw_output.replace(raw_output[start:end], "").strip()
            except Exception as e:
                print(f"Fallback parse failed: {e}")

        if not agent_thoughts:
            agent_thoughts.append({
                "tool": "ReAct Langchain Executor",
                "args": {"tasks": "Reasoning complete"}
            })

        # Save assistant message
        try:
            with engine.connect() as conn:
                conn.execute(text("INSERT INTO chat_history (session_id, role, content) VALUES (:s, :r, :c)"),
                             {"s": req.session_id, "r": "assistant", "c": raw_output.strip()})
                conn.commit()
        except Exception as e:
            print(f"Failed to save assistant memory: {e}")

        return {
            "type": final_type,
            "content": raw_output.strip(),
            "widget_data": widget_data,
            "thought_process": agent_thoughts
        }

    except Exception as e:
        print(f"❌ ReAct Agent Crash: {str(e)}")
        return {
            "type": "error",
            "content": f"System error executing agent loop: {str(e)}",
            "thought_process": []
        }

@app.post("/submit_order")
def submit_order(req: OrderSubmitRequest, user_id: str = Depends(verify_api_key)):
    if req.action == "approve":
        estimated_cost = req.quantity * 15.5
        try:
            with engine.connect() as connection:
                connection.execute(text("""
                    CREATE TABLE IF NOT EXISTS purchase_orders (
                        id SERIAL PRIMARY KEY,
                        tenant_id VARCHAR(50),
                        family VARCHAR(255),
                        quantity INTEGER,
                        estimated_cost FLOAT,
                        status VARCHAR(50),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                connection.execute(text("""
                    INSERT INTO purchase_orders (tenant_id, family, quantity, estimated_cost, status)
                    VALUES (:t_id, :family, :quantity, :cost, 'APPROVED')
                """), {
                    "t_id": user_id, 
                    "family": req.family.upper(), 
                    "quantity": req.quantity, 
                    "cost": estimated_cost
                })
                connection.commit()
                print(f"✅ SUCCESS: Ordered {req.quantity} of {req.family} to DB under tenant {user_id}")
                return {"status": "success", "message": f"Order for {req.quantity} units placed!"}
        except Exception as e:
            print(f"⚠️ Failed to save PO to db: {e}")
            raise HTTPException(status_code=500, detail="DB Error")
            
    elif req.action == "reject":
        print(f"❌ REJECTED: Cancelled order for {req.family} by tenant {user_id}")
        return {"status": "cancelled", "message": "Order was rejected."}
        
    return {"status": "error", "message": "Invalid action."}
    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)