import pandas as pd
from prophet import Prophet
from prophet.serialize import model_to_json
from sqlalchemy import create_engine
import json
import os

# Database Setup
DB_USER = "postgres"
DB_PASS = "ELEPHANT"  # Updated password
DB_HOST = "localhost"
DB_NAME = "SalesForecast"  # Updated database name
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:5432/{DB_NAME}"
engine = create_engine(DATABASE_URL)

# Create a folder to store models
os.makedirs("model_registry", exist_ok=True)

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
        print(f"⚠️ Not enough data for Store {store_id} - {family}. Skipping.")
        return

    # 2. Clean Data
    df['oil_price'] = df['oil_price'].ffill().bfill()
    df['onpromotion'] = df['onpromotion'].astype(int)

    # 3. Train Model
    m = Prophet()
    m.add_regressor('onpromotion')
    m.add_regressor('oil_price')
    m.fit(df)

    # 4. Calculate Accuracy (Professional Requirement!)
    # We compare the last 30 days of predictions vs reality
    df_cv = df.tail(30).copy()
    forecast = m.predict(df_cv)
    # Mean Absolute Percentage Error (MAPE)
    mape = (abs(df_cv['y'] - forecast['yhat']) / df_cv['y']).mean() * 100
    print(f"✅ Model Trained. Accuracy (MAPE): {mape:.2f}% error")

    # 5. Serialize & Save (The "Stored Engine" part)
    with open(f'model_registry/s{store_id}_{family}.json', 'w') as fout:
        json.dump(model_to_json(m), fout)
        
    print(f"💾 Model saved to model_registry/s{store_id}_{family}.json\n")

# Run the batch job
if __name__ == "__main__":
    # In a real startup, you'd loop through ALL stores/families here
    # For your demo, let's train just a few key ones
    train_and_save_model(1, 'GROCERY I')
    train_and_save_model(1, 'AUTOMOTIVE')