/**
 * API Seeder
 *
 * Backend API'ye baslangic verisini olusturur:
 * - Edge Gateway
 * - Device + Tag tanimlari
 * - Malzemeler
 * - Makineler (zaten cihaz olarak ekleniyor)
 *
 * Backend'te zaten kayit varsa atlar (idempotent).
 */

import axios, { AxiosInstance } from 'axios';
import { FACTORY_CONFIG } from '../config/factory.config';
import { MATERIALS, CONSUMABLES } from '../config/materials.config';

export class ApiSeeder {
  private api: AxiosInstance;
  private token: string = '';

  constructor(baseUrl: string) {
    this.api = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async seed() {
    console.log('\n📦 Seed verisi olusturuluyor...\n');

    // 1. Login
    await this.login();

    // 2. Edge Gateway
    await this.seedEdgeGateway();

    // 3. Makineler (Machine)
    await this.seedMachines();

    // 4. Cihazlar (Device) + Tag tanimlari
    await this.seedDevicesAndTags();

    // 5. Malzemeler
    await this.seedMaterials();

    console.log('\n✅ Seed tamamlandi!\n');
  }

  private async login() {
    try {
      const res = await this.api.post('/auth/login', {
        email: 'admin@fabriq.io',
        password: 'admin123',
      });
      this.token = res.data.token;
      this.api.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
      console.log('  ✅ Login basarili');
    } catch (err: any) {
      throw new Error(`Login hatasi: ${err.message}. Backend calismiyor olabilir.`);
    }
  }

  private async seedEdgeGateway() {
    try {
      await this.api.post('/edge-gateways', {
        edgeId: FACTORY_CONFIG.edgeGatewayId,
        name: FACTORY_CONFIG.edgeGatewayName,
        factorySite: FACTORY_CONFIG.factorySite,
        ipAddress: '192.168.1.100',
        version: '2.1.0',
        status: 'online',
      });
      console.log(`  ✅ Edge Gateway: ${FACTORY_CONFIG.edgeGatewayId}`);
    } catch (err: any) {
      if (err.response?.status === 409) {
        console.log(`  ⏭️  Edge Gateway zaten var: ${FACTORY_CONFIG.edgeGatewayId}`);
      } else {
        console.log(`  ⚠️  Edge Gateway hatasi: ${err.response?.data?.message || err.message}`);
      }
    }
  }

  private async seedMachines() {
    for (const machine of FACTORY_CONFIG.machines) {
      try {
        await this.api.post('/machines', {
          machineId: machine.machineId,
          name: machine.name,
          status: 'idle',
          operationType: machine.type,
          powerRatingKw: machine.runningPowerKw,
        });
        console.log(`  ✅ Makine: ${machine.machineId} - ${machine.name}`);
      } catch (err: any) {
        if (err.response?.status === 409) {
          console.log(`  ⏭️  Makine zaten var: ${machine.machineId}`);
        } else {
          console.log(`  ⚠️  Makine hatasi [${machine.machineId}]: ${err.response?.data?.message || err.message}`);
        }
      }
    }
  }

  private async seedDevicesAndTags() {
    // Once gateway ID'yi bul
    let gatewayDbId: string | null = null;
    try {
      const res = await this.api.get('/edge-gateways');
      const gateways = res.data?.data || res.data || [];
      const gw = gateways.find?.((g: any) => g.edgeId === FACTORY_CONFIG.edgeGatewayId);
      gatewayDbId = gw?.id;
    } catch {
      console.log('  ⚠️  Gateway ID alinamadi');
    }

    if (!gatewayDbId) {
      console.log('  ⚠️  Gateway bulunamadi, cihazlar olusturulamadi');
      return;
    }

    for (const machine of FACTORY_CONFIG.machines) {
      // Device olustur
      try {
        const deviceRes = await this.api.post('/devices', {
          deviceId: `DEV-${machine.machineId}`,
          name: `${machine.name} PLC`,
          protocol: machine.protocol,
          connectionConfig: machine.connectionConfig,
          pollingIntervalMs: machine.pollingIntervalMs,
          enabled: true,
          edgeGatewayId: gatewayDbId,
        });

        const deviceDbId = deviceRes.data?.id;
        console.log(`  ✅ Cihaz: DEV-${machine.machineId}`);

        // Tag tanimlari olustur
        if (deviceDbId) {
          for (const tag of machine.tags) {
            try {
              await this.api.post('/tag-definitions', {
                tagId: tag.tagId,
                name: tag.name,
                address: tag.address,
                dataType: tag.dataType,
                category: tag.category,
                engineeringUnit: tag.engineeringUnit,
                scaleFactor: 1,
                offset: 0,
                deadband: tag.deadband,
                minValue: tag.minValue,
                maxValue: tag.maxValue,
                isActive: true,
                deviceId: deviceDbId,
              });
            } catch {
              // Tag zaten var, sorun degil
            }
          }
          console.log(`     ✅ ${machine.tags.length} tag tanimı`);
        }
      } catch (err: any) {
        if (err.response?.status === 409) {
          console.log(`  ⏭️  Cihaz zaten var: DEV-${machine.machineId}`);
        } else {
          console.log(`  ⚠️  Cihaz hatasi [${machine.machineId}]: ${err.response?.data?.message || err.message}`);
        }
      }
    }
  }

  private async seedMaterials() {
    const allMaterials = [
      ...MATERIALS.map((m) => ({
        materialCode: m.code,
        materialName: m.name,
        unitId: m.unit,
        materialType: m.type,
        isActive: true,
        isConsumable: m.isConsumable,
      })),
      ...CONSUMABLES.map((c) => ({
        materialCode: c.code,
        materialName: c.name,
        unitId: c.unit,
        materialType: 'CONSUMABLE',
        isActive: true,
        isConsumable: true,
      })),
    ];

    let created = 0;
    let existing = 0;

    for (const mat of allMaterials) {
      try {
        await this.api.post('/materials', mat);
        created++;
      } catch (err: any) {
        if (err.response?.status === 409) {
          existing++;
        }
      }
    }

    console.log(`  ✅ Malzemeler: ${created} yeni, ${existing} mevcut (toplam ${allMaterials.length})`);
  }
}
