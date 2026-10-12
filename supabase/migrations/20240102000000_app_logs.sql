-- App logs table — stores frontend error/warning/info logs
-- sent by the browser via the ingest-logs edge function.

create table if not exists public.app_logs (
  id         bigint generated always as identity primary key,
  level      text not null default 'info',
  message    text not null,
  url        text,
  context    jsonb,
  logged_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Index for querying recent errors
create index app_logs_level_time on public.app_logs (level, logged_at desc);

-- Auto-delete logs older than 30 days to keep the table small
-- (run via pg_cron if available, or manually)
create or replace function public.cleanup_old_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.app_logs
  where logged_at < now() - interval '30 days';
$$;

-- No RLS needed — only the edge function (service_role) writes here.
-- Block direct access from anon/authenticated.
alter table public.app_logs enable row level security;

-- Managers can read logs from the dashboard
drop policy if exists "managers read logs" on public.app_logs;
create policy "managers read logs" on public.app_logs
  for select using (public.is_manager());