from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pandas as pd
from prophet.serialize import model_from_json
from fastapi.middleware.cors import CORSMiddleware
import json
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows all origins (for development only)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PredictionRequest(BaseModel):
    store_id: int
    family: str
    months: int = 3
    simulate_promo: bool = False

@app.post("/predict")
def predict_sales(req: PredictionRequest):
    # 1. Construct Filename
    model_path = f"model_registry/s{req.store_id}_{req.family}.json"
    
    # 2. Check if Model Exists
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail="Model not found. Please run training pipeline.")

    # 3. Load the "Frozen" Model
    with open(model_path, 'r') as fin:
        m = model_from_json(json.load(fin))

    # 4. Create Future DataFrame
    future = m.make_future_dataframe(periods=req.months * 30)
    
    # --- HANDLING REGRESSORS FOR SAVED MODELS ---
    # We need to manually inject the future regressor values
    # In a real app, you might fetch the latest oil price from a DB here
    future['oil_price'] = 90.00 # Placeholder: Use last known value
    
    # The "What-If" Logic still works on a saved model!
    future_dates = future['ds'] > m.history['ds'].max()
    if req.simulate_promo:
        future.loc[future_dates, 'onpromotion'] = 1
    else:
        future.loc[future_dates, 'onpromotion'] = 0
        
    # Fill historical gaps (Prophet requirement)
    # Since we don't have the original DF here, we can set historical regressors to 0 
    # (It doesn't affect future predictions, only the historical plot)
    future['onpromotion'] = future['onpromotion'].fillna(0)

    # 5. Predict
    forecast = m.predict(future)

    return {
        "store": req.store_id,
        "family": req.family,
        "forecast": forecast[['ds', 'yhat']].tail(req.months * 30).to_dict(orient="records")
    }
if __name__ == "__main__":
    import uvicorn
    # This starts the server on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000)