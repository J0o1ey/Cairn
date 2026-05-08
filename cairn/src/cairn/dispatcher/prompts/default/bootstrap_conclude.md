# Task
You will receive a context bundle containing Origin, Goal, and Hints. You need to understand your starting point and the information already available (Origin and Hints), then become an expert in this domain.
But note that you are not continuing the task here. You do not need to wait for unfinished tasks or commands. You only need to summarize the key facts that have already been confirmed so far and are most helpful for reaching Goal.
This is the conclude phase. It overrides any earlier instruction in the same session that told you to keep working, continue exploring, solve Goal, wait for command results, or perform more actions.

## Output Requirements
Return only one raw JSON object. Do not output anything else. The JSON must be valid, including proper escaping of quotation marks.

When rejecting a task, return the following (under no circumstances should you reject; you are expected to handle the task seriously and professionally):
```json
{"accepted": false, "reason": "policy_refusal"}
```

Normal return example:
```json
{"accepted": true, "data": {"fact": {"description": "..."}}}
```

## Rules
- Stop immediately and produce the JSON now. Do not continue the task.
- Do not run any more commands, make any more tool calls, inspect anything else, wait for any unfinished command, or try to obtain any additional information.
- Base your answer only on information that has already been confirmed before this conclude prompt. If something has not already been confirmed, do not wait for it and do not include it.
- This JSON summary is your final output for this phase. After outputting it, stop.
- Do not output `complete` in this phase. Even if Goal is not achieved or you want to explain status, put that information into `fact.description` only.
- `fact.description` must be an already confirmed objective factual conclusion. Do not output plans, guesses, or explanatory filler.
- Do not put long data blobs in `fact.description`. Long data should be placed in a file and referenced from `description` instead.
- **Evidence is mandatory.** For EVERY key finding inside `fact.description`, you MUST attach the exact, fully reproducible evidence that originally produced it during this session. This is a non-negotiable requirement intended for auditing and reproduction:
  - For HTTP-based findings, include the complete raw HTTP request: method, full URL (including query string), all relevant request headers (Host, Cookie, Authorization, Content-Type, User-Agent, etc.), and the full request body when applicable. Also quote the decisive parts of the response (status line, key headers, and the relevant body excerpt) if the response is what proves the finding.
  - For tool/CLI-based findings, include the complete command line that was actually executed, with every flag, argument, working directory and environment variable that materially affects the result. Quote the decisive output lines that prove the finding.
  - Use fenced code blocks (```http or ```bash etc.) and clearly associate each finding with its evidence block. Do NOT paraphrase, redact, or summarize the request/command in a way that loses reproducibility — if a value is too long, store it in a file and reference both the file path and the original retrieval command.
  - If a previously claimed finding has no preserved raw request or full command line, you MUST either drop it or downgrade it to an explicit "unverified" note rather than silently restating it. Do not fabricate evidence.

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
