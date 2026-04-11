import { Transport, TransportSendInput } from './base';
import { registerTransport } from './registry';
import { AppError } from '../../../middleware/errorHandler';

/**
 * Browser transport: "the server doesn't print — the browser does".
 *
 * This transport doesn't actually talk to a printer from the server.
 * Instead, the service layer detects `transport === 'browser'` and
 * returns the rendered bytes to the HTTP response so the frontend can:
 *
 *   - Open a PDF in a new window and invoke window.print()
 *   - Or render an HTML sticker sheet with JsBarcode and print that
 *
 * This is the last-resort fallback for customers who have:
 *   - A printer on a user's machine but not the POS server
 *   - Internet-only deployments where the server is remote
 *   - Non-raw printers (e.g. photo printers) for which PDF+browser print
 *     is the cleanest option
 *
 * Calling `send()` here is never correct — the service layer must short-
 * circuit and return the bytes to the HTTP caller. We throw if anything
 * reaches this code path.
 */

class BrowserTransport implements Transport {
  readonly name = 'browser';
  readonly displayName = 'Browser print (client-side, any OS)';

  isSupported(): boolean {
    return true; // available on every deployment
  }

  async send(_input: TransportSendInput): Promise<void> {
    throw new AppError(
      "The 'browser' transport cannot be used server-side — the print service must return the rendered bytes to the HTTP response for the frontend to print. This is a programming error in printing/service.ts.",
      500
    );
  }
}

registerTransport(new BrowserTransport());
