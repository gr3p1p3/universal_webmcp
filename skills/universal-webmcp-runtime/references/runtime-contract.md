# Runtime contract

Read this reference only when selecting a complex input, interpreting a result,
synchronizing dynamic UI, or proving collection completeness.

## Descriptor fields

| Field | Meaning |
|---|---|
| `name` | Exact stable name passed to `invokeTool()` |
| `description`, `title`, `targetUI.label` | Semantic selection cues |
| `kind` | `query`, `form`, `action`, or `navigation` |
| `inputSchema`, `outputSchema` | JSON Schema contracts |
| `risk.level` | `low`, `medium`, `high`, or `critical` |
| `provenance.source` | `explicit`, `manual`, `adapter`, `metadata`, `discovery`, or another declared source |
| `status`, `lifecycle` | Optional availability state |
| `annotations.readOnlyHint` | Optional WebMCP read-only hint |
| `metadata` | Runtime-specific details such as a companion `recordQuery` |

`listTools()` returns descriptors without handlers. Invoke only through
`invokeTool(name, input)`.

## Common discovered inputs

| Operation | Input |
|---|---|
| Fill or select | `{ "value": "..." }` |
| Toggle | `{ "checked": true }` |
| Submit form | `{ "fields": { "fieldName": "..." } }` |
| Click | `{}` |
| Repeated-item action | `{ "index": 0 }` |
| Repeated-list query | `{}` or optional `loadAll`, `maxIterations`, `settleMs` |

Use the selected descriptor's schema as the authority; these are examples, not
universal signatures.

## Interpret failures exactly

Runtime policy and lookup failures use `result.code` with
`result.status === "blocked"`:

| `result.code` | Response |
|---|---|
| `tool-denied` | Choose a safer read-only tool or stop |
| `confirmation-unavailable` | Stop the mutation and report that confirmation is unavailable |
| `confirmation-rejected` | Stop; do not retry the mutation |
| `tool-not-found` | Refresh once, rematch by semantics, and invoke only the new exact name |
| `tool-failed` | Report failure and inspect only relevant state |

DOM-action failures use `result.error` with `result.status === "error"`:

| `result.error` | Response |
|---|---|
| `target-not-found` | Wait for the transition or refresh once |
| `target-disabled`, `target-not-fillable`, `target-not-select`, `target-not-toggle`, `target-not-clickable` | Do not force the operation |
| `option-not-found`, `option-disabled`, `record-not-found`, `record-action-not-found` | Re-read the selected schema or companion query before deciding whether to retry |
| `action-failed` | Report failure and inspect only relevant state |

Never infer success from the absence of an exception. Check `status`, then
`code` or `error`, before using the result.

Native browser-host tools may declare different descriptor and result shapes.
Use the host's documented list/invoke operations and each native tool's schemas;
do not impose the local runtime tables above on that path.

## Synchronization

- `refresh()` synchronously reconciles discovery and returns a new catalog.
- `waitForTool(name, { timeoutMs })` returns a descriptor or `undefined`.
- `waitForIdle({ settleMs, timeoutMs })` returns
  `{ status: "idle" | "timeout", revision, elapsedMs }`.

Treat an idle timeout as uncertainty, not success. Form and action invocations
wait for UI synchronization by default, but their result remains the primary
operation outcome.

## Collection completeness

Discovered repeated-list queries return a shape like:

```json
{
  "status": "ok",
  "items": [],
  "completeness": {
    "expectedCount": null,
    "collectedCount": 0,
    "complete": true,
    "source": "scroll-exhausted",
    "iterations": 0
  }
}
```

Claim an exhaustive result only when `complete` is true, any non-null
`expectedCount` equals `collectedCount`, and `items.length` equals
`collectedCount`. If a site-owned query declares another pagination or
completeness contract, follow its schema instead. If it declares none, state
that exhaustiveness is unproven.
