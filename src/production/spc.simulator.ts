/**
 * SPC Olcum Simulatoru
 *
 * Backend'den SPC karakteristiklerini okur.
 * Gercekci normal dagilimli olcum degerleri uretir.
 * Altgrup bazli olcumleri backend'e gonderir.
 *
 * Her saat (sim zamani) bir altgrup (5 olcum) uretir.
 * Olcum degerleri: nominal +/- sigma (prosesin dogal degiskenligine gore)
 */

import { ApiClient } from '../upstream/api.client';
import { gaussian } from '../core/random.utils';

interface SpcChar {
  id: string;
  code: string;
  name: string;
  machineId?: string;
  nominalValue: number;
  upperSpecLimit: number;
  lowerSpecLimit: number;
  unit: string;
  subgroupSize: number;
  subgroupFrequency: string;
  // Simulasyon parametreleri
  processSigma: number; // Proses standart sapmasi
}

export class SpcSimulator {
  private characteristics: SpcChar[] = [];
  private apiClient: ApiClient;
  private subgroupCounters = new Map<string, number>(); // charId → current subgroup no
  private lastMeasurementSec = new Map<string, number>(); // charId → last measurement sim time
  private totalMeasurements = 0;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Backend'den SPC karakteristiklerini yukle
   */
  async loadCharacteristics() {
    const chars = await this.apiClient.getSpcCharacteristics();
    this.characteristics = chars.map((c) => {
      // Proses sigma hesapla: tolerans araligi / 6 * (1/Cpk)
      // Hedef Cpk=1.33 icin: sigma = (USL-LSL) / (6*1.33) = (USL-LSL) / 7.98
      const tolerance = c.upperSpecLimit - c.lowerSpecLimit;
      const processSigma = tolerance / 7.5; // ~Cpk 1.25 (biraz hedefin altinda - gercekci)

      return {
        ...c,
        processSigma,
      };
    });

    for (const c of this.characteristics) {
      this.subgroupCounters.set(c.id, 0);
      this.lastMeasurementSec.set(c.id, 0);
    }

    console.log(`  📊 ${this.characteristics.length} SPC karakteristik yuklendi`);
  }

  /**
   * Her tick'te cagir - zaman geldiginde olcum uret ve backend'e gonder
   */
  async tick(simTimeSec: number, machineStates: Map<string, string>) {
    for (const char of this.characteristics) {
      // Makine calisiyor mu?
      if (char.machineId) {
        const state = machineStates.get(char.machineId);
        if (state !== 'running') continue;
      }

      // Frekans kontrolu
      const lastMeasurement = this.lastMeasurementSec.get(char.id) || 0;
      const intervalSec = this.getIntervalSec(char.subgroupFrequency);

      if (simTimeSec - lastMeasurement < intervalSec) continue;

      this.lastMeasurementSec.set(char.id, simTimeSec);

      // Altgrup olcumleri uret
      const subgroupNo = (this.subgroupCounters.get(char.id) || 0) + 1;
      this.subgroupCounters.set(char.id, subgroupNo);

      const measurements = [];
      for (let i = 0; i < char.subgroupSize; i++) {
        // Normal dagilimli olcum degeri uret
        // Ortalama: nominal + kucuk drift (proses merkezleme hatasi)
        const drift = gaussian(0, char.processSigma * 0.1); // Kucuk merkez kaymasi
        const measuredValue = gaussian(char.nominalValue + drift, char.processSigma);

        measurements.push({
          characteristicId: char.id,
          subgroupNo,
          sampleNo: i + 1,
          measuredValue: parseFloat(measuredValue.toFixed(4)),
          machineId: char.machineId,
        });
      }

      // Backend'e gonder
      try {
        await this.apiClient.sendSpcMeasurements(measurements);
        this.totalMeasurements += measurements.length;
      } catch {}
    }
  }

  getTotalMeasurements(): number {
    return this.totalMeasurements;
  }

  getCharacteristicCount(): number {
    return this.characteristics.length;
  }

  /**
   * Frekans string'ini saniyeye cevir
   */
  private getIntervalSec(frequency: string): number {
    switch (frequency) {
      case 'per_100_parts': return 600; // ~10 dk (basitlestirilmis)
      case 'hourly': return 3600;
      case 'per_shift': return 28800; // 8 saat
      case 'per_batch': return 7200; // 2 saat
      default: return 3600;
    }
  }
}
