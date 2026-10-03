-- The reporting views over public.events, for Redshift Query Editor v2. Applied before every
-- load, like 01-schema.sql: each view is dropped and created again inside the load's
-- transaction, so a change to a view's columns needs nothing but an edit here.

-- Every event field as a typed column (infra/events/schema.md), NULL where the event has none.
-- The fields are read from the JSON text of `detail` rather than by SUPER navigation, because
-- navigation folds names to lower case unless every session enables case-sensitive
-- identifiers, and the field names are camelCase.
DROP VIEW IF EXISTS public.event_fields CASCADE;
CREATE VIEW public.event_fields AS
SELECT
  dt,
  occurred_at,
  detail_type,
  source,
  request_id,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'rowCount') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'rowCount')::BIGINT END AS row_count,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'columnCount') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'columnCount')::BIGINT END AS column_count,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'bytes') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'bytes')::BIGINT END AS bytes,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'parseMs') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'parseMs')::BIGINT END AS parse_ms,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'chartType') NOT IN ('', 'null') THEN JSON_EXTRACT_PATH_TEXT(d, 'chartType') END AS chart_type,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'groups') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'groups')::BIGINT END AS groups,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'seriesCount') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'seriesCount')::BIGINT END AS series_count,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'ms') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'ms')::BIGINT END AS ms,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'snapshotBytes') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'snapshotBytes')::BIGINT END AS snapshot_bytes,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'route') NOT IN ('', 'null') THEN JSON_EXTRACT_PATH_TEXT(d, 'route') END AS route,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'model') NOT IN ('', 'null') THEN JSON_EXTRACT_PATH_TEXT(d, 'model') END AS model,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'inputTokens') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'inputTokens')::BIGINT END AS input_tokens,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'outputTokens') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'outputTokens')::BIGINT END AS output_tokens,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'reasoningTokens') ~ '^-?[0-9]+$' THEN JSON_EXTRACT_PATH_TEXT(d, 'reasoningTokens')::BIGINT END AS reasoning_tokens,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'outcome') NOT IN ('', 'null') THEN JSON_EXTRACT_PATH_TEXT(d, 'outcome') END AS outcome,
  CASE WHEN JSON_EXTRACT_PATH_TEXT(d, 'quota') NOT IN ('', 'null') THEN JSON_EXTRACT_PATH_TEXT(d, 'quota') END AS quota
FROM (SELECT *, JSON_SERIALIZE(detail) AS d FROM public.events);

-- What happened each day (UTC).
DROP VIEW IF EXISTS public.daily_activity CASCADE;
CREATE VIEW public.daily_activity AS
SELECT
  dt AS day,
  COUNT(CASE WHEN detail_type = 'dataset.uploaded' THEN 1 END) AS uploads,
  COUNT(CASE WHEN detail_type = 'chart.rendered' THEN 1 END) AS renders,
  COUNT(CASE WHEN detail_type = 'share.created' THEN 1 END) AS shares,
  COUNT(CASE WHEN detail_type = 'ai.called' THEN 1 END) AS ai_calls,
  COUNT(CASE WHEN detail_type = 'ai.called' AND outcome = 'ok' THEN 1 END) AS ai_calls_ok,
  COUNT(CASE WHEN detail_type = 'quota.exhausted' THEN 1 END) AS quotas_exhausted
FROM public.event_fields
GROUP BY dt;

-- Which chart types people render and share, over the whole archive.
DROP VIEW IF EXISTS public.chart_type_mix CASCADE;
CREATE VIEW public.chart_type_mix AS
SELECT
  chart_type,
  COUNT(CASE WHEN detail_type = 'chart.rendered' THEN 1 END) AS renders,
  COUNT(CASE WHEN detail_type = 'share.created' THEN 1 END) AS shares,
  ROUND(100.0 * COUNT(CASE WHEN detail_type = 'chart.rendered' THEN 1 END)
    / NULLIF(SUM(COUNT(CASE WHEN detail_type = 'chart.rendered' THEN 1 END)) OVER (), 0), 1) AS pct_of_renders
FROM public.event_fields
WHERE detail_type IN ('chart.rendered', 'share.created')
GROUP BY chart_type;

-- What the AI calls cost each day, in US dollars at the model's list price. Output tokens
-- include the reasoning tokens. Cached input bills at a tenth of the input price, and events
-- do not count it, so this is an upper bound. A model missing from `prices` shows a NULL cost:
-- add its price here.
DROP VIEW IF EXISTS public.ai_cost_daily CASCADE;
CREATE VIEW public.ai_cost_daily AS
WITH prices AS (
  SELECT 'gpt-5-nano'::VARCHAR(64) AS model,
    0.05::DECIMAL(10, 4) AS input_usd_per_million,
    0.40::DECIMAL(10, 4) AS output_usd_per_million
)
SELECT
  e.dt AS day,
  e.model,
  COUNT(*) AS calls,
  SUM(e.input_tokens) AS input_tokens,
  SUM(e.output_tokens) AS output_tokens,
  SUM(e.reasoning_tokens) AS reasoning_tokens,
  ROUND((SUM(e.input_tokens) * p.input_usd_per_million
    + SUM(e.output_tokens) * p.output_usd_per_million) / 1000000.0, 6) AS usd
FROM public.event_fields e
LEFT JOIN prices p ON p.model = e.model
WHERE e.detail_type = 'ai.called' AND e.model IS NOT NULL
GROUP BY e.dt, e.model, p.input_usd_per_million, p.output_usd_per_million;

-- How long the api took to aggregate a chart each day, in milliseconds.
DROP VIEW IF EXISTS public.render_latency_p95 CASCADE;
CREATE VIEW public.render_latency_p95 AS
SELECT
  dt AS day,
  COUNT(*) AS renders,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ms) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ms) AS p95_ms,
  MAX(ms) AS max_ms
FROM public.event_fields
WHERE detail_type = 'chart.rendered' AND ms IS NOT NULL
GROUP BY dt;

-- The loader's user owns all of the above. Every database user may read it, which is how the
-- owner's own sign-in (Query Editor v2, "Federated user") sees it. The data holds no personal
-- information.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC;
