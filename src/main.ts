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

// ─── Konfigurasyon ───────────────────��──────────────────────────

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');

// CLI argumanlari
const args = process.argv.slice(2);
const seedOnly = args.includes('--seed-only');
const speedIdx = args.indexOf('--speed');
const simSpeed = speedIdx >= 0 ? parseFloat(args[speedIdx + 1] || '1') : parseFloat(process.env.SIMULATION_SPEED || '1');
const startIdx = args.indexOf('--start');
const startTimeStr = startIdx >= 0 ? args[startIdx + 1] : null;

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

  // 4. Sistemler olustur
  const eventBus = new EventBus();
  const clock = new ClockService(simSpeed);
  const shiftSim = new ShiftSimulator(eventBus);
  const jobSim = new JobOrderSimulator(apiClient);
  const energySim = new EnergySimulator();

  // BOM'lari yukle (backend'den)
  await jobSim.loadBoms();

  // 4. Makine simulatorleri
  const machines: MachineSimulator[] = FACTORY_CONFIG.machines.map(
    (config) => new MachineSimulator(config, eventBus),
  );

  console.log(`\n🏭 ${machines.length} makine simulatoru olusturuldu`);

  // 5. Baslangic saatini ayarla
  if (startTimeStr) {
    const [h, m] = startTimeStr.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(h, m || 0, 0, 0);
    clock.setSimTime(startDate);
    console.log(`⏰ Baslangic saati: ${startDate.toLocaleTimeString('tr-TR')}`);
  }

  // 6. Istatistikler
  let totalTelemetryMessages = 0;
  let totalAlarms = 0;
  let lastLogTime = 0;

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
        machine.startProduction(simTime);
      } else if (!shouldRun && (currentState === 'running' || currentState === 'warmup')) {
        machine.stopProduction(simTime);
      }

      // Is emri atama - backend'den iste (BOM bazli planlama)
      if (shouldRun && !jobSim.getActiveJob(machineId)) {
        await jobSim.ensureJobForMachine(machineId);
      }

      // Periyodik senkronizasyon (backend'den is emri durumlarini guncelle)
      await jobSim.syncJobOrders(clock.getTickCount());

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

    // C. Enerji snapshot (5 dk'da bir)
    const energySnap = energySim.tick(machines, simTime, deltaSec);
    if (energySnap) {
      const kwh = energySim.getTotalKwhToday();
      console.log(`  ⚡ Enerji snapshot: ${energySnap.totalElectricityKw.toFixed(0)} kW anlik, ${kwh.toFixed(1)} kWh toplam`);
    }

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
