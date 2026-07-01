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

function randomPassword(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 9000;
  return String(value + 1000);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
  }

  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData?.user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .maybeSingle();

  if (profileError || callerProfile?.role !== 'admin') {
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
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existingProfileError) {
    return new Response(JSON.stringify({ error: existingProfileError.message }), { status: 500 });
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
      const { data: users, error: listError } = await admin.auth.admin.listUsers();
      const match = !listError && users?.users.find(u => u.email?.toLowerCase() === email);
      if (match) {
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
