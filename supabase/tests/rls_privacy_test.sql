-- =====================================================================
--  RLS & PRIVACY TESTS (pgTAP)
--  "Are the doors locked for the right people?"
-- =====================================================================
begin;
select plan(9);

-- ----- SCHEMA: member_feed exposes NO guest details -----

select ok(
  not exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_feed'
      and column_name = 'full_name'
  ),
  'member_feed does not expose full_name'
);

select ok(
  not exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_feed'
      and column_name = 'phone'
  ),
  'member_feed does not expose phone'
);

select ok(
  not exists(
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_feed'
      and column_name = 'guest_id'
  ),
  'member_feed does not expose guest_id'
);

-- ----- SCHEMA: lobby_feed() return type has no guest PII -----

select ok(
  not exists(
    select 1 from information_schema.routines r
    join information_schema.parameters p on p.specific_name = r.specific_name
    where r.routine_schema = 'public'
      and r.routine_name = 'lobby_feed'
      and p.parameter_name in ('full_name', 'phone', 'guest_id')
      and p.parameter_mode = 'OUT'
  ),
  'lobby_feed() does not return guest PII columns'
);

-- ----- RLS: tables are protected -----

select ok(
  exists(
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'guests' and rowsecurity = true
  ),
  'RLS is enabled on guests table'
);

select ok(
  exists(
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'visits' and rowsecurity = true
  ),
  'RLS is enabled on visits table'
);

select ok(
  exists(
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'bookings' and rowsecurity = true
  ),
  'RLS is enabled on bookings table'
);

select ok(
  exists(
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'profiles' and rowsecurity = true
  ),
  'RLS is enabled on profiles table'
);

-- ----- POLICIES: guests + visits are manager-only -----

select ok(
  exists(
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'guests'
      and policyname = 'managers only - guests'
  ),
  'guests table has manager-only policy'
);

select * from finish();
rollback;