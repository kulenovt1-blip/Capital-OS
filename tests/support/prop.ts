/**
 * Мини-библиотека property-тестов с сидом (замена fast-check, BLOCKERS B1).
 * При падении сообщение содержит сид и номер прогона — случай воспроизводится: PROP_SEED=<сид>.
 */
export interface Gen {
  /** Целое в [lo, hi]. */
  int(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  bool(p?: number): boolean;
  /** Журнал шагов прогона — печатается при падении. */
  log(line: string): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function forAll(runs: number, body: (g: Gen, run: number) => void, baseSeed = Number(process.env.PROP_SEED ?? 20261028)): void {
  for (let run = 0; run < runs; run++) {
    const seed = (baseSeed + run * 7919) >>> 0;
    const r = mulberry32(seed);
    const lines: string[] = [];
    const g: Gen = {
      int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
      pick: (xs) => xs[Math.floor(r() * xs.length)]!,
      bool: (p = 0.5) => r() < p,
      log: (l) => void lines.push(l),
    };
    try {
      body(g, run);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Свойство нарушено: прогон ${run}, сид ${seed} (PROP_SEED=${seed} воспроизведёт с первого прогона)\n${msg}\nПоследние шаги:\n${lines.slice(-15).join('\n')}`);
    }
  }
}
