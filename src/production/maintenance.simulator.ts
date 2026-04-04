/**
 * Bakim Simulatoru
 *
 * Backend'den bakim profillerini okur.
 * Makine calisma saatini takip eder.
 * Bakim periyoduna ulasinca makineyi maintenance moduna alir.
 * Bakim tamamlaninca backend'e bildirir.
 */

import { ApiClient } from '../upstream/api.client';
import { EventBus, SimEvents } from '../core/event-bus';

interface MaintenanceProfile {
  machineId: string;
  lubricationIntervalHrs: number;
  hydraulicCheckHrs?: number;
  calibrationIntervalHrs?: number;
  beltChangeHrs?: number;
  cumulativeRunHours: number;
  hoursSinceLastMaintenance: number;
}

export class MaintenanceSimulator {
  private profiles = new Map<string, MaintenanceProfile>();
  private apiClient: ApiClient;
  private eventBus: EventBus;
  private lastSyncSec = 0;
  private lastRunHourUpdateSec = 0;
  private totalMaintenanceCount = 0;

  constructor(apiClient: ApiClient, eventBus: EventBus) {
    this.apiClient = apiClient;
    this.eventBus = eventBus;
  }

  /**
   * Backend'den bakim profillerini yukle
   */
  async loadProfiles() {
    const backendProfiles = await this.apiClient.getMaintenanceProfiles();
    for (const p of backendProfiles) {
      this.profiles.set(p.machineId, {
        machineId: p.machineId,
        lubricationIntervalHrs: p.lubricationIntervalHrs,
        hydraulicCheckHrs: p.hydraulicCheckHrs || undefined,
        calibrationIntervalHrs: p.calibrationIntervalHrs || undefined,
        beltChangeHrs: p.beltChangeHrs || undefined,
        cumulativeRunHours: p.cumulativeRunHours,
        hoursSinceLastMaintenance: 0,
      });
    }
    console.log(`  🔧 ${this.profiles.size} bakim profili yuklendi`);
  }

  /**
   * Her tick'te cagir - calisma saatini guncelle ve bakim kontrolu yap
   */
  tick(
    machineId: string,
    isRunning: boolean,
    deltaSec: number,
    simTimeSec: number,
  ): { needsMaintenance: boolean; maintenanceType?: string } {
    const profile = this.profiles.get(machineId);
    if (!profile) return { needsMaintenance: false };

    // Calisma saatini artir (sadece running ise)
    if (isRunning) {
      const deltaHours = deltaSec / 3600;
      profile.cumulativeRunHours += deltaHours;
      profile.hoursSinceLastMaintenance += deltaHours;
    }

    // Her 5 dk'da backend'e calisma saati gonder
    if (simTimeSec - this.lastRunHourUpdateSec >= 300) {
      this.lastRunHourUpdateSec = simTimeSec;
      // Async - sonucu bekleme
      this.sendRunHoursToBackend();
    }

    // Bakim gerekiyor mu?
    const hours = profile.hoursSinceLastMaintenance;

    // En kisa periyoda gore kontrol (yaglama genelde en sik)
    if (hours >= profile.lubricationIntervalHrs) {
      return { needsMaintenance: true, maintenanceType: 'lubrication' };
    }

    if (profile.beltChangeHrs && hours >= profile.beltChangeHrs) {
      return { needsMaintenance: true, maintenanceType: 'belt_change' };
    }

    if (profile.hydraulicCheckHrs && hours >= profile.hydraulicCheckHrs) {
      return { needsMaintenance: true, maintenanceType: 'hydraulic_check' };
    }

    return { needsMaintenance: false };
  }

  /**
   * Bakim tamamlandi - sayaci sifirla ve backend'e bildir
   */
  async maintenanceCompleted(machineId: string) {
    const profile = this.profiles.get(machineId);
    if (profile) {
      profile.hoursSinceLastMaintenance = 0;
    }

    this.totalMaintenanceCount++;
    await this.apiClient.reportMaintenanceCompleted(machineId);
    console.log(`  🔧 ${machineId} bakim tamamlandi (toplam ${this.totalMaintenanceCount})`);
  }

  getProfile(machineId: string): MaintenanceProfile | undefined {
    return this.profiles.get(machineId);
  }

  getTotalMaintenanceCount(): number {
    return this.totalMaintenanceCount;
  }

  /**
   * Calisma saatlerini backend'e toplu gonder
   */
  private async sendRunHoursToBackend() {
    for (const [machineId, profile] of this.profiles) {
      if (profile.cumulativeRunHours > 0) {
        // Sadece son guncelleme farkini gonder (basitlestirilmis)
        await this.apiClient.updateRunHours(machineId, 5 / 60); // ~5 dk
      }
    }
  }
}
