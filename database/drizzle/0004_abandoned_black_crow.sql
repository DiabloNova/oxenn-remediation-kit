CREATE INDEX "idx_document_embeddings_embedding" ON "document_embeddings" USING hnsw ("embedding" vector_cosine_ops);
