/**
 * Simulasyon Saati
 *
 * Gercek zamanli veya hizlandirilmis saat.
 * Tum simulatorler bu saati referans alir.
 */

type TickCallback = (simTime: Date, deltaSec: number) => void | Promise<void>;

export class ClockService {
  private speed: number;
  private running = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private tickCallbacks: TickCallback[] = [];
  private startTime: Date;
  private simTime: Date;
  private tickCount = 0;

  constructor(speed = 1) {
    this.speed = speed;
    this.startTime = new Date();
    this.simTime = new Date();
  }

  getSimTime(): Date {
    return new Date(this.simTime);
  }

  getSpeed(): number {
    return this.speed;
  }

  setSpeed(speed: number) {
    this.speed = Math.max(0.1, Math.min(speed, 100));
    console.log(`[Clock] Hiz degistirildi: ${this.speed}x`);
  }

  getTickCount(): number {
    return this.tickCount;
  }

  onTick(callback: TickCallback) {
    this.tickCallbacks.push(callback);
  }

  start(intervalMs = 1000) {
    if (this.running) return;
    this.running = true;
    this.startTime = new Date();
    this.simTime = new Date();

    console.log(`[Clock] Baslatildi (${this.speed}x hiz, ${intervalMs}ms aralik)`);

    this.intervalHandle = setInterval(async () => {
      const deltaSec = (intervalMs / 1000) * this.speed;
      this.simTime = new Date(this.simTime.getTime() + deltaSec * 1000);
      this.tickCount++;

      for (const cb of this.tickCallbacks) {
        try {
          await cb(this.simTime, deltaSec);
        } catch (err: any) {
          console.error(`[Clock] Tick hatasi: ${err.message}`);
        }
      }
    }, intervalMs);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    console.log(`[Clock] Durduruldu. Toplam tick: ${this.tickCount}`);
  }

  isRunning(): boolean {
    return this.running;
  }
}
