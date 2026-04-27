---
name: add-edge-case
description: Simulasyona yeni bir edge case senaryosu ekle. Use when adding a new test scenario, edge case, or production event.
argument-hint: "[senaryo-aciklamasi]"
allowed-tools: Read Edit Write Glob Grep
paths: "src/production/**/*.ts"
---

Simulasyona yeni bir edge case senaryosu ekle: $ARGUMENTS

## Adimlar

1. `src/production/production-planner.ts` dosyasini oku
   - Mevcut edge case'leri incele (EC-01 ... EC-30)
   - Yeni senaryo icin uygun hafta ve EC numarasi belirle

2. Senaryo tipini belirle:
   - **Tedarik**: Hammadde tukenmesi, kismi teslimat, kalitesiz malzeme
   - **Uretim**: Oncelik degisikligi, iptal, bolme, acil siparis
   - **Kalite**: Rework, SPC kontrol disi, musteri sikayet
   - **Bakim**: Planli bakim, ariza, yedek parca yok
   - **Lojistik**: Sevkiyat, kismi sevkiyat

3. Senaryoyu planner'a ekle:
   - `weeklyEdgeCases` dizisine yeni hafta/senaryo ekle
   - Gerekli API client metotlarini `src/upstream/api.client.ts`'de kontrol et
   - Eksik metot varsa ekle

4. `docs/EDGE-CASE-CHECKLIST.md`'yi guncelle

5. TypeScript hatasi olmadigindan emin ol: `npx tsc --noEmit`
