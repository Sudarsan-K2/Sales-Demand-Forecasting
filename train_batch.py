import pandas as pd
from prophet import Prophet
from prophet.serialize import model_to_json
from sqlalchemy import create_engine
import json
import os
import numpy as np

# Database Setup
DB_USER = "postgres"
DB_PASS = "ELEPHANT" # UPDATE THIS
DB_HOST = "localhost"
DB_NAME = "SalesForecast"
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:5432/{DB_NAME}"
engine = create_engine(DATABASE_URL)

os.makedirs("model_registry", exist_ok=True)

import numpy as np # Make sure this is imported at the top

def train_and_save_model(store_id, family):
    print(f"⚙️ Training model for Store {store_id} - {family}...")
    
    # 1. Fetch Data
    query = f"""
    SELECT date as ds, y, onpromotion, oil_price 
    FROM training_data 
    WHERE store_nbr = {store_id} AND family = '{family}'
    ORDER BY date ASC
    """
    df = pd.read_sql(query, engine)
    
    if len(df) < 50:
        print(f"⚠️ Not enough data. Skipping.")
        return
    if df['y'].mean() < 10: # If average daily sales < 10
        print(f"⚠️ Skipping {family}: Volume too low for reliable forecasting.")
        return
    # 2. Clean Data
    df['oil_price'] = df['oil_price'].ffill().bfill()
    df['onpromotion'] = df['onpromotion'].fillna(0).astype(int)

    # 3. Train Model
    m = Prophet()
    m.add_regressor('onpromotion')
    m.add_regressor('oil_price')
    m.fit(df)

    # 4. Calculate Accuracy (MAPE) - ROBUST NUMPY VERSION
    # We take the last 30 days of actual data
    df_cv = df.tail(30).copy()
    
    # Predict on this specific dataframe
    forecast = m.predict(df_cv)
    
    # EXTRACT NUMPY ARRAYS (Removes all Index issues)
    y_true = df_cv['y'].values
    y_pred = forecast['yhat'].values
    
    # FILTER: Remove days where actual sales were 0 using a simple numpy mask
    # This prevents division by zero and alignment errors
    mask = y_true > 0
    y_true_clean = y_true[mask]
    y_pred_clean = y_pred[mask]
    
    # CALCULATE MAPE
    if len(y_true_clean) > 0:
        mape = np.mean(np.abs((y_true_clean - y_pred_clean) / y_true_clean)) * 100
    else:
        mape = 0.0
        
    print(f"✅ Accuracy (MAPE): {mape:.2f}%")

    # 5. Save Model
    with open(f'model_registry/s{store_id}_{family}.json', 'w') as fout:
        json.dump(model_to_json(m), fout)
        
    # 6. Save Metrics
    with open(f'model_registry/s{store_id}_{family}_metrics.json', 'w') as fout:
        json.dump({"mape": mape, "last_trained": str(pd.Timestamp.now())}, fout)

# Run it
if __name__ == "__main__":
    train_and_save_model(1, 'GROCERY I')
    train_and_save_model(1, 'AUTOMOTIVE')
    train_and_save_model(1, 'BEVERAGES')