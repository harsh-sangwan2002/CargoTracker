// Deploy: supabase functions deploy password-otp-send
// Secrets required (supabase secrets set):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String((arr[0] % 900000) + 100000);
}

async function hashOtp(otp: string): Promise<string> {
  const encoded = new TextEncoder().encode(otp);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sendResendEmail(to: string, otp: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `CargoTracker <${RESEND_FROM_EMAIL}>`,
      to: [to],
      subject: 'Your Password Reset Code - CargoTracker',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#1e293b;margin-bottom:8px;">Password Reset</h2>
          <p style="color:#475569;margin-bottom:24px;">
            Enter this code in the CargoTracker app to reset your password.
            It expires in <strong>10 minutes</strong>.
          </p>
          <div style="background:#f1f5f9;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
            <span style="font-size:48px;font-weight:800;letter-spacing:16px;color:#0f172a;">
              ${otp}
            </span>
          </div>
          <p style="color:#94a3b8;font-size:13px;">
            If you didn't request a password reset, you can safely ignore this email.
          </p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend ${res.status}: ${text}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS_HEADERS });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return new Response(JSON.stringify({ error: 'email is required' }), { status: 400, headers: CORS_HEADERS });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Check auth.users directly — more reliable than profiles table
  const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const authUser = usersPage?.users.find(u => u.email?.toLowerCase() === email);

  if (!authUser) {
    return new Response(
      JSON.stringify({ error: 'No account found with this email address.' }),
      { status: 404, headers: CORS_HEADERS }
    );
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Invalidate any existing active OTPs for this email
  await admin
    .from('password_reset_otps')
    .update({ used: true })
    .eq('email', email)
    .eq('used', false);

  const { error: insertError } = await admin
    .from('password_reset_otps')
    .insert({ email, otp_hash: otpHash, expires_at: expiresAt });

  if (insertError) {
    return new Response(
      JSON.stringify({ error: 'Failed to store OTP. Try again.' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  try {
    await sendResendEmail(email, otp);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Failed to send email: ${(e as Error).message}` }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS_HEADERS });
});
