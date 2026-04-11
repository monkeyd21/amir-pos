import { promises as fs } from 'fs';
import * as os from 'os';
import { Transport, TransportSendInput } from './base';
import { registerTransport } from './registry';
import { AppError } from '../../../middleware/errorHandler';

/**
 * Linux USB raw printer transport.
 *
 * Writes bytes directly to a `/dev/usb/lp*` character device. This is
 * what the pre-refactor code did. It's the simplest option when you
 * have a single printer plugged into a Linux POS machine, but it:
 *
 *   - Only works on Linux
 *   - Requires the user running the backend to have write access
 *     (typically requires a udev rule adding them to the `lp` group,
 *     or running the backend as root, which we don't recommend)
 *   - Supports only one printer per device path
 *
 * For multi-printer Linux setups, prefer the `cups` transport.
 *
 * Writes are serialized via a write chain to avoid interleaving bytes
 * when multiple print jobs fire simultaneously.
 */

let writeChain: Promise<void> = Promise.resolve();

class UsbLpTransport implements Transport {
  readonly name = 'usb-lp';
  readonly displayName = 'USB raw (Linux /dev/usb/lp*)';

  isSupported(): boolean {
    return os.platform() === 'linux';
  }

  async send({ bytes, connection }: TransportSendInput): Promise<void> {
    const devicePath = connection.devicePath || '/dev/usb/lp0';
    if (os.platform() !== 'linux') {
      throw new AppError(
        `USB raw transport only works on Linux (current platform: ${os.platform()}). Use 'win-spool' on Windows, or 'cups' on macOS.`,
        400
      );
    }

    const next = writeChain.then(async () => {
      try {
        await fs.writeFile(devicePath, bytes);
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          throw new AppError(
            `Barcode printer not connected (${devicePath} not found). Power on the printer and check the USB cable.`,
            503
          );
        }
        if (err.code === 'EACCES' || err.code === 'EPERM') {
          throw new AppError(
            `Permission denied writing to ${devicePath}. Add the backend user to the 'lp' group: sudo usermod -a -G lp $USER, then re-login.`,
            503
          );
        }
        if (err.code === 'EIO') {
          throw new AppError(
            'Printer I/O error — check the media is loaded, the head is closed, and there is no paper jam.',
            503
          );
        }
        throw new AppError(`Failed to write to printer: ${err.message}`, 500);
      }
    });
    writeChain = next.catch(() => {});
    return next;
  }
}

registerTransport(new UsbLpTransport());
