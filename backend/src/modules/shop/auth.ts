/**
 * Shopper identity — phone + OTP over the WhatsApp integration the ERP already
 * runs. Shoppers never get a password.
 *
 * Two deliberate choices:
 *
 *  - Customer tokens are signed with a SEPARATE secret from staff JWTs. A
 *    shopper token must never be accepted by the ERP API, and a leak on one
 *    side must not compromise the other.
 *  - A signup is matched to an existing `Customer` by phone, so someone who has
 *    shopped at the counter for years keeps their history, loyalty points and
 *    tier the moment they sign in online.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { shopConfig } from '../../config/shop';
import { sendWhatsAppText } from '../messaging/whatsapp';

const AUTH = shopConfig.auth;

const hash = (v: string): string => crypto.createHash('sha256').update(v).digest('hex');

/** Indian mobile numbers, normalised to bare 10 digits. */
export function normalisePhone(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) {
    throw new AppError('Enter a valid 10-digit Indian mobile number', 400);
  }
  return local;
}

function generateCode(): string {
  // Uniform over the code space; avoids the modulo bias of `% 10`.
  let out = '';
  while (out.length < AUTH.otpLength) {
    out += crypto.randomInt(0, 10).toString();
  }
  return out;
}

export async function requestOtp(rawPhone: string) {
  const phone = normalisePhone(rawPhone);

  // Rate limit per phone per hour.
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.customerOtp.count({
    where: { phone, createdAt: { gte: since } },
  });
  if (recent >= AUTH.otpRequestsPerHour) {
    throw new AppError('Too many codes requested. Please try again in an hour.', 429);
  }

  const code = generateCode();
  await prisma.customerOtp.create({
    data: {
      phone,
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + AUTH.otpTtlMinutes * 60_000),
    },
  });

  const text = `${code} is your ${shopConfig.identity.name} verification code. It is valid for ${AUTH.otpTtlMinutes} minutes. Please do not share it with anyone.`;

  let delivered = false;
  if (AUTH.otpChannel === 'whatsapp') {
    const res = await sendWhatsAppText({ to: `91${phone}`, text });
    delivered = res.success;
    if (!res.success) {
      console.warn(`[shop/auth] WhatsApp OTP to ${phone} failed: ${res.error}`);
    }
  }

  // In development the code comes back in the response so the flow is testable
  // without a WhatsApp number. `devEchoOtp` can never be true in production.
  return {
    sent: true,
    delivered,
    expiresInSeconds: AUTH.otpTtlMinutes * 60,
    ...(AUTH.devEchoOtp ? { devCode: code } : {}),
  };
}

export interface CustomerTokens {
  accessToken: string;
  refreshToken: string;
  customer: { id: number; firstName: string; lastName: string | null; phone: string };
}

async function issueTokens(
  customerId: number,
  meta: { userAgent?: string; ipAddress?: string }
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = jwt.sign(
    { customerId, aud: 'shop' },
    AUTH.jwtSecret,
    { expiresIn: AUTH.accessTokenTtl }
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + AUTH.refreshTokenTtlDays);

  await prisma.customerSession.create({
    data: {
      customerId,
      refreshTokenHash: hash(refreshToken),
      userAgent: meta.userAgent?.slice(0, 255),
      ipAddress: meta.ipAddress,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

export async function verifyOtp(
  rawPhone: string,
  code: string,
  meta: { userAgent?: string; ipAddress?: string; firstName?: string } = {}
): Promise<CustomerTokens> {
  const phone = normalisePhone(rawPhone);

  const otp = await prisma.customerOtp.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) throw new AppError('That code has expired. Please request a new one.', 400);

  if (otp.attempts >= AUTH.otpMaxAttempts) {
    throw new AppError('Too many incorrect attempts. Please request a new code.', 429);
  }

  if (otp.codeHash !== hash(code)) {
    await prisma.customerOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError('That code is not right. Please check and try again.', 400);
  }

  await prisma.customerOtp.update({
    where: { id: otp.id },
    data: { consumedAt: new Date() },
  });

  // Match to the EXISTING counter record by phone — never create a duplicate
  // CRM row for someone the shop already knows.
  let customer = await prisma.customer.findUnique({ where: { phone } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { firstName: meta.firstName?.trim() || 'Customer', phone },
    });
  } else if (
    meta.firstName &&
    (customer.firstName === 'Customer' || customer.firstName.trim() === '')
  ) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { firstName: meta.firstName.trim() },
    });
  }

  const tokens = await issueTokens(customer.id, meta);
  return {
    ...tokens,
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
    },
  };
}

export async function refreshSession(
  refreshToken: string,
  meta: { userAgent?: string; ipAddress?: string } = {}
): Promise<CustomerTokens> {
  const session = await prisma.customerSession.findUnique({
    where: { refreshTokenHash: hash(refreshToken) },
    include: { customer: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError('Please sign in again', 401);
  }

  // Rotate: the presented token is burned and a new one issued, so a stolen
  // refresh token is usable at most once.
  await prisma.customerSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokens(session.customerId, meta);
  return {
    ...tokens,
    customer: {
      id: session.customer.id,
      firstName: session.customer.firstName,
      lastName: session.customer.lastName,
      phone: session.customer.phone,
    },
  };
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.customerSession.updateMany({
    where: { refreshTokenHash: hash(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Verify a shopper access token. Returns null rather than throwing. */
export function verifyAccessToken(token: string): { customerId: number } | null {
  try {
    const decoded = jwt.verify(token, AUTH.jwtSecret) as { customerId?: number; aud?: string };
    // A staff JWT must never authenticate a shopper, and vice versa.
    if (decoded.aud !== 'shop' || !decoded.customerId) return null;
    return { customerId: decoded.customerId };
  } catch {
    return null;
  }
}
