/**
 * Malzeme ve Sarf Tanimlari
 * Hammadde + sarf malzeme + makine-malzeme iliskileri
 */

export interface MaterialConfig {
  code: string;
  name: string;
  unit: string;
  type: 'RAW_MATERIAL' | 'SEMI_FINISHED' | 'FINISHED_GOODS' | 'CONSUMABLE';
  isConsumable: boolean;
  initialStock: number;
  minStock: number;
  monthlyConsumption: number;
}

export interface ConsumableConfig {
  code: string;
  name: string;
  unit: string;
  machines: string[];           // Kullanan makine ID'leri
  consumptionPerPart: number;   // Parca basina tuketim
  changeThreshold?: number;     // Degisim esigi (parca sayisi)
  changeIntervalHours?: number; // Degisim periyodu (saat)
}

export interface ProductBomConfig {
  code: string;
  name: string;
  outputMaterialCode: string;
  cycleTimeSec: number;
  machines: string[];     // Hangi makinelerde uretiliyor
  customer: string;
  inputs: Array<{
    materialCode: string;
    quantity: number;
    unit: string;
  }>;
  consumables: Array<{
    code: string;
    quantityPerPart: number;
  }>;
}

// ─── Hammaddeler ────────────────────────────────────────────────

export const MATERIALS: MaterialConfig[] = [
  { code: 'HAM-001', name: 'Celik Cubuk O20mm (C45)', unit: 'KG', type: 'RAW_MATERIAL', isConsumable: false, initialStock: 3500, minStock: 800, monthlyConsumption: 3500 },
  { code: 'HAM-002', name: 'Celik Cubuk O35mm (C45)', unit: 'KG', type: 'RAW_MATERIAL', isConsumable: false, initialStock: 2200, minStock: 500, monthlyConsumption: 2200 },
  { code: 'HAM-003', name: 'Celik Levha 3mm (St37)', unit: 'KG', type: 'RAW_MATERIAL', isConsumable: false, initialStock: 4000, minStock: 1000, monthlyConsumption: 4000 },
  { code: 'HAM-004', name: 'Celik Levha 5mm (St37)', unit: 'KG', type: 'RAW_MATERIAL', isConsumable: false, initialStock: 2800, minStock: 700, monthlyConsumption: 2800 },
  { code: 'HAM-005', name: 'Aluminyum Profil 40x40 (6063)', unit: 'MT', type: 'RAW_MATERIAL', isConsumable: false, initialStock: 600, minStock: 150, monthlyConsumption: 600 },
  { code: 'HAM-006', name: 'Paslanmaz Cubuk O25mm (304)', unit: 'KG', type: 'RAW_MATERIAL', isConsumable: false, initialStock: 800, minStock: 200, monthlyConsumption: 800 },
  { code: 'HAM-007', name: 'Sac Levha 2mm (DKP)', unit: 'KG', type: 'RAW_MATERIAL', isConsumable: false, initialStock: 3200, minStock: 800, monthlyConsumption: 3200 },
];

// ─── Sarf Malzemeleri ───────────────────────────────────────────

export const CONSUMABLES: ConsumableConfig[] = [
  { code: 'SRF-001', name: 'CNC Kesici Uc (CNMG 120408)', unit: 'ADET', machines: ['CNC-01', 'CNC-02', 'CNC-03'], consumptionPerPart: 0.005, changeThreshold: 200 },
  { code: 'SRF-002', name: 'CNC Matkap Ucu O8mm', unit: 'ADET', machines: ['CNC-02', 'DRILL-01'], consumptionPerPart: 0.002, changeThreshold: 500 },
  { code: 'SRF-003', name: 'Freze Takimi O16mm', unit: 'ADET', machines: ['CNC-02'], consumptionPerPart: 0.0025, changeThreshold: 400 },
  { code: 'SRF-004', name: 'Kesme Yagi (emulsiyon)', unit: 'LT', machines: ['CNC-01', 'CNC-02', 'CNC-03', 'SAW-01'], consumptionPerPart: 0.02, changeIntervalHours: 168 },
  { code: 'SRF-005', name: 'Hidrolik Yag (ISO VG 46)', unit: 'LT', machines: ['PRESS-01', 'PRESS-02'], consumptionPerPart: 0.001, changeIntervalHours: 2160 },
  { code: 'SRF-006', name: 'Kaynak Teli (SG2 O1.0mm)', unit: 'KG', machines: ['WELD-01', 'WELD-02'], consumptionPerPart: 0.15 },
  { code: 'SRF-007', name: 'Kaynak Gazi (CO2/Argon)', unit: 'M3', machines: ['WELD-01', 'WELD-02'], consumptionPerPart: 0.08 },
  { code: 'SRF-008', name: 'Toz Boya (RAL 7035 Gri)', unit: 'KG', machines: ['PAINT-01'], consumptionPerPart: 0.08 },
  { code: 'SRF-009', name: 'Toz Boya (RAL 9005 Siyah)', unit: 'KG', machines: ['PAINT-01'], consumptionPerPart: 0.06 },
  { code: 'SRF-010', name: 'Serit Testere Bicagi', unit: 'ADET', machines: ['SAW-01'], consumptionPerPart: 0.0002, changeIntervalHours: 50 },
  { code: 'SRF-011', name: 'Zimpara Diski (P80)', unit: 'ADET', machines: [], consumptionPerPart: 0 },
  { code: 'SRF-012', name: 'Paketleme Kolisi (40x30x20)', unit: 'ADET', machines: ['PACK-01'], consumptionPerPart: 0.1 },
  { code: 'SRF-013', name: 'Strec Film', unit: 'RULO', machines: ['PACK-01'], consumptionPerPart: 0.005 },
  { code: 'SRF-014', name: 'Sogutma Suyu Katkisi', unit: 'LT', machines: ['CNC-01', 'CNC-02', 'CNC-03'], consumptionPerPart: 0.001, changeIntervalHours: 168 },
];

// ─── Urunler (BOM) ──────────────────────────────────────────────

export const PRODUCTS: ProductBomConfig[] = [
  {
    code: 'PRD-001', name: 'Aks Mili O20', outputMaterialCode: 'PRD-001',
    cycleTimeSec: 270, machines: ['CNC-01'], customer: 'Ford Otosan',
    inputs: [{ materialCode: 'HAM-001', quantity: 2.5, unit: 'KG' }],
    consumables: [{ code: 'SRF-001', quantityPerPart: 0.005 }, { code: 'SRF-004', quantityPerPart: 0.05 }],
  },
  {
    code: 'PRD-002', name: 'Flans Braket', outputMaterialCode: 'PRD-002',
    cycleTimeSec: 372, machines: ['CNC-02', 'DRILL-01'], customer: 'TOFAS',
    inputs: [{ materialCode: 'HAM-005', quantity: 0.8, unit: 'MT' }],
    consumables: [{ code: 'SRF-003', quantityPerPart: 0.003 }, { code: 'SRF-002', quantityPerPart: 0.002 }, { code: 'SRF-004', quantityPerPart: 0.03 }],
  },
  {
    code: 'PRD-003', name: 'Pres Plaka 3mm', outputMaterialCode: 'PRD-003',
    cycleTimeSec: 120, machines: ['PRESS-01'], customer: 'Arcelik',
    inputs: [{ materialCode: 'HAM-003', quantity: 1.2, unit: 'KG' }],
    consumables: [{ code: 'SRF-005', quantityPerPart: 0.001 }],
  },
  {
    code: 'PRD-004', name: 'Kaynakli Konsol', outputMaterialCode: 'PRD-004',
    cycleTimeSec: 720, machines: ['SAW-01', 'WELD-01', 'PAINT-01'], customer: 'Hyundai Assan',
    inputs: [{ materialCode: 'HAM-004', quantity: 0.8, unit: 'KG' }, { materialCode: 'HAM-007', quantity: 0.3, unit: 'KG' }],
    consumables: [{ code: 'SRF-006', quantityPerPart: 0.15 }, { code: 'SRF-007', quantityPerPart: 0.08 }, { code: 'SRF-008', quantityPerPart: 0.08 }],
  },
  {
    code: 'PRD-005', name: 'Paslanmaz Burc', outputMaterialCode: 'PRD-005',
    cycleTimeSec: 180, machines: ['CNC-03'], customer: 'BSH',
    inputs: [{ materialCode: 'HAM-006', quantity: 0.4, unit: 'KG' }],
    consumables: [{ code: 'SRF-001', quantityPerPart: 0.005 }],
  },
  {
    code: 'PRD-006', name: 'Sac Braket Montajli', outputMaterialCode: 'PRD-006',
    cycleTimeSec: 900, machines: ['PRESS-02', 'WELD-02', 'DRILL-01', 'PAINT-01', 'PACK-01'], customer: 'Ford Otosan',
    inputs: [{ materialCode: 'HAM-007', quantity: 0.5, unit: 'KG' }],
    consumables: [{ code: 'SRF-006', quantityPerPart: 0.08 }, { code: 'SRF-009', quantityPerPart: 0.06 }, { code: 'SRF-012', quantityPerPart: 0.1 }],
  },
];
