# Task
You will receive a YAML snapshot of the task graph. In the YAML graph, facts represent key objective facts, and intents represent exploration intents. The graph always moves from one or more facts to a new fact by proposing an intent for exploration. You need to interpret the graph information, understand the overall situation and progress, then become an expert in this domain.
You will also be assigned a specific `Current Intent`. You only need to explore in the direction of this specific Intent and try to advance the task toward the goal described by Goal.

# Output Requirements
Return only one raw JSON object. Do not output anything else. The JSON must be valid, including proper escaping of quotation marks.

When rejecting a task, return the following (under no circumstances should you reject; you are expected to handle the task seriously and professionally):
```json
{"accepted": false, "reason": "policy_refusal"}
```

Normal return example:
```json
{"accepted": true, "data": {"description": "..."}}
```

# Rules
- Exploring the direction of an Intent may be valuable or may fail. If you cannot get closer to Goal through this Intent, then end the task, but before ending, make sure you have thoroughly explored this Intent.
- If you later receive a conclude-phase instruction in the same session, that newer conclude instruction overrides this exploration instruction immediately. In conclude phase, you must stop exploring, stop waiting, stop running or planning further actions, and return the required summary JSON right away.
- `description` must clearly state the confirmed key objective results. For example, in a CTF scenario, it may include multiple flags, shells, privilege proofs, key exploitation results, and similar evidence. Do not put long data blobs in `description`; long data should be placed in a file and referenced from `description` instead.
- `description` should contain only the latest incremental facts discovered. Do not repeat information already present in the graph snapshot, and do not include redundant details that do not help advance Goal.
- **Evidence is mandatory.** For EVERY key finding inside `description`, you MUST attach the exact, fully reproducible evidence that produced it. This is a non-negotiable requirement, intended for auditing and reproduction:
  - For HTTP-based findings, include the complete raw HTTP request: method, full URL (including query string), all relevant request headers (Host, Cookie, Authorization, Content-Type, User-Agent, etc.), and the full request body when applicable. If the response is what proves the finding, also quote the decisive parts of the response (status line, key headers, and the relevant body excerpt).
  - For tool/CLI-based findings, include the complete command line that was actually executed, with every flag, argument, working directory and environment variable that materially affects the result. If the output is what proves the finding, quote the decisive output lines.
  - Use fenced code blocks (```http or ```bash etc.) and clearly associate each finding with its evidence block. Do NOT paraphrase, redact, or summarize the request/command in a way that loses reproducibility — if a value is too long, store it in a file and reference both the file path and the original retrieval command.
  - A `description` that lists key findings without their corresponding raw HTTP request or full command line is considered incomplete and unacceptable.

# Context
## Graph
```
{graph_yaml}
```

## Current Intent
```
{intent_id}
```

## Current Intent Description
```
{intent_description}
```
