# Fabriq MES — Machine Simulator

> TypeScript + KafkaJS + Axios
> 12 makine, 3 vardiya, 30 edge case, 3 aylik uretim plani
> 19 dosya, ~5.300 satir

## Nedir?

Bursa OSB'deki Fabriq Metal Sanayi fabrikasinin dijital ikizi. 12 makinenin gercekci telemetri, uretim, bakim, kalite ve enerji verilerini simule eder. Backend API uzerinden is emirleri alir, Kafka uzerinden telemetri ve durum event'leri yayinlar. IoT entegrasyonu geldiginde simülatör devre disi kalir, ayni Kafka topic'lere gercek PLC verisi akar.

## Hizli Baslatma

```bash
npm install

# Tam reset + 3 aylik plan + 60x hiz
npx tsx src/main.ts --reset --plan 3months --start 06:00 --speed 60

# Mevcut veriyle devam (reset yok)
npx tsx src/main.ts --start 06:00 --speed 60

# Yavas mod (gozlem icin)
npx tsx src/main.ts --start 06:00 --speed 5

# Sadece seed (data hazirla, calistirma)
npx tsx src/main.ts --reset --seed-only
```

**Onkosul:** Backend (`http://localhost:3000`) ve Kafka (`localhost:9094`) calisiyor olmali.

## CLI Parametreleri

| Parametre | Aciklama | Ornek |
|-----------|----------|-------|
| `--reset` | Tum uretim verilerini sifirla (master data korunur) | |
| `--plan 3months` | 3 aylik is emri plani olustur (12 hafta, 30 edge case) | |
| `--start HH:MM` | Simulasyon baslangic saati | `--start 06:00` |
| `--speed N` | Hiz carpani (1sn gercek = N sn simulasyon) | `--speed 60` |
| `--seed-only` | Sadece seed, simulasyon baslatma | |

## Proje Yapisi

```
src/
├── main.ts                    → Orkestrator (462 satir)
│                                 CLI parse → reset → seed → plan → sim loop
│
├── config/
│   ├── factory.config.ts      → 12 makine + 3 vardiya + tag tanimlari
│   └── materials.config.ts    → 7 hammadde + 14 sarf + 6 BOM (urun)
│
├── core/
│   ├── clock.service.ts       → Simulasyon zamani (speed carpani)
│   ├── event-bus.ts           → Dahili pub/sub (11 event)
│   └── random.utils.ts       → Gaussian, Poisson, uniform dagilimlar
│
├── machines/
│   ├── machine.simulator.ts   → Makine yasam dongusu (state + cevrim + alarm)
│   └── machine-state.ts       → State machine (off→idle→warmup→running→alarm)
│
├── production/
│   ├── job-order.simulator.ts → Child-aware is emri yurutme + WIP buffer
│   ├── maintenance.simulator.ts → Calisma saati + WorkOrder olusturma/kapatma
│   ├── shift.simulator.ts     → 3 vardiya + mola + devir teslim
│   ├── production-planner.ts  → 12 haftalik plan + 30 edge case (1054 satir)
│   └── spc.simulator.ts      → Kalite olcum uretimi (Cpk ~1.25)
│
├── telemetry/
│   └── tag.generator.ts       → Gercekci tag degerleri (termal model, sinuzoidal drift, noise)
│
├── energy/
│   └── energy.simulator.ts    → 5 dk arayla enerji tuketim kaydı
│
└── upstream/
    ├── api.client.ts          → 60+ backend API metodu (687 satir)
    ├── api.seeder.ts          → Edge gateway + cihaz + sensor seed
    ├── kafka.publisher.ts     → 3 Kafka topic (telemetri, status, alarm)
    └── master-data.seeder.ts  → BOM, malzeme, lot, routing seed
```

## Simulasyon Dongusu (main.ts)

Her tick (1sn gercek × speed carpani):

```
1. Vardiya kontrolu (shift phase: startup/production/break/handover)
2. Her makine icin:
   ├── Durum gecisi (off→idle→warmup→running / running→alarm)
   ├── Bakim kontrolu (calisma saati esik → maintenance mode + WorkOrder)
   ├── Is emri atama (ensureJobForMachine → akilli secim)
   ├── Machine.tick() → cevrim, parca uretimi, hurda, alarm
   ├── Telemetri Kafka publish (tag degerleri)
   └── Durum degisikligi Kafka publish (state change + activeJobOrderNo)
3. Enerji snapshot (5 dk arayla → backend API)
4. SPC olcum (saatlik → backend API)
5. Job sync (30sn arayla → backend API: assignments + parentProgress)
6. Log ozeti (30sn arayla: Calisan/Isinma/Bosta/Alarm/Kapali + uretim)
```

## 12 Makine

| Makine | Tip | Cevrim (sn) | Guc (kW) | Protokol | Ozel Tag |
|--------|-----|------------|----------|----------|----------|
| CNC-01 | CNC Torna | 270 | 15 | S7 | spindle, sicaklik, titresim, sogutma |
| CNC-02 | CNC Freze | 372 | 22 | S7 | spindle, sogutma, sicaklik |
| CNC-03 | CNC Torna | 180 | 18 | OPC-UA | spindle, titresim |
| PRESS-01 | Hidrolik Pres | 120 | 35 | Modbus | basinc, yag sicaklik, yag seviye |
| PRESS-02 | Hidrolik Pres | 90 | 20 | Modbus | basinc, yag sicaklik |
| WELD-01 | Kaynak Robotu | 480 | 25 | OPC-UA | akim, gerilim, tel hizi |
| WELD-02 | Kaynak Robotu | 540 | 30 | OPC-UA | akim, gerilim, tel hizi |
| PAINT-01 | Boya Hatti | 90* | 45 | MQTT | kabin sicaklik, nem, firin sicaklik |
| PACK-01 | Paketleme | 45 | 5 | REST | paketleme hizi |
| SAW-01 | Serit Testere | 60 | 8 | Modbus-RTU | bicak hizi, asinma, sicaklik |
| DRILL-01 | Matkap | 90 | 12 | MT-Connect | devir, ilerleme |
| INSP-01 | Kalite Kontrol | 30* | 3 | REST | kontrol/gecen/kalan sayaci |

*PAINT-01 ve INSP-01 gecici olarak hizlandirildi (darbogaz giderimi). Gercek degerler: PAINT=900sn, INSP=150sn.

## 6 Urun (BOM)

| Urun | Kod | Faz Zinciri | Musteriler |
|------|-----|------------|------------|
| Aks Mili O20 | PRD-001 | CNC-01 → INSP-01 | Ford Otosan |
| Flans Braket | PRD-002 | CNC-02 → DRILL-01 → INSP-01 | TOFAS |
| Pres Plaka 3mm | PRD-003 | PRESS-01 → INSP-01 | Arcelik |
| Kaynakli Konsol | PRD-004 | SAW-01 → WELD-01 → PAINT-01 → INSP-01 | Hyundai Assan |
| Paslanmaz Burc | PRD-005 | CNC-03 → INSP-01 | BSH |
| Sac Braket Montajli | PRD-006 | PRESS-02 → DRILL-01 → WELD-02 → PAINT-01 → PACK-01 | Ford Otosan |

## Event Sistemi

| Event | Tetikleyici | Handler (main.ts) |
|-------|------------|-------------------|
| `PART_PRODUCED` | Cevrim tamamlandi | Kafka job status + WIP sayac |
| `PART_SCRAPPED` | Hurda | Sayac artir |
| `ALARM_TRIGGERED` | Tag esik asimi veya ariza | Kafka alarm + corrective WorkOrder |
| `SHIFT_CHANGED` | Vardiya gecisi | Log |
| `SHIFT_BREAK_START/END` | Mola | Log |

## Backend Entegrasyon (API Client)

| Kategori | Metot Sayisi | Ornek |
|----------|-------------|-------|
| Is Emri | 4 | getActiveChildrenByMachines, createJobOrderFromBom |
| BOM | 2 | getBoms, getBomFlow |
| Bakim | 5 | createWorkOrder, completeWorkOrder, updateRunHours |
| SPC | 2 | getSpcCharacteristics, sendSpcMeasurements |
| Enerji | 1 | sendEnergyConsumption |
| Tedarik | 6 | createSupplier, createPO, createGoodsReceipt |
| Is Emri State | 6 | hold, release, cancel, split, priority, rework |
| Sevkiyat | 2 | createShipment, shipShipment |
| Stok | 3 | checkAlerts, getAlerts, getStockSummary |
| Musteri Sikayet | 1 | createComplaint |

**Toplam:** 60+ API metodu, timeout 10sn, Bearer token auth.

## Kafka Topic'ler

| Topic | Icerik | Siklik |
|-------|--------|--------|
| `mes.telemetry.raw` | Tag degerleri (deviceId + tags[]) | Her tick (makine basina) |
| `mes.telemetry.machine-status` | Durum gecisi (from→to + machineId + activeJobOrderNo) | Durum degistiginde |
| `mes.production.job-order-status` | Is emri ilerlemesi (jobOrderNo + produced + phaseNo) | Her parca uretildiginde |
| `mes.telemetry.alarms` | Alarm (severity + reason + threshold) | Alarm tetiklendiginde |

## 30 Edge Case Senaryosu (3 Aylik Plan)

| Hafta | Senaryo | Aciklama |
|-------|---------|----------|
| 3 | EC-07 | Min stok alarmi (HAM-005 aluminyum) |
| 4 | EC-01, EC-03 | Hammadde tukenmesi + kismi teslimat |
| 5 | EC-09, EC-12 | Oncelik degisikligi + acil siparis (Ford) |
| 6 | EC-04, EC-18 | Kalitesiz malzeme + tedarikci puanlama |
| 7 | EC-15, EC-19 | SPC kontrol disi + rework |
| 8 | EC-08, EC-14 | PAINT-01 darbogaz + WIP birikmesi |
| 9 | EC-10, EC-11 | Siparis iptali + is emri bolme |
| 10 | EC-21, EC-22, EC-23 | Planli bakim + ariza + yedek parca yok |
| 11 | EC-17, EC-20 | Musteri sikayet (8D) + sevkiyat |
| 12 | EC-28, EC-29, EC-30 | Lot izlenebilirlik + audit trail + donem sonu |

## Canonical Referanslar (En Temiz Kod)

| Kategori | Dosya | Neden |
|----------|-------|-------|
| Core simulator | `machines/machine.simulator.ts` | Event-driven state machine, cevrim yonetimi |
| Tag generation | `telemetry/tag.generator.ts` | Termal model, sinuzoidal drift, gercekci noise |
| State machine | `machines/machine-state.ts` | Temiz gecis tablosu, gecmis takibi |
| Config | `config/factory.config.ts` | 12 makine taniminin tek dosyada tutarliligi |

## Kod Kalitesi Kurallari

- **`as any`**: YASAK (su an 0 adet — bu standart korunmali)
- **strict mode**: Acik (`tsconfig.json` strict: true)
- **Error handling**: Tum API cagirilari try/catch icinde
- **Promise handling**: async/await tutarli, unhandled rejection yok
- **Event tipi**: `SimEvents` enum kullan, string literal YASAK
- **Config**: Makine/malzeme/urun tanimlari `config/` altinda, hardcoded deger YASAK
- **Kafka topic**: `TOPICS` sabitleri kullan (`kafka.publisher.ts` icinde tanimli)

## Dikkate Deger Tasarim Kararlari

1. **Child-aware is emri**: Simülator artik parent degil, child is emirleriyle calisir. Her child bir makine fazina karsilik gelir.
2. **WIP buffer kontrolu**: Ara faz, onceki fazin kumulatif uretiminden fazla uretemez.
3. **Akilli secim**: Backend `findActiveChildrenByMachines` upstream fazi bloke olan child'lari eler.
4. **Grace period**: Yeni olusturulan child, 60sn icinde sync'te gorunmezse silinmez.
5. **Defansif kontroller**: Backend'de dedupe (2sn), rate limit (30/dk), parent cap (500).
6. **Bakim entegrasyonu**: Bakim basladığında WorkOrder olusturulur, makine maintenance moduna girer, aktif child JO on_hold olur. Bittiginde hepsi geri doner.
