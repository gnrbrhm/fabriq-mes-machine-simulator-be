/**
 * Bakim Simulatoru
 *
 * Backend'den bakim profillerini okur.
 * Makine calisma saatini takip eder.
 * Bakim periyoduna ulasinca:
 *   1. Backend'de MaintenanceWorkOrder olusturur (POST /maintenance/work-orders)
 *   2. Makineyi maintenance moduna alir
 *   3. Bakim bitince WorkOrder'u tamamlar (PATCH .../complete)
 *   4. Backend'e maintenance-completed bildirir
 *
 * IoT olmayan ortamlarda operator terminali uzerinden de bakim tetiklenebilir.
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

// Bakim tipi aciklamalari (WorkOrder description icin)
const MAINTENANCE_DESCRIPTIONS: Record<string, string> = {
  lubrication: 'Periyodik yaglama bakimi',
  belt_change: 'Kayis/sanziman degisimi',
  hydraulic_check: 'Hidrolik sistem kontrolu ve basinc testi',
  calibration: 'Kalibrasyon ve olcum dogrulamasi',
  electrical_check: 'Elektrik paneli ve motor kontrolu',
  corrective: 'Arizadan dolayi duzeltici bakim',
};

export class MaintenanceSimulator {
  private profiles = new Map<string, MaintenanceProfile>();
  private apiClient: ApiClient;
  private eventBus: EventBus;
  private lastRunHourUpdateSec = 0;
  private totalMaintenanceCount = 0;

  // Acik bakim is emirleri (machineId → workOrderId)
  // Makine bakima girdiginde kaydedilir, bittiginde temizlenir
  private activeWorkOrders = new Map<string, string>();

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
      this.sendRunHoursToBackend();
    }

    // Bakim gerekiyor mu?
    const hours = profile.hoursSinceLastMaintenance;

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
   * Bakim basliyor — backend'de WorkOrder olustur.
   * main.ts'te machine.startMaintenance() ONCESINDE cagirilir.
   */
  async maintenanceStarted(machineId: string, maintenanceType: string) {
    const desc = MAINTENANCE_DESCRIPTIONS[maintenanceType] || `${maintenanceType} bakimi`;

    const woId = await this.apiClient.createMaintenanceWorkOrder({
      machineId,
      type: 'preventive',
      description: `${desc} — ${machineId} (${this.getRunHours(machineId).toFixed(0)} saat)`,
      priority: 'normal',
    });

    if (woId) {
      this.activeWorkOrders.set(machineId, woId);
    }
  }

  /**
   * Ariza basladi — corrective WorkOrder olustur.
   * Alarm tetiklendiginde cagirilir.
   */
  async alarmTriggered(machineId: string, reason: string) {
    // Zaten acik corrective WO varsa yeni olusturma
    if (this.activeWorkOrders.has(machineId)) return;

    const woId = await this.apiClient.createMaintenanceWorkOrder({
      machineId,
      type: 'corrective',
      description: `Ariza — ${reason} (${machineId})`,
      priority: 'high',
      failureMode: this.classifyFailureMode(reason),
    });

    if (woId) {
      this.activeWorkOrders.set(machineId, woId);
    }
  }

  /**
   * Bakim/ariza tamamlandi — sayaci sifirla, WorkOrder kapat, backend'e bildir
   */
  async maintenanceCompleted(machineId: string) {
    const profile = this.profiles.get(machineId);
    const hoursBeforeReset = profile?.hoursSinceLastMaintenance || 0;
    if (profile) {
      profile.hoursSinceLastMaintenance = 0;
    }

    this.totalMaintenanceCount++;

    // Acik WorkOrder varsa tamamla
    const woId = this.activeWorkOrders.get(machineId);
    if (woId) {
      // Bakim suresi tahmini: hoursBeforeReset'in kucuk bir yuzdesi (gercekte 30dk-2saat arasi)
      const actualHours = Math.max(0.5, Math.min(hoursBeforeReset * 0.01, 4));
      await this.apiClient.completeMaintenanceWorkOrder(woId, actualHours);
      this.activeWorkOrders.delete(machineId);
    }

    await this.apiClient.reportMaintenanceCompleted(machineId);
    console.log(`  🔧 ${machineId} bakim tamamlandi (toplam ${this.totalMaintenanceCount})`);
  }

  getProfile(machineId: string): MaintenanceProfile | undefined {
    return this.profiles.get(machineId);
  }

  getRunHours(machineId: string): number {
    return this.profiles.get(machineId)?.cumulativeRunHours || 0;
  }

  getTotalMaintenanceCount(): number {
    return this.totalMaintenanceCount;
  }

  hasActiveWorkOrder(machineId: string): boolean {
    return this.activeWorkOrders.has(machineId);
  }

  /**
   * Calisma saatlerini backend'e toplu gonder
   */
  private async sendRunHoursToBackend() {
    for (const [machineId, profile] of this.profiles) {
      if (profile.cumulativeRunHours > 0) {
        await this.apiClient.updateRunHours(machineId, 5 / 60);
      }
    }
  }

  /**
   * Ariza sebebinden failure mode cikar
   */
  private classifyFailureMode(reason: string): string {
    const r = reason.toLowerCase();
    if (r.includes('motor') || r.includes('servo') || r.includes('spindle')) return 'mechanical';
    if (r.includes('elektrik') || r.includes('encoder') || r.includes('sensor')) return 'electrical';
    if (r.includes('hidrolik') || r.includes('basinc') || r.includes('pompa')) return 'hydraulic';
    if (r.includes('pnömatik') || r.includes('hava')) return 'pneumatic';
    if (r.includes('yazilim') || r.includes('plc') || r.includes('program')) return 'software';
    return 'mechanical';
  }
}
