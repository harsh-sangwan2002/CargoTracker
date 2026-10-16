// Deploy: supabase functions deploy password-otp-send
// Secrets required (supabase secrets set):
//   GMAIL_USER (the Gmail address), GMAIL_APP_PASSWORD (a Google App Password, not the account password)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER')!;
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD')!;

// Port 465 (implicit TLS): Supabase Edge Functions block outbound 25 and 587.
const mailer = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

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

async function sendOtpEmail(to: string, otp: string): Promise<void> {
  // Gmail only sends as the authenticated account (or a verified alias of it).
  await mailer.sendMail({
    from: `CargoTracker <${GMAIL_USER}>`,
    to,
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
  });
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

  // Same response whether or not the account exists, so this endpoint can't be used
  // to discover which emails are registered.
  const ok = () => new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS_HEADERS });

  // Every auth user gets a profiles row from the on_auth_user_created trigger.
  // (auth.admin.listUsers() is paginated and silently missed users past the first page.)
  const { data: profile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (!profile) return ok();

  // Rate limit: one code per minute, at most 5 per hour, per email.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from('password_reset_otps')
    .select('created_at')
    .eq('email', email)
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: false });
  if (recent && recent.length > 0) {
    const lastSentMs = Date.now() - new Date(recent[0].created_at).getTime();
    if (lastSentMs < 60 * 1000 || recent.length >= 5) {
      return new Response(
        JSON.stringify({ error: 'Too many reset requests. Please wait a few minutes and try again.' }),
        { status: 429, headers: CORS_HEADERS }
      );
    }
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
    await sendOtpEmail(email, otp);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Failed to send email: ${(e as Error).message}` }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  return ok();
});
