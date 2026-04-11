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

import { ApiClient, type BackendBom, type BomFlowData, type BomFlowPhase } from '../upstream/api.client';
import { gaussian } from '../core/random.utils';

export interface ActiveJob {
  jobOrderNo: string;
  materialCode: string;
  materialName: string;
  machineId: string;
  phaseNo: number;           // YENI: Bu makine bu is emri icin hangi fazda
  quantityPlanned: number;
  quantityProduced: number;   // Bu fazda bu makinede uretilen
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
  private bomFlows = new Map<string, BomFlowData>(); // bomId → flow data (fazlar ile)
  private lastSyncTime = 0;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Backend'den BOM listesini ve her BOM icin faz akisini yukle
   */
  async loadBoms() {
    this.boms = await this.apiClient.getBoms();
    console.log(`  📋 ${this.boms.length} BOM yuklendi`);

    // Her BOM icin faz akisini cek (hangi makine hangi fazda)
    let totalPhases = 0;
    for (const bom of this.boms) {
      const flow = await this.apiClient.getBomFlow(bom.id);
      if (flow) {
        this.bomFlows.set(bom.id, flow);
        totalPhases += flow.phases.length;
      }
    }
    console.log(`  🏗 ${this.bomFlows.size} BOM icin faz akisi yuklendi (${totalPhases} faz toplam)`);
  }

  /**
   * Bir makinenin bir BOM icin hangi faz oldugunu bul
   */
  private getPhaseForMachine(bomId: string, machineId: string): BomFlowPhase | null {
    const flow = this.bomFlows.get(bomId);
    if (!flow) return null;
    return flow.phases.find((p) => p.machineId === machineId) || null;
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
          // Simulator kendi sayacini tutar, backend'den override ETME
          // Backend Kafka uzerinden guncellenecek (Cozum A)
          continue;
        }

        // Tamamlanmis is emrini kaldir
        if (bj.status === 'completed') {
          if (this.activeJobs.has(machineId)) {
            this.activeJobs.delete(machineId);
          }
          continue;
        }

        // Bu is emri icin bu makinenin hangi fazi oldugunu bul
        const phase = bj.bomId ? this.getPhaseForMachine(bj.bomId, machineId) : null;
        // Backend'den gelen is emrinin `operation` alani genelde ilk faz makinesidir,
        // ama BOM flow'dan gercek fazi cikaramazsak faz 1 varsayariz
        const phaseNo = phase?.phaseNo ?? 1;

        // Yeni is emri ata (simulator 0'dan baslar, backend Kafka ile guncellenecek)
        this.activeJobs.set(machineId, {
          jobOrderNo: bj.jobOrderNo,
          materialCode: bj.materialCode,
          materialName: bj.materialName,
          machineId,
          phaseNo,
          quantityPlanned: bj.quantityPlanned,
          quantityProduced: 0,
          quantityScrapped: 0,
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
   * Makineye is emri gerekiyorsa belirle.
   *
   * Faz bazli mantik:
   * - Eger bu makine bir BOM'un 1. fazi ise → backend'e yeni is emri talebi gonder
   * - Eger bu makine bir BOM'un ara/son fazi ise → onceki fazdan gelen WIP'i beklemek icin
   *   ayni is emrinin devamini uretmeli. Bu durumda backend'de aktif bir is emri ara,
   *   yoksa kuyrukta bekle.
   */
  async ensureJobForMachine(machineId: string): Promise<ActiveJob | null> {
    if (this.activeJobs.has(machineId)) {
      return this.activeJobs.get(machineId)!;
    }

    // Bu makine hangi BOM'larda hangi fazlari calisabilir? (tum adaylar)
    const candidates = this.findAllBomsWithPhaseForMachine(machineId);
    if (candidates.length === 0) return null;

    // Once ara/son faz adaylarina bak - eger baska bir makinede devam eden is emri varsa
    // onu bu makinede de devam ettir (paralel faz)
    for (const { bom, phase } of candidates) {
      if (phase.phaseNo > 1) {
        // Ara/son faz: Bu BOM icin zaten devam eden bir is emri var mi?
        // Not: bom.id (UUID) ile bom.bomId (kod) ikisini de kontrol et
        const existingJob = this.findActiveJobForBom(bom.id) || this.findActiveJobForBom(bom.bomId);
        if (existingJob) {
          const job: ActiveJob = {
            jobOrderNo: existingJob.jobOrderNo,
            materialCode: existingJob.materialCode,
            materialName: existingJob.materialName,
            machineId,
            phaseNo: phase.phaseNo,
            quantityPlanned: existingJob.quantityPlanned,
            quantityProduced: 0,
            quantityScrapped: 0,
            bomId: existingJob.bomId,
          };
          this.activeJobs.set(machineId, job);
          console.log(`  [Paralel Faz] ${machineId} → ${job.jobOrderNo} FAZ-${phase.phaseNo} (${phase.operationName})`);
          return job;
        }
      }
    }

    // Hic aktif is emri yok - 1. faz olan bir BOM bul ve yeni is emri olustur
    const firstPhaseCandidate = candidates.find((c) => c.phase.phaseNo === 1);
    if (!firstPhaseCandidate) {
      // Bu makine hic ilk faz degil, beklemeli (ara faz ama is yok)
      return null;
    }

    const { bom, phase } = firstPhaseCandidate;
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
      phaseNo: phase.phaseNo,
      quantityPlanned: jobOrder.quantityPlanned,
      quantityProduced: 0,
      quantityScrapped: 0,
      bomId: jobOrder.bomId,
    };

    this.activeJobs.set(machineId, job);
    console.log(`  [Backend] Is emri atandi: ${machineId} → ${job.jobOrderNo} FAZ-${phase.phaseNo} (${job.materialName} x${job.quantityPlanned})`);

    return job;
  }

  /**
   * Bu makinenin calisabilecegi TUM BOM-faz kombinasyonlarini dondurur
   */
  private findAllBomsWithPhaseForMachine(machineId: string): Array<{ bom: BackendBom; phase: BomFlowPhase }> {
    const results: Array<{ bom: BackendBom; phase: BomFlowPhase }> = [];
    for (const bom of this.boms) {
      const flow = this.bomFlows.get(bom.id);
      if (!flow) continue;
      // Bir BOM'da ayni makine birden fazla fazda olabilir (nadir) - hepsini ekle
      for (const phase of flow.phases) {
        if (phase.machineId === machineId) {
          results.push({ bom, phase });
        }
      }
    }
    return results;
  }

  /**
   * Bir BOM icin herhangi bir makinede aktif is emri var mi?
   * (Paralel faz icin: ayni is emrinin baska bir fazi calisiyor mu)
   */
  private findActiveJobForBom(bomId: string): ActiveJob | undefined {
    for (const job of this.activeJobs.values()) {
      if (job.bomId === bomId) return job;
    }
    return undefined;
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
