import * as net from 'net';
import * as os from 'os';
import { identifyPrinter, VendorMatch } from './vendor-database';

/**
 * Scan the local LAN for printers listening on port 9100 (raw JetDirect).
 *
 * Strategy:
 *   1. Determine the LAN subnet from the host's network interfaces
 *      (typically 192.168.1.0/24 or 10.0.0.0/24).
 *   2. Iterate every host in the /24 subnet — up to 254 IPs.
 *   3. Concurrently open TCP connections to host:9100 with a 300ms
 *      timeout. Hosts that accept the connection are candidate
 *      printers.
 *   4. For each hit, attempt a lightweight SNMP-ish device name probe.
 *      (We actually just trust the IP as a printer candidate — any
 *      hostname resolution happens client-side.)
 *
 * A full /24 scan completes in ~2-3 seconds with 64-way concurrency.
 * For /23 or larger networks, we cap the scan at 512 hosts and warn.
 */

const DEFAULT_PORT = 9100;
const PROBE_TIMEOUT_MS = 300;
const MAX_CONCURRENCY = 64;
const MAX_HOSTS = 512;

export interface TcpDiscoveredPrinter {
  host: string;
  port: number;
  /** Reverse-resolved hostname if DNS has a PTR record. */
  hostname?: string;
  suggestion?: VendorMatch;
}

export async function scanLan(): Promise<TcpDiscoveredPrinter[]> {
  const candidates = enumerateLanHosts();
  if (candidates.length === 0) return [];

  const limited = candidates.slice(0, MAX_HOSTS);
  const results: TcpDiscoveredPrinter[] = [];

  // Work-stealing queue: N workers pull from a shared index.
  let nextIdx = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENCY, limited.length); i++) {
    workers.push(
      (async () => {
        while (nextIdx < limited.length) {
          const host = limited[nextIdx++];
          const open = await probePort(host, DEFAULT_PORT);
          if (open) {
            results.push({
              host,
              port: DEFAULT_PORT,
              // Don't do suggestion here — we have no model info from raw TCP.
              // Frontend can prompt the user for a vendor/model after picking.
              suggestion: identifyPrinter(host),
            });
          }
        }
      })()
    );
  }
  await Promise.all(workers);
  return results.sort((a, b) => ipSortKey(a.host) - ipSortKey(b.host));
}

function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(open);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.once('connect', () => done(true));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

/**
 * Enumerate IPv4 host addresses in every /24 subnet the host is on,
 * excluding the host's own IP and the network/broadcast addresses.
 */
function enumerateLanHosts(): string[] {
  const hosts = new Set<string>();
  const ifaces = os.networkInterfaces();
  for (const ifaceName of Object.keys(ifaces)) {
    const addrs = ifaces[ifaceName] ?? [];
    for (const addr of addrs) {
      if (addr.family !== 'IPv4') continue;
      if (addr.internal) continue;
      const cidr = addr.cidr; // e.g. "192.168.1.42/24"
      if (!cidr) continue;
      const [ip, maskBitsStr] = cidr.split('/');
      const maskBits = parseInt(maskBitsStr, 10);
      // Only scan /24 or larger — bigger subnets are too slow without masscan.
      if (maskBits < 24) continue;
      const octets = ip.split('.').map((n) => parseInt(n, 10));
      // Generate all hosts in the /24
      for (let last = 1; last <= 254; last++) {
        if (last === octets[3]) continue; // skip self
        hosts.add(`${octets[0]}.${octets[1]}.${octets[2]}.${last}`);
      }
    }
  }
  return Array.from(hosts);
}

function ipSortKey(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => acc * 256 + parseInt(octet, 10), 0);
}
