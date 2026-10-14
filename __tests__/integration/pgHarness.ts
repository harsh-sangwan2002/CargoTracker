// Boots an in-process Postgres (PGlite) with the minimum of Supabase's platform
// surface (auth schema, anon/authenticated roles, JWT claim helpers) that
// supabase/schema.sql depends on, then applies the real schema file. Tests then
// switch into the `authenticated` role with a given auth.uid() so Row Level
// Security, column grants and triggers are exercised exactly as PostgREST would.
import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_PLATFORM_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    email_confirmed_at timestamptz,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
  $$;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  -- Supabase's default privileges: API roles get full table rights; RLS is the gate.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export type Role = 'admin' | 'manager' | 'driver';

export interface Harness {
  db: PGlite;
  /** Creates an auth user (fires the real signup trigger) and returns its id. */
  createUser: (email: string, metadata?: Record<string, unknown>, confirmed?: boolean) => Promise<string>;
  /** Creates a user and force-sets its role as the platform owner would. */
  createUserWithRole: (email: string, role: Role) => Promise<string>;
  /** Runs `fn` inside a transaction as the given authenticated user (or anon). */
  as: <T>(uid: string | null, fn: (q: Query) => Promise<T>) => Promise<T>;
  /** Runs SQL as the database owner (bypasses RLS) — for setup and assertions. */
  owner: Query;
  close: () => Promise<void>;
}

export type Query = <R = any>(sql: string, params?: unknown[]) => Promise<R[]>;

// pgcrypto isn't bundled with PGlite; the schema only needs gen_random_uuid(),
// which is built into Postgres 13+, so the extension line is skipped here.
export const schemaSql = () =>
  fs
    .readFileSync(path.join(__dirname, '..', '..', 'supabase', 'schema.sql'), 'utf8')
    .replace(/^create extension if not exists pgcrypto;$/m, '');

export async function bootDatabase(): Promise<Harness> {
  const db = new PGlite();
  await db.exec(SUPABASE_PLATFORM_STUB);
  await db.exec(schemaSql());

  const owner: Query = async (sql, params) => (await db.query(sql, params as any[])).rows as any[];

  const createUser = async (email: string, metadata: Record<string, unknown> = {}, confirmed = true) => {
    const [row] = await owner<{ id: string }>(
      'insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3) returning id',
      [email, JSON.stringify(metadata), confirmed ? new Date().toISOString() : null]
    );
    return row.id;
  };

  const createUserWithRole = async (email: string, role: Role) => {
    const id = await createUser(email);
    await owner('update public.profiles set role = $1 where id = $2', [role, id]);
    return id;
  };

  const as = async <T,>(uid: string | null, fn: (q: Query) => Promise<T>): Promise<T> =>
    db.transaction(async tx => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      await tx.query(`select set_config('request.jwt.claim.role', $1, true)`, [uid ? 'authenticated' : 'anon']);
      await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
      return fn(async (sql, params) => (await tx.query(sql, params as any[])).rows as any[]);
    });

  return { db, createUser, createUserWithRole, as, owner, close: () => db.close() };
}
