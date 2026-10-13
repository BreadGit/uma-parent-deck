import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_TITLE, noticesFrom, refreshDue, contentForComparison } from '../scripts/data-refresh.ts';
import feed from './fixtures/notices.json' with { type: 'json' };

const notices = noticesFrom(feed);

test('the notice feed parses as UTC times and release notices are the ones that change the snapshot', () => {
  assert.equal(notices.find(notice => notice.title === 'The event Aim for the Stars! Dream Team has ended!')?.postedAt.toISOString(), '2026-10-04T22:00:00.000Z');
  const releases = notices.filter(notice => RELEASE_TITLE.test(notice.title)).map(notice => notice.title);
  for (const title of ['Spotlight Pretty Derby and Spotlight Support Card Scouts out now!', 'The story event Illuminate the Heart is here!',
    'The new Career scenario "Brighter Together! Our Grand Concert" is here!', 'Holiday Celebration Part 1 now available!', 'Check out all the latest updates!']) {
    assert.ok(releases.includes(title), title);
  }
  for (const title of ['New Spotlight Pretty Derby and Spotlight Support Card Scouts coming soon!', 'The story event "Hark Back, Run Forward" has ended!',
    'Maintenance Announcement', 'Issue with Independent Training']) {
    assert.ok(!releases.includes(title), title);
  }
  assert.throws(() => noticesFrom({}));
  assert.throws(() => noticesFrom({ information_list: [{ title: 'x', post_at: 'soon' }] }));
});

test('a release is refreshed about one, four and twenty-five hours after its notice, and never on a quiet day', () => {
  // Cards went live at 2026-09-15 22:00 UTC; the notices on the days around it announce or end things.
  const runs = (day: string) => [new Date(`${day}T23:07:00Z`), new Date(`${day}T02:07:00Z`)];
  assert.deepEqual([...runs('2026-09-15'), ...runs('2026-09-16'), ...runs('2026-09-17')].map(run => refreshDue(run, notices)), [true, false, true, true, false, false]);
  assert.equal(refreshDue(new Date('2026-10-02T23:07:00Z'), notices), false, 'Friday without release notices');
  assert.equal(refreshDue(new Date('2026-10-05T23:07:00Z'), []), true, 'Monday 23 UTC fallback');
  assert.equal(refreshDue(new Date('2026-10-05T02:07:00Z'), []), false, 'the other Monday run');
  assert.equal(refreshDue(new Date('2026-09-27T23:07:00Z'), [{ title: 'New Spotlight Scouts coming soon!', postedAt: new Date('2026-09-27T22:00:00Z') }]), false, 'advance notices wait for the release');
});

test('refresh comparison ignores check times but detects changed mission content and artwork', () => {
  const old = Buffer.from(JSON.stringify({ fetchedAt: '2026-10-01', events: [{ id: 1 }] }));
  const checked = Buffer.from(JSON.stringify({ fetchedAt: '2026-10-02', events: [{ id: 1 }] }));
  const changed = Buffer.from(JSON.stringify({ fetchedAt: '2026-10-02', events: [{ id: 2 }] }));
  assert.equal(contentForComparison('data/missions.json', old), contentForComparison('data/missions.json', checked));
  assert.notEqual(contentForComparison('data/missions.json', old), contentForComparison('data/missions.json', changed));
  assert.notDeepEqual(contentForComparison('public/assets/card.webp', old), contentForComparison('public/assets/card.webp', changed));
  assert.equal(contentForComparison('data/raw/manifest.json', old), contentForComparison('data/raw/manifest.json', changed));
});

test('refresh comparison ignores fitting roundoff but retains source and model changes', () => {
  const original = Buffer.from('{"fit":{"rmse":2.6134651659180705},"slope":0.8456547015729503}');
  const refitted = Buffer.from('{"fit":{"rmse":2.6134651659180737},"slope":0.8456547015729488}');
  const changed = Buffer.from('{"fit":{"rmse":2.6134651659180737},"slope":0.845655}');
  assert.equal(contentForComparison('data/stat-model.json', original), contentForComparison('data/stat-model.json', refitted));
  assert.notEqual(contentForComparison('data/stat-model.json', original), contentForComparison('data/stat-model.json', changed));
  assert.notDeepEqual(contentForComparison('data/raw/support-cards.json', original), contentForComparison('data/raw/support-cards.json', refitted));
});
