---
name: add-machine
description: Simulasyona yeni bir makine ekle. Use when adding a new machine, equipment, or workstation to the simulator.
argument-hint: "[makine-adi tip]"
allowed-tools: Read Edit Write Glob Grep
paths: "src/config/**/*.ts"
---

Simulasyona yeni bir makine ekle: $ARGUMENTS

## Adimlar

1. `src/config/factory.config.ts` dosyasini oku
   - Mevcut 12 makine tanimini incele
   - Yeni makine icin uygun parametreleri belirle

2. Factory config'e makine ekle:
   ```typescript
   {
     machineId: 'YENI-01',
     name: 'Makine Adi',
     type: MachineType.XXX,
     protocol: Protocol.XXX,
     cycleTime: N,          // saniye
     powerRating: N,        // kW
     tags: [ ... ],         // telemetri tag'lari
     alarmThresholds: { ... }
   }
   ```

3. Gerekirse `src/telemetry/tag.generator.ts`'e yeni tag generator ekle

4. `src/machines/machine.simulator.ts`'de ozel davranis gerekiyorsa ekle

5. Backend'de makine taniminin seed'de oldugundan emin ol

6. `npx tsc --noEmit` ile TypeScript hatasi olmadigini dogrula
