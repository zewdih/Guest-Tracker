-- =====================================================================
--  AFRO HOUSE GUEST TRACKER  -  DATABASE + PRIVACY RULES
--  Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--  Plain-English notes are in the README. Comments below explain each part.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Who's who. One row per logged-in account (linked to Supabase Auth).
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role         text not null default 'member'
               check (role in ('member', 'manager')),
  created_at   timestamptz not null default now()
);

-- The private guest registry. Manager-only. One row per real person,
-- recognised by phone number (the "loyalty card" trick).
create table if not exists public.guests (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  phone      text not null unique,   -- digits only; the unique key for repeat detection
  created_at timestamptz not null default now()
);

-- Each individual stay. Linked to a guest and to the host who signed them in.
create table if not exists public.visits (
  id                 uuid primary key default gen_random_uuid(),
  guest_id           uuid not null references public.guests(id) on delete cascade,
  host_id            uuid not null references public.profiles(id) on delete cascade,
  arrival_date       date not null,
  expected_departure date not null,
  nights             int  not null,   -- stored for convenience; set on insert
  created_at         timestamptz not null default now(),
  closed_at          timestamptz          -- set when a manager closes a visit
);

create index if not exists visits_guest_idx on public.visits(guest_id);
create index if not exists visits_host_idx  on public.visits(host_id);
create index if not exists visits_dates_idx on public.visits(arrival_date, expected_departure);


-- ---------------------------------------------------------------------
-- 2. HELPER: is the current user a manager?
--    SECURITY DEFINER lets this peek at profiles without tripping RLS,
--    so we can reuse it inside policies safely.
-- ---------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;


-- ---------------------------------------------------------------------
-- 3. TURN ON THE BOUNCER (Row Level Security)
--    With RLS on and no policy, NOBODY can read a table. We then add
--    narrow policies that open just the doors we want.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.guests   enable row level security;
alter table public.visits   enable row level security;


-- ---------------------------------------------------------------------
-- 4. POLICIES
-- ---------------------------------------------------------------------

-- profiles: you can always read your OWN row (so the app knows your role).
-- Managers can read everyone (needed for the host roster + dashboard).
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "managers read all profiles" on public.profiles;
create policy "managers read all profiles" on public.profiles
  for select using (public.is_manager());

-- A new account may create its own profile row once (default role = member).
drop policy if exists "create own profile" on public.profiles;
create policy "create own profile" on public.profiles
  for insert with check (id = auth.uid());

-- You may rename yourself, but you cannot promote yourself to manager.
drop policy if exists "update own profile (not role)" on public.profiles;
create policy "update own profile (not role)" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = 'member');

-- guests + visits: raw tables are MANAGER-ONLY for every operation.
-- This is the hard privacy line: a plain member's session can never
-- SELECT a guest name or phone from these tables.
drop policy if exists "managers only - guests" on public.guests;
create policy "managers only - guests" on public.guests
  for all using (public.is_manager()) with check (public.is_manager());

drop policy if exists "managers only - visits" on public.visits;
create policy "managers only - visits" on public.visits
  for all using (public.is_manager()) with check (public.is_manager());


-- ---------------------------------------------------------------------
-- 5. THE LOBBY BOARD  (member_feed view)
--    Safe columns ONLY: host name + rough dates + active flag.
--    No guest name, no phone, no guest_id ever appears here.
--    A view runs with its owner's rights, so it can read visits even
--    though members can't touch the raw table. We then GRANT this view
--    to members. They get the chalkboard, never the drawer.
-- ---------------------------------------------------------------------
drop view if exists public.member_feed;
create view public.member_feed as
select
  v.id                                                   as visit_id,
  p.display_name                                         as host_name,
  v.arrival_date,
  v.expected_departure,
  (current_date between v.arrival_date and v.expected_departure) as is_active
from public.visits v
join public.profiles p on p.id = v.host_id
where v.expired_at is null
  and v.closed_at is null;

-- Lock the view down, then hand it only to logged-in users.
revoke all on public.member_feed from anon, authenticated;
grant select on public.member_feed to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. THE MANAGER'S BOOK  (guest_status view) - auto status badges
--    security_invoker = true means this view runs AS THE CALLER, so the
--    manager-only RLS on guests/visits still applies. A member querying
--    this gets zero rows. The manager gets full detail + computed status.
--
--    Rules:
--      casual    = under 5 cumulative nights this calendar month
--      extended  = 5+ cumulative nights this calendar month
--      overstay  = more than 7 consecutive nights in a single visit
-- ---------------------------------------------------------------------
drop view if exists public.guest_status;
create view public.guest_status
with (security_invoker = true) as
with monthly as (
  select
    guest_id,
    sum(nights)  as nights_this_month,
    count(*)     as visits_this_month
  from public.visits
  where date_trunc('month', arrival_date) = date_trunc('month', current_date)
    and expired_at is null
    and closed_at is null
  group by guest_id
),
longest as (
  select guest_id, max(nights) as longest_single_visit
  from public.visits
  where expired_at is null
    and closed_at is null
  group by guest_id
)
select
  g.id            as guest_id,
  g.full_name,
  g.phone,
  coalesce(m.nights_this_month, 0)  as nights_this_month,
  coalesce(m.visits_this_month, 0)  as visits_this_month,
  coalesce(l.longest_single_visit, 0) as longest_single_visit,
  case
    when coalesce(l.longest_single_visit, 0) > 7 then 'overstay'
    when coalesce(m.nights_this_month, 0) >= 5   then 'extended'
    else 'casual'
  end as status
from public.guests g
left join monthly m on m.guest_id = g.id
left join longest l on l.guest_id = g.id;

grant select on public.guest_status to authenticated;


-- ---------------------------------------------------------------------
-- 7. DOOR SUBMISSIONS  (submit_guest function)
--    The intake form runs without a manager logged in, but the tables
--    are manager-only. This SECURITY DEFINER function does the privileged
--    write on the caller's behalf: it normalises the phone, reuses an
--    existing guest if the number is known (else creates one), then logs
--    the visit. It returns nothing sensitive - just an ok + the host name.
-- ---------------------------------------------------------------------
create or replace function public.submit_guest(
  p_host_id            uuid,
  p_full_name          text,
  p_phone              text,
  p_arrival_date       date,
  p_expected_departure date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone   text;
  v_guest   uuid;
  v_nights  int;
  v_host    text;
begin
  -- digits only, e.g. "(510) 555-1234" -> "5105551234"
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');

  if length(v_phone) < 7 then
    raise exception 'Please enter a valid phone number.';
  end if;
  if p_expected_departure < p_arrival_date then
    raise exception 'Departure date cannot be before arrival date.';
  end if;

  select display_name into v_host from public.profiles where id = p_host_id;
  if v_host is null then
    raise exception 'Please pick a valid host from the list.';
  end if;

  v_nights := greatest((p_expected_departure - p_arrival_date), 1);

  -- Loyalty-card upsert: one guest per phone number.
  insert into public.guests (full_name, phone)
  values (trim(p_full_name), v_phone)
  on conflict (phone) do update set full_name = excluded.full_name
  returning id into v_guest;

  insert into public.visits (guest_id, host_id, arrival_date, expected_departure, nights)
  values (v_guest, p_host_id, p_arrival_date, p_expected_departure, v_nights);

  return json_build_object('ok', true, 'host_name', v_host, 'nights', v_nights);
end;
$$;

-- Anyone reaching the QR form may submit. They still cannot read the tables.
grant execute on function public.submit_guest(uuid, text, text, date, date)
  to anon, authenticated;


-- ---------------------------------------------------------------------
-- 8. PUBLIC HOST ROSTER  (for the door dropdown, no login needed)
--    Exposes ONLY id + display_name of house members - no contact info.
-- ---------------------------------------------------------------------
create or replace function public.house_roster()
returns table (id uuid, display_name text)
language sql
security definer
stable
set search_path = public
as $$
  select id, display_name from public.profiles order by display_name;
$$;

grant execute on function public.house_roster() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 8b. LOBBY FEED  (replaces member_feed view for reliable anon access)
--     SECURITY DEFINER bypasses RLS so anon + members can see the safe
--     projection. No guest names, no phones — just host, dates, active flag.
-- ---------------------------------------------------------------------
create or replace function public.lobby_feed()
returns table (
  visit_id uuid,
  host_name text,
  arrival_date date,
  expected_departure date,
  is_active boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    v.id as visit_id,
    h.display_name as host_name,
    v.arrival_date,
    v.expected_departure,
    (current_date between v.arrival_date and v.expected_departure) as is_active
  from public.visits v
  join public.house_roster() h on h.id = v.host_id
  where v.expired_at is null
    and v.closed_at is null
  order by v.expected_departure asc;
$$;

grant execute on function public.lobby_feed() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. AUTO-CLEANUP: soft-expire visits older than 90 days
--    Adds an expired_at timestamp. A daily pg_cron job marks old visits.
--    Expired visits are hidden from all views but remain in the table.
-- ---------------------------------------------------------------------
alter table public.visits add column if not exists expired_at timestamptz;

create or replace function public.cleanup_old_visits()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.visits
  set expired_at = now()
  where expired_at is null
    and expected_departure < current_date - interval '90 days';
end;
$$;

-- Schedule: run once per day at 3 AM UTC.
-- Requires the pg_cron extension (enable in Supabase: Database -> Extensions -> pg_cron).
select cron.schedule(
  'cleanup-old-visits',
  '0 3 * * *',
  $$select public.cleanup_old_visits()$$
);

-- =====================================================================
--  DONE. See README for: creating accounts, making yourself a manager,
--  and the network-tab privacy test.
-- =====================================================================
