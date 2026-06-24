# Evaluation

A retrieval system is only trustworthy if you can measure whether it behaves. The
evaluation harness runs a labeled set of questions and grades the behavior, not
just the wording of the final answer.

In-corpus questions name the source file that should be retrieved, so the harness
can measure retrieval hit-rate: for each question, did the expected source appear
in the top results? Out-of-corpus questions have no valid source, so the correct
behavior is refusal. Answering an out-of-corpus question at all is the failure
that matters most, the same stance as a verification gate that would rather ship
nothing than ship something wrong.

The harness reports three things. Retrieval hit-rate measures whether the right
chunks are found. Refusal discipline measures whether the system stays quiet on
questions it cannot ground. Faithfulness measures whether the answers it does give
stay supported by their sources. Together these turn vague claims about quality
into numbers that move when the system gets better or worse.

Measuring discipline matters as much as measuring accuracy. A system that answers
everything confidently can look impressive while being unreliable, and only an
evaluation that rewards knowing when to refuse will catch the difference.
