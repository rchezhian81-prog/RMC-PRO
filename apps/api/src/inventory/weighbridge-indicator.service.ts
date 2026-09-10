import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Socket } from 'node:net';
import { lookup } from 'node:dns/promises';
import { TenantDbService } from '../core/database/tenant-db.service';
import { WeighbridgeIndicator } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import {
  parseIndicatorFrame,
  pickStableReading,
  simulateIndicatorBurst,
  type IndicatorReading,
  type WeightUnit,
} from './weighbridge-indicator.util';
import { classifyAddress, isRoutableAddress, isValidPort, privateIndicatorsAllowed } from './indicator-host.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Weighbridge indicator not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

const DEFAULT_SIMULATED_KG = 25000;

export interface LiveReading {
  indicatorId: string;
  indicatorName: string;
  connectionType: string;
  stable: boolean;
  type: IndicatorReading['type'];
  unit: WeightUnit;
  /** weight in the indicator's reported unit. */
  weight: number;
  /** weight normalised to kilograms — what the weighbridge entry stores. */
  weightKg: number;
  capturedAt: string;
  /** the raw frame the reading was taken from, for the audit trail. */
  raw: string;
}

/**
 * Weighbridge hardware bridge (Plan E1). Owns the indicator device registry and
 * the live "Get weight" read. Three capture paths, all funnelled through the
 * pure protocol parser:
 *   - `simulated`   — a deterministic settling burst (demo + the CI-tested path)
 *   - local agent   — raw frames POSTed by the offline plant-app / a small local
 *                     serial agent, parsed and validated server-side
 *   - `tcp`         — the API connects to a TCP indicator (real, guarded; never
 *                     exercised in CI because no TCP device is configured there)
 *
 * A live read is side-effect-free: it never writes an entry and never mutates
 * the device. Persisting the weight stays with WeighbridgeService.create, which
 * stamps the provenance.
 */
@Injectable()
export class WeighbridgeIndicatorService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(WeighbridgeIndicator).find({ order: { createdAt: 'DESC' } }),
    );
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(WeighbridgeIndicator).findOne({ where: { id } });
      if (!row) throw notFound();
      return row;
    });
  }

  /**
   * The rules a stored indicator must satisfy. update() applies them to the
   * MERGED row, not just the patch: it used to spread the DTO straight into
   * repo.update, so an indicator could be switched to `tcp` with no host/port —
   * or to a connectionType create() would have rejected outright.
   */
  private assertValidConfig(cfg: Record<string, unknown>): { name: string; connectionType: string } {
    const name = String(cfg.name ?? '').trim();
    if (!name) throw badReq('Indicator name is required');
    const connectionType = String(cfg.connectionType ?? 'simulated');
    if (!['simulated', 'tcp', 'serial'].includes(connectionType)) {
      throw badReq(`Invalid connectionType ${connectionType}`);
    }
    if (connectionType === 'tcp') {
      if (!cfg.host || !cfg.port) throw badReq('A TCP indicator needs a host and port');
      if (!isValidPort(cfg.port)) throw badReq('Indicator port must be between 1 and 65535');
    }
    return { name, connectionType };
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const { name, connectionType } = this.assertValidConfig(dto);
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId']) delete rest[k];
      const repo = m.getRepository(WeighbridgeIndicator);
      const saved = await repo.save(repo.create({ ...rest, tenantId, name, connectionType } as Record<string, unknown>));
      return repo.findOne({ where: { id: saved.id } });
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(WeighbridgeIndicator);
      const row = await repo.findOne({ where: { id } });
      if (!row) throw notFound();
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId']) delete rest[k];
      this.assertValidConfig({ ...(row as unknown as Record<string, unknown>), ...rest });
      await repo.update(id, rest);
      return repo.findOne({ where: { id } });
    });
  }

  /**
   * Read the current weight off an indicator. `opts.rawFrames` is the local-agent
   * path: the plant-side reader supplies the frames it pulled from the serial
   * port and the server just parses/validates them.
   */
  read(tenantId: string, id: string, opts?: { rawFrames?: unknown }): Promise<LiveReading> {
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await m.getRepository(WeighbridgeIndicator).findOne({ where: { id } });
      if (!device) throw notFound();
      if (!device.isActive) throw badReq('Indicator is inactive');

      const unit = (device.unit ?? 'kg') as WeightUnit;
      const agentFrames = Array.isArray(opts?.rawFrames)
        ? (opts!.rawFrames as unknown[]).map((f) => String(f)).filter((f) => f.length > 0)
        : null;

      let reading: IndicatorReading;
      if (agentFrames && agentFrames.length > 0) {
        // Local-agent / offline plant-app path: validate what the device sent.
        reading = pickStableReading(agentFrames);
      } else if (device.connectionType === 'simulated') {
        const nominal = device.simulatedWeightKg != null ? Number(device.simulatedWeightKg) : DEFAULT_SIMULATED_KG;
        reading = pickStableReading(simulateIndicatorBurst(nominal, unit));
      } else if (device.connectionType === 'tcp') {
        reading = parseIndicatorFrame(await this.readTcpFrame(device.host, device.port));  // guarded below
      } else {
        throw badReq('Serial indicators are read by the plant-side agent — post the raw frames to this endpoint');
      }

      return {
        indicatorId: device.id,
        indicatorName: device.name,
        connectionType: device.connectionType,
        stable: reading.stable,
        type: reading.type,
        unit: reading.unit,
        weight: reading.weight,
        weightKg: reading.weightKg,
        capturedAt: new Date().toISOString(),
        raw: reading.raw,
      };
    });
  }

  /**
   * Connect to a TCP indicator and return the first non-empty frame it streams.
   * Real hardware path — guarded by a short timeout and never reached in CI
   * (no TCP indicator is configured for the test tenant).
   */
  private async readTcpFrame(host: string | null, port: number | null): Promise<string> {
    if (!host || !port) throw badReq('TCP indicator is missing host/port');
    if (!isValidPort(port)) throw badReq('Indicator port must be between 1 and 65535');
    const target = await this.resolveIndicatorAddress(host);
    return new Promise<string>((resolve, reject) => {
      const socket = new Socket();
      let buffer = '';
      const done = (err: Error | null, frame?: string) => {
        socket.destroy();
        // One message for every failure mode. Reporting the underlying errno told
        // a caller ECONNREFUSED from ETIMEDOUT — i.e. open port from filtered —
        // which is precisely the port-scan signal the address guard exists to deny.
        if (err) reject(badReq(`Weighbridge indicator did not respond at ${host}:${port}`));
        else resolve(frame ?? '');
      };
      socket.setTimeout(2000);
      socket.on('timeout', () => done(new Error('unreachable')));
      socket.on('error', () => done(new Error('unreachable')));
      socket.on('data', (chunk) => {
        buffer += chunk.toString('latin1');
        // A peer that never sends a newline would otherwise buffer without bound.
        if (buffer.length > 8192) return done(new Error('unreachable'));
        const line = buffer.split(/[\r\n]+/).find((l) => l.trim().length > 0);
        if (line) done(null, line);
      });
      // Dial the address we just vetted, not the name: re-resolving here would
      // let a second DNS answer swap in a blocked address (DNS rebinding).
      socket.connect(port, target);
    });
  }

  /**
   * Resolve an indicator hostname and refuse anything that is not publicly
   * routable, so the device registry cannot be used to reach the API host's own
   * services, the cloud metadata endpoint, or the rest of the private network.
   */
  private async resolveIndicatorAddress(host: string): Promise<string> {
    let addresses: { address: string }[];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw badReq(`Weighbridge indicator host ${host} could not be resolved`);
    }
    const first = addresses[0];
    if (!first) throw badReq(`Weighbridge indicator host ${host} could not be resolved`);
    if (!privateIndicatorsAllowed()) {
      // EVERY answer must be routable — a name that resolves to both a public and
      // a private address must not be usable to reach the private one.
      const blocked = addresses.find((a) => !isRoutableAddress(a.address));
      if (blocked) {
        throw badReq(
          `Weighbridge indicator host ${host} resolves to a ${classifyAddress(blocked.address)} address, which cannot be used. ` +
            'Use a publicly reachable indicator, or read a plant-network device through the local agent.',
        );
      }
    }
    return first.address;
  }
}
