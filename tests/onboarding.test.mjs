import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,clone} from '../web/model.js';
import {setupDraft,setupLocation,setupAnnualConsumption} from '../web/onboarding.js';

test('new-visitor setup removes example obstructions; editing a setup preserves its scene until committed',()=>{
  const original=clone(defaults),existing=setupDraft(original),fresh=setupDraft(original,true);
  assert.equal(fresh.obstacles.length,0);assert.equal(existing.obstacles.length,original.obstacles.length);
  existing.costs.importRate=.45;existing.obstacles[0].height=55;
  assert.deepEqual(original,defaults);
});
test('setup stores only rounded weather location and rejects invalid coordinates or zones',()=>{
  const draft=setupDraft(defaults),location=setupLocation(draft,'52.512345, 13.412345','Europe/Berlin',.1);
  assert.equal(location.lat,52.5);assert.equal(location.lon,13.4);
  assert.equal(JSON.stringify(location).includes('52.512345'),false);
  assert.throws(()=>setupLocation(draft,'not a location','Europe/Berlin',.1));
  assert.throws(()=>setupLocation(draft,'52, 13','Not/AZone',.1));
});
test('changing annual consumption preserves monthly proportions and the exact annual total',()=>{
  const draft=setupDraft(defaults),ratio=draft.consumption.monthly[0]/draft.consumption.monthly[1];
  setupAnnualConsumption(draft,4200);
  assert.ok(Math.abs(draft.consumption.monthly.reduce((a,b)=>a+b,0)-4200)<1e-9);
  assert.ok(Math.abs(draft.consumption.monthly[0]/draft.consumption.monthly[1]-ratio)<1e-9);
  draft.consumption.monthly.fill(0);setupAnnualConsumption(draft,3600);assert.deepEqual(draft.consumption.monthly,Array(12).fill(300));
});
