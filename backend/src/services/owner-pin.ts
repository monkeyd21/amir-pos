import prisma from '../config/database';
import { getSetting, setSetting } from '../modules/settings/service';
import { AppError } from '../middleware/errorHandler';

/**
 * §6.4 Owner PIN — the single PIN that gates privileged POS actions: the
 * Owner Discretion Discount (§2.3) and the EOD variance override (§8.2). Set up
 * once by the Owner and changeable later; every change is audited.
 *
 * Stored under the `ownerPin` setting. This replaces the earlier "supervisor
 * PIN" concept — for a smooth migration we fall back to any legacy
 * `supervisorPin` value, then to a default, until an Owner PIN is explicitly
 * set. Once set, `ownerPin` is authoritative.
 */
const OWNER_PIN_KEY = 'ownerPin';
const LEGACY_PIN_KEY = 'supervisorPin';
const DEFAULT_OWNER_PIN = '1234';

/** The PIN currently in force (explicit owner PIN → legacy → default). */
async function currentPin(): Promise<string> {
  const legacy = await getSetting<string>(LEGACY_PIN_KEY, DEFAULT_OWNER_PIN);
  return getSetting<string>(OWNER_PIN_KEY, legacy);
}

/** True once an Owner PIN (or a legacy supervisor PIN) has been explicitly set. */
export async function isOwnerPinSet(): Promise<boolean> {
  const row = await prisma.setting.findFirst({
    where: { key: { in: [OWNER_PIN_KEY, LEGACY_PIN_KEY] } },
  });
  return !!row;
}

/** Throw 403 unless `pin` matches the Owner PIN in force. */
export async function verifyOwnerPin(pin: string | undefined | null): Promise<void> {
  const expected = await currentPin();
  if (!pin || String(pin) !== String(expected)) {
    throw new AppError('Invalid Owner PIN', 403);
  }
}

/**
 * Set or change the Owner PIN. If one is already configured, the caller must
 * supply the matching current PIN. New PIN must be 4–8 digits.
 */
export async function setOwnerPin(newPin: string, currentPinInput?: string): Promise<void> {
  if (!/^\d{4,8}$/.test(newPin || '')) {
    throw new AppError('Owner PIN must be 4 to 8 digits', 400);
  }
  if (await isOwnerPinSet()) {
    await verifyOwnerPin(currentPinInput);
  }
  await setSetting(OWNER_PIN_KEY, newPin);
}
