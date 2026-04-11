import * as os from 'os';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { identifyPrinter, VendorMatch } from './vendor-database';

/**
 * Enumerate printers already installed on the host OS.
 *
 * This is the "zero config" path: if the customer has already installed
 * their printer via the normal OS flow (Windows Settings → Add Printer,
 * macOS Print & Scan, Linux CUPS), we can detect it and suggest a profile
 * that uses `win-spool` (Windows) or `cups` (Mac/Linux). On Linux with
 * direct USB, we also scan `/dev/usb/lp*`.
 */

export interface OsDiscoveredPrinter {
  /** The name to show in the UI. */
  displayName: string;
  /** Transport that will deliver bytes to this printer. */
  transport: 'win-spool' | 'cups' | 'usb-lp';
  /** Connection fields to store on the profile. */
  connection: { queueName?: string; devicePath?: string };
  /** Best guess at driver + capabilities, undefined if nothing matched. */
  suggestion?: VendorMatch;
}

export async function listOsPrinters(): Promise<OsDiscoveredPrinter[]> {
  const platform = os.platform();
  try {
    if (platform === 'win32') return await listWindowsPrinters();
    if (platform === 'darwin') return await listCupsPrinters();
    if (platform === 'linux') {
      // Linux has both CUPS and raw /dev/usb/lp* — offer both.
      const [cups, usb] = await Promise.all([
        listCupsPrinters().catch(() => []),
        listLinuxUsbLpDevices().catch(() => []),
      ]);
      return [...cups, ...usb];
    }
  } catch {
    // Swallow — the UI shows an empty list and the user can add manually.
  }
  return [];
}

// ─── Windows ──────────────────────────────────────────────────────
//
// `Get-Printer | Select Name, DriverName | ConvertTo-Json` returns JSON
// with one object per printer. We parse it and enrich each entry with
// our vendor-database suggestion.

async function listWindowsPrinters(): Promise<OsDiscoveredPrinter[]> {
  const stdout = await runCommandForStdout('powershell.exe', [
    '-NoProfile',
    '-Command',
    '$OutputEncoding = [System.Text.Encoding]::UTF8; Get-Printer | Select-Object Name, DriverName | ConvertTo-Json -Compress',
  ]);

  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  // ConvertTo-Json returns a single object for 1 printer, an array for many.
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: OsDiscoveredPrinter[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as any).Name as string | undefined;
    const driverName = (entry as any).DriverName as string | undefined;
    if (!name) continue;
    const searchText = `${name} ${driverName ?? ''}`;
    out.push({
      displayName: name,
      transport: 'win-spool',
      connection: { queueName: name },
      suggestion: identifyPrinter(searchText),
    });
  }
  return out;
}

// ─── macOS / Linux CUPS ────────────────────────────────────────────
//
// `lpstat -a` prints one line per queue:
//   Office_Zebra accepting requests since ...
// We take the first token of each line as the queue name.

async function listCupsPrinters(): Promise<OsDiscoveredPrinter[]> {
  const stdout = await runCommandForStdout('lpstat', ['-a']);
  const out: OsDiscoveredPrinter[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const queueName = trimmed.split(/\s+/)[0];
    if (!queueName) continue;
    out.push({
      displayName: queueName,
      transport: 'cups',
      connection: { queueName },
      suggestion: identifyPrinter(queueName),
    });
  }
  return out;
}

// ─── Linux /dev/usb/lp* ────────────────────────────────────────────
//
// Each /dev/usb/lp0, /dev/usb/lp1 etc. is a raw-bytes endpoint for
// whichever USB printer was plugged in. We can't determine the model
// from the device node alone, so the suggestion is undefined.

async function listLinuxUsbLpDevices(): Promise<OsDiscoveredPrinter[]> {
  try {
    const entries = await fs.readdir('/dev/usb').catch(() => [] as string[]);
    const out: OsDiscoveredPrinter[] = [];
    for (const entry of entries) {
      if (!/^lp\d+$/.test(entry)) continue;
      const devicePath = `/dev/usb/${entry}`;
      out.push({
        displayName: `Linux USB: ${devicePath}`,
        transport: 'usb-lp',
        connection: { devicePath },
        suggestion: undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── helper ────────────────────────────────────────────────────────

function runCommandForStdout(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
    });
  });
}
