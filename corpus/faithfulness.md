# Faithfulness checking

Retrieval being strong does not guarantee the answer is honest. A language model
can still drift past its context, stating something plausible that the retrieved
sources never actually say. This is the second way a retrieval system can mislead:
not by failing to find evidence, but by outrunning the evidence it found.

The faithfulness check is an output-side guard that runs after generation. It
breaks the generated answer into individual factual claims and checks each claim
against the retrieved context. A claim counts as supported only when the context
states or clearly implies it. Outside knowledge does not count, even when it
happens to be true, because the point is to measure whether the answer stayed
within its sources.

Each claim is returned with a verdict and a short quote of the supporting
evidence, or no evidence when it is unsupported. The overall faithfulness score is
the fraction of claims the context supports. An answer where every claim is
supported is marked verified; an answer with unsupported claims is flagged so a
reader knows which sentences to distrust.

This pairs with the grounding gate. The grounding gate refuses when it cannot find
enough evidence to answer. The faithfulness check flags when the answer says more
than the evidence supports. The input gate and the output gate together cover both
ways a retrieval-augmented system can produce a wrong answer.
