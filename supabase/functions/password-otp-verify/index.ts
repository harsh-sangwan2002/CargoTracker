// Deploy: supabase functions deploy password-otp-verify
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAX_ATTEMPTS = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

async function hashOtp(otp: string): Promise<string> {
  const encoded = new TextEncoder().encode(otp);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
  }

  let body: { email?: string; otp?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS_HEADERS });
  }

  const email = body.email?.trim().toLowerCase();
  const otp = body.otp?.trim();
  const newPassword = body.newPassword;

  if (!email || !otp || !newPassword) {
    return new Response(
      JSON.stringify({ error: 'email, otp, and newPassword are required' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (newPassword.length < 6) {
    return new Response(
      JSON.stringify({ error: 'Password must be at least 6 characters.' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Fetch the most recent active OTP for this email
  const { data: record } = await admin
    .from('password_reset_otps')
    .select('id, otp_hash, expires_at, used, attempts')
    .eq('email', email)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!record) {
    return new Response(
      JSON.stringify({ error: 'No active OTP found. Please request a new code.' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (new Date(record.expires_at) < new Date()) {
    return new Response(
      JSON.stringify({ error: 'OTP has expired. Please request a new code.' }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const inputHash = await hashOtp(otp);
  if (inputHash !== record.otp_hash) {
    // A 6-digit code is brute-forceable without a cap: burn the code after 5 misses.
    const attempts = (record.attempts ?? 0) + 1;
    await admin
      .from('password_reset_otps')
      .update({ attempts, used: attempts >= MAX_ATTEMPTS })
      .eq('id', record.id);
    const message = attempts >= MAX_ATTEMPTS
      ? 'Too many incorrect attempts. Please request a new code.'
      : 'Incorrect OTP code. Check the email and try again.';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: CORS_HEADERS });
  }

  // Mark OTP as used before updating password (prevent replay)
  await admin.from('password_reset_otps').update({ used: true }).eq('id', record.id);

  // Every auth user has a profiles row (on_auth_user_created trigger); listUsers()
  // is paginated and missed accounts past the first page.
  const { data: user } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (!user) {
    return new Response(JSON.stringify({ error: 'User account not found.' }), { status: 404, headers: CORS_HEADERS });
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (updateError) {
    return new Response(
      JSON.stringify({ error: updateError.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS_HEADERS });
});
