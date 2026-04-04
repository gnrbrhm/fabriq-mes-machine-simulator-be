/**
 * Gercekci Rastgele Deger Uretimi
 *
 * Gaussian, uniform, poisson dagilimlar.
 * Sanayi verisi icin noise, drift, spike uretimi.
 */

/** Gaussian (normal) dagilim - Box-Muller yontemi */
export function gaussian(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

/** Uniform dagilim [min, max] */
export function uniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Poisson dagilim (ariza sikligi icin) */
export function poisson(lambda: number): number {
  let L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

/** Olasilik kontrolu */
export function chance(probability: number): boolean {
  return Math.random() < probability;
}

/** Dizi icinden rastgele sec */
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Gurultulu deger uret (nominal + noise) */
export function noisyValue(nominal: number, noisePercent: number): number {
  if (noisePercent <= 0) return nominal;
  const noise = gaussian(0, (nominal * noisePercent) / 100 / 3); // 3-sigma icinde
  return nominal + noise;
}

/** Sinuzoidal drift (yavas salini) */
export function sinusoidalDrift(time: number, amplitude: number, periodSec: number): number {
  return amplitude * Math.sin((2 * Math.PI * time) / periodSec);
}

/** Ramp (linear artis/azalis) - isinma icin */
export function ramp(currentValue: number, targetValue: number, ratePerSec: number, deltaSec: number): number {
  const diff = targetValue - currentValue;
  const step = ratePerSec * deltaSec;
  if (Math.abs(diff) <= step) return targetValue;
  return currentValue + Math.sign(diff) * step;
}

/** Newton soguma/isinma modeli: T(t) = T_target + (T_current - T_target) * e^(-dt/tau) */
export function thermalModel(current: number, target: number, tauSec: number, deltaSec: number): number {
  return target + (current - target) * Math.exp(-deltaSec / tauSec);
}
