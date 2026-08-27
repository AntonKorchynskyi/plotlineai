create table dataset (
    id         uuid        primary key,
    created_at timestamptz not null default now(),
    row_count  integer     not null,
    schema     jsonb       not null,
    rows       jsonb       not null,
    expires_at timestamptz not null
);

create index idx_dataset_expires_at on dataset (expires_at);

create table gallery_example (
    id            bigint generated always as identity primary key,
    slug          text  not null unique,
    title         text  not null,
    description   text  not null,
    chart_type    text  not null,
    spec          jsonb not null,
    csv_filename  text  not null,
    rendered_data jsonb not null
);

create table share (
    id            uuid        primary key,
    created_at    timestamptz not null default now(),
    spec          jsonb       not null,
    rendered_data jsonb       not null
);
