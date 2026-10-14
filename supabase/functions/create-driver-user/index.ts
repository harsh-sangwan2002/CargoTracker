// Deno Edge Function: provisions a Supabase Auth account for a driver.
// Deploy: supabase functions deploy create-driver-user
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set via `supabase secrets set`)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface RequestBody {
  driverId: string;
  email: string;
  fullName?: string;
}

// 14 characters from an unambiguous alphabet (~80 bits). The previous 4-digit
// PIN could be brute-forced against the login endpoint in minutes.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function randomPassword(length = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = '';
  for (const b of bytes) {
    // rejection sampling keeps the distribution uniform
    if (b >= 256 - (256 % PASSWORD_ALPHABET.length)) continue;
    out += PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length];
    if (out.length === length) break;
  }
  return out.length === length ? out : randomPassword(length);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Verify the caller's JWT explicitly; never trust anything else in the request.
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: callerData, error: callerError } = await admin.auth.getUser(jwt);
  if (callerError || !callerData?.user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
  }

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (profileError || callerProfile?.role !== 'admin' || !callerProfile?.is_active) {
    return new Response(JSON.stringify({ error: 'Only admins can provision driver accounts' }), { status: 403 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !body.driverId) {
    return new Response(JSON.stringify({ error: 'driverId and email are required' }), { status: 400 });
  }
  if (!EMAIL_RE.test(email) || !UUID_RE.test(body.driverId)) {
    return new Response(JSON.stringify({ error: 'Invalid email or driverId' }), { status: 400 });
  }

  const { data: driverRow, error: driverError } = await admin
    .from('drivers')
    .select('id, profile_id')
    .eq('id', body.driverId)
    .maybeSingle();

  if (driverError || !driverRow) {
    return new Response(JSON.stringify({ error: 'Driver record not found' }), { status: 404 });
  }
  if (driverRow.profile_id) {
    return new Response(JSON.stringify({ error: 'Driver already has a linked account' }), { status: 409 });
  }

  // Link + sync driver.profile_id/user_id to an existing profile, and backfill
  // driver_user_id on that driver's trips so they immediately show up in the
  // driver's portal (some trips may predate the account being linked).
  const linkExistingProfile = async (profileId: string) => {
    const { error: linkError } = await admin
      .from('drivers')
      .update({ profile_id: profileId, user_id: profileId, email, created_by: callerData.user.id, updated_at: new Date().toISOString() })
      .eq('id', body.driverId);
    if (linkError) throw linkError;

    const { error: tripSyncError } = await admin
      .from('trips')
      .update({ driver_user_id: profileId })
      .eq('driver_id', body.driverId);
    if (tripSyncError) throw tripSyncError;
  };

  // If this email already has a profile (existing auth account, e.g. self-registered
  // or created for another purpose), sync the driver record to it instead of trying
  // to create a duplicate auth user (which would fail with "already registered").
  const { data: existingProfile, error: existingProfileError } = await admin
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .maybeSingle();

  if (existingProfileError) {
    return new Response(JSON.stringify({ error: 'Failed to look up existing accounts' }), { status: 500 });
  }

  // Linking a staff account as a driver would expose it in driver flows and let
  // whoever holds the driver record act on a manager/admin identity.
  if (existingProfile && existingProfile.role !== 'driver') {
    return new Response(
      JSON.stringify({ error: 'This email belongs to a staff account and cannot be linked to a driver' }),
      { status: 409 }
    );
  }

  if (existingProfile) {
    try {
      await linkExistingProfile(existingProfile.id);
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
    }
    return new Response(
      JSON.stringify({ userId: existingProfile.id, email, linkedExisting: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const tempPassword = randomPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { role: 'driver', full_name: body.fullName ?? '' },
  });

  if (createError || !created?.user) {
    // Race condition: the auth user was created after our profiles lookup above
    // (e.g. self-registration happening concurrently). Fall back to linking it.
    if (createError?.message?.toLowerCase().includes('already been registered')) {
      const { data: match } = await admin.from('profiles').select('id, role').eq('email', email).maybeSingle();
      if (match && match.role === 'driver') {
        try {
          await linkExistingProfile(match.id);
        } catch (e) {
          return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
        }
        return new Response(
          JSON.stringify({ userId: match.id, email, linkedExisting: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    return new Response(JSON.stringify({ error: createError?.message ?? 'Failed to create auth user' }), { status: 500 });
  }

  try {
    await linkExistingProfile(created.user.id);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ userId: created.user.id, email, tempPassword }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
