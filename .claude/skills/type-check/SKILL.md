---
name: type-check
description: Simulator TypeScript tip kontrolu calistir. Use when checking for type errors or after changes.
allowed-tools: Bash(npx tsc *) Read Grep
---

Simulator TypeScript tip kontrolu calistir.

```bash
cd /Users/halilibrahimguneri/Cyclone/simulator/fabriq-mes-machine-simulator-be
npx tsc --noEmit
```

Hata varsa:
1. Hata mesajini analiz et
2. Ilgili dosyayi oku
3. Tip hatasini duzelt
4. Tekrar calistir

Hata yoksa "TypeScript tip kontrolu BASARILI" raporla.
