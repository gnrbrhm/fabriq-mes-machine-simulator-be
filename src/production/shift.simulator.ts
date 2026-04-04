/**
 * Vardiya Simulatoru
 *
 * Gercek fabrika vardiya dongusu:
 * - Sabah: 06:00 - 14:00 (mola 10:00-10:30)
 * - Ogle sonra: 14:00 - 22:00 (mola 18:00-18:30)
 * - Gece: 22:00 - 06:00 (mola 02:00-02:30)
 *
 * Vardiya gecislerinde 15dk handover suresi.
 * Gece vardiyasinda boya hatti ve paketleme kapali.
 */

import { EventBus, SimEvents } from '../core/event-bus';
import { FACTORY_CONFIG, type ShiftConfig } from '../config/factory.config';

export type ShiftPhase = 'pre_shift' | 'startup' | 'production' | 'break' | 'post_break' | 'handover' | 'off';

// Gece vardiyasinda calismayan makineler
const NIGHT_SHIFT_EXCLUDED = ['PAINT-01', 'PACK-01', 'INSP-01'];

// Hafta sonu calismayan makineler (cumartesi yarim gun)
const WEEKEND_EXCLUDED = ['PAINT-01', 'PACK-01'];

export class ShiftSimulator {
  private currentShift: ShiftConfig | null = null;
  private currentPhase: ShiftPhase = 'off';
  private phaseEnteredAt: Date = new Date();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  getCurrentShift(): ShiftConfig | null {
    return this.currentShift;
  }

  getCurrentPhase(): ShiftPhase {
    return this.currentPhase;
  }

  /**
   * Simülasyon saatine göre vardiya ve fazı belirle
   */
  async tick(simTime: Date): Promise<void> {
    const hour = simTime.getHours();
    const minute = simTime.getMinutes();
    const dayOfWeek = simTime.getDay(); // 0=Pazar, 6=Cumartesi
    const timeMinutes = hour * 60 + minute;

    // Pazar günü fabrika kapalı
    if (dayOfWeek === 0) {
      if (this.currentPhase !== 'off') {
        await this.setPhase('off', simTime);
        this.currentShift = null;
      }
      return;
    }

    // Hangi vardiya?
    const shift = this.determineShift(hour);
    const prevShift = this.currentShift;

    // Vardiya değişti mi?
    if (shift?.code !== prevShift?.code) {
      if (prevShift) {
        await this.setPhase('handover', simTime);
        this.currentShift = shift;
        await this.eventBus.emit(SimEvents.SHIFT_CHANGED, {
          previousShift: prevShift.code,
          newShift: shift?.code,
          timestamp: simTime.toISOString(),
        });
      } else {
        this.currentShift = shift;
      }
    }

    if (!shift) {
      if (this.currentPhase !== 'off') {
        await this.setPhase('off', simTime);
      }
      return;
    }

    // Cumartesi: sadece sabah vardiyası (yarım gün)
    if (dayOfWeek === 6 && shift.code !== 'SABAH') {
      if (this.currentPhase !== 'off') {
        await this.setPhase('off', simTime);
      }
      return;
    }

    // Vardiya içi faz belirleme
    const shiftStartMin = shift.startHour * 60;
    const breakStartMin = shift.breakStartHour * 60;
    const breakEndMin = breakStartMin + shift.breakDurationMin;

    // Handover süresi (ilk 15 dakika)
    const handoverEndMin = shiftStartMin + 15;

    if (this.currentPhase === 'handover') {
      const handoverDuration = (simTime.getTime() - this.phaseEnteredAt.getTime()) / 60000;
      if (handoverDuration >= 15) {
        await this.setPhase('startup', simTime);
      }
      return;
    }

    if (timeMinutes >= shiftStartMin && timeMinutes < shiftStartMin + 15 && this.currentPhase === 'off') {
      await this.setPhase('startup', simTime);
    } else if (timeMinutes >= shiftStartMin + 15 && timeMinutes < breakStartMin && this.currentPhase !== 'production') {
      if (this.currentPhase === 'startup' || this.currentPhase === 'post_break' || (this.currentPhase as ShiftPhase) === 'handover') {
        await this.setPhase('production', simTime);
      } else if (this.currentPhase === 'off' || this.currentPhase === 'pre_shift') {
        await this.setPhase('startup', simTime);
      }
    } else if (timeMinutes >= breakStartMin && timeMinutes < breakEndMin) {
      if (this.currentPhase !== 'break') {
        await this.setPhase('break', simTime);
        await this.eventBus.emit(SimEvents.SHIFT_BREAK_START, {
          shift: shift.code,
          timestamp: simTime.toISOString(),
        });
      }
    } else if (timeMinutes >= breakEndMin && timeMinutes < breakEndMin + 10) {
      if (this.currentPhase === 'break') {
        await this.setPhase('post_break', simTime);
        await this.eventBus.emit(SimEvents.SHIFT_BREAK_END, {
          shift: shift.code,
          timestamp: simTime.toISOString(),
        });
      }
    } else if (timeMinutes >= breakEndMin + 10 && this.currentPhase === 'post_break') {
      await this.setPhase('production', simTime);
    }
  }

  /**
   * Bu makine şu an çalışmalı mı?
   */
  shouldMachineRun(machineId: string, simTime: Date): boolean {
    if (this.currentPhase === 'off' || this.currentPhase === 'break') return false;
    if (this.currentPhase === 'handover') return false;

    // Gece vardiyasında bazı makineler kapalı
    if (this.currentShift?.code === 'GECE' && NIGHT_SHIFT_EXCLUDED.includes(machineId)) {
      return false;
    }

    // Cumartesi bazı makineler kapalı
    if (simTime.getDay() === 6 && WEEKEND_EXCLUDED.includes(machineId)) {
      return false;
    }

    return this.currentPhase === 'production' || this.currentPhase === 'post_break' || this.currentPhase === 'startup';
  }

  /**
   * Startup fazında mı? (makineler sırayla açılıyor)
   */
  isStartupPhase(): boolean {
    return this.currentPhase === 'startup';
  }

  private determineShift(hour: number): ShiftConfig | null {
    for (const shift of FACTORY_CONFIG.shifts) {
      if (shift.startHour < shift.endHour) {
        // Normal vardiya (06-14, 14-22)
        if (hour >= shift.startHour && hour < shift.endHour) return shift;
      } else {
        // Gece vardiyası (22-06)
        if (hour >= shift.startHour || hour < shift.endHour) return shift;
      }
    }
    return null;
  }

  private async setPhase(phase: ShiftPhase, simTime: Date): Promise<void> {
    const prev = this.currentPhase;
    this.currentPhase = phase;
    this.phaseEnteredAt = simTime;

    const phaseLabels: Record<ShiftPhase, string> = {
      off: 'Kapali', pre_shift: 'Vardiya Oncesi', startup: 'Acilis',
      production: 'Uretim', break: 'Mola', post_break: 'Mola Sonrasi',
      handover: 'Devir Teslim',
    };

    const shiftName = this.currentShift?.name || '-';
    console.log(`  [Vardiya] ${shiftName} → ${phaseLabels[phase]} (${simTime.toLocaleTimeString('tr-TR')})`);
  }
}
