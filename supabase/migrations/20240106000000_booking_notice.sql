-- House rule (2026-10-12): no same-day self-booking of the guest room.
-- Bookings must start tomorrow or later (California time) so the previous
-- host has time to clean. The House Manager can override: when she books
-- while signed in, is_manager() is true and the check is skipped.
-- Also aligns the return value with prod (visit_id, guest_id).

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
