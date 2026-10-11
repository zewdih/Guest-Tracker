-- =====================================================================
--  RPC FUNCTION TESTS (pgTAP)
--  "Does each function do what it's supposed to?"
-- =====================================================================
begin;
select plan(13);

-- ----- Functions exist -----

select has_function('public', 'submit_guest', 'submit_guest() exists');
select has_function('public', 'house_roster', 'house_roster() exists');
select has_function('public', 'lobby_feed', 'lobby_feed() exists');
select has_function('public', 'blocked_dates', 'blocked_dates() exists');
select has_function('public', 'submit_booking', 'submit_booking() exists');
select has_function('public', 'lookup_bookings', 'lookup_bookings() exists');
select has_function('public', 'cancel_booking', 'cancel_booking() exists');
select has_function('public', 'lookup_active_visit', 'lookup_active_visit() exists');
select has_function('public', 'confirm_checkout', 'confirm_checkout() exists');
select has_function('public', 'guest_month_status', 'guest_month_status() exists');

-- ----- submit_guest rejects short phone -----

select throws_ok(
  $$select public.submit_guest(gen_random_uuid(), 'Test', '123', current_date, current_date + 2)$$,
  'Please enter a valid phone number.',
  'submit_guest rejects phone shorter than 7 digits'
);

-- ----- submit_guest rejects departure before arrival -----

select throws_ok(
  $$select public.submit_guest(gen_random_uuid(), 'Test', '5105551234', '2025-03-15'::date, '2025-03-10'::date)$$,
  'Departure date cannot be before arrival date.',
  'submit_guest rejects departure before arrival'
);

-- ----- guest_month_status returns 0 for unknown phone -----

select is(
  (public.guest_month_status('0000000000')::json->>'nights_this_month')::int,
  0,
  'guest_month_status returns 0 nights for unknown phone'
);

select * from finish();
rollback;