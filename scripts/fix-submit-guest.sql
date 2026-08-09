-- Fix submit_guest: use house_roster() to bypass RLS on profiles
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor → New query

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

  insert into public.visits (guest_id, host_id, arrival_date, expected_departure, nights)
  values (v_guest, p_host_id, p_arrival_date, p_expected_departure, v_nights);

  return json_build_object('ok', true, 'host_name', v_host, 'nights', v_nights);
end;
$$;

grant execute on function public.submit_guest(uuid, text, text, date, date)
  to anon, authenticated;
