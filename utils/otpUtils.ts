export function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String((arr[0] % 900000) + 100000);
}

export async function hashOtp(otp: string): Promise<string> {
  const encoded = new TextEncoder().encode(otp);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

export function isValidOtp(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}
