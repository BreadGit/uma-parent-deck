import assert from 'node:assert/strict';
import { BLUE_SPARK_START_GAIN_BY_STARS } from '../src/model/rules.ts';
import { loadData } from '../src/data.ts';
import { startingAptitudes } from '../src/model/pink-inherit.ts';
import { migrate, STATE_KEY } from '../src/state.ts';
const data = loadData();

/**
 * Every form field that mirrors persisted state must show that state. A <select> the user has changed ignores later
 * `selected` attribute changes on its options, so a field that lit reuses for a different card or stat would keep a
 * stale value unless its value is bound live; this catches that whatever the field.
 */
export async function assertFieldsMatchState(page, where) {
  const current = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), STATE_KEY);
  const saved = migrate({ current }, data);
  const trainee = data.charByCardId.get(saved.run?.traineeCardId);
  const expectedAptitudes = trainee ? startingAptitudes(trainee.aptitudes, saved.run.aptOverrides, saved.run.pinkLineage) : null;
  const bad = await page.evaluate(({ gainByStars, expectedAptitudes, st }) => {
    const out = [];
    const STATS = ['speed', 'stamina', 'power', 'guts', 'wit'];
    for (const el of document.querySelectorAll('select[data-lb]')) {
      const v = st.inventory?.[el.dataset.lb];
      const want = v === null ? 'none' : String(v ?? 4);
      if (el.value !== want) out.push(`LB select for ${el.dataset.lb} shows ${el.value}, state ${want}`);
    }
    for (const el of document.querySelectorAll('select[data-gain]')) {
      const [p, i] = el.dataset.gain.split('-').map(Number);
      const want = String((st.run?.parentSparks?.[p] ?? []).filter((s) => s?.stat === STATS[i]).reduce((a, s) => a + gainByStars[s.stars], 0));
      if (el.value !== want) out.push(`gain select ${el.dataset.gain} shows ${el.value}, state makes ${want}`);
    }
    for (const el of document.querySelectorAll('select[data-spark-stat], select[data-spark-stars]')) {
      const key = el.dataset.sparkStat ?? el.dataset.sparkStars;
      const [p, u] = key.split('-').map(Number);
      const spark = st.run?.parentSparks?.[p]?.[u] ?? null;
      const want = el.dataset.sparkStat ? (spark?.stat ?? '') : spark ? String(spark.stars) : '';
      if (el.value !== want) out.push(`spark select ${key} shows ${el.value}, state ${want}`);
      if (el.dataset.sparkStars && el.disabled !== !spark) out.push(`stars select ${key} disabled=${el.disabled} for spark ${JSON.stringify(spark)}`);
      if (!!el.querySelector('option[value=""]') !== !spark) out.push(`spark select ${key} offers "—" ${spark ? 'for a filled slot' : 'not at all for an empty slot'}`);
    }
    for (const el of document.querySelectorAll('select[data-apt]')) {
      const over = expectedAptitudes?.[el.dataset.apt];
      if (over && el.value !== over) out.push(`aptitude select ${el.dataset.apt} shows ${el.value}, override ${over}`);
    }
    for (const el of document.querySelectorAll('select[data-select="trainee-stars"]')) {
      if (el.value !== String(st.run?.traineeStars ?? 3)) out.push(`trainee stars shows ${el.value}, state ${st.run?.traineeStars}`);
    }
    for (const el of document.querySelectorAll('[data-setting]')) {
      const v = st.settings?.[el.dataset.setting];
      if (el.tagName === 'SELECT' && v !== undefined && el.value !== String(v)) out.push(`setting ${el.dataset.setting} shows ${el.value}, state ${v}`);
    }
    const goal = st.run?.goal;
    const check = (el, want) => { if (el.value !== String(want)) out.push(`${JSON.stringify(el.dataset)} shows ${el.value}, state ${want}`); };
    for (const el of document.querySelectorAll('[data-goal-blue]')) {
      if (el.checked !== goal.blueStats.includes(el.dataset.goalBlue)) out.push(`blue ${el.dataset.goalBlue} differs from state`);
    }
    for (const el of document.querySelectorAll('[data-goal-stars]')) check(el, goal[`${el.dataset.goalStars}Stars`]);
    for (const el of document.querySelectorAll('[data-goal-pink]')) check(el, goal.pink);
    for (const el of document.querySelectorAll('[data-target-stars]')) check(el, st.run.targets.find((r) => r.id === Number(el.dataset.targetStars)).stars);
    for (const el of document.querySelectorAll('[data-target-role]')) {
      const required = st.run.targets.some((r) => r.id === Number(el.dataset.id) && r.role === 'required');
      if (el.getAttribute('aria-pressed') !== String(required === (el.dataset.targetRole === 'required'))) out.push('target role differs from state');
    }
    for (const el of document.querySelectorAll('[data-lineage-k], [data-lineage-p]')) {
      const id = el.dataset.lineageK ?? el.dataset.lineageP;
      check(el, st.run.targetLineage[id]?.[el.dataset.side] ?? 0);
    }
    for (const el of document.querySelectorAll('[data-pink-lineage], [data-pink-lineage-stars]')) {
      const index = el.dataset.pinkLineage ?? el.dataset.pinkLineageStars;
      const spark = st.run.pinkLineage[index];
      check(el, el.hasAttribute('data-pink-lineage') ? spark?.aptitude ?? '' : spark?.stars ?? '');
      if (el.hasAttribute('data-pink-lineage-stars') && el.disabled !== !spark) out.push(`pink stars ${index} disabled differs from state`);
    }
    return out;
  }, { gainByStars: BLUE_SPARK_START_GAIN_BY_STARS, expectedAptitudes, st: saved });
  assert.deepEqual(bad, [], `fields out of step with the state ${where}: ${bad.join('; ')}`);
}
