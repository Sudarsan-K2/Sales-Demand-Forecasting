from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from prophet.serialize import model_from_json
import json
import os

app = FastAPI()

# --- CORS SETUP ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DATA MODELS ---
class PredictionRequest(BaseModel):
    store_id: int
    family: str
    months: int = 3
    simulate_promo: bool = False
    custom_oil_price: float = None

class ChatRequest(BaseModel):
    message: str
    store_id: int
    family: str

# --- ENDPOINT 1: PREDICTION (Your existing dashboard logic) ---
@app.post("/predict")
def predict_sales(req: PredictionRequest):
    # 1. Load Model & Metrics
    filename = f"s{req.store_id}_{req.family}.json"
    metrics_filename = f"s{req.store_id}_{req.family}_metrics.json"
    
    model_path = os.path.join("model_registry", filename)
    metrics_path = os.path.join("model_registry", metrics_filename)
    
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="Model not found")

    with open(model_path, 'r') as fin:
        m = model_from_json(json.load(fin))
        
    # Load Accuracy Metrics (if available)
    metrics = {"mape": 0.0}
    if os.path.exists(metrics_path):
        with open(metrics_path, 'r') as fin:
            metrics = json.load(fin)

    # 2. Simulation Logic
    future = m.make_future_dataframe(periods=req.months * 30)
    future_dates = future['ds'] > m.history['ds'].max()
    
    # Promotion Logic
    if req.simulate_promo:
        future.loc[future_dates, 'onpromotion'] = 1
    else:
        future.loc[future_dates, 'onpromotion'] = 0
        
    # Oil Price Logic
    artificial_impact = 0
    if req.custom_oil_price is not None:
        future.loc[future_dates, 'oil_price'] = req.custom_oil_price
        # Apply the "Demo Sensitivity" Hack
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
    
    # Apply Demo Hack
    if req.custom_oil_price is not None:
         future_idx = forecast['ds'] > m.history['ds'].max()
         forecast.loc[future_idx, 'yhat'] += artificial_impact

    # Return Result
    # We check if 'yearly' exists (Prophet sometimes omits it if data < 2 years)
    result_cols = ['ds', 'yhat', 'trend', 'weekly']
    if 'yearly' in forecast.columns:
        result_cols.append('yearly')
    
    return {
        "metrics": metrics,
        "forecast": forecast[result_cols].tail(req.months * 30).to_dict(orient="records")
    }

# --- ENDPOINT 2: CHATBOT (The new AI feature) ---
@app.post("/chat")
def chat_with_data(req: ChatRequest):
    msg = req.message.lower()
    
    # 1. Load the Model Context
    filename = f"s{req.store_id}_{req.family}.json"
    model_path = os.path.join("model_registry", filename)
    
    if not os.path.exists(model_path):
        return {"response": f"I can't find a model for Store {req.store_id} ({req.family}). Please train it first."}
    
    with open(model_path, 'r') as fin:
        m = model_from_json(json.load(fin))

    # 2. INTENT RECOGNITION (The "Brain")
    
    # Scenario A: "What is the forecast?"
    if "forecast" in msg or "predict" in msg or "future" in msg:
        days = 30 # Default
        if "week" in msg: days = 7
        if "month" in msg: days = 30
        
        future = m.make_future_dataframe(periods=days)
        # Default assumptions
        future['onpromotion'] = 0
        future['oil_price'] = 90.0 
        future['onpromotion'] = future['onpromotion'].fillna(0)
        future['oil_price'] = future['oil_price'].fillna(method='ffill').fillna(method='bfill')
        
        forecast = m.predict(future)
        total_sales = int(forecast['yhat'].tail(days).sum())
        
        return {
            "response": f"Based on current trends, I predict total sales of <strong>{total_sales:,} units</strong> for the next {days} days."
        }

    # Scenario B: "Should I run a promotion?"
    elif "promo" in msg or "promotion" in msg:
        # Simulate +1 vs +0 promotion
        future_base = m.make_future_dataframe(periods=30)
        future_base['onpromotion'] = 0
        future_base['oil_price'] = 90.0
        
        future_promo = m.make_future_dataframe(periods=30)
        future_promo['onpromotion'] = 1
        future_promo['oil_price'] = 90.0
        
        for df in [future_base, future_promo]:
             df['onpromotion'] = df['onpromotion'].fillna(0)
             df['oil_price'] = df['oil_price'].fillna(method='ffill').fillna(method='bfill')

        base_sales = m.predict(future_base)['yhat'].tail(30).sum()
        promo_sales = m.predict(future_promo)['yhat'].tail(30).sum()
        
        lift = promo_sales - base_sales
        percent = (lift / base_sales) * 100 if base_sales > 0 else 0
        
        if lift > 0:
            return {"response": f"✅ <strong>Yes!</strong> Running a promotion is estimated to increase sales by <strong>{int(lift)} units</strong> (+{int(percent)}%) next month."}
        else:
            return {"response": "⚠️ A promotion might not be effective. My analysis shows <strong>negligible lift</strong> for this item based on historical data."}

    # Scenario C: "How is the trend?"
    elif "trend" in msg or "growth" in msg:
        # Look at the trend component of the last forecast
        future = m.make_future_dataframe(periods=1)
        future['onpromotion'] = 0
        future['oil_price'] = 90.0
        # fillna...
        future['onpromotion'] = future['onpromotion'].fillna(0)
        future['oil_price'] = future['oil_price'].fillna(method='ffill').fillna(method='bfill')
        
        forecast = m.predict(future)
        current_trend = forecast['trend'].iloc[-1]
        
        # Simple heuristic
        direction = "stable"
        if current_trend > forecast['trend'].iloc[0]: direction = "upward 📈"
        elif current_trend < forecast['trend'].iloc[0]: direction = "downward 📉"

        return {"response": f"The underlying long-term trend is currently <strong>{direction}</strong>. However, check the weekly chart for short-term seasonality."}

    # Default Fallback
    else:
        return {"response": "I am a specialized Supply Chain AI. I can answer questions about:<br/>• <strong>Forecasts</strong> (e.g., 'What is the forecast for next week?')<br/>• <strong>Promotions</strong> (e.g., 'Should I run a promo?')<br/>• <strong>Trends</strong> (e.g., 'How is the trend?')"}

if __name__ == "__main__":
    import uvicorn
    # Run on 0.0.0.0 to allow external access if needed, but 127.0.0.1 is fine for local
    uvicorn.run(app, host="127.0.0.1", port=8000)