import pandas as pd
from prophet import Prophet
from sqlalchemy import create_engine

# Database Connection (Same as before)
DB_USER = "postgres"
DB_PASS = "ELEPHANT" 
DB_HOST = "localhost"
DB_NAME = "SalesForecast"
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:5432/{DB_NAME}"
engine = create_engine(DATABASE_URL)

def get_forecast(store_id, product_family, months_to_predict=3):
    """
    Trains a model for a specific Store + Product and returns the forecast.
    """
    print(f"--- Training Model for Store {store_id} ({product_family}) ---")

    # 1. Fetch Data (Using our SQL View)
    query = f"""
    SELECT date as ds, y, onpromotion, oil_price 
    FROM training_data 
    WHERE store_nbr = {store_id} 
    AND family = '{product_family}'
    ORDER BY date ASC
    """
    df = pd.read_sql(query, engine)

    # 2. Data Cleaning (Crucial for Prophet)
    # Fill missing oil prices with the previous day's price (Forward Fill)
    df['oil_price'] = df['oil_price'].ffill().bfill() 
    
    # 3. Setup Prophet
    # We add 'onpromotion' and 'oil_price' as regressors (drivers of sales)
    m = Prophet(daily_seasonality=True)
    m.add_regressor('onpromotion')
    m.add_regressor('oil_price')
    
    # 4. Train
    m.fit(df)

    # 5. Create Future Dates
    future = m.make_future_dataframe(periods=months_to_predict * 30)
    
    # We need to assume future values for our regressors
    # For a simple demo, we assume they stay the same as the last known value
    # In a real DSS, the User would adjust these (The "What-If" Analysis)
    last_promo = df['onpromotion'].iloc[-1]
    last_oil = df['oil_price'].iloc[-1]
    
    future['onpromotion'] = last_promo
    future['oil_price'] = last_oil

    # 6. Predict
    forecast = m.predict(future)
    
    # Return just the relevant columns
    return forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].tail(90)

# --- Test it immediately ---
if __name__ == "__main__":
    # Let's predict 'GROCERY I' sales for Store #1
    prediction = get_forecast(store_id=1, product_family='GROCERY I')
    print(prediction.head())
    print("\n✅ Forecast Generated!")