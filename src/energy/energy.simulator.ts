/**
 * Enerji Tuketim Simulatoru
 *
 * Her 5 dakikada fabrika geneli enerji tuketim kaydi olusturur.
 * Makine durumuna gore guc hesaplar.
 * Her snapshot'i backend sustainability/energy endpoint'ine gonderir.
 */

import type { MachineSimulator } from '../machines/machine.simulator';
import { ApiClient } from '../upstream/api.client';

export interface EnergySnapshot {
  timestamp: string;
  totalElectricityKw: number;
  machines: Array<{
    machineId: string;
    state: string;
    powerKw: number;
  }>;
}

export class EnergySimulator {
  private lastSnapshotTime = 0;
  private snapshots: EnergySnapshot[] = [];
  private apiClient: ApiClient | null = null;
  private totalSentToBackend = 0;
  private static readonly SNAPSHOT_INTERVAL_SEC = 300;

  setApiClient(client: ApiClient) {
    this.apiClient = client;
  }

  async tick(machines: MachineSimulator[], simTime: Date, elapsedSec: number): Promise<EnergySnapshot | null> {
    this.lastSnapshotTime += elapsedSec;
    if (this.lastSnapshotTime < EnergySimulator.SNAPSHOT_INTERVAL_SEC) return null;
    this.lastSnapshotTime = 0;

    let totalKw = 0;
    const machineData: EnergySnapshot['machines'] = [];

    for (const machine of machines) {
      const config = machine.getConfig();
      const state = machine.getState();
      let powerKw = 0;
      switch (state) {
        case 'running': powerKw = config.runningPowerKw; break;
        case 'warmup': powerKw = (config.runningPowerKw + config.idlePowerKw) / 2; break;
        case 'idle': case 'setup': powerKw = config.idlePowerKw; break;
        case 'alarm': powerKw = config.idlePowerKw * 0.5; break;
        case 'maintenance': powerKw = config.idlePowerKw * 0.3; break;
        default: powerKw = 0;
      }
      totalKw += powerKw;
      machineData.push({ machineId: config.machineId, state, powerKw });
    }

    const snapshot: EnergySnapshot = { timestamp: simTime.toISOString(), totalElectricityKw: totalKw, machines: machineData };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 100) this.snapshots = this.snapshots.slice(-100);

    // Backend'e enerji kaydi gonder
    if (this.apiClient) {
      const dateStr = simTime.toISOString().split('T')[0];
      try {
        await this.apiClient.sendEnergyConsumption({
          date: dateStr,
          electricityKwh: totalKw * 5 / 60,
          source: 'telemetry',
        });
        this.totalSentToBackend++;
      } catch {}

      // En yuksek 3 makine icin ayri kayit
      for (const m of machineData.filter(m => m.powerKw > 0).sort((a, b) => b.powerKw - a.powerKw).slice(0, 3)) {
        try {
          await this.apiClient.sendEnergyConsumption({ equipmentId: m.machineId, date: dateStr, electricityKwh: m.powerKw * 5 / 60, source: 'telemetry' });
        } catch {}
      }
    }

    return snapshot;
  }

  getSnapshots(): EnergySnapshot[] { return this.snapshots; }
  getTotalKwhToday(): number { return this.snapshots.reduce((s, snap) => s + (snap.totalElectricityKw * 5 / 60), 0); }
  getTotalSentToBackend(): number { return this.totalSentToBackend; }
}
