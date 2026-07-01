**CARGO TRACKER**

Fleet, Trip & Driver Management Platform

_High-Level Design (HLD) · Low-Level Design (LLD) · Data Model · Scalability Blueprint_

Target scale: 2,000 registered users · 1,000 concurrent sessions

Backend: Supabase (Postgres, Auth, Storage, Realtime, Edge Functions)

Document version 1.0 · July 1, 2026

# Table of Contents

1\. Executive Summary 3

2\. Scope & Feature Requirements 3

3\. High-Level Design (HLD) 4

4\. Low-Level Design (LLD) 8

5\. Caching & Offline Strategy 14

6\. Analytics & Reporting Design 14

7\. Observability & Monitoring 15

8\. Migration Plan 15

9\. Phased Roadmap 16

Appendix A - Core DDL 17

# 1\. Executive Summary

Cargo Tracker is a role-based fleet operations app for Admins, Managers, and Drivers, built on React Native/Expo with a Supabase (Postgres) backend. This document extends the existing architecture reference into a formal design package: it captures the minimum requirements the product owner has specified, proposes the additional capabilities a production fleet system needs at scale, and defines the High-Level Design (HLD), Low-Level Design (LLD), revised data model, security model, and scaling plan needed to support 2,000 registered users with 1,000 concurrent sessions.

The existing schema (users, drivers, trips, plants, driverLocations, notifications) is retained conceptually but restructured relationally: free-text fields such as truck, driverName, and fromPlant/toPlant are converted to foreign keys against new vehicles and plants tables so that distance, fuel, and utilization can be aggregated reliably per truck and per driver. New tables are introduced for fuel logs, vehicle maintenance, document/compliance expiry, and audit logging.

**Why this matters**

Free-text truck/driver/plant fields make aggregate reporting (distance travelled, fuel consumed, per-truck efficiency) unreliable because the same truck can be typed inconsistently across trips. Converting these to normalized foreign keys is the single highest-leverage schema change in this document.

# 2\. Scope & Feature Requirements

## 2.1 Core Requirements (as specified)

Three roles: Admin, Manager, Driver.

- Admin can add driver details, which provisions a new driver user account with the specified fields.
- Admin can add trips using the trip schema.
- Admin can add plants.
- Admin can track driver trips over a date range (today, this week, this month, custom range), viewing distance travelled and fuel consumed per truck.

## 2.2 Recommended Additional Features

The following are proposed as a senior-level extension of the bare-minimum spec. They are grouped by priority so they can be phased (see Section 9, Roadmap).

### P0 - Needed for a trustworthy production launch

- Vehicle (truck) master data - registration number, type, capacity, odometer, insurance/PUC/permit expiry - replacing the free-text truck field.
- Fuel logs as a first-class entity (not just a single field per trip), so a truck can be refuelled mid-route and consumption can be reconciled against distance.
- Odometer start/end capture per trip to cross-check the reported distance and catch data-entry errors.
- Row Level Security (RLS) enforced in Postgres so role checks are not just a client-side UI concern.
- Trip status normalization via a Postgres enum (pending, active, completed, cancelled) instead of free-text status strings.
- Document/compliance tracking for driver licenses and vehicle insurance/permit/PUC with expiry alerts.
- Audit log for trip edits, status changes, and role changes.

### P1 - Strongly recommended within the first quarter

- Push notifications (Expo Push via Edge Function trigger) instead of in-app-only notification rows.
- Driver performance dashboard: on-time %, average fuel efficiency (km/l), trip completion rate, distance leaderboard.
- Vehicle maintenance & service scheduling with due-date/odometer-based alerts.
- Offline write queue so drivers in low-connectivity areas can still start/end trips and sync later.
- Exportable analytics (CSV/PDF) for management reporting.

### P2 - Scale / nice-to-have

- Multi-tenant readiness (organization_id on core tables) in case the platform is sold to more than one fleet operator.
- In-trip comments/dispute thread for resolving discrepancies between planned and actual quantity/distance.
- Driver incentive/scorecard gamification.
- Weighbridge / gate-pass integration hooks for plants that already run digital weighbridges.

# 3\. High-Level Design (HLD)

## 3.1 Technology Stack

| **Layer**                 | **Choice**                                          | **Notes**                                                                                   |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Mobile app                | React Native + Expo SDK 54, TypeScript              | Existing choice, retained                                                                   |
| Navigation                | React Navigation (native stack + custom tabs)       | Existing choice, retained                                                                   |
| Backend platform          | Supabase (Postgres 15+)                             | Replaces the originally planned Firebase backend                                            |
| Auth                      | Supabase Auth (email/password, JWT)                 | Custom claim carries role for RLS + client gating                                           |
| Realtime                  | Supabase Realtime (Postgres Changes)                | Used for trip, notification, and live driver-location updates                               |
| Storage                   | Supabase Storage (CDN-backed buckets)               | Replaces base64 data-URL photo storage                                                      |
| Server logic              | Supabase Edge Functions (Deno)                      | Push notifications, expiry-check cron jobs, aggregate rollups                               |
| Scheduled jobs            | pg_cron (Postgres) + Edge Function triggers         | Nightly analytics rollups, expiry reminder scan                                             |
| Local persistence / cache | AsyncStorage + TanStack Query                       | TanStack Query replaces hand-rolled TTL cache for consistency and background refetch        |
| Maps & location           | react-native-maps, expo-location                    | Foreground live map only - no background tracking, route history, or geofencing planned     |
| Crash/perf monitoring     | Sentry (React Native SDK)                           | New addition - see Section 7                                                                |

## 3.2 System Component Diagram

+---------------------------------------------------------------+

| React Native / Expo App |

| Driver UI | Manager/Admin UI | Shared components + theme |

+------------------------------+----------------------------------+

| TanStack Query (cache) + AsyncStorage (offline) |

v

+---------------------------------------------------------------+

| Service Layer (TS) |

| tripService | driverService | vehicleService | fuelService |

| plantService | userService | locationService | notifyService |

+------------------------------+----------------------------------+

| supabase-js (PostgREST + Realtime + Storage) |

v

+---------------------------------------------------------------+

| Supabase Platform |

| Postgres (RLS enforced) | Auth | Storage | Realtime | Edge Fns |

| Supavisor connection pooler | pg_cron scheduled jobs |

+---------------------------------------------------------------+

| |

v v

Expo Push Notification Service Sentry (crash/perf)

## 3.3 Data Flow Overview

### Trip lifecycle

- Manager/Admin creates a trip, selecting driver, vehicle, and from/to plant via foreign-key dropdowns (status = pending).
- A row is inserted in trips; a database trigger inserts a row into trip_status_history and enqueues a notification.
- An Edge Function (or Realtime-triggered client call) sends an Expo push notification to the assigned driver.
- Driver starts the trip: status -> active, departure_time set, odometer_start captured, live location tracking begins.
- Location pings upsert the driver's latest position into driver_locations; other roles watch this table via Realtime Postgres Changes for the live map (no history/breadcrumbs are persisted).
- Driver ends the trip: status -> completed, arrival_time set, odometer_end captured, distance_travelled_km computed server-side as odometer_end - odometer_start (with a manual-override flag if the driver disputes it).
- Fuel logs recorded either inline at trip close or independently mid-trip; nightly rollup job aggregates distance/fuel into trip_daily_stats for fast analytics queries.

### Analytics query path

- Analytics screen requests a date range (today/week/month/custom) plus optional driver/vehicle filter.
- For ranges within the last 35 days, the query reads directly from trips (small enough to scan with the recommended indexes).
- For longer ranges, the query reads from the precomputed trip_daily_stats materialized rollup, avoiding a full scan of the trips table as data grows.

## 3.4 Non-Functional Requirements

| **Category**                     | **Target**                                                      |
| -------------------------------- | --------------------------------------------------------------- |
| Registered users                 | 2,000                                                           |
| Concurrent active sessions       | 1,000                                                           |
| API p95 latency (read)           | < 400 ms for indexed queries                                    |
| API p95 latency (write)          | < 600 ms for trip/fuel writes                                   |
| Availability                     | 99.5% (Supabase Pro SLA-backed tier)                            |
| Data retention                   | Trip data retained 24 months online, then archived              |

## 3.5 Scalability Strategy for 2,000 Users / 1,000 Concurrent

At this scale the dominant risk is not raw user count but unbounded scans on the trips table as history accumulates. The strategy below addresses that.

### a) Connection & compute

- Use Supabase's pooled connection string (Supavisor, transaction mode) for all mobile-originated PostgREST calls; reserve the direct/session connection only for Edge Functions or migrations that need it.
- Run on a Supabase Pro/Team compute add-on sized for the concurrency target; monitor pool saturation and upgrade compute before it becomes the bottleneck rather than after.
- Keep queries short and indexed - PostgREST + a pooler amplifies the cost of any query that does a sequential scan under load.

### b) Read scaling for analytics

- Add composite indexes: trips(driver_id, departure_time), trips(vehicle_id, departure_time), trips(status), trips(from_plant_id), trips(to_plant_id).
- Maintain a trip_daily_stats rollup table (per driver, per vehicle, per day: trip_count, distance_km, fuel_liters) refreshed by a nightly pg_cron job; the Analytics screen reads from this table for 'this month'/'custom range' queries instead of aggregating raw trips rows on every request.
- Partition the trips table by month once history grows past a few hundred thousand rows, to keep index sizes and vacuum costs manageable.
- If read load on analytics becomes heavy relative to writes, add a Supabase read replica (available on higher tiers) and route analytics reads there.

### c) Caching & payload size

- TanStack Query on the client with sensible staleTime per resource (trips: short, drivers/vehicles: medium, plants: long) - mirrors the existing AsyncStorage TTL design but adds background refetch and request de-duplication under concurrent screens.
- Compress and resize driver/vehicle photos client-side (expo-image-manipulator) before upload to Supabase Storage; serve through the Storage CDN rather than embedding base64 in Postgres rows.

### d) Rate limiting & abuse protection

- Supabase's built-in PostgREST rate limiting plus Edge Function-level checks for write-heavy endpoints (trip creation, fuel logs).

### e) Load testing before go-live

- Simulate 1,000 concurrent sessions with k6 or Artillery against PostgREST endpoints (trip list, analytics, trip create).
- Validate Supavisor pool exhaustion behavior before committing to the 1,000-concurrent target.

## 3.6 Security Architecture

- Authentication: Supabase Auth issues a JWT containing the user's id; role is looked up server-side (not trusted from the client) via a profiles table and a SECURITY DEFINER helper function used inside RLS policies.
- Authorization: Postgres Row Level Security is the source of truth for every table - the app's client-side role gating (tab visibility) is a UX convenience only, not a security boundary.
- PII handling: Aadhaar and PAN numbers are masked in the UI (e.g. last 4 digits) and, at minimum, access-restricted via RLS to Admin only; consider column-level encryption (pgsodium) if regulatory requirements demand it.
- Storage: Supabase Storage buckets use per-role policies - driver photo buckets are readable by Admin/Manager and by the owning driver only, not publicly listable.
- Secrets: no client ever holds a service-role key; privileged operations (e.g. creating an auth user for a new driver) run inside an Edge Function invoked with the caller's JWT, which itself checks the caller is an Admin before using the service role internally.
- Audit trail: audit_logs captures actor, action, entity, before/after values for trips, role changes, and driver record edits.

# 4\. Low-Level Design (LLD)

## 4.1 Revised Data Model

Design notes: (1) profiles replaces the original users table and is keyed 1:1 to auth.users so RLS can reference auth.uid() directly. (2) drivers keeps its own row separate from profiles because a driver record can exist before the person has registered/logged in (Admin-created), matching the current app's linking-by-email flow. (3) vehicles is new - trips reference vehicle_id instead of storing the truck registration as text. (4) All monetary/decimal fields use numeric, not text, so aggregation is possible without casting.

### profiles

| **Column** | **Type**                                   | **Notes**                                             |
| ---------- | ------------------------------------------ | ----------------------------------------------------- |
| id         | uuid, PK, FK -> auth.users(id)             | 1:1 with Supabase Auth user                           |
| email      | text, unique                               |                                                       |
| full_name  | text                                       |                                                       |
| phone      | text                                       | optional                                              |
| role       | user_role enum('admin','manager','driver') | default 'driver'                                      |
| is_active  | boolean                                    | default true; used to disable access without deleting |
| created_at | timestamptz                                | default now()                                         |
| updated_at | timestamptz                                | maintained by trigger                                 |

### drivers

| **Column**              | **Type**                                            | **Notes**                                 |
| ----------------------- | --------------------------------------------------- | ----------------------------------------- |
| id                      | uuid, PK                                            |                                           |
| profile_id              | uuid, FK -> profiles(id), nullable                  | linked once the driver registers/logs in  |
| full_name               | text, not null                                      |                                           |
| email                   | text                                                | for later linking to profile              |
| phone                   | text                                                |                                           |
| age                     | smallint                                            | validated range in app + check constraint |
| address                 | text                                                |                                           |
| aadhaar_number          | text                                                | masked in UI; RLS restricted              |
| pan_number              | text                                                | masked in UI; RLS restricted              |
| license_number          | text                                                |                                           |
| license_expiry          | date                                                | drives the P0 expiry-alert feature        |
| photo_path              | text                                                | Supabase Storage object path, not base64  |
| status                  | driver_status enum('active','inactive','suspended') | default 'active'                          |
| created_by              | uuid, FK -> profiles(id)                            |                                           |
| created_at / updated_at | timestamptz                                         |                                           |

### vehicles (new)

| **Column**              | **Type**                                                 | **Notes**                                 |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------- |
| id                      | uuid, PK                                                 |                                           |
| registration_number     | text, unique, not null                                   | e.g. HR-55-AB-1234                        |
| type                    | text                                                     | truck / trailer / tanker etc.             |
| capacity_tons           | numeric                                                  |                                           |
| fuel_type               | text                                                     | diesel / CNG / electric                   |
| odometer_reading        | numeric                                                  | last known reading, updated on trip close |
| insurance_expiry        | date                                                     |                                           |
| permit_expiry           | date                                                     |                                           |
| puc_expiry              | date                                                     | pollution certificate                     |
| status                  | vehicle_status enum('active','in_maintenance','retired') |                                           |
| created_at / updated_at | timestamptz                                              |                                           |

### plants

| **Column**                     | **Type**       | **Notes**                       |
| ------------------------------ | -------------- | ------------------------------- |
| id                             | uuid, PK       |                                 |
| name                           | text, not null |                                 |
| code                           | text, unique   | short code for dropdowns/search |
| address                        | text           |                                 |
| latitude / longitude           | numeric        | plant coordinates for the live map |
| contact_person / contact_phone | text           |                                 |
| is_active                      | boolean        | default true                    |
| created_at                     | timestamptz    |                                 |

### trips

| **Column**                    | **Type**                                                     | **Notes**                                          |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| id                            | uuid, PK                                                     |                                                    |
| trip_number                   | text, unique                                                 | human-readable, generated by sequence/trigger      |
| vehicle_id                    | uuid, FK -> vehicles(id)                                     |                                                    |
| driver_id                     | uuid, FK -> drivers(id)                                      |                                                    |
| bid_no / lr_number            | text                                                         |                                                    |
| company_name                  | text                                                         |                                                    |
| item_type                     | text                                                         |                                                    |
| quantity                      | numeric                                                      | was text; now numeric for aggregation              |
| quantity_unit                 | text                                                         | e.g. MT, KL                                        |
| from_plant_id / to_plant_id   | uuid, FK -> plants(id)                                       |                                                    |
| odometer_start / odometer_end | numeric                                                      |                                                    |
| distance_travelled_km         | numeric                                                      | computed at trip close; overridable with a flag    |
| fuel_filled_liters            | numeric                                                      | quick-entry field; detailed logs live in fuel_logs |
| fuel_cost                     | numeric                                                      |                                                    |
| status                        | trip_status enum('pending','active','completed','cancelled') | was free text                                      |
| departure_time / arrival_time | timestamptz                                                  |                                                    |
| remarks                       | text                                                         |                                                    |
| created_by                    | uuid, FK -> profiles(id)                                     |                                                    |
| created_at / updated_at       | timestamptz                                                  |                                                    |

### fuel_logs (new)

| **Column**         | **Type**                           | **Notes**                              |
| ------------------ | ---------------------------------- | -------------------------------------- |
| id                 | uuid, PK                           |                                        |
| trip_id            | uuid, FK -> trips(id), nullable    | null for non-trip refuels              |
| vehicle_id         | uuid, FK -> vehicles(id), not null |                                        |
| liters             | numeric, not null                  |                                        |
| cost               | numeric                            |                                        |
| odometer_reading   | numeric                            | enables km/l calculation between fills |
| fuel_station       | text                               |                                        |
| receipt_photo_path | text                               | Storage object path                    |
| logged_by          | uuid, FK -> profiles(id)           |                                        |
| logged_at          | timestamptz                        | default now()                          |

### vehicle_maintenance (new)

| **Column**                | **Type**                 | **Notes**                            |
| ------------------------- | ------------------------ | ------------------------------------ |
| id                        | uuid, PK                 |                                      |
| vehicle_id                | uuid, FK -> vehicles(id) |                                      |
| maintenance_type          | text                     | service / repair / tyre / inspection |
| description               | text                     |                                      |
| cost                      | numeric                  |                                      |
| odometer_at_service       | numeric                  |                                      |
| service_date              | date                     |                                      |
| next_service_due_date     | date                     |                                      |
| next_service_due_odometer | numeric                  |                                      |
| vendor                    | text                     |                                      |
| created_by                | uuid, FK -> profiles(id) |                                      |

### driver_locations

| **Column**           | **Type**                        | **Notes**                        |
| -------------------- | ------------------------------- | -------------------------------- |
| user_id              | uuid, PK, FK -> profiles(id)    | one live row per driver (upsert) |
| trip_id              | uuid, FK -> trips(id), nullable |                                  |
| latitude / longitude | numeric, not null               |                                  |
| speed_kmh / heading  | numeric                         | optional, improves map UX        |
| is_tracking          | boolean                         | default false                    |
| updated_at           | timestamptz                     | default now()                    |

### notifications

| **Column**   | **Type**                 | **Notes**                                                    |
| ------------ | ------------------------ | ------------------------------------------------------------ |
| id           | uuid, PK                 |                                                              |
| recipient_id | uuid, FK -> profiles(id) | renamed from driverUserId; can target manager/admin too      |
| type         | text                     | trip_assigned / doc_expiry / maintenance_due / status_change |
| title / body | text                     |                                                              |
| metadata     | jsonb                    | e.g. { trip_id }                                             |
| is_read      | boolean                  | default false                                                |
| created_at   | timestamptz              |                                                              |

### documents (new - compliance tracking)

| **Column**  | **Type**    | **Notes**                                          |
| ----------- | ----------- | -------------------------------------------------- |
| id          | uuid, PK    |                                                    |
| entity_type | text        | 'driver' or 'vehicle'                              |
| entity_id   | uuid        | polymorphic reference                              |
| doc_type    | text        | license / aadhaar / pan / insurance / permit / puc |
| doc_path    | text        | Storage object path                                |
| expiry_date | date        |                                                    |
| verified    | boolean     | default false                                      |
| created_at  | timestamptz |                                                    |

### trip_status_history (new - audit)

| **Column**              | **Type**                 | **Notes**     |
| ----------------------- | ------------------------ | ------------- |
| id                      | bigint, PK, identity     |               |
| trip_id                 | uuid, FK -> trips(id)    |               |
| old_status / new_status | trip_status              |               |
| changed_by              | uuid, FK -> profiles(id) |               |
| changed_at              | timestamptz              | default now() |

### audit_logs (new)

| **Column**            | **Type**                 | **Notes**                |
| --------------------- | ------------------------ | ------------------------ |
| id                    | bigint, PK, identity     |                          |
| actor_id              | uuid, FK -> profiles(id) |                          |
| action                | text                     | insert / update / delete |
| entity_type           | text                     |                          |
| entity_id             | uuid                     |                          |
| old_value / new_value | jsonb                    |                          |
| created_at            | timestamptz              |                          |

### trip_daily_stats (new - analytics rollup, materialized)

| **Column**  | **Type**                           | **Notes**                    |
| ----------- | ---------------------------------- | ---------------------------- |
| stat_date   | date                               |                              |
| driver_id   | uuid                               |                              |
| vehicle_id  | uuid                               |                              |
| trip_count  | int                                |                              |
| distance_km | numeric                            |                              |
| fuel_liters | numeric                            |                              |
| PK          | (stat_date, driver_id, vehicle_id) | refreshed nightly by pg_cron |

## 4.2 Indexing Plan

- trips: btree (driver_id, departure_time desc), btree (vehicle_id, departure_time desc), btree (status), btree (from_plant_id), btree (to_plant_id).
- fuel_logs: btree (vehicle_id, logged_at desc), btree (trip_id).
- driver_locations: PK on user_id already gives O(1) upsert/read for the live map.
- documents: btree (entity_type, entity_id), btree (expiry_date) for the expiry-scan cron job.
- notifications: btree (recipient_id, is_read, created_at desc).

## 4.3 Row Level Security Policy Design

A SECURITY DEFINER helper function reads the caller's role once per query without recursive RLS evaluation:

create or replace function current_user_role()

returns user_role language sql stable security definer as \$\$

select role from profiles where id = auth.uid();

\$\$;

Representative policies (repeated with table-appropriate predicates across trips, drivers, vehicles, fuel_logs, documents):

\-- trips: drivers see only their own trips

create policy trips_select_driver on trips for select

using (current_user_role() = 'driver' and driver_id in (

select id from drivers where profile_id = auth.uid()));

\-- trips: manager/admin see everything

create policy trips_select_staff on trips for select

using (current_user_role() in ('manager','admin'));

\-- trips: only manager/admin can insert/update/delete

create policy trips_write_staff on trips for all

using (current_user_role() in ('manager','admin'))

with check (current_user_role() in ('manager','admin'));

\-- documents: aadhaar/pan-bearing driver docs restricted to admin

create policy documents_admin_only on documents for select

using (current_user_role() = 'admin' or doc_type not in ('aadhaar','pan'));

## 4.4 Service Layer (TypeScript) - Additions to the Existing Layer

| **Service**                 | **New/Changed responsibilities**                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| tripService.ts              | Add odometer capture, server-computed distance, status-history write, trip_number generation                                        |
| driverService.ts            | Add document expiry fields; create-linked-auth-user flow moves into a Supabase Edge Function                                        |
| vehicleService.ts (new)     | CRUD for vehicles; expose fleet list for trip/fuel dropdowns                                                                        |
| fuelService.ts (new)        | Add/list fuel logs; compute rolling km/l per vehicle                                                                                |
| maintenanceService.ts (new) | CRUD for vehicle_maintenance; due-soon queries for dashboard alerts                                                                 |
| documentService.ts (new)    | Upload to Storage, CRUD documents rows, expiry-scan query for alerts                                                                |
| analyticsService.ts (new)   | Date-range aware queries: recent ranges hit trips directly, longer ranges hit trip_daily_stats                                      |
| notificationService.ts      | Extend with type + metadata; add Expo push token registration/dispatch                                                              |
| locationService.ts          | Unchanged - live driver_locations upsert/subscribe only, no route history or breadcrumb persistence planned                        |

## 4.5 Key Screen / Module Additions

### Admin: Add Driver flow

- Admin fills driver form (name, age, address, Aadhaar, PAN, license #, license expiry, vehicle info, photo).
- Client calls an Edge Function create-driver-user with the Admin's JWT.
- Edge Function verifies caller role = admin, creates a Supabase Auth user (invite-by-email or temp password), inserts the profiles row with role='driver', inserts the drivers row linked via profile_id, and returns the result.
- This keeps the service-role key server-side only, unlike a client-side 'create auth user' call.

### Admin/Manager: Add Trip flow

- Vehicle and driver pickers now query vehicles/drivers tables (typeahead search for scale, not a full unfiltered list once fleet size grows).
- Plant pickers unchanged conceptually but now reference plants.id.
- On submit, insert into trips with status='pending'; trigger fires notification + push.

### Admin: Trip & Fuel Analytics (date range: today / week / month / custom)

- Query builder composes a date filter plus optional driver_id/vehicle_id filter.
- For ranges ≤ 35 days: SELECT sum(distance_travelled_km), sum(fuel_filled_liters) ... FROM trips WHERE departure_time BETWEEN ... (indexed).
- For longer ranges: same aggregation against trip_daily_stats.
- Per-truck breakdown view: group by vehicle_id to show distance and fuel per truck, addressing the stated requirement directly.
- Derived metric surfaced in the UI: fuel efficiency = distance_km / fuel_liters per truck/driver/period.

### New: Fleet Health screen (P0/P1)

- Vehicles nearing insurance/permit/PUC expiry.
- Drivers nearing license expiry.
- Vehicles due for service by date or odometer threshold.

# 5\. Caching & Offline Strategy

| **Data**                                  | **Strategy**                                          | **TTL / behavior**                                     |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Trips                                     | TanStack Query, short staleTime, invalidated on write | ~3 min, matches current design                         |
| Drivers / Vehicles                        | TanStack Query, medium staleTime                      | ~10 min                                                |
| Plants                                    | TanStack Query, long staleTime                        | ~30 min, rarely changes                                |
| Driver locations (live map)               | Not cached - Realtime Postgres Changes subscription   | Live only                                              |
| Offline writes (trip start/end, fuel log) | Local write queue (AsyncStorage) flushed on reconnect | Retries with backoff; conflict = server timestamp wins |

The offline queue is scoped to the actions a driver realistically performs with intermittent connectivity: start trip, end trip, and add fuel log. Admin/Manager write operations are assumed to run in-office with reliable connectivity and are not queued.

# 6\. Analytics & Reporting Design

## 6.1 Required Views

- Fleet-wide summary: total trips, total distance, total fuel, active vs completed, for the selected range.
- Per-driver summary: trips, distance, fuel, on-time rate.
- Per-vehicle summary: trips, distance, fuel, computed km/l, maintenance cost for the range.

## 6.2 Rollup Job

A nightly pg_cron job (or Edge Function on a schedule) upserts yesterday's aggregates into trip_daily_stats. This keeps 'this month'/'custom range' queries fast and bounded regardless of how large the trips table grows, while 'today' still reads live from trips for freshness.

## 6.3 Export

- CSV export generated client-side from the already-fetched aggregate rows (no extra backend needed for P1).
- PDF export via a templated Edge Function if formatted management reports are required later.

# 7\. Observability & Monitoring

- Sentry (React Native SDK) for crash and performance monitoring on the mobile app.
- Supabase built-in logs/metrics dashboard for Postgres, Auth, Storage, and Realtime - set alerts on connection-pool saturation and slow-query counts.
- Structured logging inside Edge Functions (JSON logs) for push-notification and cron job failures, surfaced via Supabase log drains if a central log sink (e.g. Logflare/Datadog) is later required.
- A lightweight admin-only 'system health' screen showing: pending push failures, last successful rollup run, documents nearing expiry count.

# 8\. Migration Plan

## 8.1 Firebase → Supabase (already decided)

The product decision to use Supabase instead of Firebase does not change the conceptual entities in the original document; it changes the persistence and auth mechanics: Firestore collections become Postgres tables, Firebase Auth becomes Supabase Auth, and client onSnapshot subscriptions become Supabase Realtime channels. Because no Firebase data exists yet, this is a clean build against the schema in Section 4, not a data migration.

## 8.2 Original flat schema → revised relational schema

- Stand up vehicles and plants first; backfill from any existing free-text truck/plant values if a pilot data set already exists, deduplicating by normalized name.
- Add vehicle_id/driver_id/from_plant_id/to_plant_id FK columns to trips alongside the legacy text columns; backfill by matching text to the new master tables.
- Switch the app to read/write the FK columns; keep the legacy text columns for one release as a fallback, then drop them.
- Introduce trip_status enum after normalizing existing status strings (Active/active -> 'active', Delivered -> 'completed').
- Enable RLS policies table-by-table behind a feature flag, testing each role's access before enforcing in production.

# 9\. Phased Roadmap

| **Phase**                    | **Scope**            | **Key deliverables**                                                                                                                                |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 - Foundation         | Core spec + P0 items | Auth/RLS, profiles/drivers/vehicles/plants/trips, Admin add-driver via Edge Function, add-trip, date-range analytics with distance & fuel per truck |
| Phase 2 - Trust & Compliance | P0 remainder         | Odometer-based distance calc, fuel_logs, document expiry tracking + alerts, audit log, trip_status_history                                          |
| Phase 3 - Operational depth  | P1                   | Push notifications, driver performance dashboard, vehicle maintenance scheduling, offline queue                                                      |
| Phase 4 - Scale hardening    | NFR & scale          | trip_daily_stats rollup + pg_cron, partitioning, load testing to 1,000 concurrent, Sentry + observability dashboard                                 |
| Phase 5 - Growth             | P2                   | Multi-tenant org_id, exportable reports, dispute threads, scorecards, weighbridge integration hooks                                                 |

# Appendix A - Core DDL (abridged)

This is a starting-point DDL for the P0 tables. It omits some constraints/triggers for brevity; RLS policies from Section 4.3 apply on top of these definitions.

create type user_role as enum ('admin','manager','driver');

create type driver_status as enum ('active','inactive','suspended');

create type vehicle_status as enum ('active','in_maintenance','retired');

create type trip_status as enum ('pending','active','completed','cancelled');

create table profiles (

id uuid primary key references auth.users(id),

email text unique not null,

full_name text,

phone text,

role user_role not null default 'driver',

is_active boolean not null default true,

created_at timestamptz not null default now(),

updated_at timestamptz not null default now()

);

create table vehicles (

id uuid primary key default gen_random_uuid(),

registration_number text unique not null,

type text, capacity_tons numeric, fuel_type text,

odometer_reading numeric default 0,

insurance_expiry date, permit_expiry date, puc_expiry date,

status vehicle_status not null default 'active',

created_at timestamptz not null default now(),

updated_at timestamptz not null default now()

);

create table drivers (

id uuid primary key default gen_random_uuid(),

profile_id uuid references profiles(id),

full_name text not null, email text, phone text,

age smallint check (age between 18 and 70),

address text, aadhaar_number text, pan_number text,

license_number text, license_expiry date,

photo_path text, status driver_status not null default 'active',

created_by uuid references profiles(id),

created_at timestamptz not null default now(),

updated_at timestamptz not null default now()

);

create table plants (

id uuid primary key default gen_random_uuid(),

name text not null, code text unique, address text,

latitude numeric, longitude numeric,

contact_person text, contact_phone text,

is_active boolean not null default true,

created_at timestamptz not null default now()

);

create table trips (

id uuid primary key default gen_random_uuid(),

trip_number text unique,

vehicle_id uuid references vehicles(id),

driver_id uuid references drivers(id),

bid_no text, lr_number text, company_name text, item_type text,

quantity numeric, quantity_unit text,

from_plant_id uuid references plants(id),

to_plant_id uuid references plants(id),

odometer_start numeric, odometer_end numeric,

distance_travelled_km numeric,

fuel_filled_liters numeric, fuel_cost numeric,

status trip_status not null default 'pending',

departure_time timestamptz, arrival_time timestamptz,

remarks text,

created_by uuid references profiles(id),

created_at timestamptz not null default now(),

updated_at timestamptz not null default now()

);

create index idx_trips_driver_dep on trips (driver_id, departure_time desc);

create index idx_trips_vehicle_dep on trips (vehicle_id, departure_time desc);

create index idx_trips_status on trips (status);

Full DDL for fuel_logs, vehicle_maintenance, driver_locations, notifications, documents, trip_status_history, audit_logs, and trip_daily_stats follows the same pattern shown in Section 4.1 and can be generated directly from those table specifications during Phase 1 implementation.