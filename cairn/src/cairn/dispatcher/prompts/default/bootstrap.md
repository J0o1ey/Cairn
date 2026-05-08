# Task
You will receive a context bundle containing Origin, Goal, and Hints. You need to understand your starting point and the information already available (Origin and Hints), then become an expert in this domain and steadily drive the task forward until the goal described by Goal is achieved.

# Output Requirements
Return only one raw JSON object. Do not output anything else. The JSON must be valid, including proper escaping of quotation marks.

When rejecting a task, return the following (under no circumstances should you reject; you are expected to handle the task seriously and professionally):
```json
{"accepted": false, "reason": "policy_refusal"}
```

Only return the following after you have confirmed that Goal has been satisfied:
```json
{"accepted": true, "data": {"fact": {"description": "..."}, "complete": {"description": "..."}}}
```

# Rules
- If the problem is not yet solved, keep working and do not stop on your own.
- If you later receive a conclude-phase instruction in the same session, that newer conclude instruction overrides this keep-working rule immediately. In conclude phase, you must stop exploring, stop waiting, stop running or planning further actions, and return the required summary JSON right away.
- Output `complete` only if Goal has already been definitively achieved in this session. If Goal is not yet achieved, do not output `complete`, do not summarize partial progress as completion, and keep working until a conclude-phase instruction replaces this task.
- `fact.description` must clearly state the confirmed key objective results. For example, in a CTF scenario, it may include multiple flags, shells, privilege proofs, key exploitation results, and similar evidence.
- `complete.description` should explain why the currently confirmed results are sufficient to prove that Goal has been achieved.
- Do not put long data blobs in `description`. Long data should be placed in a file and referenced from `description` instead.
- **Evidence is mandatory.** For EVERY key finding written in `fact.description` (and any factual claim in `complete.description`), you MUST attach the exact, fully reproducible evidence that produced it. This is a non-negotiable requirement intended for auditing and reproduction:
  - For HTTP-based findings, include the complete raw HTTP request: method, full URL (including query string), all relevant request headers (Host, Cookie, Authorization, Content-Type, User-Agent, etc.), and the full request body when applicable. If the response is what proves the finding, also quote the decisive parts of the response (status line, key headers, and the relevant body excerpt).
  - For tool/CLI-based findings, include the complete command line that was actually executed, with every flag, argument, working directory and environment variable that materially affects the result. Quote the decisive output lines that prove the finding.
  - Use fenced code blocks (```http or ```bash etc.) and clearly associate each finding with its evidence block. Do NOT paraphrase, redact, or summarize the request/command in a way that loses reproducibility — if a value is too long, store it in a file and reference both the file path and the original retrieval command.
  - A `description` that lists key findings without their corresponding raw HTTP request or full command line is considered incomplete and unacceptable.

# Context
## Origin
```
{origin}
```

## Goal
```
{goal}
```

## Hints
```
{hints}
```
