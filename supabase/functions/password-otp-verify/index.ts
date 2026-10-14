// Deploy: supabase functions deploy password-otp-verify
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

const MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 8;

// Constant-time comparison of two hex digests.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: CORS_HEADERS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail(405, 'Method not allowed');

  let body: { email?: string; otp?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Invalid JSON body');
  }

  const email = body.email?.trim().toLowerCase();
  const otp = body.otp?.trim();
  const newPassword = body.newPassword;

  if (!email || !otp || !newPassword) return fail(400, 'email, otp, and newPassword are required');
  if (!/^\d{6}$/.test(otp)) return fail(400, 'The code must be 6 digits.');
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 72) {
    return fail(400, `Password must be between ${MIN_PASSWORD_LENGTH} and 72 characters.`);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: record } = await admin
    .from('password_reset_otps')
    .select('id, otp_hash, expires_at, attempts')
    .eq('email', email)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // One message for "no code", "expired" and "wrong" keeps responses uninformative.
  const invalid = () => fail(400, 'Invalid or expired code. Please request a new one.');

  if (!record || new Date(record.expires_at) < new Date()) return invalid();

  // Count the attempt atomically before comparing, so parallel guesses can't all
  // slip in under the limit; the code is burnt once the limit is reached.
  const { data: attempts, error: bumpError } = await admin.rpc('register_otp_attempt', {
    p_id: record.id,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (bumpError || typeof attempts !== 'number' || attempts > MAX_ATTEMPTS) return invalid();

  if (!safeEqual(await hashOtp(otp), record.otp_hash)) {
    if (attempts >= MAX_ATTEMPTS) return fail(429, 'Too many incorrect attempts. Please request a new code.');
    return invalid();
  }

  // Mark OTP as used before updating password (prevent replay)
  await admin.from('password_reset_otps').update({ used: true }).eq('id', record.id);

  const { data: profile } = await admin
    .from('profiles')
    .select('id, is_active')
    .eq('email', email)
    .maybeSingle();
  if (!profile?.is_active) return invalid();

  const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password: newPassword });
  if (updateError) {
    console.error(JSON.stringify({ fn: 'password-otp-verify', stage: 'update', error: updateError.message }));
    return fail(500, 'Could not update the password. Try again.');
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS_HEADERS });
});
