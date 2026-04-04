/**
 * Enerji Tuketim Simulatoru
 *
 * Her 5 dakikada fabrika geneli enerji tuketim kaydi olusturur.
 * Makine durumuna gore guc hesaplar, Kafka'ya energy-reading event gonderir.
 */

import type { MachineSimulator } from '../machines/machine.simulator';

export interface EnergySnapshot {
  timestamp: string;
  totalElectricityKw: number;
  machines: Array<{
    machineId: string;
    state: string;
    powerKw: number;
    cumulativeKwh: number;
  }>;
}

export class EnergySimulator {
  private lastSnapshotTime = 0;
  private snapshots: EnergySnapshot[] = [];
  private static readonly SNAPSHOT_INTERVAL_SEC = 300; // 5 dakika

  /**
   * Her tick'te kontrol et, 5 dakikada bir snapshot al
   */
  tick(machines: MachineSimulator[], simTime: Date, elapsedSec: number): EnergySnapshot | null {
    this.lastSnapshotTime += elapsedSec;

    if (this.lastSnapshotTime < EnergySimulator.SNAPSHOT_INTERVAL_SEC) {
      return null;
    }

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
        case 'idle':
        case 'setup': powerKw = config.idlePowerKw; break;
        case 'alarm': powerKw = config.idlePowerKw * 0.5; break;
        case 'maintenance': powerKw = config.idlePowerKw * 0.3; break;
        default: powerKw = 0;
      }

      totalKw += powerKw;

      machineData.push({
        machineId: config.machineId,
        state,
        powerKw,
        cumulativeKwh: 0, // Tag generator'dan alinacak
      });
    }

    const snapshot: EnergySnapshot = {
      timestamp: simTime.toISOString(),
      totalElectricityKw: totalKw,
      machines: machineData,
    };

    this.snapshots.push(snapshot);

    // Son 100 snapshot tut
    if (this.snapshots.length > 100) {
      this.snapshots = this.snapshots.slice(-100);
    }

    return snapshot;
  }

  getSnapshots(): EnergySnapshot[] {
    return this.snapshots;
  }

  getTotalKwhToday(): number {
    // Her snapshot 5 dk = 5/60 saat
    return this.snapshots.reduce((sum, s) => sum + (s.totalElectricityKw * 5 / 60), 0);
  }
}
