/**
 * Is Emri Simulatoru (Backend-Driven)
 *
 * Artik kendi is emri OLUSTURMUYOR.
 * Backend'den aktif is emirlerini okur ve makinelere atar.
 * Parca uretildikce sadece Kafka'ya counter event gonderir.
 * Malzeme tuketimi backend ProductionExecutionService tarafindan yapilir.
 *
 * Is emri yoksa → backend'e BOM bazli is emri olusturma talebi gonderir.
 */

import { ApiClient, type BackendJobOrder, type BackendBom } from '../upstream/api.client';
import { gaussian } from '../core/random.utils';

export interface ActiveJob {
  jobOrderNo: string;
  materialCode: string;
  materialName: string;
  machineId: string;
  quantityPlanned: number;
  quantityProduced: number;
  quantityScrapped: number;
  bomId?: string;
}

export class JobOrderSimulator {
  private activeJobs = new Map<string, ActiveJob>(); // machineId → job
  private completedCount = 0;
  private totalProduced = 0;
  private totalScrapped = 0;
  private apiClient: ApiClient;
  private boms: BackendBom[] = [];
  private lastSyncTime = 0;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Backend'den BOM listesini yukle (baslangiçta bir kez)
   */
  async loadBoms() {
    this.boms = await this.apiClient.getBoms();
    console.log(`  📋 ${this.boms.length} BOM yuklendi`);
  }

  /**
   * Backend'den aktif is emirlerini senkronize et
   * Her 30 saniyede bir cagirilir
   */
  async syncJobOrders(simTimeSec: number) {
    // 30 saniyede bir senkronize et
    if (simTimeSec - this.lastSyncTime < 30) return;
    this.lastSyncTime = simTimeSec;

    try {
      const backendJobs = await this.apiClient.getActiveJobOrders();

      for (const bj of backendJobs) {
        // operation alani machineId olarak kullaniliyor (simulator böyle gonderiyor)
        const machineId = bj.operation;

        // Bu makineye zaten is emri atanmis mi?
        const existing = this.activeJobs.get(machineId);
        if (existing && existing.jobOrderNo === bj.jobOrderNo) {
          // Guncelle (backend'den gelen deger her zaman dogru)
          existing.quantityProduced = bj.quantityProduced;
          existing.quantityScrapped = bj.quantityScrapped;
          continue;
        }

        // Tamamlanmis is emrini kaldir
        if (bj.status === 'completed') {
          if (this.activeJobs.has(machineId)) {
            this.activeJobs.delete(machineId);
          }
          continue;
        }

        // Yeni is emri ata
        this.activeJobs.set(machineId, {
          jobOrderNo: bj.jobOrderNo,
          materialCode: bj.materialCode,
          materialName: bj.materialName,
          machineId,
          quantityPlanned: bj.quantityPlanned,
          quantityProduced: bj.quantityProduced,
          quantityScrapped: bj.quantityScrapped,
          bomId: bj.bomId,
        });
      }
    } catch {
      // Sync hatasi - sessiz devam et
    }
  }

  getActiveJob(machineId: string): ActiveJob | undefined {
    return this.activeJobs.get(machineId);
  }

  getAllActiveJobs(): ActiveJob[] {
    return Array.from(this.activeJobs.values());
  }

  getCompletedCount(): number {
    return this.completedCount;
  }

  getTotalProduced(): number {
    return this.totalProduced;
  }

  getTotalScrapped(): number {
    return this.totalScrapped;
  }

  /**
   * Makineye is emri gerekiyorsa backend'den iste
   * Backend BOM bazli planlama yapacak (stok kontrol + lot rezerve)
   */
  async ensureJobForMachine(machineId: string): Promise<ActiveJob | null> {
    if (this.activeJobs.has(machineId)) {
      return this.activeJobs.get(machineId)!;
    }

    // Uygun BOM bul (bu makine icin)
    const bom = this.findBomForMachine(machineId);
    if (!bom) return null;

    // Backend'e is emri olusturma talebi gonder
    const quantity = Math.round(gaussian(50, 15));
    const customer = this.getCustomerForBom(bom);

    const jobOrder = await this.apiClient.createJobOrderFromBom(
      bom.bomId,
      Math.max(20, quantity),
      customer,
    );

    if (!jobOrder) return null;

    const job: ActiveJob = {
      jobOrderNo: jobOrder.jobOrderNo,
      materialCode: jobOrder.materialCode,
      materialName: jobOrder.materialName,
      machineId,
      quantityPlanned: jobOrder.quantityPlanned,
      quantityProduced: 0,
      quantityScrapped: 0,
      bomId: jobOrder.bomId,
    };

    this.activeJobs.set(machineId, job);
    console.log(`  [Backend] Is emri atandi: ${machineId} → ${job.jobOrderNo} (${job.materialName} x${job.quantityPlanned})`);

    return job;
  }

  /**
   * Parca uretildi (simulator tarafinda sayac artir)
   * Backend malzeme tuketimini kendi yapacak
   */
  partProduced(machineId: string) {
    const job = this.activeJobs.get(machineId);
    if (!job) return;

    job.quantityProduced++;
    this.totalProduced++;

    // Is emri tamamlandi mi?
    if (job.quantityProduced >= job.quantityPlanned) {
      this.activeJobs.delete(machineId);
      this.completedCount++;
      console.log(`  [Is Emri] ${job.jobOrderNo} TAMAMLANDI (${job.quantityProduced}/${job.quantityPlanned})`);
    }
  }

  /**
   * Hurda
   */
  partScrapped(machineId: string) {
    const job = this.activeJobs.get(machineId);
    if (!job) return;

    job.quantityScrapped++;
    this.totalScrapped++;
  }

  /**
   * Vardiya raporu
   */
  getShiftSummary(): string {
    const active = this.getAllActiveJobs();
    return [
      `  Aktif is emirleri: ${active.length}`,
      `  Tamamlanan: ${this.completedCount}`,
      `  Toplam uretim: ${this.totalProduced} adet`,
      `  Toplam hurda: ${this.totalScrapped} adet`,
    ].join('\n');
  }

  // ─── Private ──────────────────────────────────────────────────

  /**
   * Makine tipi icin uygun BOM bul
   */
  private findBomForMachine(machineId: string): BackendBom | null {
    // Makine-BOM eslestirmesi (basit: makine tipi → urun tipi)
    const machineProductMap: Record<string, string[]> = {
      'CNC-01': ['PRD-001'],        // Aks Mili
      'CNC-02': ['PRD-002'],        // Flans Braket
      'CNC-03': ['PRD-005'],        // Paslanmaz Burc
      'PRESS-01': ['PRD-003'],      // Pres Plaka
      'PRESS-02': ['PRD-006'],      // Sac Braket Montajli
      'WELD-01': ['PRD-004'],       // Kaynakli Konsol
      'WELD-02': ['PRD-006'],       // Sac Braket Montajli
      'SAW-01': ['PRD-004'],        // Kaynakli Konsol (kesim adimu)
      'DRILL-01': ['PRD-002', 'PRD-006'], // Flans Braket veya Sac Braket
      'PACK-01': ['PRD-006'],       // Sac Braket Montajli (paketleme)
    };

    const eligibleProducts = machineProductMap[machineId];
    if (!eligibleProducts || eligibleProducts.length === 0) return null;

    // Rastgele bir urun sec
    const productCode = eligibleProducts[Math.floor(Math.random() * eligibleProducts.length)];

    // Bu urunun BOM'unu bul
    return this.boms.find((b) => b.outputMaterialCode === productCode) || null;
  }

  private getCustomerForBom(bom: BackendBom): string {
    const customerMap: Record<string, string> = {
      'PRD-001': 'Ford Otosan',
      'PRD-002': 'TOFAS',
      'PRD-003': 'Arcelik',
      'PRD-004': 'Hyundai Assan',
      'PRD-005': 'BSH',
      'PRD-006': 'Ford Otosan',
    };
    return customerMap[bom.outputMaterialCode] || '';
  }
}
