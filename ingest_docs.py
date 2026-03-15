import os
import chromadb
from sentence_transformers import SentenceTransformer
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

# 1. Initialize ChromaDB (Local SQLite file-based DB)
CHROMA_DB_DIR = "./chroma_db"
os.makedirs(CHROMA_DB_DIR, exist_ok=True)

print("🚀 Starting Knowledge Base Ingestion...")

# Setup Chroma Client
client = chromadb.PersistentClient(path=CHROMA_DB_DIR)

# Get or create collection
collection_name = "supply_chain_knowledge"

# Delete if exists so we can run this script multiple times cleanly
try:
    client.delete_collection(name=collection_name)
except Exception:
    pass

collection = client.create_collection(
    name=collection_name,
    metadata={"hnsw:space": "cosine"} # Use cosine similarity for text search
)

# 2. Local Embedding Model (Runs on CPU, no API key needed)
# Using a fast, lightweight sentence transformer model 
print("⏳ Loading local embedding model (all-MiniLM-L6-v2)...")
encoder = SentenceTransformer("all-MiniLM-L6-v2")

# 3. Load Documents from local /knowledge_base folder
print("📂 Reading documents from ./knowledge_base...")
loader = DirectoryLoader('./knowledge_base', glob="**/*.txt", loader_cls=TextLoader)
documents = loader.load()

print(f"📄 Found {len(documents)} logic files.")

# 4. Split Text into Chunks
# This ensures that long PDFs don't overwhelm the LLM context window
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    length_function=len,
    is_separator_regex=False,
)
chunks = text_splitter.split_documents(documents)
print(f"✂️ Split into {len(chunks)} chunks.")

# 5. Embed and Store
print("🧠 Generating embeddings and saving to ChromaDB...")
for i, chunk in enumerate(chunks):
    # Get vector representation
    embedding = encoder.encode(chunk.page_content).tolist()
    
    # Store in ChromaDB
    collection.add(
        documents=[chunk.page_content],
        embeddings=[embedding],
        metadatas=[chunk.metadata],
        ids=[f"chunk_{i}"]
    )

print(f"✅ Success! Ingested {len(chunks)} chunks into ChromaDB at {CHROMA_DB_DIR}")
