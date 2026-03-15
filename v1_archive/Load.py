import pandas as pd
from sqlalchemy import create_engine
import time

# ==========================================
# CONFIGURATION
# ==========================================
# Replace with your actual Postgres credentials
DB_USER = "postgres"
DB_PASS = "ELEPHANT"  # Your password
DB_HOST = "localhost"
DB_PORT = "5432"
DB_NAME = "SalesForecast" # Your DB Name

# Create the connection string
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
engine = create_engine(DATABASE_URL)

def load_csv_to_postgres(csv_file, table_name, chunksize=100000):
    """
    Reads a CSV and writes it to a Postgres table.
    Handles large files by processing in chunks.
    """
    print(f"--- Starting load for {csv_file} into '{table_name}' ---")
    start_time = time.time()
    
    try:
        # Create an iterator for reading the file in chunks
        # parse_dates=['date'] ensures 'date' column is read as YYYY-MM-DD
        csv_iterator = pd.read_csv(csv_file, parse_dates=['date'], chunksize=chunksize)
        
        chunk_count = 0
        total_rows = 0
        
        for chunk in csv_iterator:
            # Append data to the table
            chunk.to_sql(table_name, engine, if_exists='append', index=False)
            
            chunk_count += 1
            total_rows += len(chunk)
            print(f"Processed chunk {chunk_count} ({total_rows} rows so far...)")
            
        end_time = time.time()
        print(f"✅ Success! Loaded {total_rows} rows into '{table_name}' in {end_time - start_time:.2f} seconds.\n")
        
    except Exception as e:
        print(f"❌ Error loading {csv_file}: {e}")

# ==========================================
# EXECUTION
# ==========================================

if __name__ == "__main__":
    # 1. Load Stores (Small file, no chunking needed really, but function handles it)
    # Note: 'stores.csv' doesn't have a 'date' column, so we handle it separately
    print("--- Loading Stores ---")
    df_stores = pd.read_csv('stores.csv')
    df_stores.to_sql('stores', engine, if_exists='append', index=False)
    print("✅ Stores loaded.\n")

    # 2. Load Oil (Has date)
    load_csv_to_postgres('oil.csv', 'oil')

    # 3. Load Holidays (Has date)
    load_csv_to_postgres('holidays_events.csv', 'holidays')

    # 4. Load Train (The Big One - Has date)
    # This might take a minute or two depending on your PC speed
    load_csv_to_postgres('train.csv', 'sales_history')
    
    print("🎉 All data loaded successfully!")