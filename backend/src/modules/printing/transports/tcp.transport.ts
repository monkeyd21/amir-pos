import * as net from 'net';
import { Transport, TransportSendInput } from './base';
import { registerTransport } from './registry';
import { AppError } from '../../../middleware/errorHandler';

/**
 * Raw TCP transport (port 9100 / JetDirect).
 *
 * Works on every OS — all we need is a host and port. This is the
 * recommended transport for networked thermal printers (which are the
 * overwhelming majority of modern barcode hardware). The printer
 * accepts the raw command-language bytes directly on a socket.
 *
 * Default port 9100 is the de-facto standard. Some printers use 9101
 * or 515 (LPD) — those are configured via connection.port.
 */

const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 15_000;

class TcpTransport implements Transport {
  readonly name = 'tcp';
  readonly displayName = 'Network (TCP raw, port 9100)';

  isSupported(): boolean {
    return true; // net.Socket is always available in Node
  }

  async send({ bytes, connection }: TransportSendInput): Promise<void> {
    const host = connection.host;
    if (!host) {
      throw new AppError(
        'TCP transport requires `connection.host` on the printer profile.',
        400
      );
    }
    const port = connection.port ?? DEFAULT_PORT;

    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;

      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve();
      };

      const connectTimer = setTimeout(() => {
        done(
          new AppError(
            `Timed out connecting to printer at ${host}:${port}. Check the IP address and that the printer is powered on.`,
            503
          )
        );
      }, CONNECT_TIMEOUT_MS);

      socket.once('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(connectTimer);
        if (err.code === 'ECONNREFUSED') {
          done(
            new AppError(
              `Printer at ${host}:${port} refused the connection. The printer may not have port ${port} open, or the IP belongs to a different device.`,
              503
            )
          );
        } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
          done(
            new AppError(
              `Printer at ${host}:${port} is not reachable on this network.`,
              503
            )
          );
        } else {
          done(new AppError(`Printer network error: ${err.message}`, 503));
        }
      });

      socket.connect(port, host, () => {
        clearTimeout(connectTimer);
        // Write the bytes and close the write side so the printer knows
        // we're done. The printer typically closes the socket from its
        // end once it finishes buffering.
        socket.write(bytes, (err) => {
          if (err) return done(err);
          socket.end();
        });

        // Hard timeout in case the printer never closes the socket.
        const writeTimer = setTimeout(() => done(), WRITE_TIMEOUT_MS);
        socket.once('close', () => {
          clearTimeout(writeTimer);
          done();
        });
      });
    });
  }
}

registerTransport(new TcpTransport());
