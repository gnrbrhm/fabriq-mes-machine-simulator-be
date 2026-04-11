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
  phaseNo: number;           // Bu makine bu is emri icin hangi fazda
  quantityPlanned: number;
  quantityProduced: number;   // Bu fazda bu makinede uretilen (yerel sayac)
  quantityScrapped: number;
  bomId?: string;
}

/**
 * Bir is emrinin faz bazli ilerleme durumu.
 * jobOrderNo + phaseNo → kac parca o fazda tamamlandi
 * Paralel faz mantigi: FAZ-2 FAZ-1'in kumulatif sayacindan fazla uretemez (buffer kontrolu)
 */
interface JobPhaseProgress {
  jobOrderNo: string;
  phaseCounts: Map<number, number>; // phaseNo → kumulatif uretim
  quantityPlanned: number;
  lastPhaseNo: number; // son faz numarasi
}

export class JobOrderSimulator {
  private activeJobs = new Map<string, ActiveJob>(); // machineId → job
  private completedCount = 0;
  private totalProduced = 0;
  private totalScrapped = 0;
  private apiClient: ApiClient;
  private boms: BackendBom[] = [];
  private bomFlows = new Map<string, BomFlowData>(); // bomId → flow data (fazlar ile)
  // Is emri faz bazli ilerleme takibi (paralel faz WIP buffer kontrolu icin)
  // key: jobOrderNo → JobPhaseProgress
  private jobPhaseProgress = new Map<string, JobPhaseProgress>();
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
        // Yontem 1: activeJobs'ta bu BOM icin baska fazda calisan bir is emri var mi?
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

        // Yontem 2: activeJobs'ta yok ama progress'te WIP bekleyen is emri var mi?
        // (Onceki faz tamamlandi, buffer'da WIP var, bu faz icin is bekliyor)
        const progressingJob = this.findProgressingJobForPhase(bom.id, phase.phaseNo);
        if (progressingJob) {
          const job: ActiveJob = {
            jobOrderNo: progressingJob.jobOrderNo,
            materialCode: progressingJob.materialCode,
            materialName: progressingJob.materialName,
            machineId,
            phaseNo: phase.phaseNo,
            quantityPlanned: progressingJob.quantityPlanned,
            quantityProduced: 0,
            quantityScrapped: 0,
            bomId: progressingJob.bomId,
          };
          this.activeJobs.set(machineId, job);
          console.log(`  [WIP Buffer] ${machineId} → ${job.jobOrderNo} FAZ-${phase.phaseNo} (${phase.operationName})`);
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
   * Ara faz icin uygun WIP bekleyen is emrini bul.
   *
   * Bir makine belirli bir BOM'un FAZ-N'i icin bos kaldiginda cagirilir.
   * Bu BOM icin progress'te su kosullari saglayan bir is emri aranir:
   * - (N-1). faz bu is emri icin parca uretmis (prevCount > 0)
   * - N. faz bu is emri icin henuz bitmemis (currentCount < prevCount veya 0)
   * - N. faz hedefine ulasmamis (currentCount < quantityPlanned)
   *
   * Oncelik: En fazla WIP biriktirmis is emri (buffer bosaltma)
   */
  private findProgressingJobForPhase(bomId: string, phaseNo: number): {
    jobOrderNo: string;
    materialCode: string;
    materialName: string;
    quantityPlanned: number;
    bomId: string;
  } | null {
    if (phaseNo < 2) return null; // Ara faz olmayi gerektirir

    // Bu BOM'un job progress kayitlarina bak
    const candidates: Array<{ jobOrderNo: string; wipDiff: number; quantityPlanned: number; progress: JobPhaseProgress }> = [];

    for (const [jobOrderNo, progress] of this.jobPhaseProgress.entries()) {
      // Progress'teki is emrinin bu BOM'a ait olup olmadigini bilmiyoruz.
      // Bu metoda sadece activeJobs'dan gelen bilgiyle karar veremeyiz.
      // Bunun yerine activeJobs'a bakmak daha temiz - progress sadece sayac.
      // Ama bu metot activeJobs disinda da "devam eden" is emrini bulmamiza yarar.

      // Onceki faz ne kadar uretmis?
      const prevCount = progress.phaseCounts.get(phaseNo - 1) || 0;
      const currentCount = progress.phaseCounts.get(phaseNo) || 0;

      // Onceki faz uretim yapmamis → bu is emri icin ara faza geciş yok
      if (prevCount === 0) continue;
      // Ara faz kendi hedefine ulasmis → yeni parca uretemez
      if (currentCount >= progress.quantityPlanned) continue;
      // Onceki fazdan kumulatif olarak gecilmis, demek ki WIP buffer var
      if (currentCount >= prevCount) continue; // buffer bos

      candidates.push({
        jobOrderNo,
        wipDiff: prevCount - currentCount,
        quantityPlanned: progress.quantityPlanned,
        progress,
      });
    }

    if (candidates.length === 0) return null;

    // En fazla WIP biriktirmis is emrini sec (buffer bosaltma onceligi)
    candidates.sort((a, b) => b.wipDiff - a.wipDiff);
    const best = candidates[0];

    // Is emri bilgilerini ilk olarak activeJobs'tan al (hala bagli olabilir)
    for (const job of this.activeJobs.values()) {
      if (job.jobOrderNo === best.jobOrderNo && job.bomId === bomId) {
        return {
          jobOrderNo: job.jobOrderNo,
          materialCode: job.materialCode,
          materialName: job.materialName,
          quantityPlanned: job.quantityPlanned,
          bomId: job.bomId!,
        };
      }
    }

    // activeJobs'dan cikmis olabilir - bom flow'daki output bilgisini kullan
    const flow = this.bomFlows.get(bomId);
    if (!flow) return null;

    return {
      jobOrderNo: best.jobOrderNo,
      materialCode: flow.outputProduct.materialCode,
      materialName: flow.outputProduct.materialName,
      quantityPlanned: best.quantityPlanned,
      bomId,
    };
  }

  /**
   * Bu makine su an parca uretebilir mi?
   *
   * Faz bazli kontrol:
   * - Faz bu makineye ait mi?
   * - Faz sayaci hedefe ulasti mi? (planlanan tamamlandi mi?)
   * - Ara faz ise: onceki faz yeterli WIP uretmis mi? (buffer kontrolu)
   */
  canProduceOnMachine(machineId: string): boolean {
    const job = this.activeJobs.get(machineId);
    if (!job) return false;

    const progress = this.jobPhaseProgress.get(job.jobOrderNo);
    if (!progress) return true; // ilk parca - henuz progress yok, uretebilir

    const currentPhaseCount = progress.phaseCounts.get(job.phaseNo) || 0;

    // 1) Bu faz planlanan hedefe ulasti mi?
    if (currentPhaseCount >= progress.quantityPlanned) {
      return false; // bu faz icin yeterince uretildi, dur
    }

    // 2) Ara/son faz ise: onceki fazin kumulatif sayacindan fazla uretemeyiz
    //    (WIP buffer kontrolu - paralel fazlarda kuyruk bekleme senaryosu)
    if (job.phaseNo > 1) {
      const prevPhaseCount = progress.phaseCounts.get(job.phaseNo - 1) || 0;
      if (currentPhaseCount >= prevPhaseCount) {
        // Onceki faz hala yetismedi, WIP yok - beklemeli
        return false;
      }
    }

    return true;
  }

  /**
   * Parca uretildi (simulator tarafinda sayac artir)
   * Backend malzeme tuketimini kendi yapacak
   *
   * Faz ilerleme map'ini gunceller, paralel faz kontrolunu saglar.
   * Dondurdugu deger: gercekten parca uretildi mi (true/false)
   */
  partProduced(machineId: string): boolean {
    const job = this.activeJobs.get(machineId);
    if (!job) return false;

    // Onceki kontrolu burada da yap: bu makine uretebilir mi?
    if (!this.canProduceOnMachine(machineId)) {
      return false;
    }

    // Progress map'i al veya olustur
    let progress = this.jobPhaseProgress.get(job.jobOrderNo);
    if (!progress) {
      const bomFlow = job.bomId ? this.bomFlows.get(job.bomId) : null;
      const lastPhaseNo = bomFlow ? bomFlow.phases.length : 1;
      progress = {
        jobOrderNo: job.jobOrderNo,
        phaseCounts: new Map<number, number>(),
        quantityPlanned: job.quantityPlanned,
        lastPhaseNo,
      };
      this.jobPhaseProgress.set(job.jobOrderNo, progress);
    }

    // Bu fazin sayacini artir
    const newCount = (progress.phaseCounts.get(job.phaseNo) || 0) + 1;
    progress.phaseCounts.set(job.phaseNo, newCount);

    // Yerel sayac (geriye donuk uyumluluk)
    job.quantityProduced++;
    this.totalProduced++;

    // Bu faz tamamlandi mi? (bu makine icin yeni is beklemesi gerekiyor mu?)
    if (newCount >= progress.quantityPlanned) {
      // Faz tamamlandi - bu makineyi serbest birak
      this.activeJobs.delete(machineId);

      // Is emri tamamen tamamlandi mi? (son faz ise)
      if (job.phaseNo === progress.lastPhaseNo) {
        this.completedCount++;
        this.jobPhaseProgress.delete(job.jobOrderNo);
        console.log(`  [Is Emri] ${job.jobOrderNo} TAMAMLANDI (son faz ${job.phaseNo}, ${newCount}/${progress.quantityPlanned})`);
      } else {
        console.log(`  [Faz Tamam] ${job.jobOrderNo} FAZ-${job.phaseNo} bitti (${machineId}) → sonraki faz devam edecek`);
      }
    }

    return true;
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
