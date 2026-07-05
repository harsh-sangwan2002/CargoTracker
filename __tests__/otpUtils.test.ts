import { generateOtp, hashOtp, isExpired, isValidOtp } from '../utils/otpUtils';

describe('generateOtp', () => {
  it('returns a 6-digit numeric string', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('is always in the 100000–999999 range', () => {
    for (let i = 0; i < 50; i++) {
      const n = parseInt(generateOtp(), 10);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });

  it('produces different values across calls', () => {
    const otps = new Set(Array.from({ length: 30 }, () => generateOtp()));
    expect(otps.size).toBeGreaterThan(1);
  });
});

describe('hashOtp', () => {
  it('returns a 64-character lowercase hex string (SHA-256)', async () => {
    const hash = await hashOtp('123456');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic — same input always produces the same hash', async () => {
    const h1 = await hashOtp('123456');
    const h2 = await hashOtp('123456');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different OTPs', async () => {
    const h1 = await hashOtp('123456');
    const h2 = await hashOtp('654321');
    expect(h1).not.toBe(h2);
  });

  it('matches the known SHA-256 of "000000"', async () => {
    const hash = await hashOtp('000000');
    expect(hash).toBe('91b4d142823f7d20c5f08df69122de43f35f057a988d9619f6d3138485c9a203');
  });
});

describe('isExpired', () => {
  it('returns true for a date in the past', () => {
    const past = new Date(Date.now() - 1000);
    expect(isExpired(past)).toBe(true);
  });

  it('returns false for a date in the future', () => {
    const future = new Date(Date.now() + 60_000);
    expect(isExpired(future)).toBe(false);
  });

  it('treats a 10-minute window as not expired', () => {
    const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000);
    expect(isExpired(tenMinutesFromNow)).toBe(false);
  });
});

describe('isValidOtp', () => {
  it('accepts exactly 6 numeric digits', () => {
    expect(isValidOtp('000000')).toBe(true);
    expect(isValidOtp('123456')).toBe(true);
    expect(isValidOtp('999999')).toBe(true);
  });

  it('rejects strings shorter or longer than 6 digits', () => {
    expect(isValidOtp('12345')).toBe(false);
    expect(isValidOtp('1234567')).toBe(false);
    expect(isValidOtp('')).toBe(false);
  });

  it('rejects non-numeric characters', () => {
    expect(isValidOtp('12345a')).toBe(false);
    expect(isValidOtp('abc123')).toBe(false);
    expect(isValidOtp('      ')).toBe(false);
    expect(isValidOtp('12 345')).toBe(false);
  });

  it('rejects strings with leading/trailing spaces', () => {
    expect(isValidOtp(' 123456')).toBe(false);
    expect(isValidOtp('123456 ')).toBe(false);
  });
});

describe('OTP round-trip: generate → hash → verify', () => {
  it('hash of generated OTP matches re-hash of the same value', async () => {
    const otp = generateOtp();
    const storedHash = await hashOtp(otp);
    const inputHash = await hashOtp(otp);
    expect(inputHash).toBe(storedHash);
  });

  it('wrong OTP does not match the stored hash', async () => {
    const correctOtp = '123456';
    const wrongOtp = '654321';
    const storedHash = await hashOtp(correctOtp);
    const wrongHash = await hashOtp(wrongOtp);
    expect(wrongHash).not.toBe(storedHash);
  });
});
