import { Transport } from './base';
import { AppError } from '../../../middleware/errorHandler';

const registry = new Map<string, Transport>();

export function registerTransport(transport: Transport): void {
  registry.set(transport.name, transport);
}

export function getTransport(name: string): Transport {
  const transport = registry.get(name);
  if (!transport) {
    throw new AppError(
      `Unknown printer transport '${name}'. Known transports: ${listTransports()
        .map((t) => t.name)
        .join(', ')}`,
      400
    );
  }
  return transport;
}

export function listTransports(): Transport[] {
  return Array.from(registry.values());
}
