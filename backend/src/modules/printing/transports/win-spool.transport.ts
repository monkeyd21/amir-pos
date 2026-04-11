import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { Transport, TransportSendInput } from './base';
import { registerTransport } from './registry';
import { AppError } from '../../../middleware/errorHandler';

/**
 * Windows Print Spooler transport (primary transport on Windows).
 *
 * Why this exists: Windows has no /dev/usb/lp* and no CUPS. The
 * officially-supported way to send raw bytes to a printer is the
 * Win32 Print Spooler API (OpenPrinter / StartDocPrinter / WritePrinter).
 * Node.js doesn't expose this directly and the popular native bindings
 * (`@thiagoelg/node-printer`) regularly break on new Node versions.
 *
 * Instead of bundling a binary, we ship a **PowerShell script** that
 * P/Invokes the exact same Win32 API via inline C#:
 *
 *     powershell -NoProfile -ExecutionPolicy Bypass -File rawprint.ps1 \
 *         "<printer name>" <tempfile>
 *
 * This gives us all the benefits of a bundled helper with none of the
 * drawbacks:
 *   - No binary to vet, sign, or ship through antivirus
 *   - Human-readable, reviewable, auditable source code
 *   - PowerShell is present on every Windows 7 SP1+ install
 *   - Uses whichever printer driver the customer has already installed —
 *     one-click "Add Printer" and it just works
 *   - Handles raw thermal bytes and PDFs interchangeably
 */

// The script lives at backend/bin/win32/rawprint.ps1 and is committed.
// When the backend runs from ts-node (dev) or compiled dist (prod) we
// resolve the path relative to __dirname.
function resolveScriptPath(): string {
  // __dirname resolves to either:
  //   <repo>/backend/src/modules/printing/transports   (ts-node dev)
  //   <repo>/backend/dist/modules/printing/transports  (compiled)
  const relative = path.join('..', '..', '..', '..', 'bin', 'win32', 'rawprint.ps1');
  return path.resolve(__dirname, relative);
}

let cachedScriptPath: string | null = null;

async function getScriptPath(): Promise<string> {
  if (cachedScriptPath) return cachedScriptPath;
  const p = resolveScriptPath();
  try {
    await fs.access(p);
    cachedScriptPath = p;
    return p;
  } catch {
    throw new AppError(
      `rawprint.ps1 not found at ${p}. The bundled Windows helper script is missing — reinstall the application.`,
      500
    );
  }
}

class WinSpoolTransport implements Transport {
  readonly name = 'win-spool';
  readonly displayName = 'Windows Print Spooler (any installed printer)';

  isSupported(): boolean {
    return os.platform() === 'win32';
  }

  async send({ bytes, connection }: TransportSendInput): Promise<void> {
    if (os.platform() !== 'win32') {
      throw new AppError(
        `Windows Spool transport only works on Windows (current platform: ${os.platform()}). Use 'cups' on macOS/Linux, or 'usb-lp' on Linux.`,
        400
      );
    }
    const queueName = connection.queueName;
    if (!queueName) {
      throw new AppError(
        "Windows Spool transport requires `connection.queueName` — the exact printer name as it appears in Windows Settings → Printers & Scanners.",
        400
      );
    }

    const scriptPath = await getScriptPath();

    // Write bytes to a temp file. The PowerShell script reads it as a byte
    // array via [System.IO.File]::ReadAllBytes — reliable for binary data
    // in any locale (unlike piping binary to PowerShell stdin).
    const tmpFile = path.join(
      os.tmpdir(),
      `clothing-erp-print-${process.pid}-${Date.now()}.bin`
    );
    await fs.writeFile(tmpFile, bytes);

    try {
      await runCommand('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        queueName,
        tmpFile,
      ]);
    } catch (err: any) {
      throw new AppError(
        `Windows Spool print failed (queue '${queueName}'): ${err.message || err}`,
        503
      );
    } finally {
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

registerTransport(new WinSpoolTransport());
