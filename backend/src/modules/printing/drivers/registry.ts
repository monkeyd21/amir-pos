import { Driver } from './base';
import { AppError } from '../../../middleware/errorHandler';

/**
 * Driver registry. Each driver module calls `registerDriver(new XyzDriver())`
 * at import time. The printing module's index.ts imports every driver so they
 * all self-register on application boot.
 *
 * To add a new driver: create a file in `drivers/`, implement the Driver
 * interface, and import your file from `printing/index.ts`. No other wiring.
 */
const registry = new Map<string, Driver>();

export function registerDriver(driver: Driver): void {
  if (registry.has(driver.name)) {
    // Double-registration is a programming error during dev reloads —
    // silently overwrite, don't throw, so nodemon restarts stay smooth.
  }
  registry.set(driver.name, driver);
}

export function getDriver(name: string): Driver {
  const driver = registry.get(name);
  if (!driver) {
    throw new AppError(
      `Unknown printer driver '${name}'. Known drivers: ${listDrivers()
        .map((d) => d.name)
        .join(', ')}`,
      400
    );
  }
  return driver;
}

export function listDrivers(): Driver[] {
  return Array.from(registry.values());
}
