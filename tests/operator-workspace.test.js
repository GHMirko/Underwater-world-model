import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorSections } from '../src/ui/operator-workspace.js';

test('operator workspace separates complex system controls into five mission-oriented functions', () => {
  const sections=operatorSections();
  assert.deepEqual(sections.map(s=>s.id),['chart','mission','data','acoustic','assets']);
  const ids=sections.flatMap(s=>s.panels);
  assert.equal(ids.length,9);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ['landMapPanel','seaMapPanel','experimentPanel','missionPanel','bathyBrokerPanel','environmentPanel','acousticEnvironmentPanel','assetsPanel','optimizerPanel'])
    assert.ok(ids.includes(id));
});

test('operator section definitions are safe copies, not shared mutable UI state', () => {
  const first=operatorSections();
  first[0].panels.push('bad');
  const second=operatorSections();
  assert.ok(!second[0].panels.includes('bad'));
});
