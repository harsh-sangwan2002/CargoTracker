// Deno Edge Function: permanently deletes the calling user's account.
// Deploy: supabase functions deploy delete-account
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set for create-driver-user)
//
// Removes the user's personal driver record (Aadhaar/PAN/photo etc.) and the auth user.
// Deleting the auth user cascades to profiles, notifications, driver_locations and
// push_tokens; trips and fuel logs are company records, so they are kept with their
// user references set to null.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData?.user) return json({ error: 'Invalid session' }, 401);

  const uid = callerData.user.id;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error: driverError } = await admin.from('drivers').delete().eq('profile_id', uid);
  if (driverError) return json({ error: driverError.message }, 500);

  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) return json({ error: deleteError.message }, 500);

  return json({ deleted: true });
});
