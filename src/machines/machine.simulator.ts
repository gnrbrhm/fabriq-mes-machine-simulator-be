/**
 * Tekil Makine Simulatoru
 *
 * Bir makinenin tum yasam dongusunu yonetir:
 * - Durum gecisleri (state machine)
 * - Tag degerleri (telemetri)
 * - Parca uretimi (cevrim suresi)
 * - Ariza/alarm olasiliklari
 */

import type { MachineConfig, MachineStatus } from '../config/factory.config';
import { MachineStateMachine } from './machine-state';
import { TagGenerator, TagValue } from '../telemetry/tag.generator';
import { EventBus, SimEvents } from '../core/event-bus';
import { chance, gaussian } from '../core/random.utils';

export interface MachineTickResult {
  machineId: string;
  state: MachineStatus;
  previousState: MachineStatus;
  stateChanged: boolean;
  tags: TagValue[];
  partProduced: boolean;
  partScrapped: boolean;
  alarmTriggered: boolean;
  currentPowerKw: number;
}

export class MachineSimulator {
  private stateMachine: MachineStateMachine;
  private tagGenerator: TagGenerator;
  private config: MachineConfig;
  private eventBus: EventBus;

  private cycleElapsedSec = 0;
  private currentCycleTimeSec = 0;
  private totalPartsProduced = 0;
  private totalPartsScrapped = 0;
  private warmupElapsedSec = 0;

  constructor(config: MachineConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
    this.stateMachine = new MachineStateMachine();
    this.tagGenerator = new TagGenerator(config.tags);
    this.calculateNewCycleTime();
  }

  getMachineId(): string {
    return this.config.machineId;
  }

  getState(): MachineStatus {
    return this.stateMachine.getState();
  }

  getConfig(): MachineConfig {
    return this.config;
  }

  getTotalProduced(): number {
    return this.totalPartsProduced;
  }

  getTotalScrapped(): number {
    return this.totalPartsScrapped;
  }

  /**
   * Her saniye cagrilan ana simulasyon dongusu
   */
  async tick(simTime: Date, deltaSec: number): Promise<MachineTickResult> {
    const previousState = this.stateMachine.getState();
    let partProduced = false;
    let partScrapped = false;
    let alarmTriggered = false;

    // 1. Durum gecis kontrolleri
    await this.evaluateStateTransitions(simTime, deltaSec);

    const currentState = this.stateMachine.getState();
    const stateChanged = currentState !== previousState;

    if (stateChanged) {
      console.log(`[${this.config.machineId}] ${previousState} → ${currentState}`);
      await this.eventBus.emit(SimEvents.MACHINE_STATE_CHANGED, {
        machineId: this.config.machineId,
        previousState,
        currentState,
        timestamp: simTime.toISOString(),
      });
    }

    // 2. Guc hesapla
    const currentPowerKw = this.calculatePower();

    // 3. Running durumunda parca uretim kontrolu
    if (currentState === 'running') {
      this.cycleElapsedSec += deltaSec;

      if (this.cycleElapsedSec >= this.currentCycleTimeSec) {
        // Cevrim tamamlandi
        this.cycleElapsedSec = 0;
        this.calculateNewCycleTime();

        // Hurda kontrolu
        if (chance(this.config.scrapRate)) {
          this.totalPartsScrapped++;
          partScrapped = true;
          await this.eventBus.emit(SimEvents.PART_SCRAPPED, {
            machineId: this.config.machineId,
            timestamp: simTime.toISOString(),
          });
        } else {
          this.totalPartsProduced++;
          this.tagGenerator.incrementPartCounter(this.config.machineId);
          partProduced = true;
          await this.eventBus.emit(SimEvents.PART_PRODUCED, {
            machineId: this.config.machineId,
            timestamp: simTime.toISOString(),
            totalProduced: this.totalPartsProduced,
          });
        }

        // Ariza kontrolu (her cevrimde)
        if (chance(this.config.failureProbability)) {
          this.stateMachine.transition('alarm', simTime);
          alarmTriggered = true;
          await this.eventBus.emit(SimEvents.ALARM_TRIGGERED, {
            machineId: this.config.machineId,
            timestamp: simTime.toISOString(),
            reason: 'Beklenmeyen ariza',
          });
        }
      }
    }

    // 4. Tag degerlerini uret
    const tags = this.tagGenerator.generate(currentState, deltaSec, currentPowerKw);

    // 5. Tag bazli alarm kontrolu (sicaklik vb.)
    if (currentState === 'running' && !alarmTriggered) {
      for (const tag of this.config.tags) {
        if (tag.alarmThreshold) {
          const currentVal = this.tagGenerator.getCurrentValue(tag.tagId);
          if (currentVal > tag.alarmThreshold) {
            this.stateMachine.transition('alarm', simTime);
            alarmTriggered = true;
            await this.eventBus.emit(SimEvents.ALARM_TRIGGERED, {
              machineId: this.config.machineId,
              tagId: tag.tagId,
              value: currentVal,
              threshold: tag.alarmThreshold,
              timestamp: simTime.toISOString(),
              reason: `${tag.name} esik degeri asildi: ${currentVal.toFixed(1)} > ${tag.alarmThreshold}`,
            });
            break;
          }
        }
      }
    }

    return {
      machineId: this.config.machineId,
      state: currentState,
      previousState,
      stateChanged,
      tags,
      partProduced,
      partScrapped,
      alarmTriggered,
      currentPowerKw,
    };
  }

  // ─── Dis Komutlar ─────────────────────────────────────────────

  /** Makineyi ac (off → idle) */
  turnOn(simTime: Date): boolean {
    return this.stateMachine.transition('idle', simTime);
  }

  /** Makineyi kapat */
  turnOff(simTime: Date): boolean {
    return this.stateMachine.transition('off', simTime);
  }

  /** Uretime basla (idle → warmup) */
  startProduction(simTime: Date): boolean {
    if (this.stateMachine.getState() === 'idle') {
      this.warmupElapsedSec = 0;
      return this.stateMachine.transition('warmup', simTime);
    }
    return false;
  }

  /** Uretimi durdur (running → idle) */
  stopProduction(simTime: Date): boolean {
    return this.stateMachine.transition('idle', simTime);
  }

  /** Bakim moduna al */
  startMaintenance(simTime: Date): boolean {
    if (this.stateMachine.getState() === 'idle') {
      return this.stateMachine.transition('maintenance', simTime);
    }
    return false;
  }

  /** Bakimi bitir */
  endMaintenance(simTime: Date): boolean {
    return this.stateMachine.transition('idle', simTime);
  }

  /** Alarmi temizle */
  clearAlarm(simTime: Date): boolean {
    return this.stateMachine.transition('idle', simTime);
  }

  // ─── Private ──────────────────────────────────────────────────

  private async evaluateStateTransitions(simTime: Date, deltaSec: number) {
    const state = this.stateMachine.getState();
    const duration = this.stateMachine.getStateDurationSec(simTime);

    switch (state) {
      case 'warmup':
        this.warmupElapsedSec += deltaSec;
        if (this.warmupElapsedSec >= this.config.warmupTimeSec) {
          this.stateMachine.transition('running', simTime);
        }
        break;

      case 'alarm':
        // 3-10 dakika sonra otomatik temizle (bakim ekibi geldi)
        if (duration > gaussian(420, 120)) {
          this.stateMachine.transition('idle', simTime);
          await this.eventBus.emit(SimEvents.ALARM_CLEARED, {
            machineId: this.config.machineId,
            timestamp: simTime.toISOString(),
          });
        }
        break;

      case 'maintenance':
        // 20-60 dakika bakim suresi
        if (duration > gaussian(2400, 600)) {
          this.stateMachine.transition('idle', simTime);
        }
        break;

      case 'setup':
        // 10-20 dakika setup
        if (duration > gaussian(900, 180)) {
          this.warmupElapsedSec = 0;
          this.stateMachine.transition('warmup', simTime);
        }
        break;
    }
  }

  private calculateNewCycleTime() {
    const variance = this.config.cycleTimeSec * (this.config.cycleTimeVariance / 100);
    this.currentCycleTimeSec = Math.max(
      this.config.cycleTimeSec * 0.5,
      gaussian(this.config.cycleTimeSec, variance),
    );
  }

  private calculatePower(): number {
    const state = this.stateMachine.getState();
    switch (state) {
      case 'off': return 0;
      case 'idle': return this.config.idlePowerKw;
      case 'warmup': return this.config.idlePowerKw + (this.config.runningPowerKw - this.config.idlePowerKw) * 0.5;
      case 'running': return this.config.runningPowerKw;
      case 'alarm': return this.config.idlePowerKw * 0.5;
      case 'maintenance': return this.config.idlePowerKw * 0.3;
      case 'setup': return this.config.idlePowerKw * 0.8;
      default: return 0;
    }
  }
}
