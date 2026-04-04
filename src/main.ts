/**
 * Fabriq MES - Fabrika Makine Simulatoru
 *
 * Gercek bir fabrika gunu simule eder:
 * - Vardiya sistemi (sabah/ogle/gece, mola, handover)
 * - Is emri yonetimi (makineye atama, ilerleme, tamamlama)
 * - Malzeme tuketimi (BOM'dan hammadde + sarf dusme)
 * - Enerji tuketimi (5dk araliklarla snapshot)
 * - Ariza/alarm/kalite senaryolari
 *
 * Kullanim:
 *   npm run simulate                    # Guncel saatten basla
 *   npm run simulate -- --speed 10      # 10x hiz
 *   npm run simulate -- --start 06:00   # Sabah 06:00'dan basla
 *   npm run seed-only                   # Sadece seed veri
 */

import { ClockService } from './core/clock.service';
import { EventBus, SimEvents } from './core/event-bus';
import { FACTORY_CONFIG } from './config/factory.config';
import { MachineSimulator } from './machines/machine.simulator';
import { MasterDataSeeder } from './upstream/master-data.seeder';
import { ShiftSimulator } from './production/shift.simulator';
import { JobOrderSimulator } from './production/job-order.simulator';
import { EnergySimulator } from './energy/energy.simulator';
import { KafkaPublisher } from './upstream/kafka.publisher';
import { ApiSeeder } from './upstream/api.seeder';
import { ApiClient } from './upstream/api.client';
import { MaintenanceSimulator } from './production/maintenance.simulator';
import { SpcSimulator } from './production/spc.simulator';
import { ProductionPlanner } from './production/production-planner';

// ─── Konfigurasyon ───────────────────��──────────────────────────

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');

// CLI argumanlari
const args = process.argv.slice(2);
const seedOnly = args.includes('--seed-only');
const resetMode = args.includes('--reset');
const speedIdx = args.indexOf('--speed');
const simSpeed = speedIdx >= 0 ? parseFloat(args[speedIdx + 1] || '1') : parseFloat(process.env.SIMULATION_SPEED || '1');
const startIdx = args.indexOf('--start');
const startTimeStr = startIdx >= 0 ? args[startIdx + 1] : null;
const planIdx = args.indexOf('--plan');
const planMode = planIdx >= 0 ? args[planIdx + 1] : null;

// ─── Ana Fonksiyon ──────────���───────────────────────────────────

async function main() {
  console.log('');
  console.log('╔════════════════��═══════════════��══════════════════════════════╗');
  console.log('║         Fabriq MES - Fabrika Gunu Simulatoru                  ║');
  console.log('║         Fabriq Metal Sanayi A.S. - Bursa OSB                  ║');
  console.log('╠═══════════════��═══════════════════════════════════════════════╣');
  console.log(`║  API:     ${API_BASE_URL.padEnd(50)}║`);
  console.log(`║  Kafka:   ${KAFKA_BROKERS.join(', ').padEnd(50)}║`);
  console.log(`║  Hiz:     ${(simSpeed + 'x').padEnd(50)}║`);
  console.log(`║  Makine:  ${(FACTORY_CONFIG.machines.length + ' adet').padEnd(50)}║`);
  console.log(`║  Vardiya: 3 vardiya (Sabah/Ogle/Gece)                         ║`);
  console.log('╚═══════════════════════════════���═══════════════════════════════╝');
  console.log('');

  // 0. Reset (--reset flag'i varsa)
  if (resetMode) {
    console.log('🔄 SISTEM RESET yapiliyor...\n');
    try {
      const axios = require('axios');
      // Login
      const loginRes = await axios.post(`${API_BASE_URL}/auth/login`, { email: 'admin@fabriq.io', password: 'admin123' });
      const token = loginRes.data.token;
      // Reset
      const resetRes = await axios.post(`${API_BASE_URL}/system/reset`, {}, { headers: { Authorization: `Bearer ${token}` } });
      if (resetRes.data.success) {
        console.log('✅ Sistem sifirlandi!\n');
        const d = resetRes.data.details;
        console.log(`   Is Emirleri: ${d.jobOrders || 0} silindi`);
        console.log(`   Stok Hareket: ${d.stockMovements || 0} silindi`);
        console.log(`   SPC Olcum: ${d.spcMeasurements || 0} silindi`);
        console.log(`   Kalite: ${d.qualityInspections || 0} denetim silindi`);
        console.log(`   Lotlar: baslangica donduruldu`);
        console.log(`   Bakim: calisma saatleri sifirlandi`);
        console.log(`   Redis: temizlendi`);
        console.log('');
      }
    } catch (err: any) {
      console.error(`⚠️  Reset hatasi: ${err.message} - devam ediliyor...`);
    }
  }

  // 1. Seed
  const seeder = new ApiSeeder(API_BASE_URL);
  try {
    await seeder.seed();
  } catch (err: any) {
    console.error(`❌ Seed hatasi: ${err.message}`);
    process.exit(1);
  }

  // 1b. Master data seed (BOM, Operasyon, Lot, Routing)
  const masterSeeder = new MasterDataSeeder(API_BASE_URL);
  try {
    await masterSeeder.seed();
  } catch (err: any) {
    console.error(`⚠️ Master data seed hatasi: ${err.message}`);
    // Devam et - kritik degil
  }

  if (seedOnly) {
    console.log('🏁 --seed-only, simulasyon baslatilmadi.');
    process.exit(0);
  }

  // 2. Kafka
  const kafka = new KafkaPublisher(KAFKA_BROKERS);
  try {
    await kafka.connect();
  } catch (err: any) {
    console.error(`❌ Kafka hatasi: ${err.message}`);
    process.exit(1);
  }

  // 3. API Client (backend'den is emri okumak icin)
  const apiClient = new ApiClient(API_BASE_URL);
  await apiClient.authenticate();

  // 3b. Uretim planlayici (--plan 3months)
  if (planMode === '3months') {
    console.log('\n📋 3 Aylik Uretim Plani baslatiliyor...\n');
    const planner = new ProductionPlanner(apiClient);
    try {
      await planner.runFullPlan(new Date());
      console.log('\n📋 Uretim plani tamamlandi, simulasyon devam ediyor...\n');
    } catch (err: any) {
      console.error(`⚠️ Uretim plani hatasi: ${err.message}`);
      // Devam et - plan hatasi simulasyonu durdurmasin
    }
  }

  // 4. Sistemler olustur
  const eventBus = new EventBus();
  const clock = new ClockService(simSpeed);
  const shiftSim = new ShiftSimulator(eventBus);
  const jobSim = new JobOrderSimulator(apiClient);
  const energySim = new EnergySimulator();
  energySim.setApiClient(apiClient);
  const maintenanceSim = new MaintenanceSimulator(apiClient, eventBus);
  const spcSim = new SpcSimulator(apiClient);

  // Backend'den master veri yukle
  await jobSim.loadBoms();
  await maintenanceSim.loadProfiles();
  await spcSim.loadCharacteristics();

  // 5. Makine simulatorleri
  const machines: MachineSimulator[] = FACTORY_CONFIG.machines.map(
    (config) => new MachineSimulator(config, eventBus),
  );

  console.log(`\n🏭 ${machines.length} makine simulatoru olusturuldu`);

  // 5. Baslangic saatini ayarla
  if (startTimeStr) {
    const [h, m] = startTimeStr.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(h, m || 0, 0, 0);

    // Pazar ise Pazartesi'ye atla (fabrika Pazar kapali)
    if (startDate.getDay() === 0) {
      startDate.setDate(startDate.getDate() + 1);
      console.log(`⚠️  Bugun Pazar - Pazartesi'ye atlanıyor: ${startDate.toLocaleDateString('tr-TR')}`);
    }

    clock.setSimTime(startDate);
    console.log(`⏰ Baslangic: ${startDate.toLocaleDateString('tr-TR')} ${startDate.toLocaleTimeString('tr-TR')}`);
  }

  // 6. Istatistikler
  let totalTelemetryMessages = 0;
  let totalAlarms = 0;
  let lastLogTime = 0;
  let totalSimElapsedSec = 0; // Toplam simulasyon saniyesi

  // 7. Event dinleyicileri
  eventBus.on(SimEvents.PART_PRODUCED, async (data) => {
    const job = jobSim.getActiveJob(data.machineId);
    if (!job) return;

    // Simulator tarafinda sayac artir
    jobSim.partProduced(data.machineId);

    // Kafka'ya bildir → Backend ExecutionService malzeme dusecek
    try {
      await kafka.publishJobOrderStatus(
        job.jobOrderNo,
        job.quantityProduced >= job.quantityPlanned ? 'completed' : 'started',
        data.machineId,
        job.quantityProduced,
        job.quantityPlanned,
        job.quantityScrapped,
        job.materialCode,
        job.materialName,
        data.machineId,
      );
      // NOT: Malzeme tuketimi artik gonderilmiyor - backend BOM'dan kendisi dusecek
    } catch { /* sessiz */ }
  });

  eventBus.on(SimEvents.PART_SCRAPPED, async (data) => {
    jobSim.partScrapped(data.machineId);
  });

  eventBus.on(SimEvents.ALARM_TRIGGERED, async (data) => {
    totalAlarms++;
    try {
      await kafka.publishAlarm(
        FACTORY_CONFIG.edgeGatewayId,
        `DEV-${data.machineId}`,
        'critical',
        data.reason || 'Makine alarmi',
        data.tagId,
        data.value,
        data.threshold,
      );
    } catch { /* sessiz */ }
  });

  eventBus.on(SimEvents.SHIFT_CHANGED, (data) => {
    console.log(`\n🔄 VARDIYA DEGISIMI: ${data.previousShift} → ${data.newShift}\n`);
  });

  eventBus.on(SimEvents.SHIFT_BREAK_START, () => {
    console.log('  ☕ MOLA BASLADI - Makineler idle modda');
  });

  eventBus.on(SimEvents.SHIFT_BREAK_END, () => {
    console.log('  ⚡ MOLA BITTI - Uretim devam ediyor');
  });

  // 8. Ana simulasyon dongusu
  console.log(`\n🚀 Simulasyon baslatiliyor (${simSpeed}x hiz)...\n`);

  clock.onTick(async (simTime, deltaSec) => {
    totalSimElapsedSec += deltaSec;

    // A. Vardiya kontrolu
    await shiftSim.tick(simTime);
    const phase = shiftSim.getCurrentPhase();
    const shift = shiftSim.getCurrentShift();

    // B. Her makine icin
    for (const machine of machines) {
      const machineId = machine.getMachineId();
      const shouldRun = shiftSim.shouldMachineRun(machineId, simTime);
      const currentState = machine.getState();

      // Makine acma/kapama kontrolu
      if (shouldRun && currentState === 'off') {
        machine.turnOn(simTime);
        machine.startProduction(simTime);
      } else if (shouldRun && currentState === 'idle') {
        // Bakim kontrolu - bakim gerekiyorsa maintenance moduna al
        const maintCheck = maintenanceSim.tick(machineId, false, deltaSec, totalSimElapsedSec);
        if (maintCheck.needsMaintenance) {
          machine.startMaintenance(simTime);
          console.log(`  🔧 ${machineId} BAKIM GEREKLI (${maintCheck.maintenanceType})`);
        } else {
          machine.startProduction(simTime);
        }
      } else if (shouldRun && currentState === 'maintenance') {
        // Bakim suresi doldu mu? (state machine otomatik idle'a dondurecek)
        // idle'a donunce bir sonraki tick'te maintenanceCompleted cagirilacak
      } else if (!shouldRun && (currentState === 'running' || currentState === 'warmup')) {
        machine.stopProduction(simTime);
      }

      // Bakim tamamlandi kontrolu (maintenance → idle gecisi olduysa)
      if (currentState === 'maintenance' && machine.getState() === 'idle') {
        await maintenanceSim.maintenanceCompleted(machineId);
      }

      // Calisma saati takibi (running ise)
      maintenanceSim.tick(machineId, machine.getState() === 'running', deltaSec, totalSimElapsedSec);

      // Is emri atama - backend'den iste (BOM bazli planlama)
      if (shouldRun && machine.getState() !== 'maintenance' && !jobSim.getActiveJob(machineId)) {
        await jobSim.ensureJobForMachine(machineId);
      }

      // Periyodik senkronizasyon (backend'den is emri durumlarini guncelle)
      await jobSim.syncJobOrders(totalSimElapsedSec);

      // Makine tick
      const result = await machine.tick(simTime, deltaSec);

      // Telemetri gonder
      const activeJob = jobSim.getActiveJob(machineId);
      try {
        await kafka.publishTelemetry(
          FACTORY_CONFIG.edgeGatewayId,
          `DEV-${machineId}`,
          result.tags,
          activeJob?.jobOrderNo,
        );
        totalTelemetryMessages++;
      } catch { /* sessiz */ }

      // Durum degisikligi
      if (result.stateChanged) {
        try {
          await kafka.publishMachineStatus(
            FACTORY_CONFIG.edgeGatewayId,
            `DEV-${machineId}`,
            machineId,
            result.previousState,
            result.state,
          );
        } catch { /* sessiz */ }
      }
    }

    // C. Enerji snapshot (5 dk'da bir) → backend'e gonder
    const energySnap = await energySim.tick(machines, simTime, deltaSec);
    if (energySnap) {
      const kwh = energySim.getTotalKwhToday();
      console.log(`  ⚡ Enerji: ${energySnap.totalElectricityKw.toFixed(0)} kW | ${kwh.toFixed(1)} kWh (${energySim.getTotalSentToBackend()} backend kayit) | Bakim: ${maintenanceSim.getTotalMaintenanceCount()} | SPC: ${spcSim.getTotalMeasurements()} olcum`);
    }

    // C2. SPC olcum uretimi (saatlik)
    const machineStates = new Map<string, string>();
    for (const m of machines) machineStates.set(m.getMachineId(), m.getState());
    await spcSim.tick(totalSimElapsedSec, machineStates);

    // D. Periyodik log (her 30 saniyede)
    lastLogTime += deltaSec;
    if (lastLogTime >= 30) {
      lastLogTime = 0;
      const timeStr = simTime.toLocaleTimeString('tr-TR');
      const dateStr = simTime.toLocaleDateString('tr-TR');
      const running = machines.filter((m) => m.getState() === 'running').length;
      const warmup = machines.filter((m) => m.getState() === 'warmup').length;
      const idle = machines.filter((m) => m.getState() === 'idle').length;
      const alarm = machines.filter((m) => m.getState() === 'alarm').length;
      const off = machines.filter((m) => m.getState() === 'off').length;

      const shiftName = shift?.name || 'Kapali';
      const phaseLabel: Record<string, string> = {
        off: 'Kapali', startup: 'Acilis', production: 'Uretim',
        break: 'Mola', post_break: 'Mola Sonrasi', handover: 'Devir Teslim',
        pre_shift: 'Hazirlik',
      };

      console.log(
        `  [${dateStr} ${timeStr}] ${shiftName} (${phaseLabel[phase] || phase}) | ` +
        `Calisan:${running} Isinma:${warmup} Bosta:${idle} Alarm:${alarm} Kapali:${off} | ` +
        `Uretim:${jobSim.getTotalProduced()} Hurda:${jobSim.getTotalScrapped()} | ` +
        `Msg:${totalTelemetryMessages} Alarm:${totalAlarms}`,
      );

      // Is emri detaylari (her 2 dakikada bir)
      if (clock.getTickCount() % 4 === 0) {
        const activeJobs = jobSim.getAllActiveJobs();
        if (activeJobs.length > 0) {
          console.log('  ┌─ Aktif Is Emirleri (Backend-Driven):');
          for (const job of activeJobs) {
            const pct = job.quantityPlanned > 0 ? Math.round((job.quantityProduced / job.quantityPlanned) * 100) : 0;
            const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
            const bomTag = job.bomId ? '📋' : '⚠️';
            console.log(
              `  │  ${bomTag} ${job.machineId.padEnd(10)} ${job.jobOrderNo.padEnd(15)} ${job.materialName.padEnd(20)} ` +
              `${bar} ${String(pct).padStart(3)}% (${job.quantityProduced}/${job.quantityPlanned})`,
            );
          }
          console.log(`  └─ Tamamlanan: ${jobSim.getCompletedCount()} is emri`);
        }
      }
    }
  });

  // 9. Baslat
  clock.start(1000);

  // 10. Graceful shutdown
  const shutdown = async () => {
    console.log('\n\n���� Simulasyon durduruluyor...\n');
    clock.stop();
    await kafka.disconnect();

    console.log('📊 SIMULASYON OZETI');
    console.log('═'.repeat(50));
    console.log(`  Toplam tick: ${clock.getTickCount()}`);
    console.log(`  Toplam telemetri mesaji: ${totalTelemetryMessages}`);
    console.log(`  Toplam alarm: ${totalAlarms}`);
    console.log(`  Enerji tuketimi: ${energySim.getTotalKwhToday().toFixed(1)} kWh`);
    console.log('');
    console.log(jobSim.getShiftSummary());
    console.log('');

    for (const machine of machines) {
      const job = jobSim.getActiveJob(machine.getMachineId());
      console.log(
        `  ${machine.getMachineId().padEnd(10)} ${machine.getState().padEnd(12)} ` +
        `${machine.getTotalProduced()} uretildi, ${machine.getTotalScrapped()} hurda` +
        (job ? ` [${job.jobOrderNo}: ${job.quantityProduced}/${job.quantityPlanned}]` : ''),
      );
    }

    console.log('');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('❌ Simulasyon hatasi:', err);
  process.exit(1);
});
