# Chunking

Chunking is the step that splits source documents into smaller pieces before
they are embedded and stored. Retrieval works on chunks, not whole documents, so
the way text is chunked has a large effect on answer quality.

Chunks should be small enough to be specific but large enough to stay coherent.
A common range is 500 to 1,000 characters. Splitting on natural boundaries —
paragraphs and sentences — keeps a chunk readable instead of cutting mid-thought.

Overlap means carrying a small tail of one chunk into the next (for example, 100
to 200 characters). Overlap preserves context across the seam so a fact that
straddles a boundary is still retrievable from at least one chunk.
