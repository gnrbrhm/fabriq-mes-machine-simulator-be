/**
 * Backend API Client
 *
 * Simulator runtime'da backend'den veri okur:
 * - Aktif is emirleri (hangi makine ne uretiyor)
 * - BOM bilgileri (urun agaci)
 * - Is emri planlama (yeni is emri olustur)
 */

import axios, { AxiosInstance } from 'axios';

export interface BackendJobOrder {
  id: string;
  jobOrderNo: string;
  materialCode: string;
  materialName: string;
  quantityPlanned: number;
  quantityProduced: number;
  quantityCompleted?: number; // son faz (mamul) kumulatif
  quantityScrapped: number;
  operation: string; // machineId
  bomId?: string;
  status: string;
  customer?: string;
  // Faz bazli alt is emri alanlari
  parentJobOrderId?: string | null;
  phaseNo?: number | null;
  phaseName?: string | null;
}

export interface BomFlowPhase {
  phaseNo: number;
  machineId: string;
  operationName: string;
  cycleTimeSec: number;
  isLastPhase: boolean;
  expectedScrapRate: number;
}

export interface BomFlowData {
  bom: { id: string; bomId: string; code: string };
  phases: BomFlowPhase[];
  outputProduct: { materialCode: string; materialName: string };
}

export interface BackendBom {
  id: string;
  bomId: string;
  code: string;
  outputMaterialCode: string;
  outputPerCycle: number;
  yieldRate: number;
  BomInput?: Array<{
    materialCode: string;
    quantity: number;
  }>;
}

export class ApiClient {
  private api: AxiosInstance;
  private token: string = '';
  private authenticated = false;

  constructor(baseUrl: string) {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async authenticate(): Promise<boolean> {
    try {
      const res = await this.api.post('/auth/login', {
        email: 'admin@fabriq.io',
        password: 'admin123',
      });
      this.token = res.data.token;
      this.api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
      this.authenticated = true;
      return true;
    } catch {
      return false;
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  // ─── Is Emri Okuma ────────────────────────────────────────────

  /**
   * Verilen makinelere atanmis aktif CHILD is emirlerini getir.
   * Backend iki liste doner:
   *   - assignments: Her makine icin bir child (atama icin)
   *   - parentProgress: Bu child'larin parent'larinin tum child'lari (WIP buffer hesabi icin)
   */
  async getActiveChildrenByMachines(
    machineIds: string[],
  ): Promise<{ assignments: BackendJobOrder[]; parentProgress: BackendJobOrder[] }> {
    try {
      const res = await this.api.get('/job-orders/active/by-machines', {
        params: { machineIds: machineIds.join(',') },
      });
      const data = res.data || {};
      // Geriye donuk uyumluluk: eski endpoint array donuyordu
      if (Array.isArray(data)) {
        return { assignments: data, parentProgress: data };
      }
      return {
        assignments: data.assignments || [],
        parentProgress: data.parentProgress || [],
      };
    } catch {
      return { assignments: [], parentProgress: [] };
    }
  }

  /**
   * @deprecated — getActiveChildrenByMachines kullanin.
   * Eski davranis: tum started child'lari ceker (sayfa sinirli).
   */
  async getActiveJobOrders(): Promise<BackendJobOrder[]> {
    try {
      const res = await this.api.get('/job-orders', { params: { status: 'started', limit: 200, view: 'children' } });
      const all: BackendJobOrder[] = res.data?.data || [];
      return all.filter((j) => j.phaseNo != null && j.parentJobOrderId != null);
    } catch {
      return [];
    }
  }

  /**
   * Tum is emirlerini getir
   */
  async getAllJobOrders(): Promise<BackendJobOrder[]> {
    try {
      const res = await this.api.get('/job-orders', { params: { limit: 100 } });
      return res.data?.data || [];
    } catch {
      return [];
    }
  }

  // ─── BOM Okuma ────────────────────────────────────────────────

  /**
   * Tum BOM'lari getir
   */
  async getBoms(): Promise<BackendBom[]> {
    try {
      const res = await this.api.get('/boms', { params: { limit: 50 } });
      return res.data?.data || [];
    } catch {
      return [];
    }
  }

  /**
   * BOM faz akisini getir (her fazin makinesi ve sirasini ogrenmek icin)
   */
  async getBomFlow(bomId: string): Promise<BomFlowData | null> {
    try {
      const res = await this.api.get(`/boms/${bomId}/flow`);
      return res.data;
    } catch {
      return null;
    }
  }

  // ─── Is Emri Planlama ─────────────────────────────────────────

  /**
   * BOM bazli is emri olustur (backend'in planlama servisi uzerinden)
   */
  async createJobOrderFromBom(bomId: string, quantity: number, customer?: string): Promise<BackendJobOrder | null> {
    try {
      const res = await this.api.post('/production-planning/create-from-bom', {
        bomId,
        quantity,
        customer,
        priority: 'normal',
      });
      return res.data?.jobOrder || null;
    } catch (err: any) {
      console.log(`  [API] Is emri olusturma hatasi: ${err.response?.data?.message || err.message}`);
      return null;
    }
  }

  // ─── Makine Durumu ─���──────────────────────────────────────────

  /**
   * Makine listesini getir
   */
  async getMachines(): Promise<Array<{ machineId: string; name: string; status: string }>> {
    try {
      const res = await this.api.get('/machines');
      const data = res.data?.data || res.data || [];
      return data;
    } catch {
      return [];
    }
  }

  // ─── Bakim Profili ────────────────────────────────────────────

  /**
   * Tum bakim profillerini getir
   */
  async getMaintenanceProfiles(): Promise<Array<{
    machineId: string;
    lubricationIntervalHrs: number;
    hydraulicCheckHrs?: number;
    calibrationIntervalHrs?: number;
    beltChangeHrs?: number;
    cumulativeRunHours: number;
    maintenanceStatus: string;
  }>> {
    try {
      const res = await this.api.get('/machines/maintenance-profiles/all');
      return res.data || [];
    } catch {
      return [];
    }
  }

  /**
   * Calisma saatini guncelle
   */
  async updateRunHours(machineId: string, hours: number): Promise<void> {
    try {
      await this.api.patch(`/machines/${machineId}/run-hours`, { additionalHours: hours });
    } catch {}
  }

  /**
   * Bakim tamamlandi bildir
   */
  async reportMaintenanceCompleted(machineId: string): Promise<void> {
    try {
      await this.api.patch(`/machines/${machineId}/maintenance-completed`);
    } catch {}
  }

  // ─── SPC ──────────────────────────────────────────────────────

  /**
   * SPC karakteristiklerini getir (makine bazli)
   */
  async getSpcCharacteristics(machineId?: string): Promise<Array<{
    id: string;
    code: string;
    name: string;
    machineId?: string;
    nominalValue: number;
    upperSpecLimit: number;
    lowerSpecLimit: number;
    unit: string;
    subgroupSize: number;
    subgroupFrequency: string;
  }>> {
    try {
      const params = machineId ? { machineId } : {};
      const res = await this.api.get('/spc/characteristics', { params });
      return res.data || [];
    } catch {
      return [];
    }
  }

  /**
   * SPC olcum kaydi gonder (toplu)
   */
  async sendSpcMeasurements(measurements: Array<{
    characteristicId: string;
    subgroupNo: number;
    sampleNo: number;
    measuredValue: number;
    machineId?: string;
    jobOrderId?: string;
  }>): Promise<void> {
    try {
      await this.api.post('/spc/measurements/batch', { measurements });
    } catch {}
  }

  // ─── Enerji ───────────────────────────────────────────────────

  /**
   * Enerji tuketim kaydi gonder
   */
  async sendEnergyConsumption(data: {
    equipmentId?: string;
    date: string;
    electricityKwh: number;
    source?: string;
  }): Promise<void> {
    try {
      await this.api.post('/sustainability/energy', data);
    } catch {}
  }

  // ─── Tedarik (Procurement) ────────────────────────────────────

  /**
   * Tedarikci olustur
   */
  async createSupplier(data: {
    code: string;
    name: string;
    contactPerson?: string;
    email?: string;
    phone?: string;
    address?: string;
    taxId?: string;
    category?: string;
  }): Promise<any> {
    try {
      const res = await this.api.post('/suppliers', data);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Tum tedarikcileri getir
   */
  async getSuppliers(): Promise<any[]> {
    try {
      const res = await this.api.get('/suppliers');
      return res.data?.data || res.data || [];
    } catch {
      return [];
    }
  }

  /**
   * Satin alma siparisi olustur
   */
  async createPurchaseOrder(data: {
    supplierId: string;
    expectedDeliveryDate: string;
    priority?: string;
    notes?: string;
    items: Array<{
      materialCode: string;
      quantity: number;
      unitPrice: number;
      unit?: string;
    }>;
  }): Promise<any> {
    try {
      const res = await this.api.post('/purchase-orders', data);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Satin alma siparisini onayla
   */
  async approvePurchaseOrder(id: string): Promise<any> {
    try {
      const res = await this.api.patch(`/purchase-orders/${id}/approve`);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Satin alma siparisini gonder
   */
  async sendPurchaseOrder(id: string): Promise<any> {
    try {
      const res = await this.api.patch(`/purchase-orders/${id}/send`);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Mal kabul olustur
   */
  async createGoodsReceipt(data: {
    purchaseOrderId: string;
    receivedDate?: string;
    notes?: string;
    items: Array<{
      materialCode: string;
      quantityReceived: number;
      lotNumber?: string;
    }>;
  }): Promise<any> {
    try {
      const res = await this.api.post('/goods-receipts', data);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Mal kabul onayla
   */
  async acceptGoodsReceipt(id: string): Promise<any> {
    try {
      const res = await this.api.patch(`/goods-receipts/${id}/accept`);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Mal kabul reddet
   */
  async rejectGoodsReceipt(id: string, reason: string): Promise<any> {
    try {
      const res = await this.api.patch(`/goods-receipts/${id}/reject`, { reason });
      return res.data || null;
    } catch {
      return null;
    }
  }

  // ─── Is Emri Durum Makinesi ───────────────────────────────────

  /**
   * Is emrini beklet (hold)
   */
  async holdJobOrder(id: string, holdReason: string, changedBy: string): Promise<any> {
    try {
      const res = await this.api.patch(`/job-orders/${id}/hold`, { holdReason, changedBy });
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Is emrini serbest birak (release)
   */
  async releaseJobOrder(id: string, changedBy: string): Promise<any> {
    try {
      const res = await this.api.patch(`/job-orders/${id}/release`, { changedBy });
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Is emrini iptal et
   */
  async cancelJobOrder(id: string, cancelReason: string, changedBy: string): Promise<any> {
    try {
      const res = await this.api.patch(`/job-orders/${id}/cancel`, { cancelReason, changedBy });
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Is emrini bol
   */
  async splitJobOrder(id: string, splitQuantity: number, reason: string, changedBy: string): Promise<any> {
    try {
      const res = await this.api.post(`/job-orders/${id}/split`, { splitQuantity, reason, changedBy });
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Oncelik degistir
   */
  async changePriority(id: string, priority: string, reason: string, changedBy: string): Promise<any> {
    try {
      const res = await this.api.patch(`/job-orders/${id}/priority`, { priority, reason, changedBy });
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Yeniden islem emri olustur
   */
  async createReworkOrder(id: string, quantity: number, reason: string, changedBy: string): Promise<any> {
    try {
      const res = await this.api.post(`/job-orders/${id}/rework`, { quantity, reason, changedBy });
      return res.data || null;
    } catch {
      return null;
    }
  }

  // ─── Cizelgeleme (Scheduling) ─────────────────────────────────

  /**
   * Makine kuyruğuna is emri ekle
   */
  async addToQueue(machineId: string, jobOrderId: string, priority?: number): Promise<any> {
    try {
      const res = await this.api.post('/scheduling/queue', { machineId, jobOrderId, priority });
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Makine kuyruğunu getir
   */
  async getQueue(machineId: string): Promise<any[]> {
    try {
      const res = await this.api.get(`/scheduling/queue/${machineId}`);
      return res.data?.data || res.data || [];
    } catch {
      return [];
    }
  }

  // ─── Sevkiyat (Shipment) ──────────────────────────────────────

  /**
   * Sevkiyat olustur
   */
  async createShipment(data: {
    customer: string;
    deliveryDate: string;
    items: Array<{
      materialCode: string;
      quantity: number;
      jobOrderId?: string;
    }>;
    notes?: string;
  }): Promise<any> {
    try {
      const res = await this.api.post('/shipments', data);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Sevkiyat gonder
   */
  async shipShipment(id: string, carrier: string, trackingNo: string): Promise<any> {
    try {
      const res = await this.api.patch(`/shipments/${id}/ship`, { carrier, trackingNo });
      return res.data || null;
    } catch {
      return null;
    }
  }

  // ─── Stok Alarmlari ───────────────────────────────────────────

  /**
   * Stok alarmlarini kontrol et
   */
  async checkStockAlerts(): Promise<any> {
    try {
      const res = await this.api.post('/stock-alerts/check');
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Aktif alarmlari getir
   */
  async getActiveAlerts(): Promise<any[]> {
    try {
      const res = await this.api.get('/stock-alerts', { params: { status: 'active' } });
      return res.data?.data || res.data || [];
    } catch {
      return [];
    }
  }

  // ─── Musteri Sikayet ──────────────────────────────────────────

  /**
   * Musteri sikayeti olustur
   */
  async createComplaint(data: {
    customer: string;
    complaintType: string;
    description: string;
    materialCode?: string;
    quantity?: number;
    jobOrderId?: string;
    severity?: string;
  }): Promise<any> {
    try {
      const res = await this.api.post('/customer-complaints', data);
      return res.data || null;
    } catch {
      return null;
    }
  }

  // ─── Bakim Is Emirleri ────────────────────────────────────────

  /**
   * Bakim is emri olustur
   */
  async createMaintenanceWorkOrder(data: {
    machineId: string;
    type: string;
    priority: string;
    description: string;
    estimatedDurationMin?: number;
    spareParts?: Array<{ code: string; quantity: number }>;
  }): Promise<any> {
    try {
      const res = await this.api.post('/maintenance/work-orders', data);
      return res.data || null;
    } catch {
      return null;
    }
  }

  // ─── Malzeme Guncelleme ───────────────────────────────────────

  /**
   * Malzeme ayarlarini guncelle (minStock, reorderPoint vb.)
   */
  async updateMaterial(code: string, data: {
    minStock?: number;
    reorderPoint?: number;
    maxStock?: number;
  }): Promise<any> {
    try {
      const res = await this.api.patch(`/materials/${code}`, data);
      return res.data || null;
    } catch {
      return null;
    }
  }

  /**
   * Malzeme stok bilgisini getir
   */
  async getStockSummary(materialCode?: string): Promise<any[]> {
    try {
      const params = materialCode ? { materialCode } : {};
      const res = await this.api.get('/stock-summary', { params });
      return res.data?.data || res.data || [];
    } catch {
      return [];
    }
  }
}
