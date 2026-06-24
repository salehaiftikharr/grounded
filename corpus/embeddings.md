# Embeddings and vector search

An embedding is a list of numbers (a vector) that represents the meaning of a
piece of text. Texts with similar meaning have vectors that point in similar
directions, even when they share no exact words.

To retrieve, the query is embedded with the same model used for the chunks, and
the store compares the query vector against every chunk vector. The standard
comparison is cosine similarity, which measures the angle between two vectors and
returns a score from -1 to 1; higher means more similar.

A vector store holds the chunk vectors and runs this search. For small corpora an
in-memory store is fine; at scale a dedicated vector database such as pgvector,
Pinecone, or Weaviate handles indexing and approximate nearest-neighbor search.
