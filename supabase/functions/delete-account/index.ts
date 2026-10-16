// Deno Edge Function: permanently deletes the calling user's account.
// Deploy: supabase functions deploy delete-account
// Secrets required: SUPABASE_URL, SUPABASE_ANON_KEY (both set by default)
//
// Used by the public account-deletion web page (docs/index.html); the app calls
// delete_my_account() directly. Both run the same delete_my_account() RPC as the
// caller, so what gets deleted (and the last-admin guard) lives in one place:
// supabase/schema.sql.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: callerData, error: callerError } = await caller.auth.getUser();
  if (callerError || !callerData?.user) return json({ error: 'Invalid session' }, 401);

  const { error } = await caller.rpc('delete_my_account');
  if (error) {
    const refused = error.code === '42501';
    return json({ error: error.message }, refused ? 403 : 500);
  }

  return json({ deleted: true });
});
