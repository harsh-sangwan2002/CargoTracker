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
    'driver', -- never trust a client-supplied role in signup metadata
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
        'driver',
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
    'driver'::user_role, -- signup metadata is client-controlled; roles are granted by an admin only
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

-- ── Password reset OTPs (used by Mailgun OTP flow) ─────────────────────────
create table if not exists public.password_reset_otps (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  otp_hash   text not null,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_otps_email_idx on public.password_reset_otps (email, used, created_at desc);

-- Only the service role (edge functions) can read/write this table.
alter table public.password_reset_otps enable row level security;
drop policy if exists otp_no_public_access on public.password_reset_otps;
create policy otp_no_public_access on public.password_reset_otps for all using (false);

-- ============================================================================
-- Security hardening
-- (additive/idempotent — safe to re-run)
-- ============================================================================

-- ── Role helper: deactivated profiles lose all access ───────────────────────
-- Every RLS policy goes through current_user_role(); returning null for an
-- inactive profile denies everything without having to revoke their JWT.
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

-- ── profiles: self-service edits without self-promotion ───────────────────
alter table public.profiles add column if not exists address text;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- RLS can't restrict columns, so a trigger blocks non-admins (and admins acting
-- on their own row) from changing role / is_active / email / id. Requests made
-- with the service role or by the database owner have no auth.uid() and pass.
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'profile id and email cannot be changed' using errcode = '42501';
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    if current_user_role() is distinct from 'admin' then
      raise exception 'only an admin can change roles or account status' using errcode = '42501';
    end if;
    if new.id = auth.uid() then
      raise exception 'admins cannot change their own role or status' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
before update on public.profiles
for each row execute function public.guard_profile_privileged_columns();

-- ── drivers: Aadhaar / PAN readable by admins only (HLD §3.6) ──────────────
-- Column privileges: the API roles can read every drivers column except the two
-- PII columns. Admins (and the driver themselves) read them through
-- get_driver_pii() / get_my_driver_profile(). New drivers columns must be added
-- to this grant list or they will be unreadable from the app.
revoke all on public.drivers from anon;
revoke select on public.drivers from authenticated;
grant select (
  id, full_name, age, address, vehicle_owned, photo_path, user_id, email,
  created_at, updated_at, profile_id, license_number, license_expiry, status, created_by
) on public.drivers to authenticated;

alter table public.drivers drop constraint if exists drivers_created_by_fkey;
alter table public.drivers add constraint drivers_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;

create or replace function public.get_driver_pii(p_driver_id uuid)
returns table (aadhaar_number text, pan_number text)
language sql
stable
security definer
set search_path = public
as $$
  select d.aadhaar_number, d.pan_number
  from public.drivers d
  where d.id = p_driver_id
    and (current_user_role() = 'admin' or (d.profile_id = auth.uid() and current_user_role() is not null));
$$;

-- The signed-in driver's own record, including their own PII.
create or replace function public.get_my_driver_profile()
returns setof public.drivers
language sql
stable
security definer
set search_path = public
as $$
  select d.* from public.drivers d
  where d.profile_id = auth.uid() and current_user_role() is not null
  order by d.created_at
  limit 1;
$$;

-- Returns the caller's driver record id, first linking an unlinked admin-created
-- record with the same email. Linking requires a confirmed email address so an
-- account registered with someone else's email can't take over their record.
create or replace function public.claim_my_driver_record()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_driver_id uuid;
begin
  if v_uid is null or current_user_role() is distinct from 'driver' then
    return null;
  end if;

  select id into v_driver_id from public.drivers where profile_id = v_uid order by created_at limit 1;
  if v_driver_id is not null then
    return v_driver_id;
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if coalesce(v_email, '') = '' then
    return null;
  end if;

  select id into v_driver_id from public.drivers
  where profile_id is null and lower(email) = v_email
  order by created_at limit 1;

  if v_driver_id is not null then
    perform set_config('ct.system_write', 'on', true);
    update public.drivers set profile_id = v_uid, user_id = v_uid where id = v_driver_id;
    -- trips assigned before the account existed become visible to the driver
    update public.trips set driver_user_id = v_uid where driver_id = v_driver_id and driver_user_id is null;
  end if;
  return v_driver_id;
end;
$$;

-- Drivers can't write the drivers table directly (staff-only RLS). This lets a
-- driver complete their own record: it updates the row linked to them, or claims
-- an unlinked admin-created row with their verified email, or creates one.
create or replace function public.save_my_driver_profile(
  p_full_name text,
  p_age integer,
  p_address text,
  p_aadhaar text,
  p_pan text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_driver_id uuid;
begin
  if v_uid is null or current_user_role() is distinct from 'driver' then
    raise exception 'only drivers can edit a driver profile' using errcode = '42501';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full name is required' using errcode = '22023';
  end if;
  if p_age is null or p_age < 18 or p_age > 80 then
    raise exception 'age must be between 18 and 80' using errcode = '22023';
  end if;
  if coalesce(p_aadhaar, '') !~ '^\d{12}$' then
    raise exception 'aadhaar must be 12 digits' using errcode = '22023';
  end if;
  if upper(coalesce(p_pan, '')) !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'invalid PAN format' using errcode = '22023';
  end if;

  select email into v_email from public.profiles where id = v_uid;

  v_driver_id := public.claim_my_driver_record();

  if v_driver_id is null then
    insert into public.drivers (full_name, age, address, aadhaar_number, pan_number, email, user_id, profile_id)
    values (trim(p_full_name), p_age, trim(coalesce(p_address, '')), p_aadhaar, upper(p_pan), v_email, v_uid, v_uid)
    returning id into v_driver_id;
  else
    update public.drivers
    set full_name = trim(p_full_name),
        age = p_age,
        address = trim(coalesce(p_address, '')),
        aadhaar_number = p_aadhaar,
        pan_number = upper(p_pan),
        email = coalesce(email, v_email),
        user_id = v_uid,
        profile_id = v_uid,
        updated_at = now()
    where id = v_driver_id;
  end if;

  update public.profiles set full_name = trim(p_full_name) where id = v_uid;
  return v_driver_id;
end;
$$;

-- Self-service account deletion (required by the App Store). Removes the
-- caller's auth user and profile plus personal live data; fleet history (trips,
-- the employer's driver record) is kept but unlinked from the deleted account.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if current_user_role() = 'admin'
     and (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'the last active admin cannot delete their account' using errcode = '42501';
  end if;

  -- profile FKs null out trips.driver_user_id / user_id; let that pass the driver trip guard
  perform set_config('ct.system_write', 'on', true);

  delete from public.notifications where driver_user_id = v_uid;
  delete from public.driver_locations where user_id = v_uid;
  delete from public.push_tokens where user_id = v_uid;
  update public.drivers set profile_id = null, user_id = null where profile_id = v_uid or user_id = v_uid;
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.claim_my_driver_record() from public, anon;
grant execute on function public.claim_my_driver_record() to authenticated;
revoke execute on function public.get_driver_pii(uuid) from public, anon;
revoke execute on function public.get_my_driver_profile() from public, anon;
revoke execute on function public.save_my_driver_profile(text, integer, text, text, text) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.get_driver_pii(uuid) to authenticated;
grant execute on function public.get_my_driver_profile() to authenticated;
grant execute on function public.save_my_driver_profile(text, integer, text, text, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ── trips: drivers may only progress their own trip ───────────────────────
alter table public.trips add column if not exists updated_at timestamptz not null default now();

-- trips_update_own_driver lets a driver update their own trip row; this trigger
-- narrows that to the lifecycle fields (status, times, odometer, fuel) and to
-- forward status transitions, so a driver can't rewrite quantity, reassign the
-- vehicle, or reopen a completed trip.
create or replace function public.guard_driver_trip_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  allowed text[] := array[
    'status', 'trip_status', 'departure_time', 'arrival_time', 'time',
    'odometer_start', 'odometer_end', 'distance_travelled', 'distance_travelled_km',
    'fuel_filled', 'fuel_filled_liters', 'updated_at'
  ];
begin
  -- ct.system_write is set (transaction-local) only by security definer
  -- functions such as delete_my_account(); it isn't reachable through the API.
  if auth.uid() is null
     or current_user_role() in ('manager', 'admin')
     or current_setting('ct.system_write', true) = 'on' then
    return new;
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'drivers can only update trip status, times, odometer and fuel' using errcode = '42501';
  end if;
  if old.trip_status in ('completed', 'cancelled') then
    raise exception 'trip is already closed' using errcode = '42501';
  end if;
  if new.trip_status is distinct from old.trip_status
     and new.trip_status not in ('active', 'completed') then
    raise exception 'drivers can only start or complete a trip' using errcode = '42501';
  end if;
  if old.trip_status = 'active' and new.trip_status = 'pending' then
    raise exception 'an active trip cannot be moved back to pending' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trips_guard_driver_update on public.trips;
create trigger trips_guard_driver_update
before update on public.trips
for each row execute function public.guard_driver_trip_update();

-- ── fuel_logs: drivers append to their own trips, staff manage ─────────────
drop policy if exists fuel_logs_write on public.fuel_logs;
drop policy if exists fuel_logs_write_staff on public.fuel_logs;
create policy fuel_logs_write_staff on public.fuel_logs for all
  using (current_user_role() in ('manager', 'admin'))
  with check (current_user_role() in ('manager', 'admin'));

drop policy if exists fuel_logs_insert_driver on public.fuel_logs;
create policy fuel_logs_insert_driver on public.fuel_logs for insert
  with check (
    current_user_role() = 'driver'
    and logged_by = auth.uid()
    and trip_id in (
      select id from public.trips
      where driver_id in (select id from public.drivers where profile_id = auth.uid())
        or driver_user_id = auth.uid()
    )
  );

-- ── notifications: recipients may only flip the read flag ───────────────────
alter table public.notifications add column if not exists type text not null default 'general';
alter table public.notifications add column if not exists metadata jsonb not null default '{}'::jsonb;
create index if not exists notifications_recipient_read_idx
  on public.notifications (driver_user_id, read, created_at desc);

revoke update on public.notifications from anon, authenticated;
grant update (read) on public.notifications to authenticated;

-- ── password reset OTPs: brute-force counter ───────────────────────────────
alter table public.password_reset_otps add column if not exists attempts integer not null default 0;

-- Called by the password-otp-verify edge function (service role only). Returns
-- the attempt number, or max+1 if the code was already used up.
create or replace function public.register_otp_attempt(p_id uuid, p_max_attempts integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.password_reset_otps
  set attempts = attempts + 1,
      used = (attempts + 1 >= p_max_attempts)
  where id = p_id and not used
  returning attempts;
$$;

revoke execute on function public.register_otp_attempt(uuid, integer) from public, anon, authenticated;

-- ── audit fixes ────────────────────────────────────────────────────────────
-- TG_OP is upper-case ('UPDATE'); the earlier comparisons against lower-case
-- literals never matched, so before/after values and role changes were never
-- recorded. PII columns are stripped because managers can read audit_logs.
create or replace function public.audit_row_json(r jsonb)
returns jsonb
language sql
immutable
as $$
  select r - 'aadhaar_number' - 'pan_number';
$$;

-- The acting profile, or null when there is none (service role, or a profile
-- being deleted whose FK cascades are still firing triggers).
create or replace function public.audit_actor()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where id = auth.uid();
$$;

create or replace function public.audit_trips_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    public.audit_actor(),
    lower(tg_op),
    tg_table_name::text,
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op in ('UPDATE', 'DELETE') then public.audit_row_json(to_jsonb(old)) end,
    case when tg_op in ('INSERT', 'UPDATE') then public.audit_row_json(to_jsonb(new)) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists drivers_audit on public.drivers;
create trigger drivers_audit
after insert or update or delete on public.drivers
for each row execute function public.audit_trips_change();

create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_value, new_value)
    values (
      public.audit_actor(), 'role_change', 'profile', new.id,
      jsonb_build_object('role', old.role, 'is_active', old.is_active),
      jsonb_build_object('role', new.role, 'is_active', new.is_active)
    );
  end if;
  return new;
end;
$$;

-- ── trip lifecycle: history on create, vehicle odometer on close ───────────
create or replace function public.log_trip_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.trip_status_history (trip_id, old_status, new_status, changed_by)
    values (new.id, null, coalesce(new.trip_status, 'pending'), public.audit_actor());
  elsif new.trip_status is distinct from old.trip_status and new.trip_status is not null then
    insert into public.trip_status_history (trip_id, old_status, new_status, changed_by)
    values (new.id, old.trip_status, new.trip_status, public.audit_actor());
  end if;
  return new;
end;
$$;

drop trigger if exists trips_log_status_insert on public.trips;
create trigger trips_log_status_insert
after insert on public.trips
for each row execute function public.log_trip_status_change();

-- vehicles.odometer_reading is "last known reading, updated on trip close"
-- (LLD §4.1). Security definer because drivers close trips but can't write vehicles.
create or replace function public.sync_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vehicle_id is not null and new.odometer_end is not null
     and new.odometer_end is distinct from old.odometer_end then
    update public.vehicles
    set odometer_reading = greatest(coalesce(odometer_reading, 0), new.odometer_end),
        updated_at = now()
    where id = new.vehicle_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_sync_vehicle_odometer on public.trips;
create trigger trips_sync_vehicle_odometer
after update on public.trips
for each row execute function public.sync_vehicle_odometer();

-- ── updated_at maintenance ──────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists drivers_touch_updated_at on public.drivers;
create trigger drivers_touch_updated_at before update on public.drivers
for each row execute function public.touch_updated_at();
drop trigger if exists vehicles_touch_updated_at on public.vehicles;
create trigger vehicles_touch_updated_at before update on public.vehicles
for each row execute function public.touch_updated_at();
drop trigger if exists trips_touch_updated_at on public.trips;
create trigger trips_touch_updated_at before update on public.trips
for each row execute function public.touch_updated_at();

-- ============================================================================
-- Compliance documents (LLD §4.1 documents, HLD §3.6 storage)
-- ============================================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('driver', 'vehicle')),
  entity_id uuid not null,
  doc_type text not null check (doc_type in ('license', 'aadhaar', 'pan', 'insurance', 'permit', 'puc', 'rc', 'fitness', 'other')),
  doc_path text,
  expiry_date date,
  verified boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists documents_entity_idx on public.documents (entity_type, entity_id);
create index if not exists documents_expiry_idx on public.documents (expiry_date);

alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'manager' and doc_type not in ('aadhaar', 'pan'))
    or (
      entity_type = 'driver'
      and entity_id in (select id from public.drivers where profile_id = auth.uid())
    )
  );

drop policy if exists documents_write_staff on public.documents;
create policy documents_write_staff on public.documents for all
  using (current_user_role() = 'admin' or (current_user_role() = 'manager' and doc_type not in ('aadhaar', 'pan')))
  with check (current_user_role() = 'admin' or (current_user_role() = 'manager' and doc_type not in ('aadhaar', 'pan')));

-- ── Storage buckets (private; served through short-lived signed URLs) ──────
-- driver-photos/<driver_id>/<file>     documents/<entity_type>/<entity_id>/<doc_type>/<file>
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('driver-photos', 'driver-photos', false), ('documents', 'documents', false)
  on conflict (id) do update set public = false;

  execute 'drop policy if exists ct_driver_photos_select on storage.objects';
  execute $p$
    create policy ct_driver_photos_select on storage.objects for select to authenticated
    using (
      bucket_id = 'driver-photos'
      and (
        public.current_user_role() in ('manager', 'admin')
        or (storage.foldername(name))[1] in (
          select id::text from public.drivers where profile_id = auth.uid()
        )
      )
    )
  $p$;

  execute 'drop policy if exists ct_driver_photos_write on storage.objects';
  execute $p$
    create policy ct_driver_photos_write on storage.objects for all to authenticated
    using (bucket_id = 'driver-photos' and public.current_user_role() in ('manager', 'admin'))
    with check (bucket_id = 'driver-photos' and public.current_user_role() in ('manager', 'admin'))
  $p$;

  execute 'drop policy if exists ct_documents_select on storage.objects';
  execute $p$
    create policy ct_documents_select on storage.objects for select to authenticated
    using (
      bucket_id = 'documents'
      and (
        public.current_user_role() = 'admin'
        or (public.current_user_role() = 'manager' and (storage.foldername(name))[3] not in ('aadhaar', 'pan'))
        or (
          (storage.foldername(name))[1] = 'driver'
          and (storage.foldername(name))[2] in (
            select id::text from public.drivers where profile_id = auth.uid()
          )
        )
      )
    )
  $p$;

  execute 'drop policy if exists ct_documents_write on storage.objects';
  execute $p$
    create policy ct_documents_write on storage.objects for all to authenticated
    using (
      bucket_id = 'documents'
      and (
        public.current_user_role() = 'admin'
        or (public.current_user_role() = 'manager' and (storage.foldername(name))[3] not in ('aadhaar', 'pan'))
      )
    )
    with check (
      bucket_id = 'documents'
      and (
        public.current_user_role() = 'admin'
        or (public.current_user_role() = 'manager' and (storage.foldername(name))[3] not in ('aadhaar', 'pan'))
      )
    )
  $p$;
end $$;

-- ============================================================================
-- Fleet health: expiry + maintenance alerts (HLD §4.5 Fleet Health, P0/P1)
-- ============================================================================
-- Security invoker: RLS decides what each caller sees (managers never see
-- Aadhaar/PAN documents). Items already expired are included (days_left < 0).
create or replace function public.get_compliance_alerts(p_within_days integer default 30)
returns table (
  kind text,
  entity_type text,
  entity_id uuid,
  label text,
  item text,
  due_date date,
  days_left integer,
  due_odometer numeric,
  current_odometer numeric
)
language sql
stable
set search_path = public
as $$
  with horizon as (select current_date + p_within_days as until)
  select 'vehicle_doc', 'vehicle', v.id, v.registration_number, x.item, x.due, x.due - current_date, null::numeric, null::numeric
  from public.vehicles v
  cross join lateral (values ('insurance', v.insurance_expiry), ('permit', v.permit_expiry), ('puc', v.puc_expiry)) as x(item, due)
  where v.status <> 'retired' and x.due is not null and x.due <= (select until from horizon)
  union all
  select 'driver_license', 'driver', d.id, d.full_name, 'license', d.license_expiry, d.license_expiry - current_date, null, null
  from public.drivers d
  where d.status = 'active' and d.license_expiry is not null and d.license_expiry <= (select until from horizon)
  union all
  select 'document', doc.entity_type, doc.entity_id,
         coalesce(v.registration_number, d.full_name, doc.entity_id::text), doc.doc_type,
         doc.expiry_date, doc.expiry_date - current_date, null, null
  from public.documents doc
  left join public.vehicles v on doc.entity_type = 'vehicle' and v.id = doc.entity_id
  left join public.drivers d on doc.entity_type = 'driver' and d.id = doc.entity_id
  where doc.expiry_date is not null and doc.expiry_date <= (select until from horizon)
  union all
  -- latest maintenance entry per vehicle decides when its next service is due
  select 'maintenance', 'vehicle', v.id, v.registration_number, m.maintenance_type,
         m.next_service_due_date, m.next_service_due_date - current_date,
         m.next_service_due_odometer, v.odometer_reading
  from public.vehicles v
  join lateral (
    select * from public.vehicle_maintenance vm
    where vm.vehicle_id = v.id
    order by vm.service_date desc, vm.created_at desc
    limit 1
  ) m on true
  where v.status <> 'retired'
    and (
      (m.next_service_due_date is not null and m.next_service_due_date <= (select until from horizon))
      or (m.next_service_due_odometer is not null and v.odometer_reading >= m.next_service_due_odometer - 500)
    )
  order by 7 nulls last;
$$;

revoke execute on function public.get_compliance_alerts(integer) from public, anon;
grant execute on function public.get_compliance_alerts(integer) to authenticated;

create table if not exists public.system_job_runs (
  job_name text primary key,
  last_run_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);

alter table public.system_job_runs enable row level security;
drop policy if exists system_job_runs_select_admin on public.system_job_runs;
create policy system_job_runs_select_admin on public.system_job_runs for select
  using (current_user_role() = 'admin');

-- Daily job: notifies each driver whose own licence expires within 30 days
-- (staff see every alert on the Fleet Health screen instead). De-duplicated to
-- one notification per driver per licence date per week.
create or replace function public.scan_compliance_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is not null and current_user_role() is distinct from 'admin' then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with due as (
    select d.profile_id as recipient, d.license_expiry,
           'license:' || d.id || ':' || d.license_expiry as dedupe_key
    from public.drivers d
    where d.profile_id is not null and d.status = 'active'
      and d.license_expiry is not null and d.license_expiry <= current_date + 30
  ), inserted as (
    insert into public.notifications (driver_user_id, title, body, type, metadata)
    select recipient,
           case when license_expiry < current_date then 'Driving licence expired' else 'Driving licence expiring soon' end,
           'Your driving licence ' ||
             case when license_expiry < current_date then 'expired on ' else 'expires on ' end ||
             to_char(license_expiry, 'DD Mon YYYY') || '. Please renew it and update your documents.',
           'doc_expiry',
           jsonb_build_object('key', dedupe_key)
    from due
    where not exists (
      select 1 from public.notifications n
      where n.driver_user_id = due.recipient
        and n.metadata->>'key' = due.dedupe_key
        and n.created_at > now() - interval '7 days'
    )
    returning 1
  )
  select count(*) into v_count from inserted;

  insert into public.system_job_runs (job_name, last_run_at, detail)
  values ('compliance_scan', now(), jsonb_build_object('notifications', v_count))
  on conflict (job_name) do update set last_run_at = excluded.last_run_at, detail = excluded.detail;

  return v_count;
end;
$$;

revoke execute on function public.scan_compliance_alerts() from public, anon;
grant execute on function public.scan_compliance_alerts() to authenticated;

-- ============================================================================
-- Analytics rollup (HLD §3.5b, §6.2) — trip_daily_stats
-- ============================================================================
-- Days are bucketed in the fleet's local timezone so "today" matches the app.
create or replace function public.fleet_timezone()
returns text
language sql
immutable
as $$ select 'Asia/Kolkata'::text $$;

-- Trips without a driver/vehicle are rolled up under this sentinel id because
-- primary-key columns can't be null.
create or replace function public.no_entity_id()
returns uuid
language sql
immutable
as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

create table if not exists public.trip_daily_stats (
  stat_date date not null,
  driver_id uuid not null,
  vehicle_id uuid not null,
  trip_count integer not null default 0,
  completed_count integer not null default 0,
  distance_km numeric not null default 0,
  fuel_liters numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (stat_date, driver_id, vehicle_id)
);

create index if not exists trip_daily_stats_vehicle_idx on public.trip_daily_stats (vehicle_id, stat_date);
create index if not exists trip_daily_stats_driver_idx on public.trip_daily_stats (driver_id, stat_date);

alter table public.trip_daily_stats enable row level security;
drop policy if exists trip_daily_stats_select_staff on public.trip_daily_stats;
create policy trip_daily_stats_select_staff on public.trip_daily_stats for select
  using (current_user_role() in ('manager', 'admin'));

-- Days whose trips changed since they were last rolled up. Analytics reads
-- these days live from trips, so results are exact even before the nightly job.
create table if not exists public.trip_stats_dirty_dates (
  stat_date date primary key
);
alter table public.trip_stats_dirty_dates enable row level security;
drop policy if exists trip_stats_dirty_dates_select_staff on public.trip_stats_dirty_dates;
create policy trip_stats_dirty_dates_select_staff on public.trip_stats_dirty_dates for select
  using (current_user_role() in ('manager', 'admin'));

create or replace function public.mark_trip_stats_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.departure_time is not null then
    insert into public.trip_stats_dirty_dates values ((old.departure_time at time zone public.fleet_timezone())::date)
    on conflict do nothing;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.departure_time is not null then
    insert into public.trip_stats_dirty_dates values ((new.departure_time at time zone public.fleet_timezone())::date)
    on conflict do nothing;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trips_mark_stats_dirty on public.trips;
create trigger trips_mark_stats_dirty
after insert or update or delete on public.trips
for each row execute function public.mark_trip_stats_dirty();

create or replace function public.refresh_trip_daily_stats(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text := public.fleet_timezone();
  v_rows integer;
begin
  if auth.uid() is not null and current_user_role() is distinct from 'admin' then
    raise exception 'admin only' using errcode = '42501';
  end if;

  delete from public.trip_daily_stats where stat_date between p_from and p_to;

  insert into public.trip_daily_stats (stat_date, driver_id, vehicle_id, trip_count, completed_count, distance_km, fuel_liters)
  select (t.departure_time at time zone tz)::date,
         coalesce(t.driver_id, public.no_entity_id()),
         coalesce(t.vehicle_id, public.no_entity_id()),
         count(*),
         count(*) filter (where t.trip_status = 'completed' or t.arrival_time is not null),
         coalesce(sum(t.distance_travelled_km), 0),
         coalesce(sum(t.fuel_filled_liters), 0)
  from public.trips t
  where t.departure_time >= (p_from::timestamp at time zone tz)
    and t.departure_time < ((p_to + 1)::timestamp at time zone tz)
    and t.trip_status is distinct from 'cancelled'
  group by 1, 2, 3;
  get diagnostics v_rows = row_count;

  delete from public.trip_stats_dirty_dates where stat_date between p_from and p_to;
  return v_rows;
end;
$$;

-- Nightly job: re-rolls every changed day before today.
create or replace function public.refresh_dirty_trip_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone public.fleet_timezone())::date;
  d date;
  v_days integer := 0;
begin
  if auth.uid() is not null and current_user_role() is distinct from 'admin' then
    raise exception 'admin only' using errcode = '42501';
  end if;

  for d in select stat_date from public.trip_stats_dirty_dates where stat_date < today order by stat_date loop
    perform public.refresh_trip_daily_stats(d, d);
    v_days := v_days + 1;
  end loop;

  insert into public.system_job_runs (job_name, last_run_at, detail)
  values ('trip_stats_rollup', now(), jsonb_build_object('days_refreshed', v_days))
  on conflict (job_name) do update set last_run_at = excluded.last_run_at, detail = excluded.detail;

  return v_days;
end;
$$;

revoke execute on function public.refresh_trip_daily_stats(date, date) from public, anon;
revoke execute on function public.refresh_dirty_trip_stats() from public, anon;
grant execute on function public.refresh_trip_daily_stats(date, date) to authenticated;
grant execute on function public.refresh_dirty_trip_stats() to authenticated;

-- Date-range analytics (LLD §4.5): ranges up to 35 days aggregate trips
-- directly; longer ranges read rolled-up days from trip_daily_stats and only
-- today + not-yet-rolled-up days from trips. Cancelled trips are excluded.
-- Security invoker, so drivers only ever aggregate their own trips.
create or replace function public.get_trip_analytics(
  p_start timestamptz,
  p_end timestamptz,
  p_driver_id uuid default null,
  p_vehicle_id uuid default null
)
returns table (
  vehicle_id uuid,
  driver_id uuid,
  trip_count bigint,
  completed_count bigint,
  distance_km numeric,
  fuel_liters numeric,
  source text
)
language plpgsql
stable
set search_path = public
as $$
declare
  tz text := public.fleet_timezone();
  today date := (now() at time zone tz)::date;
begin
  if current_user_role() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if current_user_role() = 'driver' or p_end - p_start <= interval '35 days' then
    return query
      select t.vehicle_id, t.driver_id, count(*)::bigint,
             (count(*) filter (where t.trip_status = 'completed' or t.arrival_time is not null))::bigint,
             coalesce(sum(t.distance_travelled_km), 0), coalesce(sum(t.fuel_filled_liters), 0), 'trips'::text
      from public.trips t
      where t.departure_time between p_start and p_end
        and t.trip_status is distinct from 'cancelled'
        and (p_driver_id is null or t.driver_id = p_driver_id)
        and (p_vehicle_id is null or t.vehicle_id = p_vehicle_id)
      group by t.vehicle_id, t.driver_id;
    return;
  end if;

  return query
    with rolled as (
      select nullif(s.vehicle_id, public.no_entity_id()) as v,
             nullif(s.driver_id, public.no_entity_id()) as d,
             s.trip_count::bigint as tc, s.completed_count::bigint as cc,
             s.distance_km as dk, s.fuel_liters as fl
      from public.trip_daily_stats s
      where s.stat_date >= (p_start at time zone tz)::date
        and s.stat_date <= (p_end at time zone tz)::date
        and s.stat_date < today
        and s.stat_date not in (select stat_date from public.trip_stats_dirty_dates)
        and (p_driver_id is null or s.driver_id = p_driver_id)
        and (p_vehicle_id is null or s.vehicle_id = p_vehicle_id)
    ), live as (
      select t.vehicle_id as v, t.driver_id as d, 1::bigint as tc,
             (case when t.trip_status = 'completed' or t.arrival_time is not null then 1 else 0 end)::bigint as cc,
             coalesce(t.distance_travelled_km, 0) as dk, coalesce(t.fuel_filled_liters, 0) as fl
      from public.trips t
      where t.departure_time between p_start and p_end
        and t.trip_status is distinct from 'cancelled'
        and (
          (t.departure_time at time zone tz)::date >= today
          or (t.departure_time at time zone tz)::date in (select stat_date from public.trip_stats_dirty_dates)
        )
        and (p_driver_id is null or t.driver_id = p_driver_id)
        and (p_vehicle_id is null or t.vehicle_id = p_vehicle_id)
    )
    select c.v, c.d, sum(c.tc)::bigint, sum(c.cc)::bigint, sum(c.dk), sum(c.fl), 'rollup'::text
    from (select * from rolled union all select * from live) c
    group by c.v, c.d;
end;
$$;

revoke execute on function public.get_trip_analytics(timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.get_trip_analytics(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- Backfill the rollup once for all existing history before today.
do $$
declare
  v_min date;
  v_today date := (now() at time zone public.fleet_timezone())::date;
begin
  if not exists (select 1 from public.trip_daily_stats) then
    select min((departure_time at time zone public.fleet_timezone())::date) into v_min from public.trips;
    if v_min is not null and v_min < v_today then
      perform public.refresh_trip_daily_stats(v_min, v_today - 1);
    end if;
  end if;
end $$;

-- ── Scheduled jobs (pg_cron). Skipped quietly where pg_cron isn't available;
-- enable it under Database → Extensions in Supabase and re-run this file.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available (%); schedule refresh_dirty_trip_stats() and scan_compliance_alerts() manually', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('ct_trip_stats_rollup', 'ct_compliance_scan');
    perform cron.schedule('ct_trip_stats_rollup', '30 20 * * *', 'select public.refresh_dirty_trip_stats()'); -- 02:00 IST
    perform cron.schedule('ct_compliance_scan', '0 3 * * *', 'select public.scan_compliance_alerts()');         -- 08:30 IST
  end if;
end $$;
