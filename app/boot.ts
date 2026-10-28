/** Сборка приложения из экранов. Этапы добавляют свои экраны здесь. */
import { addRoute, start } from './main';
import { renderGoals } from './screens/goals';
import { renderIncome } from './screens/income';
import { renderForecast } from './screens/forecast';
import { renderClasses } from './screens/classes';
import { renderSetup, setupDone } from './screens/setup';

addRoute({ path: 'setup', title: 'Первые шаги', render: () => renderSetup(), hidden: setupDone }, 'import');
addRoute({ path: 'goals', title: 'Цели', render: () => renderGoals() }, 'import');
addRoute({ path: 'income', title: 'Поступление', render: (r) => renderIncome(r) }, 'import');
addRoute({ path: 'forecast', title: 'Прогноз', render: (r) => renderForecast(r) }, 'import');
addRoute({ path: 'classes', title: 'Классы', render: () => renderClasses() }, 'settings');
void start();
