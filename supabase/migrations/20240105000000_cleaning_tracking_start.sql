-- Start tracking guest room cleanings from the first stay after launch.
-- The cleaning log went live 2026-10-12. Stays that ended before 2026-10-11
-- were never asked to log a cleaning, so they must not show as "overdue".
-- Nothing is deleted — older stays stay in bookings/history; the cleaning
-- log just ignores them.

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
  where s.end_date >= date '2026-10-11';   -- cleaning log tracking start
$$;

revoke execute on function public.guest_room_stays() from public, anon, authenticated;
