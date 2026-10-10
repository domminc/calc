-- homesell 계산기 초기 스키마 (Neon Postgres)
-- 계산은 DB 없이 동작한다. 이 표들은 공유 링크·통계·피드백·요율 이력·속도 제한용이다.

create table if not exists rate_sets (
  id bigserial primary key,
  year int not null,
  version text not null,
  effective_from date not null,
  sha256 text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (year, version)
);

create table if not exists shared_results (
  id text primary key check (id ~ '^[0-9A-Za-z]{8}$'),
  calculator text not null check (calculator in ('salary', 'payroll', 'insurance', 'freelancer')),
  rate_year int not null,
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object' and pg_column_size(inputs) <= 8192),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists shared_results_expires_idx on shared_results (expires_at);

create table if not exists usage_daily (
  day date not null,
  calculator text not null check (calculator in ('salary', 'payroll', 'insurance', 'freelancer', 'table')),
  view_count int not null default 0,
  share_count int not null default 0,
  export_count int not null default 0,
  primary key (day, calculator)
);

create table if not exists feedback (
  id bigserial primary key,
  calculator text not null check (calculator in ('salary', 'payroll', 'insurance', 'freelancer', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  contact text check (contact is null or char_length(contact) <= 200),
  page_url text check (page_url is null or char_length(page_url) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
create index if not exists feedback_expires_idx on feedback (expires_at);

create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits (window_start);
