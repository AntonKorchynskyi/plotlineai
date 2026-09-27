-- Provider calls spent per UTC day: the AI cost ceiling. It lives here, not in web's memory,
-- so a restart (every cold start on Cloud Run) cannot hand out a fresh allowance.
create table ai_daily_usage (
    day   date    primary key,
    calls integer not null
);
