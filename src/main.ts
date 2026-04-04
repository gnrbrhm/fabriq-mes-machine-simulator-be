/**
 * Fabriq MES - Fabrika Makine Simulatoru
 *
 * Backend'te tanimli cihazlari alir, gercekci telemetri verisi uretir
 * ve Kafka uzerinden backend'e gonderir.
 *
 * Kullanim:
 *   npm run simulate              # Normal calistirma
 *   npm run simulate -- --speed 5 # 5x hiz
 *   npm run seed-only             # Sadece seed veri olustur
 */

import { ClockService } from './core/clock.service';
import { EventBus, SimEvents } from './core/event-bus';
import { FACTORY_CONFIG } from './config/factory.config';
import { MachineSimulator, MachineTickResult } from './machines/machine.simulator';
import { KafkaPublisher } from './upstream/kafka.publisher';
import { ApiSeeder } from './upstream/api.seeder';

// ─── Konfigürasyon ──────────────────────────────────────────────

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
const SPEED = parseFloat(process.env.SIMULATION_SPEED || '1');

// CLI argumanlari
const args = process.argv.slice(2);
const seedOnly = args.includes('--seed-only');
const speedArg = args.find((a) => a.startsWith('--speed'));
const simSpeed = speedArg ? parseFloat(args[args.indexOf(speedArg) + 1] || '1') : SPEED;

// ─── Ana Fonksiyon ──────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     Fabriq MES - Fabrika Makine Simulatoru        ║');
  console.log('║     Fabriq Metal Sanayi A.S. - Bursa OSB          ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  API: ${API_BASE_URL}`);
  console.log(`  Kafka: ${KAFKA_BROKERS.join(', ')}`);
  console.log(`  Hiz: ${simSpeed}x`);
  console.log(`  Makine: ${FACTORY_CONFIG.machines.length} adet`);
  console.log('');

  // 1. Seed verisi olustur
  const seeder = new ApiSeeder(API_BASE_URL);
  try {
    await seeder.seed();
  } catch (err: any) {
    console.error(`❌ Seed hatasi: ${err.message}`);
    console.error('   Backend calismiyor olabilir. Once "node dist/apps/fabriq-mes/main.js" calistirin.');
    process.exit(1);
  }

  if (seedOnly) {
    console.log('🏁 --seed-only modu, simulasyon baslatilmadi.');
    process.exit(0);
  }

  // 2. Kafka baglantisi
  const kafka = new KafkaPublisher(KAFKA_BROKERS);
  try {
    await kafka.connect();
  } catch (err: any) {
    console.error(`❌ Kafka baglanti hatasi: ${err.message}`);
    process.exit(1);
  }

  // 3. Event bus ve saat olustur
  const eventBus = new EventBus();
  const clock = new ClockService(simSpeed);

  // 4. Makine simulatorleri olustur
  const machines: MachineSimulator[] = FACTORY_CONFIG.machines.map(
    (config) => new MachineSimulator(config, eventBus),
  );

  console.log(`\n🏭 ${machines.length} makine simulatoru olusturuldu\n`);

  // 5. Event dinleyicileri
  let totalTelemetryMessages = 0;
  let totalPartsProduced = 0;
  let totalAlarms = 0;

  eventBus.on(SimEvents.PART_PRODUCED, (data) => {
    totalPartsProduced++;
  });

  eventBus.on(SimEvents.ALARM_TRIGGERED, async (data) => {
    totalAlarms++;
    await kafka.publishAlarm(
      FACTORY_CONFIG.edgeGatewayId,
      `DEV-${data.machineId}`,
      'critical',
      data.reason || 'Makine alarmi',
      data.tagId,
      data.value,
      data.threshold,
    );
  });

  // 6. Makineleri sirasyla ac
  console.log('⚡ Makineler aciliyor...');
  const startTime = new Date();

  for (let i = 0; i < machines.length; i++) {
    const machine = machines[i];
    machine.turnOn(startTime);
    machine.startProduction(startTime);
    console.log(`  🟢 ${machine.getMachineId()} acildi`);

    // Gercek zamanda 500ms bekle (hizlandirilmis modda daha kisa)
    await sleep(Math.max(100, 500 / simSpeed));
  }

  console.log(`\n🚀 Simulasyon baslatiliyor (${simSpeed}x hiz)...\n`);

  // 7. Her tick'te tum makineleri islet
  clock.onTick(async (simTime, deltaSec) => {
    const results: MachineTickResult[] = [];

    for (const machine of machines) {
      const result = await machine.tick(simTime, deltaSec);
      results.push(result);

      // Telemetri gonder
      try {
        await kafka.publishTelemetry(
          FACTORY_CONFIG.edgeGatewayId,
          `DEV-${result.machineId}`,
          result.tags,
        );
        totalTelemetryMessages++;
      } catch {
        // Kafka hatasi - sessiz devam
      }

      // Durum degisikligi bildirimi
      if (result.stateChanged) {
        try {
          await kafka.publishMachineStatus(
            FACTORY_CONFIG.edgeGatewayId,
            `DEV-${result.machineId}`,
            result.machineId,
            result.previousState,
            result.state,
          );
        } catch {
          // Sessiz
        }
      }
    }

    // Her 30 saniyede ozet logla
    if (clock.getTickCount() % 30 === 0) {
      const running = machines.filter((m) => m.getState() === 'running').length;
      const idle = machines.filter((m) => m.getState() === 'idle' || m.getState() === 'warmup').length;
      const alarm = machines.filter((m) => m.getState() === 'alarm').length;

      const simTimeStr = simTime.toLocaleTimeString('tr-TR');
      console.log(
        `  [${simTimeStr}] Calisan: ${running} | Bosta: ${idle} | Alarm: ${alarm} | ` +
        `Uretim: ${totalPartsProduced} adet | Mesaj: ${totalTelemetryMessages} | Alarm: ${totalAlarms}`,
      );
    }
  });

  // 8. Saati baslat
  clock.start(1000);

  // 9. Graceful shutdown
  const shutdown = async () => {
    console.log('\n\n🛑 Simulasyon durduruluyor...');
    clock.stop();
    await kafka.disconnect();

    console.log('\n📊 Simulasyon Ozeti:');
    console.log(`   Toplam tick: ${clock.getTickCount()}`);
    console.log(`   Toplam telemetri mesaji: ${totalTelemetryMessages}`);
    console.log(`   Toplam uretim: ${totalPartsProduced} adet`);
    console.log(`   Toplam alarm: ${totalAlarms}`);
    console.log('');

    for (const machine of machines) {
      console.log(`   ${machine.getMachineId()}: ${machine.getTotalProduced()} uretildi, ${machine.getTotalScrapped()} hurda (${machine.getState()})`);
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

// ─── Baslat ─────────────────────────────────────────────────────

main().catch((err) => {
  console.error('❌ Simulasyon hatasi:', err);
  process.exit(1);
});
