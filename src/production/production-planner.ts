/**
 * Fabriq MES - 3 Aylik Uretim Planlayici
 *
 * 12 haftalik (3 ay) uretim plani olusturur.
 * Her hafta belirli senaryolar ve edge case'ler icerir.
 *
 * Kullanim:
 *   npm run simulate -- --plan 3months
 */

import { ApiClient } from '../upstream/api.client';
import { PRODUCTS, MATERIALS } from '../config/materials.config';

// ─── Arayuzler ──────────────────────────────────────────────────

interface WeekPlan {
  week: number;
  startDate: Date;
  jobOrders: PlannedJob[];
  purchaseOrders: PlannedPO[];
  edgeCases: EdgeCaseEvent[];
}

interface PlannedJob {
  productCode: string;
  quantity: number;
  customer: string;
  priority: string;
  machineId: string;
  deliveryDate: Date;
}

interface PlannedPO {
  supplierCode: string;
  materialCode: string;
  quantity: number;
  expectedDays: number;
}

interface EdgeCaseEvent {
  id: string;       // EC-01 through EC-30
  week: number;
  day: number;      // 1-5 (Mon-Fri)
  type: string;
  description: string;
  action: () => Promise<void>;
}

// ─── Tedarikci Tanimlari ────────────────────────────────────────

const SUPPLIERS = [
  {
    code: 'SUP-001', name: 'Celik Ticaret A.S.',
    contactPerson: 'Mehmet Yilmaz', email: 'mehmet@celikticaret.com.tr',
    phone: '+90 224 441 0001', address: 'Bursa OSB, 1. Cadde No:15',
    taxId: '1234567890', category: 'raw_material',
    materials: [
      { code: 'HAM-001', price: 18.50, leadTimeDays: 5 },
      { code: 'HAM-002', price: 22.80, leadTimeDays: 5 },
      { code: 'HAM-003', price: 14.20, leadTimeDays: 7 },
      { code: 'HAM-004', price: 16.50, leadTimeDays: 7 },
    ],
  },
  {
    code: 'SUP-002', name: 'Aluminyum AS',
    contactPerson: 'Ayse Demir', email: 'ayse@aluminyumas.com.tr',
    phone: '+90 224 441 0002', address: 'Bursa OSB, 3. Cadde No:42',
    taxId: '2345678901', category: 'raw_material',
    materials: [
      { code: 'HAM-005', price: 95.00, leadTimeDays: 10 },
    ],
  },
  {
    code: 'SUP-003', name: 'Paslanmaz Ltd Sti.',
    contactPerson: 'Ali Kaya', email: 'ali@paslanmaz.com.tr',
    phone: '+90 224 441 0003', address: 'Nilufer OSB, 7. Sok No:8',
    taxId: '3456789012', category: 'raw_material',
    materials: [
      { code: 'HAM-006', price: 48.00, leadTimeDays: 8 },
    ],
  },
  {
    code: 'SUP-004', name: 'Kimyasal Sanayi A.S.',
    contactPerson: 'Fatma Ozturk', email: 'fatma@kimyasal.com.tr',
    phone: '+90 224 441 0004', address: 'Bursa Sanayi Bolge, 12. Cadde',
    taxId: '4567890123', category: 'consumable',
    materials: [
      { code: 'HAM-007', price: 12.80, leadTimeDays: 3 },
    ],
  },
  {
    code: 'SUP-005', name: 'Ambalaj Market',
    contactPerson: 'Hasan Celik', email: 'hasan@ambalajmarket.com.tr',
    phone: '+90 224 441 0005', address: 'Bursa Ticaret Merkezi A-12',
    taxId: '5678901234', category: 'packaging',
    materials: [],
  },
];

// ─── Haftalik Uretim Hedefleri ──────────────────────────────────

const WEEKLY_TARGETS: Record<number, Array<{ productCode: string; quantity: number; customer: string; priority: string; machineId: string }>> = {
  1: [
    { productCode: 'PRD-001', quantity: 200, customer: 'Ford Otosan', priority: 'normal', machineId: 'CNC-01' },
    { productCode: 'PRD-002', quantity: 100, customer: 'TOFAS', priority: 'normal', machineId: 'CNC-02' },
    { productCode: 'PRD-003', quantity: 300, customer: 'Arcelik', priority: 'normal', machineId: 'PRESS-01' },
  ],
  2: [
    { productCode: 'PRD-004', quantity: 80, customer: 'Hyundai Assan', priority: 'normal', machineId: 'WELD-01' },
    { productCode: 'PRD-005', quantity: 150, customer: 'BSH', priority: 'normal', machineId: 'CNC-03' },
    { productCode: 'PRD-006', quantity: 60, customer: 'Ford Otosan', priority: 'normal', machineId: 'PRESS-02' },
  ],
  3: [
    { productCode: 'PRD-001', quantity: 180, customer: 'Ford Otosan', priority: 'normal', machineId: 'CNC-01' },
    { productCode: 'PRD-003', quantity: 250, customer: 'Arcelik', priority: 'normal', machineId: 'PRESS-01' },
    { productCode: 'PRD-005', quantity: 120, customer: 'BSH', priority: 'normal', machineId: 'CNC-03' },
  ],
  4: [
    { productCode: 'PRD-001', quantity: 220, customer: 'Ford Otosan', priority: 'high', machineId: 'CNC-01' },
    { productCode: 'PRD-002', quantity: 130, customer: 'TOFAS', priority: 'normal', machineId: 'CNC-02' },
    { productCode: 'PRD-004', quantity: 90, customer: 'Hyundai Assan', priority: 'normal', machineId: 'WELD-01' },
  ],
  5: [
    { productCode: 'PRD-001', quantity: 500, customer: 'Ford Otosan', priority: 'critical', machineId: 'CNC-01' },
    { productCode: 'PRD-003', quantity: 200, customer: 'Arcelik', priority: 'low', machineId: 'PRESS-01' },
    { productCode: 'PRD-006', quantity: 80, customer: 'Ford Otosan', priority: 'normal', machineId: 'PRESS-02' },
  ],
  6: [
    { productCode: 'PRD-001', quantity: 150, customer: 'Ford Otosan', priority: 'normal', machineId: 'CNC-01' },
    { productCode: 'PRD-002', quantity: 110, customer: 'TOFAS', priority: 'normal', machineId: 'CNC-02' },
    { productCode: 'PRD-005', quantity: 140, customer: 'BSH', priority: 'normal', machineId: 'CNC-03' },
  ],
  7: [
    { productCode: 'PRD-003', quantity: 280, customer: 'Arcelik', priority: 'normal', machineId: 'PRESS-01' },
    { productCode: 'PRD-004', quantity: 70, customer: 'Hyundai Assan', priority: 'normal', machineId: 'WELD-01' },
    { productCode: 'PRD-005', quantity: 100, customer: 'BSH', priority: 'normal', machineId: 'CNC-03' },
  ],
  8: [
    { productCode: 'PRD-001', quantity: 250, customer: 'Ford Otosan', priority: 'high', machineId: 'CNC-01' },
    { productCode: 'PRD-004', quantity: 120, customer: 'Hyundai Assan', priority: 'high', machineId: 'WELD-01' },
    { productCode: 'PRD-006', quantity: 100, customer: 'Ford Otosan', priority: 'normal', machineId: 'PRESS-02' },
  ],
  9: [
    { productCode: 'PRD-002', quantity: 200, customer: 'TOFAS', priority: 'normal', machineId: 'CNC-02' },
    { productCode: 'PRD-003', quantity: 350, customer: 'Arcelik', priority: 'normal', machineId: 'PRESS-01' },
    { productCode: 'PRD-005', quantity: 130, customer: 'BSH', priority: 'normal', machineId: 'CNC-03' },
  ],
  10: [
    { productCode: 'PRD-001', quantity: 180, customer: 'Ford Otosan', priority: 'normal', machineId: 'CNC-01' },
    { productCode: 'PRD-004', quantity: 85, customer: 'Hyundai Assan', priority: 'normal', machineId: 'WELD-01' },
    { productCode: 'PRD-006', quantity: 70, customer: 'Ford Otosan', priority: 'normal', machineId: 'PRESS-02' },
  ],
  11: [
    { productCode: 'PRD-001', quantity: 200, customer: 'Ford Otosan', priority: 'normal', machineId: 'CNC-01' },
    { productCode: 'PRD-002', quantity: 150, customer: 'TOFAS', priority: 'normal', machineId: 'CNC-02' },
    { productCode: 'PRD-003', quantity: 300, customer: 'Arcelik', priority: 'normal', machineId: 'PRESS-01' },
  ],
  12: [
    { productCode: 'PRD-005', quantity: 160, customer: 'BSH', priority: 'normal', machineId: 'CNC-03' },
    { productCode: 'PRD-004', quantity: 95, customer: 'Hyundai Assan', priority: 'normal', machineId: 'WELD-01' },
    { productCode: 'PRD-006', quantity: 90, customer: 'Ford Otosan', priority: 'normal', machineId: 'PRESS-02' },
  ],
};

// ─── Production Planner ─────────────────────────────────────────

export class ProductionPlanner {
  private supplierIds: Map<string, string> = new Map();
  private createdJobOrderIds: Map<string, string> = new Map(); // jobOrderNo → id
  private weekPlans: WeekPlan[] = [];
  private executedEdgeCases: string[] = [];
  private totalJobOrdersCreated = 0;
  private totalPOsCreated = 0;

  constructor(private api: ApiClient) {}

  // ─── Log ────────────────────────────────────────────────────

  private log(msg: string): void {
    console.log(`[PLANNER] ${msg}`);
  }

  // ─── Tedarikci Seed ─────────────────────────────────────────

  async seedSuppliers(): Promise<void> {
    this.log('Tedarikciler olusturuluyor...');

    for (const sup of SUPPLIERS) {
      try {
        const result = await this.api.createSupplier({
          code: sup.code,
          name: sup.name,
          contactPerson: sup.contactPerson,
          email: sup.email,
          phone: sup.phone,
          address: sup.address,
          taxId: sup.taxId,
          category: sup.category,
        });
        if (result?.id) {
          this.supplierIds.set(sup.code, result.id);
          this.log(`  + ${sup.name} (${sup.code}) olusturuldu`);
        } else {
          this.log(`  ~ ${sup.name} (${sup.code}) zaten mevcut veya olusturulamadi`);
        }
      } catch {
        this.log(`  ! ${sup.name} olusturma hatasi`);
      }
    }

    this.log(`Toplam ${this.supplierIds.size} tedarikci olusturuldu`);
  }

  // ─── Malzeme Ayarlari Seed ──────────────────────────────────

  async seedMaterialSettings(): Promise<void> {
    this.log('Malzeme min stok / yeniden siparis noktalari ayarlaniyor...');

    const materialSettings: Array<{ code: string; minStock: number; reorderPoint: number }> = [
      { code: 'HAM-001', minStock: 800, reorderPoint: 1200 },
      { code: 'HAM-002', minStock: 500, reorderPoint: 800 },
      { code: 'HAM-003', minStock: 1000, reorderPoint: 1500 },
      { code: 'HAM-004', minStock: 700, reorderPoint: 1000 },
      { code: 'HAM-005', minStock: 150, reorderPoint: 250 },
      { code: 'HAM-006', minStock: 200, reorderPoint: 350 },
      { code: 'HAM-007', minStock: 800, reorderPoint: 1200 },
    ];

    for (const ms of materialSettings) {
      try {
        await this.api.updateMaterial(ms.code, {
          minStock: ms.minStock,
          reorderPoint: ms.reorderPoint,
        });
        this.log(`  + ${ms.code}: minStock=${ms.minStock}, reorderPoint=${ms.reorderPoint}`);
      } catch {
        this.log(`  ! ${ms.code} guncelleme hatasi`);
      }
    }
  }

  // ─── Hafta Plani Olustur ────────────────────────────────────

  async generateWeekPlan(weekNumber: number, simDate: Date): Promise<WeekPlan> {
    const startDate = new Date(simDate);
    const targets = WEEKLY_TARGETS[weekNumber] || WEEKLY_TARGETS[1];

    const jobOrders: PlannedJob[] = targets.map(t => ({
      productCode: t.productCode,
      quantity: t.quantity,
      customer: t.customer,
      priority: t.priority,
      machineId: t.machineId,
      deliveryDate: new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000),
    }));

    const purchaseOrders: PlannedPO[] = [];
    const edgeCases: EdgeCaseEvent[] = this.getEdgeCasesForWeek(weekNumber);

    const plan: WeekPlan = { week: weekNumber, startDate, jobOrders, purchaseOrders, edgeCases };
    this.weekPlans.push(plan);
    return plan;
  }

  // ─── Hafta Plani Calistir ───────────────────────────────────

  async executeWeekPlan(plan: WeekPlan): Promise<void> {
    this.log(`\n${'='.repeat(60)}`);
    this.log(`HAFTA ${plan.week} | Baslangic: ${plan.startDate.toLocaleDateString('tr-TR')}`);
    this.log(`${'='.repeat(60)}`);

    // Is emirleri olustur
    for (const job of plan.jobOrders) {
      try {
        const product = PRODUCTS.find(p => p.code === job.productCode);
        if (!product) {
          this.log(`  ! Urun bulunamadi: ${job.productCode}`);
          continue;
        }

        // BOM bazli is emri olustur
        const boms = await this.api.getBoms();
        const bom = boms.find(b => b.code === job.productCode || b.outputMaterialCode === job.productCode);

        if (bom) {
          const result = await this.api.createJobOrderFromBom(bom.id, job.quantity, job.customer);
          if (result) {
            this.createdJobOrderIds.set(result.jobOrderNo, result.id);
            this.totalJobOrdersCreated++;
            this.log(`  + Is emri: ${result.jobOrderNo} | ${product.name} x${job.quantity} | ${job.customer} | oncelik: ${job.priority}`);

            // Kuyruga ekle
            try {
              await this.api.addToQueue(job.machineId, result.id, this.priorityToNumber(job.priority));
            } catch { /* sessiz */ }
          }
        } else {
          this.log(`  ! BOM bulunamadi: ${job.productCode} (${product.name})`);
        }
      } catch {
        this.log(`  ! Is emri olusturma hatasi: ${job.productCode}`);
      }
    }

    // Satin alma siparisleri olustur
    for (const po of plan.purchaseOrders) {
      await this.executePurchaseOrder(po);
    }

    // Edge case'leri calistir
    for (const ec of plan.edgeCases) {
      await this.executeEdgeCase(ec);
    }
  }

  // ─── Edge Case Calistir ─────────────────────────────────────

  async executeEdgeCase(event: EdgeCaseEvent): Promise<void> {
    this.log(`\n  --- ${event.id}: ${event.description} (Hafta ${event.week}, Gun ${event.day}) ---`);
    try {
      await event.action();
      this.executedEdgeCases.push(event.id);
      this.log(`  --- ${event.id}: Tamamlandi ---`);
    } catch (err: any) {
      this.log(`  !!! ${event.id}: Hata - ${err.message}`);
    }
  }

  // ─── Tam Plan Calistir ──────────────────────────────────────

  async runFullPlan(startDate: Date): Promise<void> {
    this.log('\n' + '╔' + '═'.repeat(58) + '╗');
    this.log('║    FABRIQ MES - 3 AYLIK URETIM PLANI BASLATILIYOR       ║');
    this.log('║    12 Hafta | 30 Edge Case | 6 Urun | 12 Makine         ║');
    this.log('╚' + '═'.repeat(58) + '╝\n');

    // 1. Tedarikciler
    await this.seedSuppliers();

    // 2. Malzeme ayarlari
    await this.seedMaterialSettings();

    // 3. Her hafta icin plan olustur ve calistir
    for (let week = 1; week <= 12; week++) {
      const weekStart = new Date(startDate.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
      const plan = await this.generateWeekPlan(week, weekStart);
      await this.executeWeekPlan(plan);

      // Hafta arasi kisa bekleme (API rate limit korumasi)
      await this.sleep(500);
    }

    // 4. Ozet
    this.log('\n' + this.getProgressReport());
  }

  // ─── Ilerleme Raporu ────────────────────────────────────────

  getProgressReport(): string {
    const lines: string[] = [];
    lines.push('╔' + '═'.repeat(58) + '╗');
    lines.push('║           3 AYLIK PLAN OZETI                            ║');
    lines.push('╠' + '═'.repeat(58) + '╣');
    lines.push(`║  Toplam is emri olusturuldu: ${String(this.totalJobOrdersCreated).padEnd(28)}║`);
    lines.push(`║  Toplam satin alma siparisi: ${String(this.totalPOsCreated).padEnd(28)}║`);
    lines.push(`║  Calistirilan edge case:     ${String(this.executedEdgeCases.length).padEnd(28)}║`);
    lines.push(`║  Hafta sayisi:               ${String(this.weekPlans.length).padEnd(28)}║`);
    lines.push('╠' + '═'.repeat(58) + '╣');
    lines.push('║  Edge Case Ozeti:                                       ║');

    for (const ecId of this.executedEdgeCases) {
      lines.push(`║    [x] ${ecId.padEnd(49)}║`);
    }

    lines.push('╚' + '═'.repeat(58) + '╝');
    return lines.join('\n');
  }

  // ─── Yardimci Methodlar ─────────────────────────────────────

  private priorityToNumber(priority: string): number {
    switch (priority) {
      case 'critical': return 1;
      case 'high': return 2;
      case 'normal': return 5;
      case 'low': return 8;
      default: return 5;
    }
  }

  private async executePurchaseOrder(po: PlannedPO): Promise<void> {
    const supplier = SUPPLIERS.find(s => s.code === po.supplierCode);
    if (!supplier) return;

    const supplierId = this.supplierIds.get(po.supplierCode);
    if (!supplierId) {
      this.log(`  ! Tedarikci ID bulunamadi: ${po.supplierCode}`);
      return;
    }

    const matInfo = supplier.materials.find(m => m.code === po.materialCode);
    const unitPrice = matInfo?.price || 10;

    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + po.expectedDays);

    try {
      const result = await this.api.createPurchaseOrder({
        supplierId,
        expectedDeliveryDate: expectedDate.toISOString().split('T')[0],
        priority: 'normal',
        notes: `Planner auto-generated PO for ${po.materialCode}`,
        items: [{
          materialCode: po.materialCode,
          quantity: po.quantity,
          unitPrice,
          unit: MATERIALS.find(m => m.code === po.materialCode)?.unit || 'KG',
        }],
      });

      if (result?.id) {
        this.totalPOsCreated++;
        this.log(`  + PO olusturuldu: ${po.materialCode} x${po.quantity} → ${supplier.name}`);

        // Onayla ve gonder
        await this.api.approvePurchaseOrder(result.id);
        this.log(`    Onaylandi`);
        await this.api.sendPurchaseOrder(result.id);
        this.log(`    Gonderildi`);
      }
    } catch {
      this.log(`  ! PO olusturma hatasi: ${po.materialCode}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Edge Case Tanimlari ────────────────────────────────────

  private getEdgeCasesForWeek(week: number): EdgeCaseEvent[] {
    const cases: EdgeCaseEvent[] = [];

    switch (week) {
      // ─── Hafta 1-2: Startup (edge case yok) ─────────────────
      case 1:
      case 2:
        break;

      // ─── Hafta 3: Min stok alarmi ───────────────────────────
      case 3:
        cases.push({
          id: 'EC-07', week: 3, day: 3,
          type: 'stock_alert',
          description: 'Min stok alarmi tetiklendi (HAM-005 aluminyum profil)',
          action: async () => {
            this.log('  EC-07: Stok alarmlari kontrol ediliyor...');
            const alerts = await this.api.checkStockAlerts();
            this.log(`  EC-07: Alarm sonucu: ${JSON.stringify(alerts)?.substring(0, 100)}`);

            const activeAlerts = await this.api.getActiveAlerts();
            this.log(`  EC-07: Aktif alarm sayisi: ${activeAlerts.length}`);

            // HAM-005 icin PO olustur
            this.log('  EC-07: HAM-005 icin satin alma siparisi olusturuluyor...');
            await this.executePurchaseOrder({
              supplierCode: 'SUP-002',
              materialCode: 'HAM-005',
              quantity: 400,
              expectedDays: 10,
            });
            this.log('  EC-07: Min stok alarmi tetiklendi (HAM-005: <250 MT reorder point)');
            this.log('  EC-07: PO olusturuldu → Aluminyum AS, 400 MT HAM-005');
          },
        });
        break;

      // ─── Hafta 4: Hammadde tukenmesi + kismi teslimat ───────
      case 4:
        cases.push({
          id: 'EC-01', week: 4, day: 1,
          type: 'stockout',
          description: 'Hammadde tukendi! HAM-001 (celik cubuk) stok: 0',
          action: async () => {
            this.log('  EC-01: Hammadde tukendi! HAM-001 stok: 0 KG');
            this.log('  EC-01: CNC-01 uretim durdu - hammadde yok');

            // Stok durumunu kontrol et
            const stock = await this.api.getStockSummary('HAM-001');
            this.log(`  EC-01: HAM-001 mevcut stok: ${JSON.stringify(stock)?.substring(0, 80)}`);

            // Acil PO olustur
            this.log('  EC-01: Acil satin alma siparisi olusturuluyor...');
            const supplierId = this.supplierIds.get('SUP-001');
            if (supplierId) {
              const po = await this.api.createPurchaseOrder({
                supplierId,
                expectedDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                priority: 'urgent',
                notes: 'ACIL - HAM-001 stok tukendi, uretim durdu',
                items: [{
                  materialCode: 'HAM-001',
                  quantity: 3000,
                  unitPrice: 18.50,
                  unit: 'KG',
                }],
              });
              if (po?.id) {
                this.totalPOsCreated++;
                await this.api.approvePurchaseOrder(po.id);
                await this.api.sendPurchaseOrder(po.id);
                this.log('  EC-01: Acil PO olusturuldu, onaylandi ve gonderildi');
              }
            }
          },
        });

        cases.push({
          id: 'EC-03', week: 4, day: 3,
          type: 'partial_delivery',
          description: 'Kismi teslimat: 2000/3000 KG HAM-001 teslim alindi',
          action: async () => {
            this.log('  EC-03: Kismi teslimat geldi → 2000/3000 KG HAM-001');
            this.log('  EC-03: Celik Ticaret yalnizca %60 teslim edebildi');

            // Mal kabul olustur (kismi miktar)
            // NOT: Gercek PO id'si olmadan simule ediyoruz
            this.log('  EC-03: Mal kabul olusturuluyor (kismi)...');
            // Temsili olarak stok bilgisi guncelleniyor
            const stock = await this.api.getStockSummary('HAM-001');
            this.log(`  EC-03: HAM-001 stok durumu: ${JSON.stringify(stock)?.substring(0, 80)}`);
            this.log('  EC-03: Kalan 1000 KG icin 2. teslimat bekleniyor (3 gun)');
          },
        });
        break;

      // ─── Hafta 5: Oncelik degisikligi + acil siparis ────────
      case 5:
        cases.push({
          id: 'EC-09', week: 5, day: 1,
          type: 'priority_change',
          description: 'Ford Otosan acil siparis: Mevcut siparislerin onceligi dusuruldu',
          action: async () => {
            this.log('  EC-09: Ford Otosan acil siparis talebi!');
            this.log('  EC-09: Mevcut PRD-003 (Pres Plaka) siparisleri onceligi dusuruldu');

            // Mevcut is emirlerini bul ve oncelik degistir
            const allJobs = await this.api.getAllJobOrders();
            const pressJobs = allJobs.filter(j =>
              j.materialCode === 'PRD-003' && j.status === 'started'
            );

            for (const job of pressJobs) {
              await this.api.changePriority(job.id, 'low', 'Ford Otosan acil siparis onceligi', 'planner');
              this.log(`  EC-09: ${job.jobOrderNo} onceligi LOW yapildi`);
            }
          },
        });

        cases.push({
          id: 'EC-12', week: 5, day: 1,
          type: 'rush_order',
          description: 'Ford Otosan acil siparis: 500 Aks Mili, critical oncelik',
          action: async () => {
            this.log('  EC-12: ACIL SIPARIS → Ford Otosan: 500 Aks Mili (PRD-001)');
            this.log('  EC-12: Oncelik: CRITICAL | Teslimat: 5 gun');

            // BOM'dan acil is emri olustur
            const boms = await this.api.getBoms();
            const bom = boms.find(b => b.code === 'PRD-001' || b.outputMaterialCode === 'PRD-001');

            if (bom) {
              const result = await this.api.createJobOrderFromBom(bom.id, 500, 'Ford Otosan - ACIL');
              if (result) {
                this.createdJobOrderIds.set(result.jobOrderNo, result.id);
                this.totalJobOrdersCreated++;
                this.log(`  EC-12: Acil is emri olusturuldu: ${result.jobOrderNo}`);

                // Kuyruk basina ekle
                await this.api.addToQueue('CNC-01', result.id, 1);
                this.log('  EC-12: CNC-01 kuyruk basina eklendi (oncelik: 1)');
              }
            }
          },
        });
        break;

      // ─── Hafta 6: Kalitesiz malzeme + tedarikci puani ──────
      case 6:
        cases.push({
          id: 'EC-04', week: 6, day: 2,
          type: 'quality_reject',
          description: 'Gelen malzeme kalitesiz: Celik Ticaret HAM-001 sertlik dusuk',
          action: async () => {
            this.log('  EC-04: Mal kabul kalite kontrol sonucu: RED');
            this.log('  EC-04: HAM-001 (Celik Cubuk) sertlik degeri spec altinda (HRC 38 < 42)');
            this.log('  EC-04: Celik Ticaret partisi reddedildi');

            // Temsili mal kabul reddi
            this.log('  EC-04: Mal kabul reddediliyor...');
            // Gercek GR id'si olmadan log'luyoruz
            this.log('  EC-04: Alternatif tedarikci arailiyor...');
          },
        });

        cases.push({
          id: 'EC-18', week: 6, day: 3,
          type: 'supplier_score',
          description: 'Tedarikci skoru dusuruldu: Celik Ticaret kalite puani azaldi',
          action: async () => {
            this.log('  EC-18: Celik Ticaret (SUP-001) tedarikci kalite puani guncellendi');
            this.log('  EC-18: Kalite skoru: 85 → 62 (kalitesiz teslimat nedeniyle)');
            this.log('  EC-18: Paslanmaz Ltd (SUP-003) alternatif tedarikci olarak degerlendiriliyor');

            // Alternatif tedarikci ile PO
            await this.executePurchaseOrder({
              supplierCode: 'SUP-003',
              materialCode: 'HAM-006',
              quantity: 500,
              expectedDays: 8,
            });
            this.log('  EC-18: Alternatif tedarikci PO olusturuldu');
          },
        });
        break;

      // ─── Hafta 7: Rework + SPC kontrol disi ────────────────
      case 7:
        cases.push({
          id: 'EC-15', week: 7, day: 2,
          type: 'rework',
          description: 'SPC kontrol disi: CNC-01 Cpk < 1.0 → 50 parca rework',
          action: async () => {
            this.log('  EC-15: SPC UYARI → CNC-01 cap olcumu kontrol disi!');
            this.log('  EC-15: Cpk = 0.82 (hedef: >= 1.33)');
            this.log('  EC-15: 50 parca yeniden isleme alinmali');

            // Aktif is emrini bul ve hold yap
            const activeJobs = await this.api.getActiveJobOrders();
            const cncJob = activeJobs.find(j => j.operation === 'CNC-01');

            if (cncJob) {
              await this.api.holdJobOrder(cncJob.id, 'SPC kontrol disi - Cpk 0.82', 'planner');
              this.log(`  EC-15: ${cncJob.jobOrderNo} HOLD yapildi`);

              // Rework emri olustur
              const rework = await this.api.createReworkOrder(
                cncJob.id, 50,
                'SPC kontrol disi - cap toleransi asimi',
                'planner',
              );
              if (rework) {
                this.log(`  EC-15: Rework emri olusturuldu: 50 parca`);
              }
            }
          },
        });

        cases.push({
          id: 'EC-19', week: 7, day: 4,
          type: 'release_hold',
          description: 'Rework tamamlandi, is emri serbest birakildi',
          action: async () => {
            this.log('  EC-19: Rework islemi tamamlandi');
            this.log('  EC-19: 50 parcanin 47\'si kurtarildi, 3 hurda');

            // Hold'daki is emrini bul ve release yap
            const allJobs = await this.api.getAllJobOrders();
            const holdJobs = allJobs.filter(j => j.status === 'on_hold');

            for (const job of holdJobs) {
              await this.api.releaseJobOrder(job.id, 'planner');
              this.log(`  EC-19: ${job.jobOrderNo} RELEASE yapildi - uretim devam ediyor`);
            }
          },
        });
        break;

      // ─── Hafta 8: Kapasite asimi + WIP birikmesi ───────────
      case 8:
        cases.push({
          id: 'EC-08', week: 8, day: 1,
          type: 'capacity_overflow',
          description: 'PAINT-01 kuyruk dolu (darbogaz) - WIP birikmesi',
          action: async () => {
            this.log('  EC-08: PAINT-01 darbogaz tespit edildi!');
            this.log('  EC-08: Boya hatti kuyrugu: 12 is emri bekliyor');

            // Kuyruk bilgisini kontrol et
            const queue = await this.api.getQueue('PAINT-01');
            this.log(`  EC-08: Mevcut kuyruk uzunlugu: ${queue.length}`);

            // Fazla is emri ekle (kapasite asimi gosterimi)
            const boms = await this.api.getBoms();
            const paintBom = boms.find(b => b.code === 'PRD-004' || b.outputMaterialCode === 'PRD-004');

            if (paintBom) {
              for (let i = 0; i < 3; i++) {
                const result = await this.api.createJobOrderFromBom(paintBom.id, 30, 'Hyundai Assan');
                if (result) {
                  this.totalJobOrdersCreated++;
                  await this.api.addToQueue('PAINT-01', result.id, 5);
                  this.log(`  EC-08: Ek is emri kuyruga eklendi: ${result.jobOrderNo}`);
                }
              }
            }

            this.log('  EC-08: WIP birikme uyarisi: WELD-01 cikisi → PAINT-01 girisi');
          },
        });

        cases.push({
          id: 'EC-14', week: 8, day: 3,
          type: 'wip_accumulation',
          description: 'WIP birikmesi devam ediyor: 45 parca boya oncesi bekliyor',
          action: async () => {
            this.log('  EC-14: WIP durumu:');
            this.log('  EC-14:   WELD-01 cikisi → 28 parca bekliyor');
            this.log('  EC-14:   WELD-02 cikisi → 17 parca bekliyor');
            this.log('  EC-14:   PAINT-01 kapasitesi: 15 parca/vardiya');
            this.log('  EC-14: Tahmini temizleme suresi: 3 vardiya');
          },
        });
        break;

      // ─── Hafta 9: Iptal + bolme ────────────────────────────
      case 9:
        cases.push({
          id: 'EC-10', week: 9, day: 2,
          type: 'cancellation',
          description: 'TOFAS siparis iptali: Flans Braket siparisi yariya indirildi',
          action: async () => {
            this.log('  EC-10: TOFAS bildirim: Siparis miktari yariya dusuruldu');
            this.log('  EC-10: 200 Flans Braket → 100 Flans Braket');

            // TOFAS is emrini bul ve iptal et
            const allJobs = await this.api.getAllJobOrders();
            const tofasJobs = allJobs.filter(j =>
              j.customer === 'TOFAS' &&
              (j.status === 'started' || j.status === 'planned')
            );

            if (tofasJobs.length > 0) {
              const job = tofasJobs[0];
              await this.api.cancelJobOrder(job.id, 'Musteri siparis iptali - TOFAS miktar dusurme', 'planner');
              this.log(`  EC-10: ${job.jobOrderNo} iptal edildi`);
            }
          },
        });

        cases.push({
          id: 'EC-11', week: 9, day: 3,
          type: 'split',
          description: 'Is emri bolme: Buyuk Arcelik siparisi 2 makineye dagildi',
          action: async () => {
            this.log('  EC-11: Arcelik buyuk siparisi (350 parca) 2 makineye bolunuyor');

            const allJobs = await this.api.getAllJobOrders();
            const arcelikJobs = allJobs.filter(j =>
              j.customer === 'Arcelik' &&
              (j.status === 'started' || j.status === 'planned') &&
              j.quantityPlanned >= 200
            );

            if (arcelikJobs.length > 0) {
              const job = arcelikJobs[0];
              const splitResult = await this.api.splitJobOrder(
                job.id, 175,
                'Kapasite dengeleme - 2 makineye dagitim',
                'planner',
              );
              if (splitResult) {
                this.log(`  EC-11: ${job.jobOrderNo} bolundu: 175 + 175 parca`);
                this.log('  EC-11: PRESS-01 ve PRESS-02 arasinda dagitildi');
              }
            }
          },
        });
        break;

      // ─── Hafta 10: Bakim senaryolari ───────────────────────
      case 10:
        cases.push({
          id: 'EC-21', week: 10, day: 1,
          type: 'planned_maintenance',
          description: 'Planli bakim: CNC-02 haftalik bakim programi',
          action: async () => {
            this.log('  EC-21: CNC-02 planli bakim baslatiliyor');
            this.log('  EC-21: Tahmini sure: 4 saat');

            const wo = await this.api.createMaintenanceWorkOrder({
              machineId: 'CNC-02',
              type: 'preventive',
              priority: 'normal',
              description: 'Haftalik bakim: Yaglama, filtreleme, kalibrasyon kontrolu (tahmini 4 saat, SRF-004 x20, SRF-014 x5)',
            });

            if (wo) {
              this.log('  EC-21: Bakim is emri olusturuldu');
            }

            // CNC-02 uretimini hold yap
            const activeJobs = await this.api.getActiveJobOrders();
            const cncJob = activeJobs.find(j => j.operation === 'CNC-02');
            if (cncJob) {
              await this.api.holdJobOrder(cncJob.id, 'Planli bakim - CNC-02', 'planner');
              this.log(`  EC-21: ${cncJob.jobOrderNo} HOLD (bakim nedeniyle)`);
            }
          },
        });

        cases.push({
          id: 'EC-22', week: 10, day: 3,
          type: 'breakdown',
          description: 'Arizayla durun: WELD-01 servo motor arizasi',
          action: async () => {
            this.log('  EC-22: !!! ARIZA !!! WELD-01 servo motor arizasi!');
            this.log('  EC-22: Ariza tipi: Servo motor encoder hatasi');
            this.log('  EC-22: Tahmini onarim: 8 saat (yedek parca gerekli)');

            const wo = await this.api.createMaintenanceWorkOrder({
              machineId: 'WELD-01',
              type: 'corrective',
              description: 'Acil ariza: Servo motor encoder hatasi - kaynak robotu durdu (tahmini 8 saat, SPARE-SERVO-01 x1)',
              failureMode: 'mechanical',
            });

            if (wo) {
              this.log('  EC-22: Acil bakim is emri olusturuldu');
            }

            // WELD-01 is emirlerini hold yap
            const activeJobs = await this.api.getActiveJobOrders();
            const weldJobs = activeJobs.filter(j => j.operation === 'WELD-01');
            for (const job of weldJobs) {
              await this.api.holdJobOrder(job.id, 'Makine arizasi - WELD-01 servo motor', 'planner');
              this.log(`  EC-22: ${job.jobOrderNo} HOLD (ariza nedeniyle)`);
            }
          },
        });

        cases.push({
          id: 'EC-23', week: 10, day: 4,
          type: 'waiting_parts',
          description: 'Yedek parca yok: WELD-01 onarimi bekleniyor',
          action: async () => {
            this.log('  EC-23: WELD-01 servo motor yedek parcasi stokta yok!');
            this.log('  EC-23: Bakim is emri durumu: BEKLEMEDE (yedek parca)');
            this.log('  EC-23: Siparis verildi - tahmini varis: 2 is gunu');

            // Yedek parca icin PO
            const supplierId = this.supplierIds.get('SUP-004');
            if (supplierId) {
              const po = await this.api.createPurchaseOrder({
                supplierId,
                expectedDeliveryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                priority: 'urgent',
                notes: 'ACIL - WELD-01 servo motor yedek parcasi',
                items: [{
                  materialCode: 'SPARE-SERVO-01',
                  quantity: 1,
                  unitPrice: 2500,
                  unit: 'ADET',
                }],
              });
              if (po?.id) {
                this.totalPOsCreated++;
                await this.api.approvePurchaseOrder(po.id);
                await this.api.sendPurchaseOrder(po.id);
                this.log('  EC-23: Yedek parca PO olusturuldu ve gonderildi');
              }
            }
          },
        });
        break;

      // ─── Hafta 11: Musteri sikayet + sevkiyat ──────────────
      case 11:
        cases.push({
          id: 'EC-17', week: 11, day: 1,
          type: 'customer_complaint',
          description: 'Ford Otosan iade: 30 parca boyutsal hata',
          action: async () => {
            this.log('  EC-17: MUSTERI SIKAYET → Ford Otosan');
            this.log('  EC-17: 30 adet Aks Mili iade (boyutsal tolerans asimi)');
            this.log('  EC-17: 8D sureci baslatiliyor');

            const complaint = await this.api.createComplaint({
              customer: 'Ford Otosan',
              complaintType: 'dimensional_defect',
              description: 'Aks Mili PRD-001: 30 adet boyutsal tolerans asimi. Cap olcusu O20 +0.05/-0.02 spec disi.',
              materialCode: 'PRD-001',
              quantity: 30,
              severity: 'major',
            });

            if (complaint) {
              this.log('  EC-17: Musteri sikayeti olusturuldu (8D basladi)');
            }

            // Rework emri olustur
            const allJobs = await this.api.getAllJobOrders();
            const fordJobs = allJobs.filter(j => j.customer === 'Ford Otosan' && j.materialCode === 'PRD-001');
            if (fordJobs.length > 0) {
              await this.api.createReworkOrder(fordJobs[0].id, 30, 'Musteri iade - boyutsal hata', 'planner');
              this.log('  EC-17: 30 parca icin rework emri olusturuldu');
            }
          },
        });

        cases.push({
          id: 'EC-25', week: 11, day: 3,
          type: 'shipment',
          description: 'Sevkiyat planlama: Tamamlanan siparisler icin sevkiyat',
          action: async () => {
            this.log('  EC-25: Sevkiyat planlama baslatiliyor');

            // Ford Otosan sevkiyati
            const shipment1 = await this.api.createShipment({
              customer: 'Ford Otosan',
              deliveryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              items: [
                { materialCode: 'PRD-001', quantity: 450 },
                { materialCode: 'PRD-006', quantity: 55 },
              ],
              notes: 'Ford Otosan haftalik sevkiyat',
            });

            if (shipment1?.id) {
              await this.api.shipShipment(shipment1.id, 'Aras Kargo', 'TRK-2026-' + Math.floor(Math.random() * 90000 + 10000));
              this.log('  EC-25: Ford Otosan sevkiyati olusturuldu ve gonderildi');
            }

            // Arcelik sevkiyati
            const shipment2 = await this.api.createShipment({
              customer: 'Arcelik',
              deliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              items: [
                { materialCode: 'PRD-003', quantity: 280 },
              ],
              notes: 'Arcelik aylik sevkiyat',
            });

            if (shipment2?.id) {
              await this.api.shipShipment(shipment2.id, 'MNG Kargo', 'TRK-2026-' + Math.floor(Math.random() * 90000 + 10000));
              this.log('  EC-25: Arcelik sevkiyati olusturuldu ve gonderildi');
            }
          },
        });

        cases.push({
          id: 'EC-26', week: 11, day: 4,
          type: 'partial_shipment',
          description: 'Kismi sevkiyat: BSH siparisi yeterli stok yok',
          action: async () => {
            this.log('  EC-26: BSH sevkiyat hazirligi');
            this.log('  EC-26: Siparis: 160 Paslanmaz Burc (PRD-005)');
            this.log('  EC-26: Mevcut stok: 120 adet - KISMI SEVKIYAT');

            const shipment = await this.api.createShipment({
              customer: 'BSH',
              deliveryDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              items: [
                { materialCode: 'PRD-005', quantity: 120 },
              ],
              notes: 'BSH kismi sevkiyat - kalan 40 adet sonraki haftaya',
            });

            if (shipment?.id) {
              await this.api.shipShipment(shipment.id, 'Yurtici Kargo', 'TRK-2026-' + Math.floor(Math.random() * 90000 + 10000));
              this.log('  EC-26: BSH kismi sevkiyat: 120/160 adet gonderildi');
              this.log('  EC-26: Kalan 40 adet icin ek uretim planlanacak');
            }
          },
        });
        break;

      // ─── Hafta 12: Izlenebilirlik + audit ──────────────────
      case 12:
        cases.push({
          id: 'EC-28', week: 12, day: 1,
          type: 'lot_trace',
          description: 'Lot izlenebilirlik sorgusu: HAM-001 Lot-2024-001 hangi urunlerde?',
          action: async () => {
            this.log('  EC-28: LOT IZLENEBILIRLIK SORGUSU');
            this.log('  EC-28: Sorgulanan: HAM-001 Lot-2024-001');
            this.log('  EC-28: Bu lot asagidaki urunlerde kullanildi:');
            this.log('  EC-28:   - PRD-001 (Aks Mili): ~850 adet');
            this.log('  EC-28:   - Toplam: 2125 KG ham madde tuketildi');
            this.log('  EC-28:   - Musteriler: Ford Otosan');
            this.log('  EC-28: Lot izlenebilirlik raporu olusturuldu');
          },
        });

        cases.push({
          id: 'EC-29', week: 12, day: 3,
          type: 'audit_trail',
          description: 'Audit trail incelemesi: 3 aylik uretim ozeti',
          action: async () => {
            this.log('  EC-29: AUDIT TRAIL INCELEMESI');
            this.log('  EC-29: 3 aylik uretim istatistikleri:');

            // Tum is emirlerini al ve ozet cikart
            const allJobs = await this.api.getAllJobOrders();
            const completed = allJobs.filter(j => j.status === 'completed');
            const cancelled = allJobs.filter(j => j.status === 'cancelled');
            const totalProduced = completed.reduce((sum, j) => sum + j.quantityProduced, 0);
            const totalScrapped = completed.reduce((sum, j) => sum + j.quantityScrapped, 0);

            this.log(`  EC-29:   Toplam is emri: ${allJobs.length}`);
            this.log(`  EC-29:   Tamamlanan: ${completed.length}`);
            this.log(`  EC-29:   Iptal edilen: ${cancelled.length}`);
            this.log(`  EC-29:   Toplam uretim: ${totalProduced} parca`);
            this.log(`  EC-29:   Toplam hurda: ${totalScrapped} parca`);
            this.log(`  EC-29:   Hurda orani: ${totalProduced > 0 ? ((totalScrapped / totalProduced) * 100).toFixed(2) : 0}%`);
          },
        });

        cases.push({
          id: 'EC-30', week: 12, day: 5,
          type: 'final_summary',
          description: 'Donem sonu: 3 aylik uretim raporu',
          action: async () => {
            this.log('  EC-30: 3 AYLIK DONEM SONU RAPORU');
            this.log('  EC-30: ' + '─'.repeat(40));

            const allJobs = await this.api.getAllJobOrders();
            const machines = await this.api.getMachines();

            // Urun bazli ozet
            for (const product of PRODUCTS) {
              const productJobs = allJobs.filter(j => j.materialCode === product.outputMaterialCode);
              const produced = productJobs.reduce((sum, j) => sum + j.quantityProduced, 0);
              this.log(`  EC-30:   ${product.name}: ${produced} adet uretildi (${productJobs.length} is emri)`);
            }

            // Tedarikci ozet
            this.log(`  EC-30:   Toplam satin alma siparisi: ${this.totalPOsCreated}`);
            this.log(`  EC-30:   Edge case calistirilan: ${this.executedEdgeCases.length}/30`);

            // Makine ozet
            this.log(`  EC-30:   Makine sayisi: ${machines.length}`);

            this.log('  EC-30: ' + '─'.repeat(40));
            this.log('  EC-30: DONEM TAMAMLANDI');
          },
        });
        break;
    }

    return cases;
  }
}
