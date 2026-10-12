-- =====================================================================
--  GUEST ROOM CLEANING LOG
--  After a guest room stay ends, the host logs a cleaning with a photo.
--  The House Manager reviews it: approve (published) or send back (re-clean).
--  Council decision: approved cleaning photos + host name are public.
--  Pending, sent-back and missed cleanings are only visible to managers.
-- =====================================================================

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
  from stays s;
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
