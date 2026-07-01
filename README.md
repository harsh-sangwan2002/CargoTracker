# Cargo Tracker

Cargo Tracker is an Expo React Native app for fleet trip management, driver assignment, plant management, analytics, and live driver location tracking.

## Current Stack

- React Native + Expo SDK 54
- TypeScript
- Supabase Auth
- Supabase Postgres
- Supabase Realtime for active driver locations
- AsyncStorage for local session/cache persistence
- `react-native-maps` and `expo-location` for live tracking

## Setup

Install dependencies:

```bash
npm install
```

Create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Required environment variables:

```bash
SUPABASE_DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:6543/postgres
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

The Postgres connection string is only for local schema migration scripts. Do not import it into app code. The Expo app uses only the Supabase URL and anon key.

Apply the database schema:

```bash
npm run supabase:migrate
```

Start the app:

```bash
npm start
```

Run type checking:

```bash
npx tsc --noEmit
```

## Main Features

- Email/password auth through Supabase Auth
- Driver, manager, and admin roles
- Driver home screen with assigned trips, notifications, and GPS tracking
- Manager/admin dashboard with overview stats and recent trips
- Trip list with search, status filters, add/edit/delete modals, date pickers, and driver/plant selectors
- Driver management with photo capture/gallery upload, profile validation, and account-linking email
- Plant management with default seed plants
- User role management
- Analytics with date ranges and driver filtering
- Live driver map backed by realtime `driver_locations` updates

## Project Structure

```text
App.tsx
supabaseConfig.ts
screens/
services/
utils/
components/
supabase/schema.sql
scripts/run-supabase-schema.js
```

## Supabase Notes

The schema is defined in `supabase/schema.sql` (idempotent — safe to re-run via `npm run supabase:migrate`).

Core tables:

- `profiles` (renamed from `users`; 1:1 with `auth.users`)
- `drivers` (now links to `profiles` via `profile_id`)
- `vehicles`
- `trips` (now references `vehicles`, `drivers`, and `plants` via foreign keys, alongside the legacy free-text columns kept for this release)
- `plants`
- `driver_locations`
- `notifications`

Row Level Security is enabled on `profiles`, `drivers`, `vehicles`, `plants`, and `trips` via a `current_user_role()` helper (see `supabase/schema.sql`). Verify each role's access manually before relying on it as the sole security boundary.

### Admin driver login provisioning

Creating a Supabase Auth account for a driver (so the service-role key never touches the client) is handled by the `create-driver-user` Edge Function in `supabase/functions/create-driver-user`. Deploy it with:

```bash
supabase functions deploy create-driver-user
supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

The Admin's "Create Login" action on a driver's detail screen calls this function; it only succeeds for callers whose `profiles.role` is `admin`.

## Troubleshooting

### Email rate limit exceeded on signup

Supabase's built-in email provider is rate-limited. For local development, disable email confirmation in Supabase Dashboard under Authentication settings, or configure a custom SMTP provider for higher email limits.
