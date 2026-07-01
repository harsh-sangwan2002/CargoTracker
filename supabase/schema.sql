create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.profiles') is null and to_regclass('public.users') is null then
    create table public.users (
      uid text primary key,
      email text not null unique,
      role text not null default 'driver' check (role in ('driver', 'manager', 'admin')),
      created_at timestamptz not null default now()
    );
  end if;
end $$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (uid, email, role, created_at)
  values (
    new.id::text,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data->>'role', 'driver'),
    coalesce(new.created_at, now())
  )
  on conflict (uid) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

do $$
begin
  if to_regclass('public.users') is not null then
    execute $sql$
      insert into public.users (uid, email, role, created_at)
      select
        id::text,
        lower(coalesce(email, '')),
        coalesce(raw_user_meta_data->>'role', 'driver'),
        coalesce(created_at, now())
      from auth.users
      where email is not null
      on conflict (uid) do update
        set email = excluded.email
    $sql$;
  end if;
end $$;

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null default '',
  age integer not null default 0,
  address text not null default '',
  aadhaar_card text not null default '',
  pan_card text not null default '',
  vehicle_owned text not null default '',
  photo_url text not null default '',
  user_id text references public.users(uid) on delete set null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drivers_user_id_idx on public.drivers(user_id);
create index if not exists drivers_email_idx on public.drivers(lower(email));

create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  created_at timestamptz not null default now()
);

create index if not exists plants_name_idx on public.plants(name);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  truck text not null default '',
  bid_no text not null default '',
  driver_name text not null default '',
  company_name text not null default '',
  item_type text not null default '',
  quantity text not null default '',
  fuel_filled text not null default '0',
  distance_travelled text,
  departure_time timestamptz not null,
  arrival_time timestamptz,
  from_plant text not null default '',
  to_plant text not null default '',
  status text not null default 'Active',
  time text not null default '',
  user_id text references public.users(uid) on delete set null,
  driver_user_id text references public.users(uid) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists trips_created_at_idx on public.trips(created_at desc);
create index if not exists trips_driver_user_id_idx on public.trips(driver_user_id);
create index if not exists trips_user_id_idx on public.trips(user_id);

create table if not exists public.driver_locations (
  user_id text primary key references public.users(uid) on delete cascade,
  driver_name text not null default '',
  lat double precision not null,
  lng double precision not null,
  updated_at bigint not null,
  is_tracking boolean not null default false,
  trip_route text
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  driver_user_id text not null references public.users(uid) on delete cascade,
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_driver_user_id_idx on public.notifications(driver_user_id);
create index if not exists notifications_created_at_idx on public.notifications(created_at desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'driver_locations'
     ) then
    alter publication supabase_realtime add table public.driver_locations;
  end if;
end $$;

-- Realtime for trips + notifications so a driver's app updates live when a trip is
-- assigned/reassigned to them, without waiting on a manual pull-to-refresh.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips'
     ) then
    alter publication supabase_realtime add table public.trips;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================================
-- Phase 1 Foundation migration: relational schema + RLS
-- (additive/idempotent — safe to re-run; preserves existing data)
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('admin', 'manager', 'driver');
exception when duplicate_object then null; end $$;

do $$ begin
  create type driver_status as enum ('active', 'inactive', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type vehicle_status as enum ('active', 'in_maintenance', 'retired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trip_status as enum ('pending', 'active', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ── users -> profiles ───────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.users') is not null and to_regclass('public.profiles') is null then
    -- drop FK constraints that reference users(uid) so the column can be retyped
    alter table public.drivers drop constraint if exists drivers_user_id_fkey;
    alter table public.trips drop constraint if exists trips_user_id_fkey;
    alter table public.trips drop constraint if exists trips_driver_user_id_fkey;
    alter table public.driver_locations drop constraint if exists driver_locations_user_id_fkey;
    alter table public.notifications drop constraint if exists notifications_driver_user_id_fkey;

    alter table public.users rename to profiles;
    alter table public.profiles rename column uid to id;
    alter table public.profiles alter column id type uuid using id::uuid;
    alter table public.profiles add column if not exists full_name text;
    alter table public.profiles add column if not exists phone text;
    alter table public.profiles add column if not exists is_active boolean not null default true;
    alter table public.profiles add column if not exists updated_at timestamptz not null default now();
    alter table public.profiles drop constraint if exists users_role_check;
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type user_role using role::user_role;
    alter table public.profiles alter column role set default 'driver';
    alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

    -- retype dependent FK columns from text -> uuid, then re-add FKs to profiles(id)
    alter table public.drivers alter column user_id type uuid using nullif(user_id, '')::uuid;
    alter table public.trips alter column user_id type uuid using nullif(user_id, '')::uuid;
    alter table public.trips alter column driver_user_id type uuid using nullif(driver_user_id, '')::uuid;
    alter table public.driver_locations alter column user_id type uuid using user_id::uuid;
    alter table public.notifications alter column driver_user_id type uuid using driver_user_id::uuid;

    alter table public.drivers add constraint drivers_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;
    alter table public.trips add constraint trips_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;
    alter table public.trips add constraint trips_driver_user_id_fkey foreign key (driver_user_id) references public.profiles(id) on delete set null;
    alter table public.driver_locations add constraint driver_locations_user_id_fkey foreign key (user_id) references public.profiles(id) on delete cascade;
    alter table public.notifications add constraint notifications_driver_user_id_fkey foreign key (driver_user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- point the auth trigger at profiles going forward
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, full_name, created_at)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'driver'),
    new.raw_user_meta_data->>'full_name',
    coalesce(new.created_at, now())
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ── vehicles (new) ──────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  registration_number text unique not null,
  type text,
  capacity_tons numeric,
  fuel_type text,
  odometer_reading numeric not null default 0,
  insurance_expiry date,
  permit_expiry date,
  puc_expiry date,
  status vehicle_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── drivers additions ───────────────────────────────────────────────────
alter table public.drivers add column if not exists profile_id uuid references public.profiles(id) on delete set null;
alter table public.drivers add column if not exists license_number text;
alter table public.drivers add column if not exists license_expiry date;
alter table public.drivers add column if not exists status driver_status not null default 'active';
alter table public.drivers add column if not exists created_by uuid references public.profiles(id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'aadhaar_card') then
    alter table public.drivers rename column aadhaar_card to aadhaar_number;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'pan_card') then
    alter table public.drivers rename column pan_card to pan_number;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'drivers' and column_name = 'photo_url') then
    alter table public.drivers rename column photo_url to photo_path;
  end if;
end $$;

update public.drivers d
set profile_id = p.id
from public.profiles p
where d.profile_id is null and d.email is not null and lower(d.email) = p.email;

-- backfill for rows linked via linkDriverToUser() before it was fixed to also set
-- profile_id (previously only set user_id, which drivers_select_own RLS ignores).
update public.drivers
set profile_id = user_id
where profile_id is null and user_id is not null;

create index if not exists drivers_profile_id_idx on public.drivers(profile_id);

-- ── plants additions ────────────────────────────────────────────────────
alter table public.plants add column if not exists code text;
alter table public.plants add column if not exists address text;
alter table public.plants add column if not exists latitude numeric;
alter table public.plants add column if not exists longitude numeric;
alter table public.plants add column if not exists contact_person text;
alter table public.plants add column if not exists contact_phone text;
alter table public.plants add column if not exists is_active boolean not null default true;
create unique index if not exists plants_code_idx on public.plants(code) where code is not null;

-- ── trips additions ─────────────────────────────────────────────────────
alter table public.trips add column if not exists vehicle_id uuid references public.vehicles(id);
alter table public.trips add column if not exists driver_id uuid references public.drivers(id);
alter table public.trips add column if not exists from_plant_id uuid references public.plants(id);
alter table public.trips add column if not exists to_plant_id uuid references public.plants(id);
alter table public.trips add column if not exists odometer_start numeric;
alter table public.trips add column if not exists odometer_end numeric;
alter table public.trips add column if not exists distance_travelled_km numeric;
alter table public.trips add column if not exists fuel_filled_liters numeric;
alter table public.trips add column if not exists fuel_cost numeric;
alter table public.trips add column if not exists trip_status trip_status;
alter table public.trips add column if not exists trip_number text;
alter table public.trips add column if not exists created_by uuid references public.profiles(id);

-- the FKs above default to "on delete no action", which blocks deleting a driver/
-- vehicle/plant/profile that has trip history (raw FK-violation surfaced as a
-- generic "failed to delete" error). Trips are historical records, so relax these
-- to "on delete set null" instead of restricting deletion of the referenced row.
alter table public.trips drop constraint if exists trips_vehicle_id_fkey;
alter table public.trips add constraint trips_vehicle_id_fkey foreign key (vehicle_id) references public.vehicles(id) on delete set null;
alter table public.trips drop constraint if exists trips_driver_id_fkey;
alter table public.trips add constraint trips_driver_id_fkey foreign key (driver_id) references public.drivers(id) on delete set null;
alter table public.trips drop constraint if exists trips_from_plant_id_fkey;
alter table public.trips add constraint trips_from_plant_id_fkey foreign key (from_plant_id) references public.plants(id) on delete set null;
alter table public.trips drop constraint if exists trips_to_plant_id_fkey;
alter table public.trips add constraint trips_to_plant_id_fkey foreign key (to_plant_id) references public.plants(id) on delete set null;
alter table public.trips drop constraint if exists trips_created_by_fkey;
alter table public.trips add constraint trips_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;

-- backfill vehicles from historical free-text truck/vehicle_owned values
insert into public.vehicles (registration_number)
select distinct upper(trim(truck))
from public.trips
where trim(coalesce(truck, '')) <> ''
on conflict (registration_number) do nothing;

insert into public.vehicles (registration_number)
select distinct upper(trim(vehicle_owned))
from public.drivers
where trim(coalesce(vehicle_owned, '')) <> ''
on conflict (registration_number) do nothing;

-- backfill trip FKs from legacy text columns
update public.trips t
set vehicle_id = v.id
from public.vehicles v
where t.vehicle_id is null and upper(trim(t.truck)) = v.registration_number;

update public.trips t
set driver_id = d.id
from public.drivers d
where t.driver_id is null and t.driver_user_id is not null and t.driver_user_id = d.user_id;

update public.trips t
set driver_id = d.id
from public.drivers d
where t.driver_id is null and lower(trim(t.driver_name)) = lower(trim(d.full_name));

update public.trips t
set from_plant_id = p.id
from public.plants p
where t.from_plant_id is null and lower(trim(t.from_plant)) = lower(trim(p.name));

update public.trips t
set to_plant_id = p.id
from public.plants p
where t.to_plant_id is null and lower(trim(t.to_plant)) = lower(trim(p.name));

update public.trips
set distance_travelled_km = nullif(distance_travelled, '')::numeric
where distance_travelled_km is null and distance_travelled ~ '^\d+(\.\d+)?$';

update public.trips
set fuel_filled_liters = nullif(fuel_filled, '')::numeric
where fuel_filled_liters is null and fuel_filled ~ '^\d+(\.\d+)?$';

update public.trips
set trip_status = case lower(status)
  when 'active' then 'active'::trip_status
  when 'delivered' then 'completed'::trip_status
  when 'completed' then 'completed'::trip_status
  when 'cancelled' then 'cancelled'::trip_status
  when 'pending' then 'pending'::trip_status
  else 'active'::trip_status
end
where trip_status is null;

-- generate trip_number for existing rows (CT-000001 style)
create sequence if not exists public.trip_number_seq;

do $$
declare
  r record;
begin
  for r in select id from public.trips where trip_number is null order by created_at loop
    update public.trips
    set trip_number = 'CT-' || lpad(nextval('public.trip_number_seq')::text, 6, '0')
    where id = r.id;
  end loop;
end $$;

create or replace function public.assign_trip_number()
returns trigger
language plpgsql
as $$
begin
  if new.trip_number is null then
    new.trip_number := 'CT-' || lpad(nextval('public.trip_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trips_assign_number on public.trips;
create trigger trips_assign_number
before insert on public.trips
for each row execute function public.assign_trip_number();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trips_trip_number_key'
  ) then
    alter table public.trips add constraint trips_trip_number_key unique (trip_number);
  end if;
end $$;

-- ── indexes (HLD §4.2) ──────────────────────────────────────────────────
create index if not exists idx_trips_driver_dep on public.trips (driver_id, departure_time desc);
create index if not exists idx_trips_vehicle_dep on public.trips (vehicle_id, departure_time desc);
create index if not exists idx_trips_status on public.trips (trip_status);
create index if not exists idx_trips_from_plant on public.trips (from_plant_id);
create index if not exists idx_trips_to_plant on public.trips (to_plant_id);

-- ============================================================================
-- Row Level Security (HLD §4.3)
-- ============================================================================
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.plants enable row level security;
alter table public.trips enable row level security;
-- notifications and driver_locations were created without RLS — any authenticated
-- client could read/write every driver's notifications and live GPS location.
alter table public.notifications enable row level security;
alter table public.driver_locations enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select
  using (id = auth.uid() or current_user_role() in ('manager', 'admin'));

drop policy if exists profiles_write_admin on public.profiles;
create policy profiles_write_admin on public.profiles for all
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

drop policy if exists drivers_select_own on public.drivers;
create policy drivers_select_own on public.drivers for select
  using (current_user_role() in ('manager', 'admin') or profile_id = auth.uid());

drop policy if exists drivers_write_staff on public.drivers;
create policy drivers_write_staff on public.drivers for all
  using (current_user_role() in ('manager', 'admin'))
  with check (current_user_role() in ('manager', 'admin'));

drop policy if exists vehicles_select_all on public.vehicles;
create policy vehicles_select_all on public.vehicles for select
  using (current_user_role() in ('manager', 'admin', 'driver'));

drop policy if exists vehicles_write_staff on public.vehicles;
create policy vehicles_write_staff on public.vehicles for all
  using (current_user_role() in ('manager', 'admin'))
  with check (current_user_role() in ('manager', 'admin'));

drop policy if exists plants_select_all on public.plants;
create policy plants_select_all on public.plants for select
  using (current_user_role() in ('manager', 'admin', 'driver'));

drop policy if exists plants_write_staff on public.plants;
create policy plants_write_staff on public.plants for all
  using (current_user_role() in ('manager', 'admin'))
  with check (current_user_role() in ('manager', 'admin'));

drop policy if exists trips_select_driver on public.trips;
create policy trips_select_driver on public.trips for select
  using (
    current_user_role() in ('manager', 'admin')
    or driver_id in (select id from public.drivers where profile_id = auth.uid())
    or driver_user_id = auth.uid()
  );

drop policy if exists trips_write_staff on public.trips;
create policy trips_write_staff on public.trips for all
  using (current_user_role() in ('manager', 'admin'))
  with check (current_user_role() in ('manager', 'admin'));

drop policy if exists trips_update_own_driver on public.trips;
create policy trips_update_own_driver on public.trips for update
  using (
    driver_id in (select id from public.drivers where profile_id = auth.uid())
    or driver_user_id = auth.uid()
  )
  with check (
    driver_id in (select id from public.drivers where profile_id = auth.uid())
    or driver_user_id = auth.uid()
  );

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select
  using (current_user_role() in ('manager', 'admin') or driver_user_id = auth.uid());

drop policy if exists notifications_insert_staff on public.notifications;
create policy notifications_insert_staff on public.notifications for insert
  with check (current_user_role() in ('manager', 'admin'));

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update
  using (current_user_role() in ('manager', 'admin') or driver_user_id = auth.uid())
  with check (current_user_role() in ('manager', 'admin') or driver_user_id = auth.uid());

drop policy if exists notifications_delete_staff on public.notifications;
create policy notifications_delete_staff on public.notifications for delete
  using (current_user_role() in ('manager', 'admin'));

drop policy if exists driver_locations_select on public.driver_locations;
create policy driver_locations_select on public.driver_locations for select
  using (current_user_role() in ('manager', 'admin') or user_id = auth.uid());

drop policy if exists driver_locations_write_own on public.driver_locations;
create policy driver_locations_write_own on public.driver_locations for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================================
-- Phase 2: Trust & Compliance
-- (additive/idempotent — safe to re-run)
-- ============================================================================

-- ── fuel_logs (new) ─────────────────────────────────────────────────────
create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete set null,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  liters numeric not null,
  cost numeric,
  odometer_reading numeric,
  fuel_station text,
  receipt_photo_path text,
  logged_by uuid references public.profiles(id) on delete set null,
  logged_at timestamptz not null default now()
);

create index if not exists fuel_logs_vehicle_logged_idx on public.fuel_logs(vehicle_id, logged_at desc);
create index if not exists fuel_logs_trip_idx on public.fuel_logs(trip_id);

alter table public.fuel_logs enable row level security;

drop policy if exists fuel_logs_select on public.fuel_logs;
create policy fuel_logs_select on public.fuel_logs for select
  using (
    current_user_role() in ('manager', 'admin')
    or trip_id in (
      select id from public.trips
      where driver_id in (select id from public.drivers where profile_id = auth.uid())
        or driver_user_id = auth.uid()
    )
  );

drop policy if exists fuel_logs_write on public.fuel_logs;
create policy fuel_logs_write on public.fuel_logs for all
  using (
    current_user_role() in ('manager', 'admin')
    or trip_id in (
      select id from public.trips
      where driver_id in (select id from public.drivers where profile_id = auth.uid())
        or driver_user_id = auth.uid()
    )
  )
  with check (
    current_user_role() in ('manager', 'admin')
    or trip_id in (
      select id from public.trips
      where driver_id in (select id from public.drivers where profile_id = auth.uid())
        or driver_user_id = auth.uid()
    )
  );

-- ── trip_status_history (new) ───────────────────────────────────────────
create table if not exists public.trip_status_history (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  old_status trip_status,
  new_status trip_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists trip_status_history_trip_idx on public.trip_status_history(trip_id, changed_at desc);

alter table public.trip_status_history enable row level security;

drop policy if exists trip_status_history_select on public.trip_status_history;
create policy trip_status_history_select on public.trip_status_history for select
  using (
    current_user_role() in ('manager', 'admin')
    or trip_id in (
      select id from public.trips
      where driver_id in (select id from public.drivers where profile_id = auth.uid())
        or driver_user_id = auth.uid()
    )
  );

create or replace function public.log_trip_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.trip_status is distinct from old.trip_status then
    insert into public.trip_status_history (trip_id, old_status, new_status, changed_by)
    values (new.id, old.trip_status, new.trip_status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trips_log_status_change on public.trips;
create trigger trips_log_status_change
after update on public.trips
for each row execute function public.log_trip_status_change();

-- ── odometer-based distance calc ────────────────────────────────────────
alter table public.trips add column if not exists distance_manual_override boolean not null default false;

create or replace function public.compute_trip_distance()
returns trigger
language plpgsql
as $$
begin
  if not new.distance_manual_override
     and new.odometer_start is not null
     and new.odometer_end is not null
     and new.odometer_end >= new.odometer_start then
    new.distance_travelled_km := new.odometer_end - new.odometer_start;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_compute_distance on public.trips;
create trigger trips_compute_distance
before insert or update on public.trips
for each row execute function public.compute_trip_distance();

-- ── audit_logs (new) ─────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_staff on public.audit_logs;
create policy audit_logs_select_staff on public.audit_logs for select
  using (current_user_role() in ('manager', 'admin'));

create or replace function public.audit_trips_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    auth.uid(),
    lower(tg_op),
    'trip',
    coalesce(new.id, old.id),
    case when tg_op in ('update', 'delete') then to_jsonb(old) else null end,
    case when tg_op in ('insert', 'update') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trips_audit on public.trips;
create trigger trips_audit
after insert or update or delete on public.trips
for each row execute function public.audit_trips_change();

create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'update' and new.role is distinct from old.role then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value)
    values (auth.uid(), 'role_change', 'profile', new.id, jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_audit_role on public.profiles;
create trigger profiles_audit_role
after update on public.profiles
for each row execute function public.audit_role_change();

-- fuel_logs.logged_by / trip_status_history.changed_by / audit_logs.actor_id were
-- created above with the default "on delete no action", which would block deleting
-- a profile that has fuel logs, status-change history, or audit entries. Relax to
-- "on delete set null" on databases where these tables were already created before
-- this fix (create table if not exists won't re-apply the new column default).
do $$
begin
  if to_regclass('public.fuel_logs') is not null then
    alter table public.fuel_logs drop constraint if exists fuel_logs_logged_by_fkey;
    alter table public.fuel_logs add constraint fuel_logs_logged_by_fkey foreign key (logged_by) references public.profiles(id) on delete set null;
  end if;
  if to_regclass('public.trip_status_history') is not null then
    alter table public.trip_status_history drop constraint if exists trip_status_history_changed_by_fkey;
    alter table public.trip_status_history add constraint trip_status_history_changed_by_fkey foreign key (changed_by) references public.profiles(id) on delete set null;
  end if;
  if to_regclass('public.audit_logs') is not null then
    alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;
    alter table public.audit_logs add constraint audit_logs_actor_id_fkey foreign key (actor_id) references public.profiles(id) on delete set null;
  end if;
end $$;

-- ============================================================================
-- Phase 3: Operational Depth
-- (additive/idempotent — safe to re-run)
-- ============================================================================

-- ── vehicle_maintenance (new) ────────────────────────────────────────────
create table if not exists public.vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  maintenance_type text not null default 'service',
  description text,
  cost numeric,
  odometer_at_service numeric,
  service_date date not null default current_date,
  next_service_due_date date,
  next_service_due_odometer numeric,
  vendor text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_maintenance_vehicle_idx on public.vehicle_maintenance(vehicle_id, service_date desc);
create index if not exists vehicle_maintenance_due_idx on public.vehicle_maintenance(next_service_due_date);

alter table public.vehicle_maintenance enable row level security;

drop policy if exists vehicle_maintenance_select on public.vehicle_maintenance;
create policy vehicle_maintenance_select on public.vehicle_maintenance for select
  using (current_user_role() in ('manager', 'admin', 'driver'));

drop policy if exists vehicle_maintenance_write_staff on public.vehicle_maintenance;
create policy vehicle_maintenance_write_staff on public.vehicle_maintenance for all
  using (current_user_role() in ('manager', 'admin'))
  with check (current_user_role() in ('manager', 'admin'));

-- ── push_tokens (new) ─────────────────────────────────────────────────────
create table if not exists public.push_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
