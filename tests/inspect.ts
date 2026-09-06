// Prints the top cards for a few targets so the ranking can be eyeballed. Not a test.
import { loadData } from '../src/data.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { resolveTarget } from '../src/model/sparks.ts';
import { buildDeck, makeCtx, rankCards, traineeCoverage, wishlist, type Ctx } from '../src/model/deck.ts';
import { predictDeck } from '../src/model/stats.ts';
const data = loadData();
const { cards, skills, characters } = data;
const settings = { ...DEFAULT_SETTINGS };
const trainee = characters.find((c) => c.name === 'Special Week')!;
const ctx: Ctx = makeCtx({ data, settings, races: 20, totalTurns: data.model.races.totalTurns, trainee });
const byName = (n: string) => skills.find((s) => s.name === n && !s.unreleasedEn)!;
const targets = ['Corner Recovery ○', 'Groundwork', 'Pace Strategy'].map((n) => resolveTarget(byName(n).id, data)!);
console.log('targets', targets.map((t) => `${t.name} [white ${t.white?.id} gold ${t.gold?.name ?? '-'}]`));
const pool = cards.map((card) => ({ card, lb: 4 }));
const r = rankCards(pool, targets, traineeCoverage(targets, ctx), ctx);
for (const x of r.slice(0, 12)) console.log(`${x.card.name.padEnd(40)} ${x.card.rarity.padEnd(3)} ${x.card.type.padEnd(7)} marg ${(x.marginalValue*100).toFixed(1).padStart(5)}%  stats ${x.statPower.toFixed(0).padStart(4)} sp ${x.sp.toFixed(0)}  ${x.source}  ` + x.coverage.map((c) => `${c.target.name}:${(c.spark*100).toFixed(0)}%[${c.sources.map((s) => s.kind + (s.gold ? '*' : '') + ' ' + (s.pObtain*100).toFixed(0)).join(',')}]`).join(' '));
const d = buildDeck(pool, targets, ctx, [30052]);
console.log('\nDECK'); d.steps.forEach((s) => console.log(' -', s));
const p = predictDeck(d.deck.map((x) => ({ card: x.card, lb: x.lb })), trainee, 20, 'stamina', 1, data.model, settings);
console.log('pred gain', p.mean.map((v) => v.toFixed(0)), 'final', p.finalMean.map((v) => v.toFixed(0)), 'sp', p.sp.toFixed(0), 'card', p.cardStats.map((v) => v.toFixed(0)));
console.log('wishlist', wishlist(d.deck, targets, ctx).map((w) => `${w.name}${w.gated ? '*' : ''}`));
// stat-stick ranking with no targets
const r2 = rankCards(pool, [], traineeCoverage([], ctx), ctx);
console.log('\nTOP STAT STICKS'); for (const x of r2.slice(0, 8)) console.log(`${x.card.name.padEnd(40)} ${x.card.rarity} ${x.card.type.padEnd(7)} ${x.stats.map((v) => v.toFixed(0).padStart(4)).join(' ')} = ${x.statPower.toFixed(0)} sp ${x.sp.toFixed(0)} ${x.source}`);
