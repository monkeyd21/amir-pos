/**
 * Printing module entry point.
 *
 * Importing this file triggers self-registration of every driver and
 * transport — they each call `registerDriver(...)` / `registerTransport(...)`
 * at module load time.
 *
 * To add a new driver: create `drivers/foo.driver.ts`, export a singleton
 * and add one import line below. No other wiring.
 */

// Drivers (self-register on import)
import './drivers/tspl.driver';
import './drivers/zpl.driver';
import './drivers/epl2.driver';
import './drivers/escpos.driver';
import './drivers/pdf.driver';

// Transports (self-register on import)
import './transports/tcp.transport';
import './transports/usb-lp.transport';
import './transports/cups.transport';
import './transports/win-spool.transport';
import './transports/browser.transport';

export { listDrivers, getDriver } from './drivers/registry';
export { listTransports, getTransport } from './transports/registry';
export * from './ir/types';
export { DEFAULT_LABEL_TEMPLATE } from './ir/defaults';
