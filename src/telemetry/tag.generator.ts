/**
 * Tag Deger Uretici
 *
 * Her tag icin gercekci deger uretir.
 * Durum, noise, drift, termal model hesaba katilir.
 *
 * Gercek davranis:
 * - running: nominal deger + noise + sinuzoidal drift
 * - idle: devir=0, basinc=0, sicaklik yavasca sogur (ortam sicakligina)
 * - warmup: yavasca nominal'e cik (sicaklik daha yavas, devir daha hizli)
 * - alarm: sicaklik yuksek kalir, devir sifira duser
 * - off: her sey sifir/ortam
 */

import type { TagConfig, MachineStatus } from '../config/factory.config';
import { noisyValue, thermalModel, sinusoidalDrift } from '../core/random.utils';

export interface TagValue {
  tagId: string;
  name: string;
  value: number | boolean | string;
  quality: 'good' | 'bad' | 'uncertain';
  unit: string;
}

const AMBIENT_TEMP = 22; // Ortam sicakligi (°C)

export class TagGenerator {
  private currentValues = new Map<string, number>();
  private cumulativeValues = new Map<string, number>();
  private elapsedSec = 0;
  private warmupStartSec = 0; // warmup baslangicindan itibaren gecen sure

  constructor(private tags: TagConfig[]) {
    for (const tag of tags) {
      if (tag.category === 'counter' || tag.category === 'energy' || tag.category === 'quality') {
        this.cumulativeValues.set(tag.tagId, 0);
        this.currentValues.set(tag.tagId, 0);
      } else if (this.isTemperatureTag(tag)) {
        this.currentValues.set(tag.tagId, AMBIENT_TEMP);
      } else {
        this.currentValues.set(tag.tagId, 0);
      }
    }
  }

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

  /**
   * Warmup baslangic zamanini kaydet
   */
  resetWarmup() {
    this.warmupStartSec = this.elapsedSec;
  }

  // ─── Private ──────────────────────────────────────────────────

  private generateTagValue(tag: TagConfig, state: MachineStatus, deltaSec: number, powerKw: number): number | boolean {
    // Status tag'i
    if (tag.category === 'status') {
      return state === 'running' || state === 'warmup';
    }

    // Counter/quality tag'i (kumulatif)
    if (tag.category === 'counter' || tag.category === 'quality') {
      return this.cumulativeValues.get(tag.tagId) || 0;
    }

    // Energy tag'i (kumulatif kWh)
    if (tag.category === 'energy') {
      const prevEnergy = this.cumulativeValues.get(tag.tagId) || 0;
      const energyDelta = (powerKw * deltaSec) / 3600;
      const newEnergy = prevEnergy + energyDelta;
      this.cumulativeValues.set(tag.tagId, newEnergy);
      return parseFloat(newEnergy.toFixed(3));
    }

    // Process parametreleri
    const currentVal = this.currentValues.get(tag.tagId) ?? 0;
    const isTemp = this.isTemperatureTag(tag);
    const isMechanical = this.isMechanicalTag(tag); // devir, basinc, akim vb.

    let targetValue: number;

    switch (state) {
      case 'off':
        // Her sey ortam/sifir
        targetValue = isTemp ? AMBIENT_TEMP : 0;
        break;

      case 'idle':
        // Devir/basinc/akim = 0, sicaklik yavasca ortam sicakligina sogur
        if (isTemp) {
          targetValue = AMBIENT_TEMP + 3; // Bosta bile hafif isi (elektronik, pompa)
        } else {
          targetValue = 0; // Devir, basinc, akim vb. sifir
        }
        break;

      case 'setup':
      case 'maintenance':
        if (isTemp) {
          targetValue = AMBIENT_TEMP + 2;
        } else {
          targetValue = 0;
        }
        break;

      case 'warmup': {
        // Yavasca nominal'e yukselt
        const warmupDuration = this.elapsedSec - this.warmupStartSec;
        const warmupTarget = 300; // 5 dk isinma hedefi
        const progress = Math.min(warmupDuration / warmupTarget, 1);

        if (isTemp) {
          // Sicaklik yavas artar (termal ataletten dolayi)
          targetValue = AMBIENT_TEMP + (tag.nominalValue - AMBIENT_TEMP) * progress * 0.7;
        } else {
          // Mekanik degerler daha hizli artar
          targetValue = tag.nominalValue * progress;
        }
        break;
      }

      case 'running':
        if (isTemp) {
          // Sicaklik: nominal + kucuk drift (calisma kosullarina bagli)
          targetValue = tag.nominalValue + sinusoidalDrift(this.elapsedSec, 2, 600);
          targetValue = noisyValue(targetValue, tag.noisePercent);
        } else {
          // Devir, basinc vb: nominal + noise + drift
          targetValue = noisyValue(
            tag.nominalValue + sinusoidalDrift(this.elapsedSec, tag.nominalValue * 0.02, 300),
            tag.noisePercent,
          );
        }
        break;

      case 'alarm':
        if (isTemp) {
          // Alarm'da sicaklik yuksek kalir veya yavasce duser (makine durdu ama hala sicak)
          targetValue = tag.alarmThreshold
            ? tag.alarmThreshold * 0.95 // Alarm esigine yakin kal
            : tag.nominalValue * 1.2;
        } else {
          // Mekanik degerler sifira duser (makine durdu)
          targetValue = 0;
        }
        break;

      default:
        targetValue = isTemp ? AMBIENT_TEMP : 0;
    }

    // Termal model - farkli parametreler kullan
    let tauSec: number;
    if (isTemp) {
      // Sicaklik yavas degisir
      if (state === 'idle' || state === 'off') {
        tauSec = 180; // Soguma yavas (3dk time constant)
      } else if (state === 'warmup') {
        tauSec = 120; // Isinma orta hizda
      } else {
        tauSec = 60; // Calisirken normal
      }
    } else if (isMechanical) {
      // Devir, basinc vb. hizli degisir
      if (state === 'idle' || state === 'off' || state === 'alarm') {
        tauSec = 3; // Durma cok hizli (fren)
      } else {
        tauSec = 8; // Kalkis biraz daha yavas
      }
    } else {
      tauSec = 10;
    }

    const newValue = thermalModel(currentVal, targetValue, tauSec, deltaSec);

    // Min/max sinirlama
    const clamped = Math.max(
      tag.minValue ?? (isTemp ? AMBIENT_TEMP - 5 : 0),
      Math.min(tag.maxValue ?? Infinity, newValue),
    );

    this.currentValues.set(tag.tagId, clamped);
    return parseFloat(clamped.toFixed(2));
  }

  private isTemperatureTag(tag: TagConfig): boolean {
    return tag.name.includes('temp') || tag.name.includes('temperature') ||
           tag.engineeringUnit === '°C';
  }

  private isMechanicalTag(tag: TagConfig): boolean {
    return tag.name.includes('speed') || tag.name.includes('pressure') ||
           tag.name.includes('current') || tag.name.includes('voltage') ||
           tag.name.includes('feed') || tag.name.includes('wire') ||
           tag.engineeringUnit === 'rpm' || tag.engineeringUnit === 'bar' ||
           tag.engineeringUnit === 'A' || tag.engineeringUnit === 'V';
  }
}
