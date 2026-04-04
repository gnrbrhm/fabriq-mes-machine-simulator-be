/**
 * Makine Durum Makinesi (State Machine)
 *
 * Gecerli durum gecisleri:
 *   off → idle
 *   idle → warmup → running
 *   running → idle (uretim bitti / mola)
 *   running → alarm (ariza)
 *   running → setup (urun degisimi)
 *   alarm → idle (ariza giderildi)
 *   idle → maintenance (planli bakim)
 *   maintenance → idle (bakim tamamlandi)
 *   setup → warmup → running
 *   * → off (kapatma)
 */

import type { MachineStatus } from '../config/factory.config';

interface StateTransition {
  from: MachineStatus;
  to: MachineStatus;
  condition?: string;
}

const VALID_TRANSITIONS: StateTransition[] = [
  { from: 'off', to: 'idle' },
  { from: 'idle', to: 'warmup' },
  { from: 'idle', to: 'maintenance' },
  { from: 'idle', to: 'off' },
  { from: 'warmup', to: 'running' },
  { from: 'warmup', to: 'alarm' },
  { from: 'running', to: 'idle' },
  { from: 'running', to: 'alarm' },
  { from: 'running', to: 'setup' },
  { from: 'alarm', to: 'idle' },
  { from: 'maintenance', to: 'idle' },
  { from: 'setup', to: 'warmup' },
];

export class MachineStateMachine {
  private state: MachineStatus = 'off';
  private previousState: MachineStatus = 'off';
  private stateEnteredAt: Date = new Date();
  private stateHistory: Array<{ state: MachineStatus; at: Date }> = [];

  getState(): MachineStatus {
    return this.state;
  }

  getPreviousState(): MachineStatus {
    return this.previousState;
  }

  getStateEnteredAt(): Date {
    return this.stateEnteredAt;
  }

  getStateDurationSec(now: Date): number {
    return (now.getTime() - this.stateEnteredAt.getTime()) / 1000;
  }

  canTransition(to: MachineStatus): boolean {
    return VALID_TRANSITIONS.some((t) => t.from === this.state && t.to === to);
  }

  transition(to: MachineStatus, now: Date): boolean {
    if (!this.canTransition(to)) {
      return false;
    }

    this.previousState = this.state;
    this.state = to;
    this.stateEnteredAt = now;
    this.stateHistory.push({ state: to, at: now });

    // Son 100 kayit tut
    if (this.stateHistory.length > 100) {
      this.stateHistory = this.stateHistory.slice(-100);
    }

    return true;
  }

  isProductive(): boolean {
    return this.state === 'running';
  }

  isAvailable(): boolean {
    return this.state !== 'off' && this.state !== 'alarm' && this.state !== 'maintenance';
  }

  getHistory(): Array<{ state: MachineStatus; at: Date }> {
    return [...this.stateHistory];
  }
}
