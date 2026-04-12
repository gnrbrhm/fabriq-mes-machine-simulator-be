/**
 * Fabriq Metal Sanayi A.S. - Fabrika Tanimı
 * Bursa OSB, Otomotiv Yan Sanayi, 4.500 m² kapali alan
 */

export type MachineStatus = 'off' | 'idle' | 'warmup' | 'running' | 'alarm' | 'maintenance' | 'setup';
export type TagCategory = 'status' | 'counter' | 'process_param' | 'energy' | 'alarm' | 'quality';

export interface TagConfig {
  tagId: string;
  name: string;
  address: string;
  dataType: 'float32' | 'int32' | 'boolean' | 'string';
  category: TagCategory;
  engineeringUnit: string;
  deadband: number;
  minValue?: number;
  maxValue?: number;
  // Simulasyon parametreleri
  nominalValue: number;     // Normal calisma degeri
  noisePercent: number;     // Gurultu yuzdesi (0-100)
  idleValue: number;        // Bosta deger
  alarmThreshold?: number;  // Alarm esigi
}

export interface MachineConfig {
  machineId: string;
  name: string;
  type: string;
  protocol: string;
  connectionConfig: Record<string, unknown>;
  pollingIntervalMs: number;
  tags: TagConfig[];
  // Uretim parametreleri
  cycleTimeSec: number;        // Cevrim suresi (sn)
  cycleTimeVariance: number;   // Cevrim varyans (%)
  failureProbability: number;  // Ariza olasiligi (her dakika)
  scrapRate: number;           // Hurda orani (0-1)
  warmupTimeSec: number;       // Isinma suresi (sn)
  // Enerji
  runningPowerKw: number;      // Calisirken guc (kW)
  idlePowerKw: number;         // Bosta guc (kW)
}

export interface ShiftConfig {
  code: string;
  name: string;
  startHour: number;
  endHour: number;
  breakStartHour: number;
  breakDurationMin: number;
}

export interface FactoryConfig {
  factoryName: string;
  edgeGatewayId: string;
  edgeGatewayName: string;
  factorySite: string;
  shifts: ShiftConfig[];
  machines: MachineConfig[];
}

export const FACTORY_CONFIG: FactoryConfig = {
  factoryName: 'Fabriq Metal Sanayi A.S.',
  edgeGatewayId: 'EDGE-BURSA-01',
  edgeGatewayName: 'Bursa Fabrika Gateway',
  factorySite: 'Bursa OSB',

  shifts: [
    { code: 'SABAH', name: 'Sabah Vardiyasi', startHour: 6, endHour: 14, breakStartHour: 10, breakDurationMin: 30 },
    { code: 'OGLEDEN_SONRA', name: 'Ogleden Sonra', startHour: 14, endHour: 22, breakStartHour: 18, breakDurationMin: 30 },
    { code: 'GECE', name: 'Gece Vardiyasi', startHour: 22, endHour: 6, breakStartHour: 2, breakDurationMin: 30 },
  ],

  machines: [
    // ─── CNC TORNALAR ──────────────────────────────────────
    {
      machineId: 'CNC-01', name: 'CNC Torna #1 (Doosan Lynx)', type: 'cnc_lathe',
      protocol: 's7', connectionConfig: { host: '192.168.1.10', port: 102, rack: 0, slot: 1 },
      pollingIntervalMs: 1000, cycleTimeSec: 270, cycleTimeVariance: 10, failureProbability: 0.002,
      scrapRate: 0.015, warmupTimeSec: 600, runningPowerKw: 15, idlePowerKw: 2.5,
      tags: [
        { tagId: 'CNC01.status', name: 'machine_status', address: 'DB1.DBX0.0', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'CNC01.spindle', name: 'spindle_speed', address: 'DB1.DBD2', dataType: 'float32', category: 'process_param', engineeringUnit: 'rpm', deadband: 5, minValue: 0, maxValue: 6000, nominalValue: 2800, noisePercent: 2, idleValue: 0, alarmThreshold: 5500 },
        { tagId: 'CNC01.temp', name: 'temperature', address: 'DB1.DBD6', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 0.5, minValue: 15, maxValue: 120, nominalValue: 42, noisePercent: 3, idleValue: 25, alarmThreshold: 85 },
        { tagId: 'CNC01.parts', name: 'part_counter', address: 'DB1.DBD10', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'CNC01.energy', name: 'energy_kwh', address: 'DB2.DBD0', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },
    {
      machineId: 'CNC-02', name: 'CNC Freze #2 (Mazak VCN)', type: 'cnc_mill',
      protocol: 's7', connectionConfig: { host: '192.168.1.11', port: 102, rack: 0, slot: 1 },
      pollingIntervalMs: 1000, cycleTimeSec: 372, cycleTimeVariance: 12, failureProbability: 0.0015,
      scrapRate: 0.018, warmupTimeSec: 480, runningPowerKw: 22, idlePowerKw: 3.5,
      tags: [
        { tagId: 'CNC02.status', name: 'machine_status', address: 'DB1.DBX0.0', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'CNC02.spindle', name: 'spindle_speed', address: 'DB1.DBD2', dataType: 'float32', category: 'process_param', engineeringUnit: 'rpm', deadband: 5, minValue: 0, maxValue: 12000, nominalValue: 4500, noisePercent: 2, idleValue: 0, alarmThreshold: 11000 },
        { tagId: 'CNC02.temp', name: 'temperature', address: 'DB1.DBD6', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 0.5, minValue: 15, maxValue: 120, nominalValue: 38, noisePercent: 3, idleValue: 25, alarmThreshold: 80 },
        { tagId: 'CNC02.coolant', name: 'coolant_level', address: 'DB1.DBD14', dataType: 'float32', category: 'process_param', engineeringUnit: '%', deadband: 1, minValue: 0, maxValue: 100, nominalValue: 85, noisePercent: 1, idleValue: 85, alarmThreshold: 20 },
        { tagId: 'CNC02.parts', name: 'part_counter', address: 'DB1.DBD10', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'CNC02.energy', name: 'energy_kwh', address: 'DB2.DBD0', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },
    {
      machineId: 'CNC-03', name: 'CNC Torna #3 (DMG MORI)', type: 'cnc_lathe',
      protocol: 'opc-ua', connectionConfig: { endpointUrl: 'opc.tcp://192.168.1.12:4840' },
      pollingIntervalMs: 1000, cycleTimeSec: 180, cycleTimeVariance: 8, failureProbability: 0.001,
      scrapRate: 0.012, warmupTimeSec: 300, runningPowerKw: 18, idlePowerKw: 3,
      tags: [
        { tagId: 'CNC03.status', name: 'machine_status', address: 'ns=2;s=Status', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'CNC03.spindle', name: 'spindle_speed', address: 'ns=2;s=SpindleSpeed', dataType: 'float32', category: 'process_param', engineeringUnit: 'rpm', deadband: 5, minValue: 0, maxValue: 8000, nominalValue: 3200, noisePercent: 2, idleValue: 0 },
        { tagId: 'CNC03.temp', name: 'temperature', address: 'ns=2;s=Temperature', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 0.5, minValue: 15, maxValue: 120, nominalValue: 45, noisePercent: 3, idleValue: 25, alarmThreshold: 90 },
        { tagId: 'CNC03.vibration', name: 'vibration', address: 'ns=2;s=Vibration', dataType: 'float32', category: 'process_param', engineeringUnit: 'mm/s', deadband: 0.1, minValue: 0, maxValue: 20, nominalValue: 1.8, noisePercent: 15, idleValue: 0.2, alarmThreshold: 8 },
        { tagId: 'CNC03.parts', name: 'part_counter', address: 'ns=2;s=PartCount', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'CNC03.energy', name: 'energy_kwh', address: 'ns=2;s=Energy', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },

    // ─── PRESLER ────────────────────────────────────────────
    {
      machineId: 'PRESS-01', name: 'Hidrolik Pres 200T (Ermaksan)', type: 'hydraulic_press',
      protocol: 'modbus-tcp', connectionConfig: { host: '192.168.1.20', port: 502, unitId: 1 },
      pollingIntervalMs: 1000, cycleTimeSec: 120, cycleTimeVariance: 5, failureProbability: 0.0025,
      scrapRate: 0.02, warmupTimeSec: 180, runningPowerKw: 35, idlePowerKw: 5,
      tags: [
        { tagId: 'PRESS01.status', name: 'machine_status', address: '10001', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'PRESS01.pressure', name: 'pressure', address: '40001', dataType: 'float32', category: 'process_param', engineeringUnit: 'bar', deadband: 2, minValue: 0, maxValue: 250, nominalValue: 180, noisePercent: 3, idleValue: 0, alarmThreshold: 220 },
        { tagId: 'PRESS01.oiltemp', name: 'oil_temperature', address: '40003', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 0.5, minValue: 15, maxValue: 80, nominalValue: 48, noisePercent: 2, idleValue: 25, alarmThreshold: 65 },
        { tagId: 'PRESS01.oillevel', name: 'oil_level', address: '40005', dataType: 'float32', category: 'process_param', engineeringUnit: '%', deadband: 1, minValue: 0, maxValue: 100, nominalValue: 92, noisePercent: 0.5, idleValue: 92, alarmThreshold: 30 },
        { tagId: 'PRESS01.parts', name: 'cycle_counter', address: '40007', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'PRESS01.energy', name: 'energy_kwh', address: '40009', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },
    {
      machineId: 'PRESS-02', name: 'Hidrolik Pres 100T (Baykal)', type: 'hydraulic_press',
      protocol: 'modbus-tcp', connectionConfig: { host: '192.168.1.21', port: 502, unitId: 1 },
      pollingIntervalMs: 1000, cycleTimeSec: 90, cycleTimeVariance: 8, failureProbability: 0.003,
      scrapRate: 0.025, warmupTimeSec: 120, runningPowerKw: 20, idlePowerKw: 3,
      tags: [
        { tagId: 'PRESS02.status', name: 'machine_status', address: '10001', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'PRESS02.pressure', name: 'pressure', address: '40001', dataType: 'float32', category: 'process_param', engineeringUnit: 'bar', deadband: 2, minValue: 0, maxValue: 150, nominalValue: 95, noisePercent: 4, idleValue: 0, alarmThreshold: 130 },
        { tagId: 'PRESS02.temp', name: 'oil_temperature', address: '40003', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 0.5, minValue: 15, maxValue: 80, nominalValue: 45, noisePercent: 2, idleValue: 25, alarmThreshold: 65 },
        { tagId: 'PRESS02.parts', name: 'cycle_counter', address: '40005', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'PRESS02.energy', name: 'energy_kwh', address: '40007', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },

    // ─── KAYNAK ROBOTLARI ───────────────────────────────────
    {
      machineId: 'WELD-01', name: 'Kaynak Robotu #1 (ABB IRB 1600)', type: 'welding_robot',
      protocol: 's7', connectionConfig: { host: '192.168.1.30', port: 102, rack: 0, slot: 1 },
      pollingIntervalMs: 1000, cycleTimeSec: 480, cycleTimeVariance: 15, failureProbability: 0.001,
      scrapRate: 0.02, warmupTimeSec: 120, runningPowerKw: 25, idlePowerKw: 3,
      tags: [
        { tagId: 'WELD01.status', name: 'machine_status', address: 'DB1.DBX0.0', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'WELD01.current', name: 'weld_current', address: 'DB1.DBD2', dataType: 'float32', category: 'process_param', engineeringUnit: 'A', deadband: 2, minValue: 0, maxValue: 400, nominalValue: 220, noisePercent: 5, idleValue: 0, alarmThreshold: 350 },
        { tagId: 'WELD01.voltage', name: 'weld_voltage', address: 'DB1.DBD6', dataType: 'float32', category: 'process_param', engineeringUnit: 'V', deadband: 0.5, minValue: 0, maxValue: 50, nominalValue: 28, noisePercent: 3, idleValue: 0 },
        { tagId: 'WELD01.wirefeed', name: 'wire_feed_speed', address: 'DB1.DBD10', dataType: 'float32', category: 'process_param', engineeringUnit: 'm/dk', deadband: 0.2, minValue: 0, maxValue: 25, nominalValue: 12, noisePercent: 4, idleValue: 0 },
        { tagId: 'WELD01.parts', name: 'part_counter', address: 'DB1.DBD14', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'WELD01.energy', name: 'energy_kwh', address: 'DB2.DBD0', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },
    {
      machineId: 'WELD-02', name: 'Kaynak Robotu #2 (ABB IRB 2600)', type: 'welding_robot',
      protocol: 's7', connectionConfig: { host: '192.168.1.31', port: 102, rack: 0, slot: 1 },
      pollingIntervalMs: 1000, cycleTimeSec: 540, cycleTimeVariance: 12, failureProbability: 0.001,
      scrapRate: 0.018, warmupTimeSec: 120, runningPowerKw: 30, idlePowerKw: 3.5,
      tags: [
        { tagId: 'WELD02.status', name: 'machine_status', address: 'DB1.DBX0.0', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'WELD02.current', name: 'weld_current', address: 'DB1.DBD2', dataType: 'float32', category: 'process_param', engineeringUnit: 'A', deadband: 2, minValue: 0, maxValue: 500, nominalValue: 280, noisePercent: 5, idleValue: 0, alarmThreshold: 420 },
        { tagId: 'WELD02.voltage', name: 'weld_voltage', address: 'DB1.DBD6', dataType: 'float32', category: 'process_param', engineeringUnit: 'V', deadband: 0.5, minValue: 0, maxValue: 50, nominalValue: 32, noisePercent: 3, idleValue: 0 },
        { tagId: 'WELD02.wirefeed', name: 'wire_feed_speed', address: 'DB1.DBD10', dataType: 'float32', category: 'process_param', engineeringUnit: 'm/dk', deadband: 0.2, minValue: 0, maxValue: 25, nominalValue: 14, noisePercent: 4, idleValue: 0 },
        { tagId: 'WELD02.parts', name: 'part_counter', address: 'DB1.DBD14', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'WELD02.energy', name: 'energy_kwh', address: 'DB2.DBD0', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },

    // ─── BOYA HATTI ─────────────────────────────────────────
    {
      machineId: 'PAINT-01', name: 'Toz Boya Hatti (Koyuncu)', type: 'paint_line',
      protocol: 'mqtt', connectionConfig: { brokerUrl: 'mqtt://192.168.1.50:1883', clientId: 'paint-01' },
      // [GECICI] Darbogaz giderimi: cycleTimeSec 900 → 90, warmupTimeSec 1200 → 60
      pollingIntervalMs: 2000, cycleTimeSec: 90, cycleTimeVariance: 10, failureProbability: 0.0008,
      scrapRate: 0.01, warmupTimeSec: 60, runningPowerKw: 45, idlePowerKw: 8,
      tags: [
        { tagId: 'PAINT01.status', name: 'machine_status', address: 'paint/status', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'PAINT01.boothtemp', name: 'booth_temperature', address: 'paint/booth_temp', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 0.5, minValue: 15, maxValue: 40, nominalValue: 23, noisePercent: 2, idleValue: 20 },
        { tagId: 'PAINT01.humidity', name: 'humidity', address: 'paint/humidity', dataType: 'float32', category: 'process_param', engineeringUnit: '%', deadband: 1, minValue: 20, maxValue: 80, nominalValue: 50, noisePercent: 5, idleValue: 45, alarmThreshold: 70 },
        { tagId: 'PAINT01.oventemp', name: 'cure_oven_temp', address: 'paint/oven_temp', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 2, minValue: 15, maxValue: 250, nominalValue: 190, noisePercent: 1, idleValue: 25, alarmThreshold: 220 },
        { tagId: 'PAINT01.parts', name: 'part_counter', address: 'paint/parts', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'PAINT01.energy', name: 'energy_kwh', address: 'paint/energy', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },

    // ─── PAKETLEME ──────────────────────────────────────────
    {
      machineId: 'PACK-01', name: 'Otomatik Paketleme', type: 'packaging',
      protocol: 'rest', connectionConfig: { baseUrl: 'http://192.168.1.60:8080', readEndpoint: '/api/data' },
      pollingIntervalMs: 2000, cycleTimeSec: 45, cycleTimeVariance: 10, failureProbability: 0.0005,
      scrapRate: 0.005, warmupTimeSec: 60, runningPowerKw: 5, idlePowerKw: 1,
      tags: [
        { tagId: 'PACK01.status', name: 'machine_status', address: 'status', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'PACK01.speed', name: 'packing_speed', address: 'speed', dataType: 'float32', category: 'process_param', engineeringUnit: 'adet/dk', deadband: 0.5, minValue: 0, maxValue: 30, nominalValue: 12, noisePercent: 8, idleValue: 0 },
        { tagId: 'PACK01.parts', name: 'part_counter', address: 'parts', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'PACK01.energy', name: 'energy_kwh', address: 'energy', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },

    // ─── SERIT TESTERE ──────────────────────────────────────
    {
      machineId: 'SAW-01', name: 'Serit Testere (Beka-Mak)', type: 'band_saw',
      protocol: 'modbus-rtu', connectionConfig: { serialPort: '/dev/ttyUSB0', baudRate: 9600, slaveId: 1 },
      pollingIntervalMs: 1000, cycleTimeSec: 60, cycleTimeVariance: 20, failureProbability: 0.002,
      scrapRate: 0.01, warmupTimeSec: 30, runningPowerKw: 8, idlePowerKw: 1.5,
      tags: [
        { tagId: 'SAW01.status', name: 'machine_status', address: '10001', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'SAW01.bladespeed', name: 'blade_speed', address: '40001', dataType: 'float32', category: 'process_param', engineeringUnit: 'm/dk', deadband: 1, minValue: 0, maxValue: 120, nominalValue: 75, noisePercent: 3, idleValue: 0 },
        { tagId: 'SAW01.temp', name: 'temperature', address: '40003', dataType: 'float32', category: 'process_param', engineeringUnit: '°C', deadband: 0.5, minValue: 15, maxValue: 80, nominalValue: 35, noisePercent: 5, idleValue: 25, alarmThreshold: 65 },
        { tagId: 'SAW01.bladewear', name: 'blade_wear', address: '40005', dataType: 'float32', category: 'process_param', engineeringUnit: '%', deadband: 1, minValue: 0, maxValue: 100, nominalValue: 30, noisePercent: 0, idleValue: 30 },
        { tagId: 'SAW01.parts', name: 'part_counter', address: '40007', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'SAW01.energy', name: 'energy_kwh', address: '40009', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },

    // ─── MATKAP ─────────────────────────────────────────────
    {
      machineId: 'DRILL-01', name: 'Coklu Matkap (Sugino)', type: 'drilling',
      protocol: 'mt-connect', connectionConfig: { agentUrl: 'http://192.168.1.70:5000' },
      pollingIntervalMs: 1000, cycleTimeSec: 90, cycleTimeVariance: 10, failureProbability: 0.001,
      scrapRate: 0.008, warmupTimeSec: 60, runningPowerKw: 10, idlePowerKw: 2,
      tags: [
        { tagId: 'DRILL01.status', name: 'machine_status', address: 'execution', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'DRILL01.spindle', name: 'spindle_speed', address: 'Sspeed', dataType: 'float32', category: 'process_param', engineeringUnit: 'rpm', deadband: 10, minValue: 0, maxValue: 8000, nominalValue: 3500, noisePercent: 2, idleValue: 0 },
        { tagId: 'DRILL01.feedrate', name: 'feed_rate', address: 'Frt', dataType: 'float32', category: 'process_param', engineeringUnit: 'mm/dk', deadband: 1, minValue: 0, maxValue: 2000, nominalValue: 450, noisePercent: 5, idleValue: 0 },
        { tagId: 'DRILL01.parts', name: 'part_counter', address: 'pcount', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'DRILL01.energy', name: 'energy_kwh', address: 'energy', dataType: 'float32', category: 'energy', engineeringUnit: 'kWh', deadband: 0.01, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },

    // ─── KALITE KONTROL ─────────────────────────────────────
    {
      machineId: 'INSP-01', name: 'Kalite Kontrol (Mitutoyo CMM)', type: 'inspection',
      protocol: 'rest', connectionConfig: { baseUrl: 'http://192.168.1.80:9090', readEndpoint: '/api/status' },
      // [GECICI] Darbogaz giderimi: cycleTimeSec 150 → 30 (5x hizli)
      pollingIntervalMs: 5000, cycleTimeSec: 30, cycleTimeVariance: 15, failureProbability: 0.0003,
      scrapRate: 0, warmupTimeSec: 30, runningPowerKw: 3, idlePowerKw: 1,
      tags: [
        { tagId: 'INSP01.status', name: 'machine_status', address: 'status', dataType: 'boolean', category: 'status', engineeringUnit: '', deadband: 0, nominalValue: 1, noisePercent: 0, idleValue: 0 },
        { tagId: 'INSP01.inspected', name: 'inspection_count', address: 'inspected', dataType: 'int32', category: 'counter', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'INSP01.passed', name: 'pass_count', address: 'passed', dataType: 'int32', category: 'quality', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
        { tagId: 'INSP01.failed', name: 'fail_count', address: 'failed', dataType: 'int32', category: 'quality', engineeringUnit: 'adet', deadband: 0, nominalValue: 0, noisePercent: 0, idleValue: 0 },
      ],
    },
  ],
};
