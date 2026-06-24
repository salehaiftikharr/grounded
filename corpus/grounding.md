# Grounding and the grounding gate

Grounding means an answer is supported by the retrieved context rather than by
the model's parametric memory or a guess. A grounded answer cites the specific
chunks it used, so a reader can check it.

The grounding gate is a guardrail that runs before generation. It inspects the
retrieved hits — how many there are and how strong the top similarity score is —
and decides whether the context is good enough to answer at all. If retrieval is
weak, the gate refuses: the system says it does not have enough information
instead of producing a confident but unsupported answer.

This is the most important reliability property of a retrieval system. A wrong
answer delivered confidently is worse than an honest "I don't know," especially
in high-stakes domains. The gate is what turns a demo into something trustworthy.
