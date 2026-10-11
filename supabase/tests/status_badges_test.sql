-- =====================================================================
--  STATUS BADGE TESTS (pgTAP)
--  "Do the guest status labels compute correctly?"
--
--  casual    = under 5 cumulative nights this month
--  extended  = 5+ cumulative nights this month
--  overstay  = more than 7 consecutive nights in a single visit
-- =====================================================================
begin;
select plan(8);

-- ----- View exists -----

select has_view('public', 'guest_status', 'guest_status view exists');

-- ----- View has required columns -----

select has_column('public', 'guest_status', 'status', 'guest_status has status column');
select has_column('public', 'guest_status', 'guest_id', 'guest_status has guest_id column');
select has_column('public', 'guest_status', 'full_name', 'guest_status has full_name column');
select has_column('public', 'guest_status', 'nights_this_month', 'guest_status has nights_this_month column');
select has_column('public', 'guest_status', 'longest_single_visit', 'guest_status has longest_single_visit column');

-- ----- Threshold logic: test with real data -----
-- Insert test data, verify status, then rollback (transaction keeps it clean)

-- Create test host
insert into public.profiles (id, display_name, role, active)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Host', 'manager', true);

-- Create test guests
insert into public.guests (id, full_name, phone) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Casual Guest', '1111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Extended Guest', '2222222222'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'Overstay Guest', '3333333333');

-- Casual: 2 nights this month (under 5)
insert into public.visits (guest_id, host_id, arrival_date, expected_departure, nights) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   date_trunc('month', current_date)::date, date_trunc('month', current_date)::date + 2, 2);

-- Extended: 6 nights this month (>= 5, but longest single visit <= 7)
insert into public.visits (guest_id, host_id, arrival_date, expected_departure, nights) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   date_trunc('month', current_date)::date, date_trunc('month', current_date)::date + 6, 6);

-- Overstay: 10 nights in one visit (> 7)
insert into public.visits (guest_id, host_id, arrival_date, expected_departure, nights) values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   date_trunc('month', current_date)::date, date_trunc('month', current_date)::date + 10, 10);

-- Verify statuses
select is(
  (select status from public.guest_status where guest_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'casual',
  '2 nights this month = casual'
);

select is(
  (select status from public.guest_status where guest_id = 'bbbbbbbb-0000-0000-0000-000000000003'),
  'overstay',
  '10-night single visit = overstay (takes priority over extended)'
);

select * from finish();
rollback;