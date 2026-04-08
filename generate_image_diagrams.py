import base64
import zlib
import urllib.request
import os
from PIL import Image

def generate_diagram(mermaid_code, output_file):
    compressed = zlib.compress(mermaid_code.encode('utf-8'), 9)
    b64 = base64.urlsafe_b64encode(compressed).decode('ascii')
    
    url = f"https://kroki.io/mermaid/png/{b64}"
    print(f"Downloading {output_file}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(output_file, 'wb') as out_file:
            out_file.write(response.read())
        
        # Open the image with Pillow and composite it onto a solid white background
        img = Image.open(output_file)
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            white_bg = Image.new("RGB", img.size, (255, 255, 255))
            img_rgba = img.convert('RGBA')
            white_bg.paste(img_rgba, mask=img_rgba.split()[3])
            white_bg.save(output_file, "PNG")

        print(f"Success: Saved {output_file}")
    except Exception as e:
        print(f"Failed to download or process {output_file}: {e}")

INIT_BLOCK = "%%{init: {'theme': 'default', 'themeVariables': { 'background': '#FFFFFF', 'darkMode': false, 'textColor': '#000000', 'lineColor': '#000000' }}}%%\n"

# 1. Use Case Diagram - Richly populated with multiple actors
use_case = INIT_BLOCK + '''flowchart LR
    %% Primary Human Actors
    Analyst([Business Analyst])
    Manager([Procurement / Inventory Mgr])
    
    %% Secondary / System Actors
    LLM([OpenAI / LLM Model])
    ExtAPI([Market / Weather APIs])

    subgraph App ["Sales & Supply Chain System"]
        direction TB
        subgraph Analytics ["Analytics Domain"]
            UC1(View Dashboard KPIs)
            UC2(Analyze Time-Series Forecasts)
            UC3(Identify Sales Anomalies)
            UC4(Simulate Promo/Pricing Scenarios)
        end
        
        subgraph InventoryOps ["Inventory Operations"]
            UC5(Calculate Economic Order Quantity)
            UC6(Assess Stockout Risk)
            UC7(Draft & Review Purchase Orders)
            UC8(Trigger Model Retraining)
        end
        
        subgraph AgenticTasks ["Agentic Interactions"]
            UC9(Multi-Agent Chat Query)
            UC10(Text-to-SQL DB Query)
            UC11(Semantic Knowledge Search)
        end
    end

    %% Human Connections
    Analyst --> UC1
    Analyst --> UC2
    Analyst --> UC3
    Analyst --> UC4
    Analyst --> UC9

    Manager --> UC1
    Manager --> UC5
    Manager --> UC6
    Manager --> UC7
    Manager --> UC8
    Manager --> UC9
    
    %% System Connections
    UC9 <--> LLM
    UC10 <--> LLM
    UC11 <--> LLM
    
    InventoryOps -.-> ExtAPI
    AgenticTasks -.-> ExtAPI
'''

# 2. UML Class Diagram - Very high precision and deep relationships
uml_class = INIT_BLOCK + '''classDiagram
    namespace DataModels {
        class PredictionRequest {
            +int store_id
            +str family
            +int months
            +bool simulate_promo
            +float custom_oil_price
            +sanitize_family(v: str) class_method
        }
        class InventoryRequest {
            +int store_id
            +str family
            +int lead_time_days
            +int current_stock
            +float service_level
            +float order_cost
            +float holding_cost
            +float unit_price
            +bool is_perishable
            +sanitize_family(v: str) class_method
        }
        class ChatRequest {
            +str message
            +int store_id
            +str family
            +int current_stock
            +List~Dict~ history
            +str session_id
        }
    }

    namespace FastAPI_Controllers {
        class Router {
            +engine : sqlalchemy.Engine
            +chroma_client : chromadb.Client
            -verify_api_key(key: str)
            +predict_sales(req: PredictionRequest) JSON
            +predict_inventory(req: InventoryRequest) JSON
            +analyze_history(req: InventoryRequest) JSON
            +retrain_model(req: PredictionRequest) JSON
        }
    }

    namespace LangGraph_Architecture {
        class ReActAgent {
            +ChatOpenAI LLM
            +StateGraph graph
            +List~Tool~ mapped_tools
            +invoke(state: Dict) str
        }
        class Tools {
            +execute_text_to_sql(query: str) str
            +search_company_knowledge(query: str) List
            +get_live_market_data(query: str) Dict
        }
    }

    namespace Core_Engines {
        class ProphetEngine {
            +str REGISTRY_DIR
            +float DEFAULT_OIL_PRICE
            +load_model(store_id: int, family: str) Tuple
            +train_and_save_model(store_id: int, family: str)
            +predict_inventory_advanced(req: InventoryRequest) Dict
            +get_market_sentiment(model: Prophet) Dict
        }
        class VectorEngine {
            +SentenceTransformer embedder
            +Collection knowledge_collection
            +ingest_documents(dir: str)
        }
    }

    Router --> PredictionRequest : Depends on
    Router --> InventoryRequest : Depends on
    Router --> ProphetEngine : Instantiates & Queries
    Router --> ReActAgent : Routes Natural Language
    ReActAgent "1" *-- "many" Tools : Composes
    Tools --> VectorEngine : Uses for RAG
'''

# 3. Sequence Diagram (Unchanged)
sequence = INIT_BLOCK + '''sequenceDiagram
    actor User
    participant UI as React Frontend
    participant API as FastAPI Backend
    participant Agent as LangGraph ReAct Agent
    participant SQLDB as PostgreSQL (Sales)
    participant VecDB as ChromaDB (Docs)
    
    User->>UI: Send message ("What are recent sales?")
    UI->>API: POST /chat Payload
    API->>Agent: invoke(message)
    
    Agent-->>Agent: Reasoning: I need SQL data
    Agent->>SQLDB: Tool: execute_text_to_sql()
    SQLDB-->>Agent: Returns SQL Results (JSON)
    
    Agent-->>Agent: Reasoning: Checking policies
    Agent->>VecDB: Tool: search_company_knowledge()
    VecDB-->>Agent: Returns relevant text chunks
    
    Agent-->>Agent: Reasoning: Synthesizing Answer
    Agent->>API: Final Chat Response
    API->>UI: Returns AI Response + Widget Actions
    UI->>User: Renders Chat Bubble
'''

# 4. Data Flow Diagram (Unchanged)
data_flow = INIT_BLOCK + '''flowchart TD
    User((End User))
    Meteo((External API: Weather / Oil))
    
    subgraph Application ["Core Processes"]
        API[FastAPI Gateway]
        Agent[LangChain / ReAct System]
        Engine[Prophet Engine / Forecasting]
        Ingest[PDF/Text Ingestion Script]
    end
    
    subgraph Data Stores
        DB1[(PostgreSQL: historical_sales)]
        DB2[(ChromaDB: knowledge_base)]
        DB3[(Model Registry: .json Weights)]
    end
    
    User <-->|HTTP Requests / JSON| API
    API <-->|Tasks & Results| Agent
    API <-->|Forecast Settings| Engine
    
    Agent <-->|Read Data| DB1
    Agent <-->|Vector Search| DB2
    Agent <-->|Live Data Pull| Meteo
    
    Engine <-->|Read Historical Data| DB1
    Engine -->|Write Model JSON| DB3
    Engine <-->|Load Weights| DB3
    
    Ingest -->|Parse Docs / Embeddings| DB2
'''

print("Generating ultra-detailed diagrams...")
generate_diagram(use_case, 'diagram_1_use_case.png')
generate_diagram(uml_class, 'diagram_2_uml_class.png')
generate_diagram(sequence, 'diagram_3_sequence.png')
generate_diagram(data_flow, 'diagram_4_data_flow.png')
print("Complete.")
