// Deno Edge Function: sends an Expo push notification to a driver's registered device.
// Deploy: supabase functions deploy send-push-notification
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set for create-driver-user)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface RequestBody {
  driverUserId: string;
  title: string;
  body: string;
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

  if (profileError || !['admin', 'manager'].includes(callerProfile?.role ?? '')) {
    return new Response(JSON.stringify({ error: 'Only staff can send driver push notifications' }), { status: 403 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  if (!body.driverUserId || !body.title || !body.body) {
    return new Response(JSON.stringify({ error: 'driverUserId, title and body are required' }), { status: 400 });
  }

  const { data: tokenRow } = await admin
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', body.driverUserId)
    .maybeSingle();

  if (!tokenRow?.expo_push_token) {
    // Not an error — the driver just hasn't registered a device for push yet;
    // they still see the notification in-app via the notifications table.
    return new Response(JSON.stringify({ sent: false, reason: 'no_token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: tokenRow.expo_push_token,
      title: body.title,
      body: body.body,
      sound: 'default',
    }),
  });

  if (!pushResponse.ok) {
    const detail = await pushResponse.text();
    return new Response(JSON.stringify({ error: `Expo push send failed: ${detail}` }), { status: 502 });
  }

  return new Response(JSON.stringify({ sent: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
