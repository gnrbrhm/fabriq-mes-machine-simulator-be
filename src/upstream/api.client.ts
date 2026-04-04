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
  quantityScrapped: number;
  operation: string; // machineId
  bomId?: string;
  status: string;
  customer?: string;
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
   * Aktif (started) is emirlerini getir
   */
  async getActiveJobOrders(): Promise<BackendJobOrder[]> {
    try {
      const res = await this.api.get('/job-orders', { params: { status: 'started', limit: 50 } });
      return res.data?.data || [];
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
}
