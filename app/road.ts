/**
 * «Дорога» (дизайн A+): что нужно, чтобы подняться на следующую ступень, — условиями с цифрами.
 * Чистая функция над `PositionView`: ничего не считает заново, только раскладывает уже посчитанное движком
 * (запас, общая оценка, направления) в строки «сколько есть из сколько нужно». Математику движка не меняет.
 */
import { L3_RESERVE_MONTHS, L4_RESERVE_MONTHS, type PositionView } from '../engine/index';

/** Запас — округление вниз до десятых, как на «Профиле» и «Обзоре»: 5,96 → «5,9». */
const nfDown = (x: number): string => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1).replace('.', ',');

export interface RoadCond {
  title: string;
  /** Что есть сейчас: «4,5 из 6 мес.», «71 из 75», «выполнено»; пусто — условие только словами. */
  value: string;
  /** 0–1 для полоски; null — полоска не нужна. */
  ratio: number | null;
  done: boolean;
  /** Запас/оценка — условия, которые можно подвинуть деньгами; нужны экрану, чтобы повесить «Посчитать путь» к запасу. */
  kind: 'reserve' | 'score' | 'directions' | 'text';
}

export interface RoadModel {
  /** «Ступень 1 пройдена» / «Ступени 1 и 2 пройдены»; null — пройденных нет. */
  passed: string | null;
  current: { level: number; name: string };
  next: { level: number; name: string; conds: RoadCond[] };
  /** Ступени после следующей — одной строкой в конце дороги. */
  rest: { level: number; name: string }[];
}

const SCORE_THRESHOLD: Record<number, number> = { 2: 20, 3: 40, 4: 75 };

/**
 * null — дорогу не рисуем: уровня нет, ступень уже 4 и выше (дальше «Независимость» со своим блоком) или движок не назвал следующую.
 * Условия идут в порядке «что поддаётся деньгами → оценка → направления → слова».
 */
export function roadOf(v: PositionView): RoadModel | null {
  if (v.level === null || v.levelName === null || v.level > 3 || !v.next) return null;
  const to = v.next.level;
  const conds: RoadCond[] = [];

  const reserveTarget = to === 3 ? L3_RESERVE_MONTHS : to === 4 ? L4_RESERVE_MONTHS : null;
  if (reserveTarget !== null) {
    const r = v.money.reserveEssentialMonths;
    conds.push({ title: 'Запас на жизнь', value: r >= reserveTarget ? `выполнено · ${nfDown(r)} мес.` : `${nfDown(r)} из ${reserveTarget} мес.`, ratio: Math.max(0, Math.min(1, r / reserveTarget)), done: r >= reserveTarget, kind: 'reserve' });
  }

  const thr = SCORE_THRESHOLD[to];
  if (thr !== undefined && v.g !== null) {
    conds.push({ title: 'Общая оценка', value: v.g >= thr ? `выполнено · ${Math.round(v.g)}` : `${Math.round(v.g)} из ${thr}`, ratio: Math.max(0, Math.min(1, v.g / thr)), done: v.g >= thr, kind: 'score' });
  }

  if (to === 4) {
    const low = v.directions.filter((d) => d.score !== null && d.score < 60);
    const unknown = v.directions.some((d) => d.score === null);
    conds.push({
      title: 'Каждое направление от 60',
      value: low.length ? low.map((d) => `${d.name} ${Math.round(d.score!)}`).join(', ') : unknown ? 'данных мало' : 'выполнено',
      ratio: null,
      done: !low.length && !unknown,
      kind: 'directions',
    });
  }

  // условия, которые движок формулирует только словами: ограничения оценки и «доходы покрывают расходы»
  for (const need of v.next.needs) {
    if (need.startsWith('снять ограничение') || need.includes('доходы покрывали')) conds.push({ title: need.charAt(0).toUpperCase() + need.slice(1), value: '', ratio: null, done: false, kind: 'text' });
  }

  const passed = v.level === 1 ? null : v.level === 2 ? 'Ступень 1 пройдена' : 'Ступени 1 и 2 пройдены';
  return {
    passed,
    current: { level: v.level, name: v.levelName },
    next: { level: to, name: v.next.name, conds },
    rest: v.ladder.filter((l) => l.level > to).map((l) => ({ level: l.level, name: l.name })),
  };
}
