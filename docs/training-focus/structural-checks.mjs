const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path. See README.md.');
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fixtures, inputs, measure, data } from './sweep.mjs';
import { goalDeckConstraints } from '../../src/model/goal-deck.ts';
import { chooseGoal } from '../../src/model/goal-objective.ts';
const results = [], pink = [];
for (const spec of fixtures().filter(c => c.cohort === 'white-three-star')) {
  const state = inputs(spec);
  const constraints = goalDeckConstraints({
    owned: data.cards.filter(card => state.inventory[card.id] !== null).map(card => ({card,lb:state.inventory[card.id]})),
    borrows: data.cards.map(card => ({card,lb:4,borrowed:true})),
    pinnedIds: state.run.pinnedIds, borrowFromAll: false, traineeId: data.charByCardId.get(state.run.traineeCardId).charId,
  });
  const selection = constraints.legalSeeds.find(constraints.legal).map(e=>({id:e.card.id,lb:e.lb,borrowed:e.borrowed}));
  for (const stat of ['speed','stamina','power','guts','wit']) {
    const sample = structuredClone(state);
    sample.run.targets.filter(t=>t.role==='required').forEach(t=>t.stars=1);
    sample.run.goal.blueStats=[stat]; sample.run.goal.blueStars=3;
    const rows = ['balanced','stamina','sprint'].map(focus=>measure(sample,focus,{selection,search:false}));
    const expected=rows.find(r=>r.focus===(stat==='stamina'?'stamina':'sprint'));
    for (const row of rows) {
      assert.ok(expected.score.count>=row.score.count);
      if (expected.score.count===row.score.count) assert.ok(expected.score.comparison >= row.score.comparison*(1-1e-10));
      assert.equal(row.sp,rows[0].sp);
    }
    results.push({inv:spec.inv,legacy:spec.legacy,blue:stat,expected:expected.focus,probabilities:rows.map(r=>[r.focus,r.probability])});
  }
  const variants = [[{aptitude:'any',stars:1}],[{aptitude:'any',stars:3}],[{aptitude:'medium',stars:2}],[{aptitude:'dirt',stars:3}],[{aptitude:'medium',stars:2},{aptitude:'mile',stars:2}]];
  const rows = variants.map(goals=>{
    const sample=structuredClone(state); sample.run.goal.pink=goals;
    return ['balanced','stamina','sprint'].map(focus=>measure(sample,focus,{selection,search:false}));
  });
  for(let v=1;v<rows.length;v++) for(let f=0;f<3;f++) {
    assert.ok(Math.abs(rows[v][f].score.comparison-rows[0][f].score.comparison)<1e-12);
    assert.ok(Math.abs(rows[v][f].score.preferred-rows[0][f].score.preferred)<1e-12);
    assert.deepEqual(rows[v][f].stats,rows[0][f].stats);
    assert.equal(rows[v][f].races,rows[0][f].races);
  }
  pink.push({inv:spec.inv,legacy:spec.legacy,goals:variants,probabilities:rows.map(rs=>rs.map(r=>r.probability)),winners:rows.map(rs=>chooseGoal(rs,.02).focus)});
}
writeFileSync(output,JSON.stringify({dominance:results,pink},null,2));
console.log(`Passed ${results.length} fixed-deck dominance cases and ${pink.length*5} matched pink-goal cases, each across three focuses.`);
