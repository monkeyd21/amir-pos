/**
 * Connection parameters stored on a `PrinterProfile.connection` JSON column.
 *
 * Different transports use different subsets:
 *   - tcp:       { host, port }
 *   - usb-lp:    { devicePath }
 *   - cups:      { queueName }
 *   - win-spool: { queueName }
 *   - browser:   {} (client-side print, no server-side connection)
 */
export interface PrinterConnection {
  host?: string;
  port?: number;
  devicePath?: string;
  queueName?: string;
}

export interface TransportSendInput {
  bytes: Buffer;
  /** Content type from the driver — transports may ignore or use it (PDF on win-spool). */
  contentType: string;
  connection: PrinterConnection;
}

/**
 * A Transport delivers pre-rendered bytes to a physical or virtual printer.
 * It knows nothing about command languages — it just moves bytes.
 */
export interface Transport {
  readonly name: string;
  readonly displayName: string;
  /** Returns true if this transport can plausibly run on the current host OS. */
  isSupported(): boolean;
  send(input: TransportSendInput): Promise<void>;
}
