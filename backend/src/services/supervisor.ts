import { getSetting } from '../modules/settings/service';
import { AppError } from '../middleware/errorHandler';

/**
 * Supervisor / manager PIN gate. Privileged POS actions (void, edit-after-
 * partial-payment, large EOD shortfall override) require this PIN. It is stored
 * as the `supervisorPin` setting; until an owner sets one, a default applies.
 *
 * Shared by §1.4 (void), §3.4 (edit lock), §8.4 (shortfall override).
 */
const DEFAULT_SUPERVISOR_PIN = '1234';

export async function verifySupervisorPin(pin: string | undefined | null): Promise<void> {
  const expected = await getSetting<string>('supervisorPin', DEFAULT_SUPERVISOR_PIN);
  if (!pin || String(pin) !== String(expected)) {
    throw new AppError('Invalid supervisor PIN', 403);
  }
}
