/**
 * Read a weighbridge indicator straight from the browser, over the PC's COM
 * port, with the Web Serial API (Chrome and Edge on Windows, Linux, Chrome OS).
 *
 * No agent to install on the weighbridge PC: the operator presses Get, picks
 * the COM port once (the browser remembers the choice for this site), and the
 * frames the indicator streams for a couple of seconds go to the server, which
 * parses and validates them exactly as it does for every other source. Nothing
 * here interprets the weight.
 */

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}

function serialApi(): SerialLike | null {
  if (typeof navigator === 'undefined') return null;
  const s = (navigator as unknown as { serial?: SerialLike }).serial;
  return s && typeof s.requestPort === 'function' ? s : null;
}

/** True in a browser that can open a COM port (Chrome, Edge). */
export function serialSupported(): boolean {
  return serialApi() !== null;
}

/**
 * Ask the operator to pick the COM port. Must run from a click. The browser
 * keeps the permission, so later reads need no dialog; call this again to
 * switch to a different port.
 */
export async function chooseSerialPort(): Promise<boolean> {
  const api = serialApi();
  if (!api) return false;
  try {
    await api.requestPort();
    return true;
  } catch {
    // The operator closed the dialog: not an error worth showing.
    return false;
  }
}

/**
 * Collect the raw frames the indicator sends in `ms` milliseconds. Returns
 * them one per line, empty lines dropped. Throws a plain-words error when no
 * port is granted, the port cannot be opened, or nothing arrives.
 */
export async function readSerialFrames(opts: { baudRate: number; ms?: number }): Promise<string[]> {
  const api = serialApi();
  if (!api) throw new Error('This browser cannot read a COM port. Use Chrome or Edge on the weighbridge PC.');
  let [port] = await api.getPorts();
  if (!port) {
    try {
      port = await api.requestPort();
    } catch {
      throw new Error('No COM port chosen. Press Get again and pick the port the indicator is plugged into.');
    }
  }
  try {
    await port.open({ baudRate: opts.baudRate > 0 ? opts.baudRate : 9600 });
  } catch (e) {
    throw new Error(`Could not open the COM port (${e instanceof Error ? e.message : 'unknown error'}). Is another program using it?`);
  }
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  const reader = port.readable?.getReader();
  if (!reader) {
    await port.close();
    throw new Error('The COM port opened but cannot be read.');
  }
  const deadline = Date.now() + (opts.ms ?? 2500);
  try {
    while (Date.now() < deadline) {
      const left = deadline - Date.now();
      const next = reader.read();
      const timeout = new Promise<{ done: true; value: undefined }>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), left));
      const { value, done } = await Promise.race([next, timeout]);
      if (done) break;
      if (value) chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    try { await reader.cancel(); } catch { /* the stream may already be closed */ }
    reader.releaseLock();
    try { await port.close(); } catch { /* best effort */ }
  }
  const frames = chunks.join('').split(/[\r\n]+/).map((f) => f.trim()).filter(Boolean);
  if (!frames.length) {
    throw new Error('Nothing came from the indicator. Check the cable, that the indicator is switched on, and that the baud rate matches it.');
  }
  return frames;
}
