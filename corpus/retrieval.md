# Retrieval and reranking

Retrieval is the step that finds the chunks most likely to answer a query. The
first pass is vector search: embed the query and take the top-k chunks by cosine
similarity. Top-k is fast but blunt — it ranks purely on embedding closeness.

Reranking is a second pass that reorders those candidates with a sharper signal.
A cheap reranker blends the vector score with lexical overlap, boosting chunks
that also share the query's key terms. A stronger reranker is a cross-encoder or
an LLM that scores each candidate's relevance to the query directly. Reranking
usually retrieves a wider set first (say top 20) and then keeps the best few.

Good retrieval is the ceiling on answer quality: the generator can only be as
correct as the context it is handed, so retrieval and grounding matter more than
prompt wording.
