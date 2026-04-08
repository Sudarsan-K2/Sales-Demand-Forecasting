import os
import chromadb
from sentence_transformers import SentenceTransformer
import PyPDF2

# Configure Paths
KB_DIR = "./knowledge_base"
CHROMA_DB_DIR = "./chroma_db"

def extract_text_from_pdf(pdf_path):
    text = ""
    try:
        with open(pdf_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
    except Exception as e:
        print(f"Error reading PDF {pdf_path}: {e}")
    return text

def chunk_text(text, chunk_size=1000, overlap=100):
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

def ingest_documents():
    print(f"📂 Scanning directoy: {KB_DIR}...")
    if not os.path.exists(KB_DIR):
        print("Directory does not exist. Creating it...")
        os.makedirs(KB_DIR)
        print("Done. Add some .txt or .pdf files and run again.")
        return

    # Initialize Chroma
    chroma_client = chromadb.PersistentClient(path=CHROMA_DB_DIR)
    collection = chroma_client.get_or_create_collection("supply_chain_knowledge")
    embedder = SentenceTransformer("all-MiniLM-L6-v2")

    documents = []
    ids = []
    metadatas = []

    file_count = 0
    for file in os.listdir(KB_DIR):
        file_path = os.path.join(KB_DIR, file)
        
        content = ""
        if file.endswith(".txt"):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception as e:
                print(f"Error reading {file}: {e}")
        elif file.endswith(".pdf"):
            content = extract_text_from_pdf(file_path)
            
        if content.strip():
            file_count += 1
            chunks = chunk_text(content)
            for i, chunk in enumerate(chunks):
                doc_id = f"{file}_chunk_{i}"
                if len(chunk.strip()) > 10:
                    documents.append(chunk)
                    ids.append(doc_id)
                    metadatas.append({"source": file, "chunk": i})

    if not documents:
        print("⚠️ No valid documents found or parsed.")
        return

    print(f"🧬 Encoding {len(documents)} chunks from {file_count} files...")
    embeddings = embedder.encode(documents).tolist()

    print("💾 Saving to ChromaDB...")
    collection.upsert(
        documents=documents,
        embeddings=embeddings,
        ids=ids,
        metadatas=metadatas
    )
    print("✅ Ingestion Complete! The RAG agent can now search these documents.")

if __name__ == "__main__":
    ingest_documents()
