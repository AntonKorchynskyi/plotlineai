# PlotlineAI usage events

The api and web publish one event to the EventBridge bus `plotlineai` for each thing worth
counting. Every event is archived to the `analytics` bucket (`lib/pipeline-stack.ts`,
`lambda/event-archiver`), and `quota.exhausted` is also emailed to the owner.

Publishers: `backend/.../events/EventPublisher.java` (source `plotlineai.api`) and
`frontend/lib/events.ts` (source `plotlineai.web`). Both have tests against this contract.

## Rules

- **No personal data, ever:** no IP address, file name, column name, cell value, prompt or
  model output. Counts, sizes, timings, chart types and outcomes only.
- **Publishing never fails a request.** It waits at most 1 second (a Lambda freezes once it
  has answered, so a background send is unreliable), and any failure is logged as
  `event_publish_failed` and swallowed.
- Without a bus configured (compose, tests, `next dev`) nothing is sent.
- A change that is not backward compatible bumps `version`.

## Envelope

Every `detail` starts with:

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | The contract version, `1`. |
| `occurredAt` | string | ISO-8601 UTC time the publisher sent the event. The archive files events by its date. |
| `requestId` | string | The Lambda invocation id, which ties the event to its log lines. A random id outside Lambda. |

## Events

| `detail-type` | Source | Fields after the envelope |
|---|---|---|
| `dataset.uploaded` | api | `rowCount`, `columnCount`, `bytes`, `parseMs` |
| `chart.rendered` | api | `chartType`, `groups` (labels on the x axis), `seriesCount`, `ms` |
| `share.created` | api | `chartType`, `snapshotBytes` (gzipped) |
| `ai.called` | web | `route` (`suggest` or `chart-spec`), `model`, `inputTokens`, `outputTokens`, `reasoningTokens`, `ms`, `outcome` |
| `quota.exhausted` | api | `quota` (`ai` or `upload`), `limit`, `day` (`YYYY-MM-DD`, UTC) |

Notes:
- `chart.rendered` counts `POST /charts/render` only. Creating a share renders too, but counts
  as `share.created`.
- `ai.called` is sent once per AI attempt. `outcome` is `ok`, `bad_output` (the model
  answered with something unusable), `unavailable` (no key, the provider or the budget
  service failed) or `budget_refused` (the daily AI limit was spent). `model` and the token
  counts are `null` when there was no answer to count.
- `quota.exhausted` is sent once per quota and UTC day across all api instances: the first
  refusal claims a one-per-day slot in DynamoDB.

## Archive format

`s3://<analytics bucket>/events/dt=YYYY-MM-DD/<uuid>.json.gz`: gzipped JSON Lines, one row
per event, with keys matching the Phase 13 Redshift table:

```json
{"dt":"2026-10-02","occurred_at":"2026-10-02T23:59:58.123Z","detail_type":"chart.rendered","source":"plotlineai.api","request_id":"...","detail":{"version":1,"occurredAt":"...","requestId":"...","chartType":"bar","groups":2,"seriesCount":1,"ms":4}}
```
