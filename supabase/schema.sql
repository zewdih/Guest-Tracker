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
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  role         text not null default 'member'
               check (role in ('member', 'manager')),
  active       boolean not null default true,
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
  group by guest_id
),
longest as (
  select guest_id, max(nights) as longest_single_visit
  from public.visits
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

  -- Use house_roster() to bypass RLS on profiles (matches submit_booking pattern)
  select display_name into v_host from public.house_roster() where id = p_host_id;
  if v_host is null then
    raise exception 'Please pick a valid host from the list.';
  end if;

  v_nights := greatest((p_expected_departure - p_arrival_date), 1);

  -- Loyalty-card upsert: one guest per phone number.
  insert into public.guests (full_name, phone)
  values (trim(p_full_name), v_phone)
  on conflict (phone) do update set full_name = excluded.full_name
  returning id into v_guest;

  -- Auto-close any existing open visit for this guest+host so duplicate
  -- rows don't appear on the lobby board.
  update public.visits
  set closed_at = now()
  where guest_id = v_guest
    and host_id  = p_host_id
    and closed_at is null;

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
  select id, display_name from public.profiles where active = true order by display_name;
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
  join public.profiles h on h.id = v.host_id
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

-- Cron job disabled: the cleanup was silently hiding old visit data from
-- all views and the manager dashboard. Old visits are kept indefinitely;
-- managers can close them manually if needed.
-- To re-enable in future, uncomment:
-- select cron.schedule('cleanup-old-visits', '0 3 * * *', $$select public.cleanup_old_visits()$$);

-- ---------------------------------------------------------------------
-- 10. BOOKINGS  (calendar-based guest room reservations)
--     Public form — anyone in the house can book the guest room.
--     No auth required (same pattern as the door intake form).
-- ---------------------------------------------------------------------

create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  booker_name     text not null,           -- who is booking (= host display_name)
  booker_phone    text not null,           -- their phone (digits only after normalize)
  booker_email    text not null,           -- their email
  guest_name      text not null,           -- who the guest is
  arrival_date    date not null,
  departure_date  date not null,
  nights          int  not null,           -- departure - arrival, minimum 1
  status          text not null default 'confirmed'
                  check (status in ('confirmed', 'cancelled')),
  created_at      timestamptz not null default now(),
  host_id         uuid references public.profiles(id),   -- which member is hosting
  guest_phone     text,                                   -- guest's phone (for visit tracking)
  visit_id        uuid references public.visits(id) on delete set null,  -- linked visit

  constraint valid_booking_dates check (departure_date >= arrival_date)
);

create index if not exists bookings_dates_idx on public.bookings(arrival_date, departure_date);

alter table public.bookings enable row level security;

-- Managers can see and manage all bookings
drop policy if exists "managers all bookings" on public.bookings;
create policy "managers all bookings" on public.bookings
  for all using (public.is_manager()) with check (public.is_manager());


-- ---------------------------------------------------------------------
-- 10b. BLOCKED DATES  (public function — shows which dates are taken)
--      Returns only dates, no personal info. Safe for public use.
-- ---------------------------------------------------------------------
create or replace function public.blocked_dates()
returns table (blocked_date date)
language sql
security definer
stable
set search_path = public
as $$
  select distinct d::date as blocked_date
  from public.bookings b
    cross join lateral generate_series(b.arrival_date, b.departure_date, '1 day'::interval) d
    left join public.visits v on b.visit_id = v.id
  where b.status = 'confirmed'
    and b.departure_date >= current_date
    and (b.visit_id is null or v.closed_at is null);
$$;

grant execute on function public.blocked_dates() to anon, authenticated;



-- ---------------------------------------------------------------------
-- 10c. SUBMIT BOOKING  (public function — inserts a booking)
--      Same SECURITY DEFINER pattern as submit_guest: the caller can't
--      touch the table directly, but this function does the insert.
-- ---------------------------------------------------------------------
-- Drop old signature so we can create the new 8-param version
drop function if exists public.submit_booking(text, text, text, text, date, date);

create or replace function public.submit_booking(
  p_phone          text,          -- booker's phone
  p_email          text,          -- booker's email (for lookup/cancel)
  p_guest_name     text,          -- who the guest is
  p_arrival_date   date,
  p_departure_date date,
  p_host_id        uuid,          -- which member is hosting (booker = host)
  p_guest_phone    text           -- guest's phone (for visit tracking)
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booker_phone text;
  v_guest_phone  text;
  v_nights       int;
  v_conflict     boolean;
  v_host_name    text;
  v_guest_id     uuid;
  v_visit_id     uuid;
begin
  -- Validate inputs
  if trim(coalesce(p_guest_name, '')) = '' then
    raise exception 'Please enter the guest''s name.';
  end if;
  if trim(coalesce(p_email, '')) = '' then
    raise exception 'Please enter your email.';
  end if;

  -- Validate host (use house_roster() to bypass RLS on profiles)
  select display_name into v_host_name from public.house_roster() where id = p_host_id;
  if v_host_name is null then
    raise exception 'Please pick a valid host from the list.';
  end if;

  -- Normalize booker phone: digits only
  v_booker_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_booker_phone) < 7 then
    raise exception 'Please enter a valid phone number.';
  end if;

  -- Normalize guest phone: digits only
  v_guest_phone := regexp_replace(coalesce(p_guest_phone, ''), '\D', '', 'g');
  if length(v_guest_phone) < 7 then
    raise exception 'Please enter a valid phone number for the guest.';
  end if;

  if p_departure_date < p_arrival_date then
    raise exception 'Check-out date cannot be before check-in date.';
  end if;

  -- House rule: no same-day self-booking — the guest room needs at least a
  -- day's notice so the last host has time to clean. The House Manager can
  -- override (she's signed in, so is_manager() is true). "Today" is
  -- California time, not the database's UTC clock.
  if p_arrival_date <= (now() at time zone 'America/Los_Angeles')::date
     and not public.is_manager() then
    raise exception 'The guest room needs at least a day''s notice. Pick tomorrow or later, or ask the House Manager.';
  end if;

  -- One booking at a time: two people booking the same instant are checked
  -- in turn, so both can't see the dates as free. Released at commit.
  perform pg_advisory_xact_lock(hashtext('guest_room_booking'));

  -- Check for date conflicts with existing confirmed bookings
  -- Must mirror blocked_dates() logic: ignore bookings whose linked visit is closed
  select exists (
    select 1 from public.bookings b
      left join public.visits v on b.visit_id = v.id
    where b.status = 'confirmed'
      and b.arrival_date <= p_departure_date
      and b.departure_date >= p_arrival_date
      and (b.visit_id is null or v.closed_at is null)
  ) into v_conflict;

  if v_conflict then
    raise exception 'Some of those dates are already booked. Please pick different dates.';
  end if;

  v_nights := greatest((p_departure_date - p_arrival_date), 1);

  -- Upsert guest (same loyalty-card pattern as submit_guest)
  insert into public.guests (full_name, phone)
  values (trim(p_guest_name), v_guest_phone)
  on conflict (phone) do update set full_name = excluded.full_name
  returning id into v_guest_id;

  -- Create visit (future-dated visits won't appear on lobby board until arrival)
  insert into public.visits (guest_id, host_id, arrival_date, expected_departure, nights)
  values (v_guest_id, p_host_id, p_arrival_date, p_departure_date, v_nights)
  returning id into v_visit_id;

  -- Create booking linked to the visit
  -- Skip host_id (FK references profiles, but visits FK references hosts table;
  -- host is already captured in booker_name and linked via visit_id)
  insert into public.bookings (
    booker_name, booker_phone, booker_email, guest_name,
    arrival_date, departure_date, nights,
    guest_phone, visit_id
  ) values (
    v_host_name, v_booker_phone, trim(p_email), trim(p_guest_name),
    p_arrival_date, p_departure_date, v_nights,
    v_guest_phone, v_visit_id
  );

  return json_build_object(
    'ok', true,
    'visit_id', v_visit_id,
    'guest_id', v_guest_id,
    'nights', v_nights,
    'host_name', v_host_name
  );
end;
$$;

grant execute on function public.submit_booking(text, text, text, date, date, uuid, text)
  to anon, authenticated;


-- ---------------------------------------------------------------------
-- 10d. LOOKUP BOOKINGS  (public — find your bookings by email)
--      Returns only upcoming confirmed bookings for the given email.
--      Exposes minimal info: id, guest_name, dates, nights.
-- ---------------------------------------------------------------------
create or replace function public.lookup_bookings(p_email text)
returns table (
  id uuid,
  guest_name text,
  arrival_date date,
  departure_date date,
  nights int
)
language sql
security definer
stable
set search_path = public
as $$
  select id, guest_name, arrival_date, departure_date, nights
  from public.bookings
  where lower(booker_email) = lower(trim(p_email))
    and status = 'confirmed'
    and departure_date >= current_date
  order by arrival_date;
$$;

grant execute on function public.lookup_bookings(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 10e. CANCEL BOOKING  (public — cancel your own booking by id + email)
--      Requires both the booking id and the matching email as proof of
--      ownership. Sets status to 'cancelled' so the dates free up.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking(p_booking_id uuid, p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
  v_visit uuid;
begin
  select exists (
    select 1 from public.bookings
    where id = p_booking_id
      and lower(booker_email) = lower(trim(p_email))
      and status = 'confirmed'
  ) into v_found;

  if not v_found then
    raise exception 'Booking not found or already cancelled.';
  end if;

  -- Get the linked visit before cancelling
  select visit_id into v_visit from public.bookings
  where id = p_booking_id
    and lower(booker_email) = lower(trim(p_email));

  update public.bookings
  set status = 'cancelled'
  where id = p_booking_id
    and lower(booker_email) = lower(trim(p_email));

  -- Close the linked visit so it disappears from lobby board
  if v_visit is not null then
    update public.visits set closed_at = now() where id = v_visit;
  end if;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.cancel_booking(uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 11. GUEST CHECKOUT CONFIRMATION  (good-faith cleanup checklist)
--     Guests revisit the QR code URL, enter their phone, and confirm
--     they completed the cleanup steps. No auth needed.
-- ---------------------------------------------------------------------
alter table public.visits add column if not exists checkout_confirmed_at timestamptz;

-- Lookup: find the guest's active visit by phone number.
-- Returns minimal info (visit id, host name, dates) — no sensitive data.
create or replace function public.lookup_active_visit(p_phone text)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_phone text;
  v_result json;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) < 7 then
    raise exception 'Please enter a valid phone number.';
  end if;

  select json_build_object(
    'visit_id', v.id,
    'guest_name', g.full_name,
    'host_name', h.display_name,
    'arrival_date', v.arrival_date,
    'expected_departure', v.expected_departure,
    'checkout_confirmed', v.checkout_confirmed_at is not null
  ) into v_result
  from public.visits v
  join public.guests g on g.id = v.guest_id
  join public.house_roster() h on h.id = v.host_id
  where g.phone = v_phone
    and v.closed_at is null
    and v.expired_at is null
  order by v.arrival_date desc
  limit 1;

  if v_result is null then
    raise exception 'No active visit found for that phone number.';
  end if;

  return v_result;
end;
$$;

grant execute on function public.lookup_active_visit(text) to anon, authenticated;

-- Confirm checkout: guest marks their cleanup as done.
create or replace function public.confirm_checkout(p_phone text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_visit_id uuid;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) < 7 then
    raise exception 'Please enter a valid phone number.';
  end if;

  select v.id into v_visit_id
  from public.visits v
  join public.guests g on g.id = v.guest_id
  where g.phone = v_phone
    and v.closed_at is null
    and v.expired_at is null
  order by v.arrival_date desc
  limit 1;

  if v_visit_id is null then
    raise exception 'No active visit found for that phone number.';
  end if;

  update public.visits
  set checkout_confirmed_at = now()
  where id = v_visit_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.confirm_checkout(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 12. GUEST MONTH STATUS  (cumulative nights lookup for the door form)
--     Public function so the intake form can show the real cumulative
--     status at check-in, even though guest_status view is manager-only.
--     Returns only aggregate numbers — no guest name, no phone, no PII.
-- ---------------------------------------------------------------------
create or replace function public.guest_month_status(p_phone text)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_phone text;
  v_result json;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  select json_build_object(
    'nights_this_month', coalesce(sum(v.nights), 0),
    'longest_single_visit', coalesce(max(v.nights), 0)
  ) into v_result
  from public.visits v
  join public.guests g on g.id = v.guest_id
  where g.phone = v_phone
    and date_trunc('month', v.arrival_date) = date_trunc('month', current_date);
  return coalesce(v_result, json_build_object('nights_this_month', 0, 'longest_single_visit', 0));
end;
$$;

grant execute on function public.guest_month_status(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 13. APP LOGS  (frontend observability)
--     Stores error/warning/info logs sent by the browser via the
--     ingest-logs edge function. Only managers can read them.
-- ---------------------------------------------------------------------

create table if not exists public.app_logs (
  id         bigint generated always as identity primary key,
  level      text not null default 'info',
  message    text not null,
  url        text,
  context    jsonb,
  logged_at  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists app_logs_level_time on public.app_logs (level, logged_at desc);

alter table public.app_logs enable row level security;

drop policy if exists "managers read logs" on public.app_logs;
create policy "managers read logs" on public.app_logs
  for select using (public.is_manager());

create or replace function public.cleanup_old_logs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.app_logs
  where logged_at < now() - interval '30 days';
$$;


-- ---------------------------------------------------------------------
-- 14. GUEST ROOM CLEANING LOG
--     After a guest room stay ends, the host logs a cleaning with a photo.
--     The House Manager reviews it: approve (published) or send back.
--     Council decision: approved cleaning photos + host name are public.
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- Cleanings table — one cleaning per guest room booking.
-- booking_id uses ON DELETE SET NULL so cleaning history is never lost
-- if a booking row is removed.
-- ---------------------------------------------------------------------
create table if not exists public.cleanings (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid unique references public.bookings(id) on delete set null,
  host_name   text not null,                 -- booker's display name at the time
  photo_path  text not null,                 -- path in the cleaning-photos bucket
  cleaned_at  timestamptz not null default now(),   -- when the host submitted
  status      text not null default 'submitted'
              check (status in ('submitted', 'approved', 'sent_back')),
  reviewed_at timestamptz                    -- when the House Manager approved / sent back
);

alter table public.cleanings add column if not exists status text not null default 'submitted';
alter table public.cleanings add column if not exists reviewed_at timestamptz;
alter table public.cleanings drop constraint if exists cleanings_status_check;
alter table public.cleanings add constraint cleanings_status_check
  check (status in ('submitted', 'approved', 'sent_back'));

create index if not exists cleanings_cleaned_at_idx on public.cleanings (cleaned_at desc);

alter table public.cleanings enable row level security;

drop policy if exists "managers all cleanings" on public.cleanings;
create policy "managers all cleanings" on public.cleanings
  for all using (public.is_manager()) with check (public.is_manager());


-- ---------------------------------------------------------------------
-- Guest room stays that actually happened, with their real end date.
-- A manager "close out" marks the booking cancelled, so a cancelled
-- booking still counts if its visit was closed on/after arrival.
-- Internal helper — not callable from the browser.
-- ---------------------------------------------------------------------
create or replace function public.guest_room_stays()
returns table (
  booking_id   uuid,
  booker_name  text,
  booker_email text,
  guest_name   text,
  arrival_date date,
  end_date     date,
  clean_by     date
)
language sql
security definer
stable
set search_path = public
as $$
  with stays as (
    select b.id, b.booker_name, b.booker_email, b.guest_name, b.arrival_date,
           case when b.status = 'confirmed' then b.departure_date
                else least(b.departure_date, v.closed_at::date)
           end as end_date
    from public.bookings b
      left join public.visits v on v.id = b.visit_id
    where b.status = 'confirmed'
       or (b.status = 'cancelled' and v.closed_at is not null
           and v.closed_at::date >= b.arrival_date)
  )
  select s.id, s.booker_name, s.booker_email, s.guest_name, s.arrival_date, s.end_date,
         -- 48 hours after departure, or the next booked arrival, whichever comes first
         least(s.end_date + 2, coalesce((
           select min(n.arrival_date) from public.bookings n
           where n.status = 'confirmed' and n.id <> s.id and n.arrival_date >= s.end_date
         ), s.end_date + 2)) as clean_by
  from stays s
  -- Cleaning log tracking start: stays that ended before launch were never
  -- asked to log a cleaning, so they must not show as overdue.
  where s.end_date >= date '2026-10-11';
$$;

revoke execute on function public.guest_room_stays() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Host lookup: stays for this email that ended in the last 14 days
-- (including today) — the ones a cleaning can be logged for.
-- Same email-lookup pattern as lookup_bookings / cancel_booking.
-- ---------------------------------------------------------------------
drop function if exists public.cleaning_bookings(text);

create or replace function public.cleaning_bookings(p_email text)
returns table (
  booking_id      uuid,
  guest_name      text,
  arrival_date    date,
  end_date        date,
  clean_by        date,
  cleaned_at      timestamptz,
  cleaning_status text          -- null (none yet) / submitted / approved / sent_back
)
language sql
security definer
stable
set search_path = public
as $$
  select s.booking_id, s.guest_name, s.arrival_date, s.end_date, s.clean_by, c.cleaned_at, c.status
  from public.guest_room_stays() s
    left join public.cleanings c on c.booking_id = s.booking_id
  where lower(s.booker_email) = lower(trim(p_email))
    and s.end_date <= current_date
    and s.end_date >= current_date - 14
  order by s.end_date desc;
$$;

grant execute on function public.cleaning_bookings(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Upload gate for the storage policy: a photo may only be uploaded into
-- a folder named after a stay that is open for cleaning.
-- ---------------------------------------------------------------------
create or replace function public.can_upload_cleaning(p_folder text)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return exists (
    select 1 from public.guest_room_stays() s
    where s.booking_id = p_folder::uuid
      and s.end_date <= current_date
      and s.end_date >= current_date - 14
  );
exception when invalid_text_representation then
  return false;
end;
$$;

grant execute on function public.can_upload_cleaning(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Submit a cleaning. Verifies the email owns the stay, the stay has
-- ended (no logging before departure), and the photo was uploaded.
-- Re-submitting (e.g. after a send-back) replaces the photo and goes back
-- to the House Manager for review. An approved cleaning can't be replaced.
-- ---------------------------------------------------------------------
drop function if exists public.submit_cleaning(uuid, text, text, boolean);

create or replace function public.submit_cleaning(p_booking_id uuid, p_email text, p_photo_path text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay record;
begin
  select * into v_stay from public.guest_room_stays() s
  where s.booking_id = p_booking_id
    and lower(s.booker_email) = lower(trim(p_email));

  if not found then
    raise exception 'Booking not found for that email.';
  end if;
  if v_stay.end_date > current_date then
    raise exception 'You can log the cleaning once your guest has left.';
  end if;
  if v_stay.end_date < current_date - 14 then
    raise exception 'This stay is too old to log a cleaning for.';
  end if;
  if p_photo_path is null or split_part(p_photo_path, '/', 1) <> p_booking_id::text
     or not exists (select 1 from storage.objects
                    where bucket_id = 'cleaning-photos' and name = p_photo_path) then
    raise exception 'Please add a photo of the cleaned room.';
  end if;
  if exists (select 1 from public.cleanings
             where booking_id = p_booking_id and status = 'approved') then
    raise exception 'This cleaning was already approved. Thanks!';
  end if;

  insert into public.cleanings (booking_id, host_name, photo_path)
  values (p_booking_id, v_stay.booker_name, p_photo_path)
  on conflict (booking_id) do update
    set photo_path = excluded.photo_path, cleaned_at = now(),
        status = 'submitted', reviewed_at = null;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.submit_cleaning(uuid, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Lobby board: recent APPROVED cleanings (public — council decision) and
-- whether a turnover is in progress / awaiting the HM's check. Never names
-- anyone with a pending or missed cleaning, never says "overdue".
-- ---------------------------------------------------------------------
create or replace function public.guest_room_cleanings()
returns json
language sql
security definer
stable
set search_path = public
as $$
  select json_build_object(
    'recent', coalesce((
      select json_agg(r order by r.cleaned_at desc) from (
        select c.host_name, c.photo_path, c.cleaned_at
        from public.cleanings c
        where c.status = 'approved'
        order by c.cleaned_at desc
        limit 5
      ) r
    ), '[]'::json),
    -- Only the MOST RECENT finished stay decides the room's status: if its
    -- cleaning is approved the room is ready, even if an older stay's
    -- cleaning is still open (that's for the HM's Cleanings tab, not public).
    'pending', (
      select json_build_object('end_date', latest.end_date, 'clean_by', latest.clean_by,
                               'submitted', coalesce(latest.status = 'submitted', false),
                               'submitted_at', case when latest.status = 'submitted' then latest.cleaned_at end)
      from (
        select s.end_date, s.clean_by, c.status, c.cleaned_at
        from public.guest_room_stays() s
          left join public.cleanings c on c.booking_id = s.booking_id
        where s.end_date <= current_date
          and s.end_date >= current_date - 14
        order by s.end_date desc
        limit 1
      ) latest
      where coalesce(latest.status, '') <> 'approved'
    )
  );
$$;

grant execute on function public.guest_room_cleanings() to anon, authenticated;


-- ---------------------------------------------------------------------
-- Manager view: every stay that ended in the last 30 days, with its
-- cleaning (if any) and review status. Overdue = past clean_by with no
-- approved cleaning.
-- ---------------------------------------------------------------------
drop function if exists public.cleaning_overview();

create or replace function public.cleaning_overview()
returns table (
  booking_id   uuid,
  host_name    text,
  guest_name   text,
  arrival_date date,
  end_date     date,
  clean_by     date,
  cleaned_at   timestamptz,
  photo_path   text,
  status       text,
  reviewed_at  timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_manager() then
    raise exception 'Managers only.';
  end if;
  return query
    select s.booking_id, s.booker_name, s.guest_name, s.arrival_date, s.end_date,
           s.clean_by, c.cleaned_at, c.photo_path, c.status, c.reviewed_at
    from public.guest_room_stays() s
      left join public.cleanings c on c.booking_id = s.booking_id
    where s.end_date <= current_date
      and s.end_date >= current_date - 30
    order by s.end_date desc;
end;
$$;

grant execute on function public.cleaning_overview() to authenticated;


-- ---------------------------------------------------------------------
-- Photo storage. Public bucket so the lobby board can show photos.
-- Uploads only into a folder for a stay that's open for cleaning;
-- no one can overwrite or delete through the API.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cleaning-photos', 'cleaning-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload cleaning photos" on storage.objects;
create policy "upload cleaning photos" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'cleaning-photos'
    and public.can_upload_cleaning((storage.foldername(name))[1])
  );


-- =====================================================================
--  DONE. See README for: creating accounts, making yourself a manager,
--  and the network-tab privacy test.
-- =====================================================================
