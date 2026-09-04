import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';
import { fullName } from '../utils/helpers';
import { canApproveExchangeOverride } from '../modules/pos/exchange-limit';

/**
 * §0 one exchange per bill: the manager override.
 *
 * The shop calls one-exchange-per-bill a general policy, so a second swap is
 * allowed but only on a manager's or an owner's say-so, and only with their
 * name attached. That last part rules out the Owner PIN used elsewhere (§2.3
 * discretion discounts, §8.2 EOD variance): the PIN is one shared secret, so it
 * can say "somebody senior agreed" but never who. An override nobody can trace
 * is a hole, so the approver signs in with their own credentials instead.
 *
 * Approval is a two-step handshake rather than credentials riding along on the
 * checkout:
 *
 *   1. The manager authorises at the terminal and gets back a GRANT, a short
 *      lived signed token naming them and the one bill it covers.
 *   2. The exchange is submitted carrying that grant. The backend re-verifies
 *      the signature, so the approval is proven at the moment it is used.
 *
 * That keeps a password out of the POS cart state (which is snapshotted to
 * local storage), scopes the approval to a single bill, and expires it if the
 * exchange is abandoned. The audit row is written where the grant is SPENT, not
 * where it is issued, so the log never claims an override that never happened.
 */

/** Long enough to finish scanning the replacement goods, short enough to expire. */
export const OVERRIDE_GRANT_TTL_SECONDS = 10 * 60;

/** Marks the token as an override grant, so an access token cannot stand in. */
const GRANT_KIND = 'exchange-limit-override';

export interface ExchangeOverrideGrant {
  kind: typeof GRANT_KIND;
  /** The ORIGINAL bill this approval covers. A grant is good for that bill only. */
  saleId: number;
  approvedBy: number;
  approverName: string;
  approverRole: string;
}

export interface ExchangeOverrideApproval {
  grant: string;
  approvedBy: number;
  approverName: string;
  approverRole: string;
  expiresInSeconds: number;
}

/**
 * Verify a manager's or owner's own credentials and issue a grant for one bill.
 *
 * Deliberately gives the same message for a wrong password and for a real user
 * who simply is not senior enough to approve, so the form cannot be used to
 * probe who holds which role.
 */
export async function approveExchangeOverride(
  saleId: number,
  email: string,
  password: string
): Promise<ExchangeOverrideApproval> {
  const refused = new AppError(
    'Only an owner or a manager can approve a second exchange. Check the email and password.',
    403
  );

  const approver = await prisma.user.findUnique({
    // Matched exactly as `/auth/login` matches it, so the approver types the
    // same email they sign in with.
    where: { email: (email || '').trim() },
  });
  if (!approver || !approver.isActive) throw refused;
  if (!canApproveExchangeOverride(approver.role)) throw refused;

  const ok = await bcrypt.compare(password || '', approver.passwordHash);
  if (!ok) throw refused;

  const approverName = fullName(approver);
  const payload: ExchangeOverrideGrant = {
    kind: GRANT_KIND,
    saleId,
    approvedBy: approver.id,
    approverName,
    approverRole: approver.role,
  };

  return {
    grant: jwt.sign(payload, config.jwt.secret, { expiresIn: OVERRIDE_GRANT_TTL_SECONDS }),
    approvedBy: approver.id,
    approverName,
    approverRole: approver.role,
    expiresInSeconds: OVERRIDE_GRANT_TTL_SECONDS,
  };
}

/**
 * Re-check a grant at the moment the exchange is submitted. Throws 403 unless
 * it is a genuine, unexpired grant for THIS bill.
 */
export function verifyExchangeOverrideGrant(
  token: string | null | undefined,
  saleId: number
): ExchangeOverrideGrant {
  if (!token) {
    throw new AppError('A manager approval is required for a second exchange', 403);
  }

  let decoded: Partial<ExchangeOverrideGrant>;
  try {
    decoded = jwt.verify(token, config.jwt.secret) as Partial<ExchangeOverrideGrant>;
  } catch {
    throw new AppError('The manager approval has expired. Ask for it again.', 403);
  }

  if (decoded?.kind !== GRANT_KIND || !decoded.approvedBy) {
    throw new AppError('That is not a valid exchange approval', 403);
  }
  if (decoded.saleId !== saleId) {
    throw new AppError('That approval was given for a different bill', 403);
  }
  if (!canApproveExchangeOverride(decoded.approverRole)) {
    throw new AppError('That approval was not given by a manager or owner', 403);
  }

  return decoded as ExchangeOverrideGrant;
}
