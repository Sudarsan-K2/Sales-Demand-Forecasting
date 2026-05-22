import pandas as pd
from prophet import Prophet
from prophet.serialize import model_to_json
from sqlalchemy import create_engine
import json
import os
import numpy as np
from dotenv import load_dotenv
load_dotenv(override=True)

# --- DATABASE SETUP ---
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASS = os.environ.get("DB_PASS", "")
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "SalesForecast")
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)
engine = create_engine(DATABASE_URL)

os.makedirs("model_registry", exist_ok=True)

def train_and_save_model(store_id, family):
    print(f"⚙️  Training model for Store {store_id} - {family}...")
    
    # 1. Fetch Data
    query = f"""
    SELECT date as ds, y, onpromotion, oil_price 
    FROM training_data 
    WHERE store_nbr = {store_id} AND family = '{family}'
    ORDER BY date ASC
    """
    df = pd.read_sql(query, engine)
    
    # 2. Validation Checks
    if len(df) < 50:
        print(f"⚠️  Skipping {family}: Not enough data (< 50 rows).")
        return
    if df['y'].mean() < 1: 
        print(f"⚠️  Skipping {family}: Volume too low (Average < 1 unit/day).")
        return

    # 3. Clean Data & Fill Gaps
    # Ensure dates are datetime objects
    df['ds'] = pd.to_datetime(df['ds'])
    
    # Fill Regressors
    df['oil_price'] = df['oil_price'].ffill().bfill()
    df['onpromotion'] = df['onpromotion'].fillna(0).astype(int)

    # 4. Initialize & Train Model
    # CRITICAL CHANGE: interval_width=0.95 matches our Inventory Service Level target
    m = Prophet(
        interval_width=0.95, 
        daily_seasonality=False,
        yearly_seasonality=True,
        weekly_seasonality=True
    )
    
    # Add Regressors
    m.add_regressor('onpromotion')
    m.add_regressor('oil_price')
    
    # Add Holidays (Optional: Change 'US' to your target country, e.g., 'EC' for Ecuador)
    m.add_country_holidays(country_name='US') 

    m.fit(df)

    # 5. Evaluate Accuracy (Backtesting on last 30 days)
    train_df = df.iloc[:-30] # Train on all except last 30
    test_df = df.iloc[-30:]  # Test on last 30
    
    # We re-fit a temporary model just for honest metrics (optional, but rigorous)
    # For speed in this script, we will just predict on the training set fit (in-sample) 
    # or strictly predict the last 30 days using the main model.
    # Let's do the standard approach: Predict on the test set.
    
    future_test = test_df[['ds', 'onpromotion', 'oil_price']].copy()
    forecast_test = m.predict(future_test)
    
    y_true = test_df['y'].values
    y_pred = forecast_test['yhat'].values
    
    # Clean zeros for MAPE
    mask = y_true > 0
    y_true_clean = y_true[mask]
    y_pred_clean = y_pred[mask]
    
    # Metrics Calculation
    metrics = {}
    
    # A. wMAPE (Volume-Weighted MAPE)
    total_actuals = np.sum(np.abs(y_true))
    if total_actuals > 0:
        mape = (np.sum(np.abs(y_true - y_pred)) / total_actuals) * 100
        metrics['mape'] = round(float(mape), 2)
    else:
        metrics['mape'] = 0.0
        
    # B. RMSE (Root Mean Squared Error) - Valuable for "Units of Error"
    mse = np.mean((y_true - y_pred) ** 2)
    rmse = np.sqrt(mse)
    metrics['rmse'] = round(rmse, 2)
    
    # C. Model Reliability Score (Simple heuristic)
    # If MAPE < 20% -> High Confidence
    if metrics['mape'] < 20: confidence = "High"
    elif metrics['mape'] < 40: confidence = "Medium"
    else: confidence = "Low"
    metrics['confidence'] = confidence

    print(f"✅  Finished {family}. MAPE: {metrics['mape']}%, RMSE: {metrics['rmse']}")

    # 6. Save Model
    with open(f'model_registry/s{store_id}_{family}.json', 'w') as fout:
        json.dump(model_to_json(m), fout)
        
    # 7. Save Metrics
    metrics['last_trained'] = str(pd.Timestamp.now())
    with open(f'model_registry/s{store_id}_{family}_metrics.json', 'w') as fout:
        json.dump(metrics, fout)

# --- EXECUTION LOOP ---
if __name__ == "__main__":
    # In production, you would loop through all store/family combinations
    # distinct_combinations = pd.read_sql("SELECT DISTINCT store_nbr, family FROM training_data", engine)
    
    print("🚀 Starting Batch Training...")
    
    # Example Batch
    targets = [
        (1, 'GROCERY I'),
        (1, 'AUTOMOTIVE'),
        (1, 'BEVERAGES'),
        (1, 'PRODUCE')
    ]
    
    for store, fam in targets:
        try:
            train_and_save_model(store, fam)
        except Exception as e:
            print(f"❌ Error training {store}-{fam}: {e}")
            
    print("🏁 Batch Training Complete.")