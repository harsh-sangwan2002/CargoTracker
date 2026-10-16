// Integration tests for supabase/schema.sql: runs the real migration (twice, to prove it
// is re-runnable) against an in-process Postgres (PGlite) with a minimal stub of
// Supabase's auth schema, then exercises triggers and RLS as the `authenticated`
// role — the same role PostgREST uses for app requests.
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

jest.setTimeout(120_000);

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../supabase/schema.sql'), 'utf8');

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
`;
const GRANTS = `
  grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;
`;

let db: PGlite;

// Simulates supabase.auth.signUp / auth.admin.createUser (fires on_auth_user_created).
const signUp = async (email: string, meta: Record<string, unknown> = {}) => {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, meta]);
  return id;
};

const setRole = (uid: string, role: string) =>
  db.query('update public.profiles set role = $2 where id = $1', [uid, role]);

// Runs `sql` as an app request from user `uid` (role `authenticated`, auth.uid() = uid).
const asUser = async <T = any>(uid: string, sql: string, params: unknown[] = []) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
};

let adminId: string;
let managerId: string;
let driverId: string;
let driverRowId: string;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_STUB);
  await db.exec(SCHEMA);
  await db.exec(SCHEMA); // must be re-runnable
  await db.exec(GRANTS);

  adminId = await signUp('admin@test.com');
  await setRole(adminId, 'admin');
  managerId = await signUp('manager@test.com');
  await setRole(managerId, 'manager');
  driverId = await signUp('driver@test.com');
  const r = await db.query<{ id: string }>(
    `insert into public.drivers (full_name, email, profile_id, user_id) values ('Old Name', 'driver@test.com', $1, $1) returning id`,
    [driverId]
  );
  driverRowId = r.rows[0].id;
});

afterAll(async () => {
  await db?.close();
});

describe('auth & roles', () => {
  it('self sign-up cannot grant itself admin via user_metadata.role', async () => {
    const attacker = await signUp('attacker@test.com', { role: 'admin' });
    const { rows } = await db.query<{ role: string }>('select role from public.profiles where id = $1', [attacker]);
    expect(rows[0].role).toBe('driver');
  });

  it('a manager cannot promote themselves through the self-update policy', async () => {
    await expect(
      asUser(managerId, `update public.profiles set role = 'admin', is_active = false where id = $1`, [managerId])
    ).rejects.toThrow(/only an admin/);
    const { rows } = await db.query<any>('select role, is_active from public.profiles where id = $1', [managerId]);
    expect(rows[0]).toEqual({ role: 'manager', is_active: true });
  });

  it('a manager cannot change another user\'s role (0 rows, so the app reports it)', async () => {
    const u = await signUp('target@test.com');
    const res = await asUser(managerId, `update public.profiles set role = 'admin' where id = $1`, [u]);
    expect(res.affectedRows).toBe(0);
  });

  it('an admin can change roles, and the change is audited', async () => {
    const u = await signUp('promote@test.com');
    const res = await asUser(adminId, `update public.profiles set role = 'manager' where id = $1`, [u]);
    expect(res.affectedRows).toBe(1);
    const { rows } = await db.query(`select 1 from public.audit_logs where entity_id = $1 and action = 'role_change'`, [u]);
    expect(rows).toHaveLength(1);
  });
});

describe('staff profile', () => {
  it('has the columns the Profile screen reads/writes', async () => {
    await expect(db.query('select full_name, phone, address from public.profiles limit 1')).resolves.toBeDefined();
  });

  it('a manager can edit their own name/phone/address', async () => {
    const res = await asUser(managerId,
      `update public.profiles set full_name = 'Mgr', phone = '1', address = 'HQ' where id = $1`, [managerId]);
    expect(res.affectedRows).toBe(1);
  });
});

describe('driver records', () => {
  it('a driver cannot change their own status, account link or email', async () => {
    await asUser(driverId,
      `update public.drivers set status = 'suspended', profile_id = null, email = 'x@y.z' where id = $1`, [driverRowId]);
    const { rows } = await db.query<any>('select status, profile_id, email from public.drivers where id = $1', [driverRowId]);
    expect(rows[0]).toEqual({ status: 'active', profile_id: driverId, email: 'driver@test.com' });
  });
});

describe('trips', () => {
  it('a driver can start and end their own trip; distance comes from the odometer', async () => {
    const t = await db.query<{ id: string }>(
      `insert into public.trips (departure_time, driver_user_id, status, trip_status)
       values (now(), $1, 'pending', 'pending') returning id`, [driverId]);
    const id = t.rows[0].id;
    const r1 = await asUser(driverId,
      `update public.trips set status = 'active', trip_status = 'active', departure_time = now(), odometer_start = 1000 where id = $1`, [id]);
    const r2 = await asUser(driverId,
      `update public.trips set status = 'completed', trip_status = 'completed', arrival_time = now(), odometer_end = 1180 where id = $1`, [id]);
    expect((r1.affectedRows ?? 0) + (r2.affectedRows ?? 0)).toBe(2);

    const { rows } = await db.query<any>(
      'select trip_status, distance_travelled_km, distance_travelled from public.trips where id = $1', [id]);
    expect(rows[0].trip_status).toBe('completed');
    expect(Number(rows[0].distance_travelled_km)).toBe(180);
    expect(rows[0].distance_travelled).toBe('180');

    const hist = await db.query<{ n: number }>('select count(*)::int as n from public.trip_status_history where trip_id = $1', [id]);
    expect(hist.rows[0].n).toBe(3); // created, started, completed
  });

  it('a driver cannot rewrite fuel/distance figures on their own trip', async () => {
    const t = await db.query<{ id: string }>(
      `insert into public.trips (departure_time, driver_user_id, fuel_filled_liters, distance_travelled_km)
       values (now(), $1, 50, 300) returning id`, [driverId]);
    await expect(asUser(driverId,
      `update public.trips set fuel_filled_liters = 5000 where id = $1`, [t.rows[0].id])).rejects.toThrow(/drivers can only/);
    await expect(asUser(driverId,
      `update public.trips set distance_travelled_km = 99999 where id = $1`, [t.rows[0].id])).rejects.toThrow(/drivers can only/);
    const { rows } = await db.query<any>('select fuel_filled_liters, distance_travelled_km from public.trips where id = $1', [t.rows[0].id]);
    expect(Number(rows[0].fuel_filled_liters)).toBe(50);
    expect(Number(rows[0].distance_travelled_km)).toBe(300);
  });

  it('odometer-derived distance is mirrored into the legacy text column', async () => {
    const t = await db.query<any>(
      `insert into public.trips (departure_time, odometer_start, odometer_end, distance_travelled, distance_travelled_km)
       values (now(), 100, 350, '0', 0) returning distance_travelled, distance_travelled_km`);
    expect(Number(t.rows[0].distance_travelled_km)).toBe(250);
    expect(t.rows[0].distance_travelled).toBe('250');
  });

  it('trip UPDATE audit rows capture old and new values', async () => {
    const t = await db.query<{ id: string }>(`insert into public.trips (departure_time, truck) values (now(), 'HR55AB1234') returning id`);
    await db.query(`update public.trips set truck = 'HR55AB9999' where id = $1`, [t.rows[0].id]);
    const { rows } = await db.query<any>(
      `select old_value->>'truck' as old_truck, new_value->>'truck' as new_truck
       from public.audit_logs where entity_id = $1 and action = 'update'`, [t.rows[0].id]);
    expect(rows).toEqual([{ old_truck: 'HR55AB1234', new_truck: 'HR55AB9999' }]);
  });
});

describe('account deletion', () => {
  it('deleting an auth user is not blocked by FKs and keeps the trips they created', async () => {
    const a = await signUp('admin2@test.com');
    await setRole(a, 'admin');
    await db.query(`insert into public.drivers (full_name, created_by) values ('Made by admin2', $1)`, [a]);
    const t = await db.query<{ id: string }>(
      `insert into public.trips (departure_time, created_by, user_id) values (now(), $1, $1) returning id`, [a]);
    await expect(db.query('delete from auth.users where id = $1', [a])).resolves.toBeDefined();
    const { rows } = await db.query('select id from public.trips where id = $1', [t.rows[0].id]);
    expect(rows).toHaveLength(1);
  });
});
