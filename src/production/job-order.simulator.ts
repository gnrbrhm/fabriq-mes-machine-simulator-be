/**
 * Is Emri Simulatoru (Child-Aware, Backend-Driven)
 *
 * Backend'de her iş emri parent + N child (faz başı bir) şeklinde oluşturulur.
 * Simülatör yalnızca CHILD iş emirlerini işler — her child bir makineye aittir,
 * kendi quantityProduced sayacına sahiptir. Backend parent rollup'ı otomatik yapar.
 *
 * Mantik:
 * - syncJobOrders: backend'den started child'lari ceker, activeJobs map'ine atar
 * - canProduceOnMachine: child kendi hedefine ulasti mi + WIP buffer kontrolu
 * - partProduced: child sayacini artirir, Kafka'ya her parcada event gonderir
 * - Is emri yoksa → backend'e BOM bazli yeni parent+child olusturma talebi
 */

import { ApiClient, type BackendBom, type BomFlowData, type BomFlowPhase } from '../upstream/api.client';
import { gaussian } from '../core/random.utils';

export interface ActiveJob {
  jobOrderNo: string;        // Child jobOrderNo (ornek: JO-2026-0021.2)
  parentJobOrderNo: string;  // Parent jobOrderNo (ornek: JO-2026-0021)
  materialCode: string;
  materialName: string;
  machineId: string;
  phaseNo: number;
  quantityPlanned: number;
  quantityProduced: number;  // Backend'den senkron; simulator yerelde artirarak takip eder
  quantityScrapped: number;
  bomId?: string;
  assignedAt?: number;       // Bu kayit olusturuldugu timestamp (sync grace period icin)
}

/**
 * Parent iş emri başına fazların kümülatif üretim durumu.
 * Son üretim yapan child güncelleme sonrası bu map yeniden hesaplanır.
 * WIP buffer kontrolü için ara/son fazların önceki fazdan fazla üretmemesini sağlar.
 */
interface ParentProgress {
  parentJobOrderNo: string;
  quantityPlanned: number;
  phaseCounts: Map<number, number>; // phaseNo → kumulatif uretim (backend'den)
}

export class JobOrderSimulator {
  private activeJobs = new Map<string, ActiveJob>(); // machineId → child job
  private parentProgress = new Map<string, ParentProgress>(); // parentJobOrderNo → progress
  private completedCount = 0;
  private totalProduced = 0;
  private totalScrapped = 0;
  private apiClient: ApiClient;
  private boms: BackendBom[] = [];
  private bomFlows = new Map<string, BomFlowData>();
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
   * Backend'den aktif CHILD is emirlerini senkronize et (30 saniyede bir).
   *
   * Yeni yaklaşim: `active/by-machines` endpoint'i makine listesiyle cagirilir.
   * Backend her makine icin en eski aktif child'i doner — sayfa sinirli degil.
   *
   * Yaptigi isler:
   * 1. Her makine icin backend'den gelen child'i activeJobs'a yaz (yoksa)
   * 2. Backend'den donmeyen makineler icin activeJobs'tan temizle
   * 3. parentProgress haritasini guncelle (canProduceOnMachine icin)
   *
   * NOT: Yerel olarak az once olusturulan is emirleri icin grace period uygulanir.
   * Simulator `createJobOrderFromBom` cagirdiktan sonra backend'de child'in gorunmesi
   * bir anlik gecikebilir - bu durumda silinmemeli.
   */
  async syncJobOrders(simTimeSec: number) {
    if (simTimeSec - this.lastSyncTime < 30) return;
    this.lastSyncTime = simTimeSec;

    try {
      // BomFlows'tan tum makineleri topla
      const machineIds = new Set<string>();
      for (const flow of this.bomFlows.values()) {
        for (const p of flow.phases) {
          if (p.machineId) machineIds.add(p.machineId);
        }
      }
      // Ayrica activeJobs'taki makineler de dahil
      for (const machineId of this.activeJobs.keys()) {
        machineIds.add(machineId);
      }

      const { assignments, parentProgress: progressChildren } = await this.apiClient.getActiveChildrenByMachines(Array.from(machineIds));
      const backendChildren = assignments; // makine atama icin
      const byMachine = new Map<string, typeof backendChildren[0]>();
      for (const c of backendChildren) {
        if (c.operation) byMachine.set(c.operation, c);
      }

      const now = Date.now();
      const GRACE_PERIOD_MS = 60_000; // 1 dakika: yerel olusturulan is emrine grace ver

      // 1) Her makine icin guncelle veya temizle
      for (const machineId of machineIds) {
        const backendChild = byMachine.get(machineId);
        const local = this.activeJobs.get(machineId);

        if (backendChild) {
          // Backend'de is var
          if (!local || local.jobOrderNo !== backendChild.jobOrderNo) {
            // Yeni ata veya degisiklige yaz
            const parentNo = backendChild.jobOrderNo.includes('.')
              ? backendChild.jobOrderNo.split('.').slice(0, -1).join('.')
              : backendChild.jobOrderNo;
            this.activeJobs.set(machineId, {
              jobOrderNo: backendChild.jobOrderNo,
              parentJobOrderNo: parentNo,
              materialCode: backendChild.materialCode,
              materialName: backendChild.materialName,
              machineId,
              phaseNo: backendChild.phaseNo || 1,
              quantityPlanned: backendChild.quantityPlanned,
              quantityProduced: backendChild.quantityProduced || 0,
              quantityScrapped: 0,
              bomId: backendChild.bomId,
              assignedAt: now,
            });
          } else {
            // Ayni is, sayacı taze veriyle guncelle
            local.quantityProduced = backendChild.quantityProduced || 0;
          }
        } else {
          // Backend'de is yok
          if (local) {
            // Grace period: yerel olusturulan is emri backend'de henuz gorunmuyor olabilir
            if (local.assignedAt && now - local.assignedAt < GRACE_PERIOD_MS) {
              // Bekle, bir sonraki sync'te tekrar kontrol et
              continue;
            }
            this.activeJobs.delete(machineId);
            console.log(`  [Senkron] ${machineId} serbest (${local.jobOrderNo} artik started degil)`);
          }
        }
      }

      // 2) parentProgress haritasini guncelle
      // KRITIK: assignments sadece her makine icin 1 child doner. WIP buffer kontrolu icin
      // parent'in TUM child'larinin sayaclari gerekli (FAZ-1 ne kadar uretti, FAZ-2'nin
      // gercek buffer durumu hesaplanabilsin). Bu yuzden progressChildren kullaniliyor.
      this.parentProgress.clear();
      const allChildrenForProgress = progressChildren.length > 0 ? progressChildren : backendChildren;
      for (const child of allChildrenForProgress) {
        if (!child.parentJobOrderId || child.phaseNo == null) continue;

        const parentNo = child.jobOrderNo.includes('.')
          ? child.jobOrderNo.split('.').slice(0, -1).join('.')
          : child.jobOrderNo;

        let progress = this.parentProgress.get(parentNo);
        if (!progress) {
          progress = {
            parentJobOrderNo: parentNo,
            quantityPlanned: child.quantityPlanned,
            phaseCounts: new Map<number, number>(),
          };
          this.parentProgress.set(parentNo, progress);
        }
        progress.phaseCounts.set(child.phaseNo, child.quantityProduced || 0);
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
   * Makineye iş gerekiyorsa bul/olustur.
   *
   * 1. Backend'den gelen child'larin hangisi bu makineye ait?
   *    → syncJobOrders zaten atamis olurdu, ama henuz sync olmamis olabilir.
   * 2. Hiç uygun child yoksa ve bu makine bir BOM'un ilk faz makinesi ise,
   *    backend'e yeni iş emri (parent+child zinciri) olusturma talebi gonder.
   */
  async ensureJobForMachine(machineId: string): Promise<ActiveJob | null> {
    if (this.activeJobs.has(machineId)) {
      return this.activeJobs.get(machineId)!;
    }

    // Bu makine bir BOM'un ilk faz makinesi mi? Eger oyleyse yeni parent+child olustur
    const firstPhaseBom = this.findBomWhereMachineIsFirstPhase(machineId);
    if (!firstPhaseBom) {
      // Ara/son faz makinesi - syncJobOrders beklemeli (backend'de child olusunca otomatik atanir)
      return null;
    }

    const { bom } = firstPhaseBom;
    const quantity = Math.round(gaussian(50, 15));
    const customer = this.getCustomerForBom(bom);

    const jobOrder = await this.apiClient.createJobOrderFromBom(
      bom.bomId,
      Math.max(20, quantity),
      customer,
    );

    if (!jobOrder) return null;

    // Backend parent ve child'lari olusturdu. FAZ-1 child'i bu makineye aittir.
    // Sync'in getirmesini beklemek yerine kendi kaydimizi olusturalim.
    const child: ActiveJob = {
      jobOrderNo: `${jobOrder.jobOrderNo}.1`, // Konvansiyon: FAZ-1 child
      parentJobOrderNo: jobOrder.jobOrderNo,
      materialCode: jobOrder.materialCode,
      materialName: jobOrder.materialName,
      machineId,
      phaseNo: 1,
      quantityPlanned: jobOrder.quantityPlanned,
      quantityProduced: 0,
      quantityScrapped: 0,
      bomId: jobOrder.bomId,
      assignedAt: Date.now(), // grace period icin
    };

    this.activeJobs.set(machineId, child);
    console.log(`  [Backend] Yeni is emri: ${machineId} → ${child.jobOrderNo} (${child.materialName} x${child.quantityPlanned})`);

    return child;
  }

  /**
   * Bu makinenin bir BOM'un ilk fazi olup olmadigini kontrol et.
   */
  private findBomWhereMachineIsFirstPhase(machineId: string): { bom: BackendBom; phase: BomFlowPhase } | null {
    for (const bom of this.boms) {
      const flow = this.bomFlows.get(bom.id);
      if (!flow) continue;
      const firstPhase = flow.phases.find((p) => p.phaseNo === 1);
      if (firstPhase && firstPhase.machineId === machineId) {
        return { bom, phase: firstPhase };
      }
    }
    return null;
  }

  /**
   * Bu makine su an parca uretebilir mi?
   *
   * - Child hedefine ulasti mi?
   * - Ara/son faz ise onceki faz yeterli WIP uretmis mi? (buffer kontrolu)
   */
  canProduceOnMachine(machineId: string): boolean {
    const job = this.activeJobs.get(machineId);
    if (!job) return false;

    // 1) Child kendi hedefine ulasti mi?
    if (job.quantityProduced >= job.quantityPlanned) {
      return false;
    }

    // 2) Ara/son faz WIP buffer kontrolu
    if (job.phaseNo > 1) {
      const progress = this.parentProgress.get(job.parentJobOrderNo);
      if (!progress) {
        // Progress henuz yok (henuz sync olmadi) - ara faz icin beklemeli
        return false;
      }
      const prevPhaseCount = progress.phaseCounts.get(job.phaseNo - 1) || 0;
      if (job.quantityProduced >= prevPhaseCount) {
        // Onceki fazin kumulatif uretimini gecemeyiz - WIP yetersiz
        return false;
      }
    }

    return true;
  }

  /**
   * Parca uretildi: yerel sayaci artir, progress haritasini guncelle.
   * Backend Kafka event'i ile child.quantityProduced'i de artiracak.
   */
  partProduced(machineId: string): boolean {
    const job = this.activeJobs.get(machineId);
    if (!job) return false;

    if (!this.canProduceOnMachine(machineId)) {
      return false;
    }

    job.quantityProduced++;
    this.totalProduced++;

    // Parent progress haritasini guncelle (bir sonraki canProduceOnMachine dogru karar versin)
    let progress = this.parentProgress.get(job.parentJobOrderNo);
    if (!progress) {
      progress = {
        parentJobOrderNo: job.parentJobOrderNo,
        quantityPlanned: job.quantityPlanned,
        phaseCounts: new Map<number, number>(),
      };
      this.parentProgress.set(job.parentJobOrderNo, progress);
    }
    progress.phaseCounts.set(job.phaseNo, job.quantityProduced);

    // Child hedefine ulasti mi? Makineyi serbest birak.
    if (job.quantityProduced >= job.quantityPlanned) {
      this.activeJobs.delete(machineId);
      console.log(`  [Child Tamam] ${job.jobOrderNo} FAZ-${job.phaseNo} bitti (${machineId})`);
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
      `  Aktif child is emirleri: ${active.length}`,
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
