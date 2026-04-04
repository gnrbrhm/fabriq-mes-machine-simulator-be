/**
 * Master Data Seeder
 *
 * Backend'te uretim icin gerekli tum master veriyi olusturur:
 * 1. Operasyonlar (CNC Tornalama, Presleme, Kaynak, Boya, Paketleme, vb.)
 * 2. Mamul malzemeleri (PRD-001...006)
 * 3. BOM'lar (urun agaci - girdi malzemeler + routing adimlari)
 * 4. Lotlar (hammadde baslangic stoklari)
 * 5. Stok ozetleri
 *
 * Idempotent - birden fazla calistirilabilir.
 */

import axios, { AxiosInstance } from 'axios';
import { MATERIALS, PRODUCTS } from '../config/materials.config';

export class MasterDataSeeder {
  private api: AxiosInstance;
  private token = '';

  // Cache: code → id mapping
  private materialIds = new Map<string, string>();
  private operationIds = new Map<string, string>();
  private locationIds = new Map<string, string>();
  private machineIds = new Map<string, string>();

  constructor(baseUrl: string) {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async seed() {
    console.log('\n🏭 Master Data Seed baslatiliyor...\n');

    await this.login();
    await this.loadExistingIds();

    await this.seedOperations();
    await this.seedProductMaterials();
    await this.seedBoms();
    await this.seedLots();
    await this.seedMaintenanceProfiles();
    await this.seedSpcCharacteristics();
    await this.seedReportDefinitions();

    console.log('\n✅ Master Data Seed tamamlandi!\n');
  }

  private async login() {
    const res = await this.api.post('/auth/login', {
      email: 'admin@fabriq.io',
      password: 'admin123',
    });
    this.token = res.data.token;
    this.api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
  }

  /**
   * Mevcut ID'leri yukle (malzeme, lokasyon, makine)
   */
  private async loadExistingIds() {
    // Malzemeler
    try {
      const res = await this.api.get('/materials?limit=100');
      for (const m of res.data?.data || []) {
        this.materialIds.set(m.materialCode, m.id);
      }
      console.log(`  📦 ${this.materialIds.size} malzeme yuklendi`);
    } catch {}

    // Lokasyonlar
    try {
      const res = await this.api.get('/locations');
      for (const l of (res.data?.data || res.data || [])) {
        this.locationIds.set(l.code, l.id);
      }
      console.log(`  📍 ${this.locationIds.size} lokasyon yuklendi`);
    } catch {}

    // Makineler
    try {
      const res = await this.api.get('/machines');
      for (const m of (res.data?.data || res.data || [])) {
        this.machineIds.set(m.machineId, m.id);
      }
      console.log(`  🔧 ${this.machineIds.size} makine yuklendi`);
    } catch {}
  }

  /**
   * 1. Operasyonlar
   */
  private async seedOperations() {
    const operations = [
      { code: 'OP-CNC-TORNA', name: 'CNC Tornalama', description: 'CNC torna tezgahinda isleme', defaultCycleTime: 270, energyPerCycle: 1.125 },
      { code: 'OP-CNC-FREZE', name: 'CNC Frezleme', description: 'CNC freze tezgahinda isleme', defaultCycleTime: 372, energyPerCycle: 2.27 },
      { code: 'OP-PRES', name: 'Presleme', description: 'Hidrolik pres ile sekillendirme', defaultCycleTime: 120, energyPerCycle: 1.17 },
      { code: 'OP-KAYNAK', name: 'Kaynak', description: 'MIG/MAG kaynak islemi', defaultCycleTime: 480, energyPerCycle: 3.33 },
      { code: 'OP-BOYA', name: 'Boyama', description: 'Elektrostatik toz boya', defaultCycleTime: 900, energyPerCycle: 11.25 },
      { code: 'OP-PAKET', name: 'Paketleme', description: 'Otomatik paketleme', defaultCycleTime: 45, energyPerCycle: 0.0625 },
      { code: 'OP-KESIM', name: 'Testere Kesim', description: 'Serit testere ile kesim', defaultCycleTime: 60, energyPerCycle: 0.133 },
      { code: 'OP-DELME', name: 'Delme', description: 'Coklu matkap ile delik delme', defaultCycleTime: 90, energyPerCycle: 0.25 },
      { code: 'OP-KALITE', name: 'Kalite Kontrol', description: 'CMM olcum ve gorsel kontrol', defaultCycleTime: 150, energyPerCycle: 0.125 },
    ];

    let created = 0;
    for (const op of operations) {
      try {
        const res = await this.api.post('/operations', op);
        this.operationIds.set(op.code, res.data.id);
        created++;
      } catch (err: any) {
        if (err.response?.status === 409) {
          // Zaten var - ID'sini al
          try {
            const existing = await this.api.get(`/operations`);
            for (const o of (existing.data?.data || existing.data || [])) {
              if (o.code === op.code) this.operationIds.set(op.code, o.id);
            }
          } catch {}
        }
      }
    }
    console.log(`  ⚙️  Operasyonlar: ${created} yeni (toplam ${this.operationIds.size})`);
  }

  /**
   * 2. Mamul malzemeleri (PRD-001...006)
   */
  private async seedProductMaterials() {
    const products = [
      { materialCode: 'PRD-001', materialName: 'Aks Mili O20', unitId: 'ADET', materialType: 'FINISHED_GOODS' },
      { materialCode: 'PRD-002', materialName: 'Flans Braket', unitId: 'ADET', materialType: 'FINISHED_GOODS' },
      { materialCode: 'PRD-003', materialName: 'Pres Plaka 3mm', unitId: 'ADET', materialType: 'FINISHED_GOODS' },
      { materialCode: 'PRD-004', materialName: 'Kaynakli Konsol', unitId: 'ADET', materialType: 'FINISHED_GOODS' },
      { materialCode: 'PRD-005', materialName: 'Paslanmaz Burc', unitId: 'ADET', materialType: 'FINISHED_GOODS' },
      { materialCode: 'PRD-006', materialName: 'Sac Braket Montajli', unitId: 'ADET', materialType: 'FINISHED_GOODS' },
    ];

    let created = 0;
    for (const p of products) {
      try {
        const res = await this.api.post('/materials', { ...p, isActive: true, isConsumable: false });
        this.materialIds.set(p.materialCode, res.data.id);
        created++;
      } catch (err: any) {
        if (err.response?.status === 409) {
          // Zaten var
          const existing = this.materialIds.get(p.materialCode);
          if (!existing) {
            try {
              const res = await this.api.get(`/materials/code/${p.materialCode}`);
              this.materialIds.set(p.materialCode, res.data.id);
            } catch {}
          }
        }
      }
    }
    console.log(`  📦 Mamul malzemeler: ${created} yeni`);
  }

  /**
   * 3. BOM'lar (urun agaci)
   */
  private async seedBoms() {
    // BOM tanimlari - PRODUCTS config'inden
    const bomDefs = [
      {
        bomId: 'BOM-AKS-V1', code: 'BOM-AKS-V1', outputMaterialCode: 'PRD-001',
        operationCode: 'OP-CNC-TORNA', outputPerCycle: 1, yieldRate: 0.985,
        inputs: [
          { materialCode: 'HAM-001', quantityPerCycle: 2.5 },
          { materialCode: 'SRF-001', quantityPerCycle: 0.005 },
          { materialCode: 'SRF-004', quantityPerCycle: 0.05 },
        ],
        steps: [
          { step: 1, operationCode: 'OP-KESIM', cycleTime: 60 },
          { step: 2, operationCode: 'OP-CNC-TORNA', cycleTime: 270 },
          { step: 3, operationCode: 'OP-KALITE', cycleTime: 150 },
        ],
      },
      {
        bomId: 'BOM-FLANS-V1', code: 'BOM-FLANS-V1', outputMaterialCode: 'PRD-002',
        operationCode: 'OP-CNC-FREZE', outputPerCycle: 1, yieldRate: 0.982,
        inputs: [
          { materialCode: 'HAM-005', quantityPerCycle: 0.8 },
          { materialCode: 'SRF-003', quantityPerCycle: 0.003 },
          { materialCode: 'SRF-002', quantityPerCycle: 0.002 },
          { materialCode: 'SRF-004', quantityPerCycle: 0.03 },
        ],
        steps: [
          { step: 1, operationCode: 'OP-CNC-FREZE', cycleTime: 372 },
          { step: 2, operationCode: 'OP-DELME', cycleTime: 90 },
          { step: 3, operationCode: 'OP-KALITE', cycleTime: 150 },
        ],
      },
      {
        bomId: 'BOM-PRES-V1', code: 'BOM-PRES-V1', outputMaterialCode: 'PRD-003',
        operationCode: 'OP-PRES', outputPerCycle: 1, yieldRate: 0.98,
        inputs: [
          { materialCode: 'HAM-003', quantityPerCycle: 1.2 },
          { materialCode: 'SRF-005', quantityPerCycle: 0.001 },
        ],
        steps: [
          { step: 1, operationCode: 'OP-PRES', cycleTime: 120 },
          { step: 2, operationCode: 'OP-KALITE', cycleTime: 150 },
        ],
      },
      {
        bomId: 'BOM-KONSOL-V1', code: 'BOM-KONSOL-V1', outputMaterialCode: 'PRD-004',
        operationCode: 'OP-KAYNAK', outputPerCycle: 1, yieldRate: 0.975,
        inputs: [
          { materialCode: 'HAM-004', quantityPerCycle: 0.8 },
          { materialCode: 'HAM-007', quantityPerCycle: 0.3 },
          { materialCode: 'SRF-006', quantityPerCycle: 0.15 },
          { materialCode: 'SRF-007', quantityPerCycle: 0.08 },
          { materialCode: 'SRF-008', quantityPerCycle: 0.08 },
        ],
        steps: [
          { step: 1, operationCode: 'OP-KESIM', cycleTime: 60 },
          { step: 2, operationCode: 'OP-KAYNAK', cycleTime: 480 },
          { step: 3, operationCode: 'OP-BOYA', cycleTime: 900 },
          { step: 4, operationCode: 'OP-KALITE', cycleTime: 150 },
        ],
      },
      {
        bomId: 'BOM-BURC-V1', code: 'BOM-BURC-V1', outputMaterialCode: 'PRD-005',
        operationCode: 'OP-CNC-TORNA', outputPerCycle: 1, yieldRate: 0.988,
        inputs: [
          { materialCode: 'HAM-006', quantityPerCycle: 0.4 },
          { materialCode: 'SRF-001', quantityPerCycle: 0.005 },
        ],
        steps: [
          { step: 1, operationCode: 'OP-CNC-TORNA', cycleTime: 180 },
          { step: 2, operationCode: 'OP-KALITE', cycleTime: 150 },
        ],
      },
      {
        bomId: 'BOM-BRAKET-V1', code: 'BOM-BRAKET-V1', outputMaterialCode: 'PRD-006',
        operationCode: 'OP-PRES', outputPerCycle: 1, yieldRate: 0.97,
        inputs: [
          { materialCode: 'HAM-007', quantityPerCycle: 0.5 },
          { materialCode: 'SRF-006', quantityPerCycle: 0.08 },
          { materialCode: 'SRF-009', quantityPerCycle: 0.06 },
          { materialCode: 'SRF-012', quantityPerCycle: 0.1 },
        ],
        steps: [
          { step: 1, operationCode: 'OP-PRES', cycleTime: 90 },
          { step: 2, operationCode: 'OP-KAYNAK', cycleTime: 480 },
          { step: 3, operationCode: 'OP-DELME', cycleTime: 90 },
          { step: 4, operationCode: 'OP-BOYA', cycleTime: 900 },
          { step: 5, operationCode: 'OP-PAKET', cycleTime: 45 },
        ],
      },
    ];

    let created = 0;
    for (const bom of bomDefs) {
      try {
        const operationId = this.operationIds.get(bom.operationCode);
        if (!operationId) {
          console.log(`     ⚠️  Operasyon bulunamadi: ${bom.operationCode}`);
          continue;
        }

        await this.api.post('/boms', {
          bomId: bom.bomId,
          code: bom.code,
          version: '1.0',
          operationId,
          outputMaterialCode: bom.outputMaterialCode,
          outputPerCycle: bom.outputPerCycle,
          yieldRate: bom.yieldRate,
          createdBy: 'system',
          inputs: bom.inputs.map((i) => ({
            materialCode: i.materialCode,
            quantityPerCycle: i.quantityPerCycle,
          })),
          steps: bom.steps.map((s) => ({
            step: s.step,
            operationId: this.operationIds.get(s.operationCode) || operationId,
            cycleTime: s.cycleTime,
          })),
        });
        created++;
        console.log(`     ✅ BOM: ${bom.bomId} → ${bom.outputMaterialCode}`);
      } catch (err: any) {
        if (err.response?.status === 409) {
          console.log(`     ⏭️  BOM zaten var: ${bom.bomId}`);
        } else {
          console.log(`     ⚠️  BOM hatasi [${bom.bomId}]: ${err.response?.data?.message || err.message}`);
        }
      }
    }
    console.log(`  🧩 BOM: ${created} yeni`);
  }

  /**
   * 4. Hammadde lotlari
   */
  private async seedLots() {
    const lots = MATERIALS.map((m, i) => ({
      code: `LOT-${new Date().getFullYear()}-${String(i + 1).padStart(4, '0')}`,
      materialCode: m.code,
      initialQuantity: m.initialStock,
    }));

    let created = 0;
    for (const lot of lots) {
      const materialId = this.materialIds.get(lot.materialCode);
      if (!materialId) {
        console.log(`     ⚠️  Malzeme ID bulunamadi: ${lot.materialCode}`);
        continue;
      }

      try {
        await this.api.post('/lots', {
          code: lot.code,
          materialId,
          initialQuantity: lot.initialQuantity,
          status: 'active',
        });
        created++;
      } catch (err: any) {
        if (err.response?.status === 409) {
          // Zaten var
        } else {
          console.log(`     ⚠️  Lot hatasi [${lot.code}]: ${err.response?.data?.message || err.message}`);
        }
      }
    }
    console.log(`  📋 Lotlar: ${created} yeni`);
  }

  /**
   * 5. Makine bakim profilleri
   */
  private async seedMaintenanceProfiles() {
    const profiles = [
      { machineId: 'CNC-01', lubricationIntervalHrs: 168, hydraulicCheckHrs: null, calibrationIntervalHrs: 4320, beltChangeHrs: 2000 },
      { machineId: 'CNC-02', lubricationIntervalHrs: 168, hydraulicCheckHrs: null, calibrationIntervalHrs: 4320, beltChangeHrs: 2000 },
      { machineId: 'CNC-03', lubricationIntervalHrs: 168, hydraulicCheckHrs: null, calibrationIntervalHrs: 4320, beltChangeHrs: 2000 },
      { machineId: 'PRESS-01', lubricationIntervalHrs: 168, hydraulicCheckHrs: 720, calibrationIntervalHrs: 2160, beltChangeHrs: null },
      { machineId: 'PRESS-02', lubricationIntervalHrs: 168, hydraulicCheckHrs: 720, calibrationIntervalHrs: 2160, beltChangeHrs: null },
      { machineId: 'WELD-01', lubricationIntervalHrs: 336, hydraulicCheckHrs: null, calibrationIntervalHrs: 2160, beltChangeHrs: null },
      { machineId: 'WELD-02', lubricationIntervalHrs: 336, hydraulicCheckHrs: null, calibrationIntervalHrs: 2160, beltChangeHrs: null },
      { machineId: 'PAINT-01', lubricationIntervalHrs: 720, hydraulicCheckHrs: null, calibrationIntervalHrs: 4320, beltChangeHrs: null },
      { machineId: 'SAW-01', lubricationIntervalHrs: 168, hydraulicCheckHrs: null, calibrationIntervalHrs: 2160, beltChangeHrs: 50 },
      { machineId: 'DRILL-01', lubricationIntervalHrs: 168, hydraulicCheckHrs: null, calibrationIntervalHrs: 4320, beltChangeHrs: null },
    ];

    let created = 0;
    for (const p of profiles) {
      try {
        await this.api.put(`/machines/${p.machineId}/maintenance-profile`, p);
        created++;
      } catch { /* zaten var */ }
    }
    console.log(`  🔧 Bakim profilleri: ${created} yeni`);
  }

  /**
   * 6. SPC karakteristikleri
   */
  private async seedSpcCharacteristics() {
    const chars = [
      { code: 'SPC-CNC01-CAP', name: 'Dis Cap O20', machineId: 'CNC-01', partNumber: 'PRD-001', nominalValue: 20.00, upperSpecLimit: 20.05, lowerSpecLimit: 19.95, unit: 'mm', measurementTool: 'mikrometre', specialCharClass: 'SC' },
      { code: 'SPC-CNC01-UZN', name: 'Uzunluk 150mm', machineId: 'CNC-01', partNumber: 'PRD-001', nominalValue: 150.00, upperSpecLimit: 150.10, lowerSpecLimit: 149.90, unit: 'mm', measurementTool: 'kumpas' },
      { code: 'SPC-CNC02-GEN', name: 'Kanal Genisligi', machineId: 'CNC-02', partNumber: 'PRD-002', nominalValue: 40.00, upperSpecLimit: 40.08, lowerSpecLimit: 39.92, unit: 'mm', measurementTool: 'kumpas', specialCharClass: 'HI' },
      { code: 'SPC-CNC03-CAP', name: 'Burc Dis Cap', machineId: 'CNC-03', partNumber: 'PRD-005', nominalValue: 25.00, upperSpecLimit: 25.03, lowerSpecLimit: 24.97, unit: 'mm', measurementTool: 'mikrometre', specialCharClass: 'CC' },
      { code: 'SPC-PRESS01-KAL', name: 'Sac Kalinlik', machineId: 'PRESS-01', partNumber: 'PRD-003', nominalValue: 3.00, upperSpecLimit: 3.10, lowerSpecLimit: 2.90, unit: 'mm', measurementTool: 'kumpas' },
      { code: 'SPC-WELD01-DIK', name: 'Kaynak Dikis Genisligi', machineId: 'WELD-01', partNumber: 'PRD-004', nominalValue: 6.00, upperSpecLimit: 7.00, lowerSpecLimit: 5.00, unit: 'mm', measurementTool: 'kumpas', specialCharClass: 'SC' },
    ];

    let created = 0;
    for (const c of chars) {
      try {
        await this.api.post('/spc/characteristics', { ...c, targetCpk: 1.33, subgroupSize: 5, subgroupFrequency: 'hourly', chartType: 'xbar_r' });
        created++;
      } catch { /* zaten var */ }
    }
    console.log(`  📊 SPC karakteristikler: ${created} yeni`);
  }

  /**
   * 7. Rapor tanimlari
   */
  private async seedReportDefinitions() {
    const reports = [
      { code: 'daily-production', name: 'Gunluk Uretim Raporu', category: 'production', templateType: 'excel', description: 'Gun bazli uretim, hurda ve is emri ozeti' },
      { code: 'shift-performance', name: 'Vardiya Performans', category: 'production', templateType: 'excel', description: 'Vardiya bazli uretim ve verimlilik karsilastirmasi' },
      { code: 'oee-dashboard', name: 'OEE Dashboard', category: 'oee', templateType: 'excel', description: 'Makine bazli OEE (A/P/Q) detayli rapor' },
      { code: 'scrap-downtime-pareto', name: 'Hurda/Durus Pareto', category: 'quality', templateType: 'excel', description: 'Kategori bazli durus ve hurda analizi' },
      { code: 'energy-consumption', name: 'Enerji Tuketim', category: 'energy', templateType: 'excel', description: 'Elektrik, dogalgaz, su tuketim ve CO2e raporu' },
      { code: 'maintenance-cost', name: 'Bakim Maliyet', category: 'cost', templateType: 'excel', description: 'Ekipman bazli bakim maliyeti ve yedek parca kullanimi' },
      { code: 'material-consumption', name: 'Malzeme Tuketim', category: 'production', templateType: 'excel', description: 'BOM bazli malzeme tuketim sapma analizi' },
      { code: 'spc-capability', name: 'SPC Proses Yeterlilik', category: 'quality', templateType: 'pdf', description: 'Cp/Cpk hesaplamalari ve kontrol grafikleri' },
    ];

    let created = 0;
    for (const r of reports) {
      try {
        await this.api.post('/reports/definitions', { ...r, createdBy: 'system', isActive: true });
        created++;
      } catch { /* zaten var */ }
    }
    console.log(`  📄 Rapor tanimlari: ${created} yeni`);
  }
}
