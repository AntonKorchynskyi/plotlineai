-- The usage event archive in Redshift. The redshift-loader applies these files in order before
-- every load, so each statement must be safe to run again. A statement ends with a semicolon
-- at the end of a line.

CREATE SCHEMA IF NOT EXISTS analytics;

-- One row per event, loaded a day at a time from s3://<analytics bucket>/events/dt=<day>/.
-- The columns are the archive row keys (infra/events/schema.md); `detail` keeps the event's
-- own fields as they were published.
CREATE TABLE IF NOT EXISTS analytics.events (
  dt DATE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  detail_type VARCHAR(64) NOT NULL,
  source VARCHAR(64) NOT NULL,
  request_id VARCHAR(128),
  detail SUPER
)
DISTSTYLE AUTO
SORTKEY (dt);
