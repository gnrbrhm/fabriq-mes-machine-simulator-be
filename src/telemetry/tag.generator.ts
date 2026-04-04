/**
 * Tag Deger Uretici
 *
 * Her tag icin gercekci deger uretir.
 * Durum, noise, drift, termal model hesaba katilir.
 */

import type { TagConfig, MachineStatus } from '../config/factory.config';
import { noisyValue, thermalModel, sinusoidalDrift, ramp } from '../core/random.utils';

export interface TagValue {
  tagId: string;
  name: string;
  value: number | boolean | string;
  quality: 'good' | 'bad' | 'uncertain';
  unit: string;
}

export class TagGenerator {
  private currentValues = new Map<string, number>();
  private cumulativeValues = new Map<string, number>();  // counter, energy
  private elapsedSec = 0;

  constructor(private tags: TagConfig[]) {
    // Baslangic degerleri
    for (const tag of tags) {
      this.currentValues.set(tag.tagId, tag.idleValue);
      if (tag.category === 'counter' || tag.category === 'energy') {
        this.cumulativeValues.set(tag.tagId, 0);
      }
    }
  }

  /**
   * Tum tag'ler icin deger uret
   */
  generate(state: MachineStatus, deltaSec: number, powerKw: number): TagValue[] {
    this.elapsedSec += deltaSec;
    const results: TagValue[] = [];

    for (const tag of this.tags) {
      const value = this.generateTagValue(tag, state, deltaSec, powerKw);
      results.push({
        tagId: tag.tagId,
        name: tag.name,
        value,
        quality: state === 'off' ? 'bad' : 'good',
        unit: tag.engineeringUnit,
      });
    }

    return results;
  }

  /**
   * Parca uretildiginde counter'i artir
   */
  incrementPartCounter(machineId: string) {
    const counterTag = this.tags.find((t) => t.category === 'counter');
    if (counterTag) {
      const current = this.cumulativeValues.get(counterTag.tagId) || 0;
      this.cumulativeValues.set(counterTag.tagId, current + 1);
    }
  }

  getPartCount(): number {
    const counterTag = this.tags.find((t) => t.category === 'counter');
    return counterTag ? (this.cumulativeValues.get(counterTag.tagId) || 0) : 0;
  }

  getCurrentValue(tagId: string): number {
    return this.currentValues.get(tagId) || 0;
  }

  // ─── Private ──────────────────────────────────────────────────

  private generateTagValue(tag: TagConfig, state: MachineStatus, deltaSec: number, powerKw: number): number | boolean {
    // Status tag'i
    if (tag.category === 'status') {
      return state === 'running' || state === 'warmup';
    }

    // Counter tag'i (kumulatif)
    if (tag.category === 'counter' || tag.category === 'quality') {
      return this.cumulativeValues.get(tag.tagId) || 0;
    }

    // Energy tag'i (kumulatif kWh)
    if (tag.category === 'energy') {
      const prevEnergy = this.cumulativeValues.get(tag.tagId) || 0;
      const energyDelta = (powerKw * deltaSec) / 3600; // kWs -> kWh
      const newEnergy = prevEnergy + energyDelta;
      this.cumulativeValues.set(tag.tagId, newEnergy);
      return parseFloat(newEnergy.toFixed(3));
    }

    // Process parametreleri (sicaklik, basinc, devir vb.)
    const currentVal = this.currentValues.get(tag.tagId) || tag.idleValue;
    let targetValue: number;

    switch (state) {
      case 'off':
        targetValue = tag.minValue || 0;
        break;

      case 'idle':
      case 'setup':
      case 'maintenance':
        targetValue = tag.idleValue;
        break;

      case 'warmup': {
        // Yavas yavas nominal'e yukselt
        const progress = Math.min(this.elapsedSec / 300, 1); // 5 dk isinma
        targetValue = tag.idleValue + (tag.nominalValue - tag.idleValue) * progress;
        break;
      }

      case 'running':
        // Nominal + sinuzoidal drift + noise
        targetValue = noisyValue(
          tag.nominalValue + sinusoidalDrift(this.elapsedSec, tag.nominalValue * 0.02, 300),
          tag.noisePercent,
        );
        break;

      case 'alarm':
        // Alarm durumunda deger yukselebilir veya dusebilir
        targetValue = tag.alarmThreshold
          ? tag.alarmThreshold * 1.1  // Esik degerinin %10 ustunde
          : tag.nominalValue * 1.3;
        break;

      default:
        targetValue = tag.idleValue;
    }

    // Termal model ile yavas gecis (ani degisim olmasin)
    const tauSec = tag.name.includes('temp') ? 60 : 10; // Sicaklik yavaş, diğerleri hızlı
    const newValue = thermalModel(currentVal, targetValue, tauSec, deltaSec);

    // Min/max sinirlama
    const clamped = Math.max(
      tag.minValue ?? -Infinity,
      Math.min(tag.maxValue ?? Infinity, newValue),
    );

    this.currentValues.set(tag.tagId, clamped);
    return parseFloat(clamped.toFixed(2));
  }
}
