import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { Transport, TransportSendInput } from './base';
import { registerTransport } from './registry';
import { AppError } from '../../../middleware/errorHandler';

/**
 * CUPS transport for macOS and Linux.
 *
 * Uses `lp -d <queue> -o raw <tempfile>` to submit a job to a printer
 * that's already installed in CUPS. This path:
 *
 *   - Supports any printer for which the OS has a CUPS driver
 *   - Works on macOS (which has no /dev/usb/lp*)
 *   - Supports multiple printers on a single Linux host (one CUPS queue
 *     per physical printer)
 *   - Inherits the user's existing CUPS configuration — no extra setup
 *
 * For thermal printers speaking TSPL/ZPL/EPL2, `-o raw` is essential
 * so CUPS bypasses its driver stack and passes bytes through untouched.
 * For the PDF driver, we drop `-o raw` and let CUPS pipe the PDF
 * through the printer's installed driver.
 */

class CupsTransport implements Transport {
  readonly name = 'cups';
  readonly displayName = 'CUPS queue (macOS / Linux)';

  isSupported(): boolean {
    const p = os.platform();
    return p === 'linux' || p === 'darwin';
  }

  async send({ bytes, contentType, connection }: TransportSendInput): Promise<void> {
    const queueName = connection.queueName;
    if (!queueName) {
      throw new AppError(
        'CUPS transport requires `connection.queueName` on the printer profile. Run `lpstat -a` on the server to see available queue names.',
        400
      );
    }
    if (!this.isSupported()) {
      throw new AppError(
        `CUPS transport unavailable on ${os.platform()}. Use 'win-spool' on Windows.`,
        400
      );
    }

    // Write the bytes to a temp file; `lp` reads the file and submits it.
    const tmpDir = os.tmpdir();
    const isPdf = contentType === 'application/pdf';
    const ext = isPdf ? '.pdf' : '.bin';
    const tmpFile = path.join(
      tmpDir,
      `clothing-erp-print-${process.pid}-${Date.now()}${ext}`
    );

    await fs.writeFile(tmpFile, bytes);

    try {
      // For thermal raw bytes: `-o raw` bypasses CUPS rasterization.
      // For PDFs: omit `-o raw` so CUPS routes through the installed driver.
      const args = isPdf
        ? ['-d', queueName, tmpFile]
        : ['-d', queueName, '-o', 'raw', tmpFile];
      await runCommand('lp', args);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new AppError(
          "CUPS command `lp` not found. Install CUPS: `sudo apt install cups` on Linux, or use macOS's built-in CUPS.",
          503
        );
      }
      throw new AppError(
        `CUPS print failed (queue '${queueName}'): ${err.message || err}`,
        503
      );
    } finally {
      // Best-effort cleanup; CUPS has already copied the file into its spool.
      fs.unlink(tmpFile).catch(() => {});
    }
  }
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
    });
  });
}

registerTransport(new CupsTransport());
