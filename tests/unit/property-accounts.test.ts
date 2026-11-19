/**
 * Имущество (D218): квартиру или машину, которую человек ведёт счётом в MoneyManager, можно отметить «это имущество».
 * Тогда она — как ручной актив «жильё / заблокировано»: в капитале есть, а в деньгах, копилках, запасе и «свободно» — нет.
 */
import { describe, it, expect } from 'vitest';
import { buildOverview } from '../../engine/overview';
import { positionViewOf } from '../../engine/position/view';
import { PROPERTY_TITLE_RE } from '../../engine/settings';
import { tenge } from '../../engine/money';
import type { AppState } from '../../engine/state';
import { build, mk, TODAY } from '../support/position-profiles';

/** Профиль, у которого в MoneyManager есть счёт «Квартира» на 30 млн (его баланс — начальный приход в копилку, как в сборщике). */
function withFlat(property: boolean): AppState {
  const st = build(mk('С квартирой', 1_000_000, 500_000, [['food', 'E_base', 150_000], ['rent', 'E_base', 50_000], ['fun', 'E_fun', 80_000]]));
  const imp = st.imported!;
  const flat = { ...imp.accounts[0]!, id: 'flat', title: 'Квартира' };
  const op = { ...imp.operations[0]!, id: 'flat-open', accountId: 'flat', amount: tenge(30_000_000), categoryId: null };
  return {
    ...st,
    imported: { ...imp, accounts: [...imp.accounts, flat], operations: [...imp.operations, op] },
    settings: { ...st.settings, accounts: [...st.settings.accounts, { accountId: 'flat', excluded: false, liquidity: { kind: 'instant' }, ...(property ? { property: true } : {}) }] },
  } as AppState;
}

describe('счёт MoneyManager с отметкой «имущество»', () => {
  const money = withFlat(false), prop = withFlat(true);
  const om = buildOverview(money, TODAY), op = buildOverview(prop, TODAY);

  it('капитал тот же: квартира в нём есть в обоих случаях', () => {
    expect(op.capital.net).toBe(om.capital.net);
  });
  it('«Всего на счетах» и «в копилках» — без квартиры; квартира — в «Имуществе»', () => {
    expect(om.spend.onHand - op.spend.onHand).toBe(tenge(30_000_000));
    expect(op.spend.property).toBe(tenge(30_000_000));
    expect(om.spend.property).toBe(0);
  });
  it('запас и ступень считаются без квартиры', () => {
    const vm = positionViewOf(money, TODAY), vp = positionViewOf(prop, TODAY);
    expect(vp.money.reserveEssentialMonths).toBeLessThan(vm.money.reserveEssentialMonths);
    expect(vp.housing?.assets).toBe(30_000_000);
  });
});

describe('название похоже на имущество — только подсказка', () => {
  it('квартира, дом, машина, авто, участок — да; «Домашние», «Автокредит», вклад, карта — нет', () => {
    for (const t of ['Квартира', 'Дом', 'Мой дом', 'Машина', 'Авто', 'Участок', 'Жильё', 'Гараж']) expect(PROPERTY_TITLE_RE.test(t), t).toBe(true);
    for (const t of ['Домашние', 'Автокредит', 'Депозит', 'Kaspi Gold', 'Наличные', 'Копилка']) expect(PROPERTY_TITLE_RE.test(t), t).toBe(false);
  });
});
