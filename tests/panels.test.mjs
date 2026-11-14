import test from 'node:test';
import assert from 'node:assert/strict';
import {PANEL_PRESETS,PANEL_SPEC_FIELDS,applyPanelPreset,normalizePanelPreset} from '../web/panels.js';
import {defaults,clone,prepareScene,generationAt,panelGeometry} from '../web/model.js';

test('applying a panel loads electrical and geometric specs while preserving installation settings',()=>{
  const original=clone(defaults.panel),preset=PANEL_PRESETS.find(p=>p.id==='rec-alpha-pure-rx-460');
  const panel=applyPanelPreset(original,preset.id);
  for(const key of PANEL_SPEC_FIELDS)assert.equal(panel[key],preset[key]);
  for(const key of Object.keys(original).filter(k=>k!=='preset'&&!PANEL_SPEC_FIELDS.includes(k)))assert.equal(panel[key],original[key]);
  assert.deepEqual(original,defaults.panel);
});
test('legacy and custom panels are preserved and altered specs cannot retain a product label',()=>{
  const legacy=clone(defaults.panel);delete legacy.preset;
  assert.deepEqual(normalizePanelPreset(legacy),{...legacy,preset:'custom'});
  const panel=applyPanelPreset(legacy,PANEL_PRESETS[0].id);
  assert.equal(normalizePanelPreset(panel).preset,PANEL_PRESETS[0].id);
  for(const key of PANEL_SPEC_FIELDS)assert.equal(normalizePanelPreset({...panel,[key]:panel[key]+.01}).preset,'custom');
  assert.equal(normalizePanelPreset({...panel,preset:'unknown'}).preset,'custom');
  const custom=applyPanelPreset(panel,'custom');
  for(const key of PANEL_SPEC_FIELDS)assert.equal(custom[key],panel[key]);
  assert.equal(custom.preset,'custom');
  assert.throws(()=>applyPanelPreset(panel,'unknown'),/Unknown/);
});
test('catalogue specifications reach the 3D dimensions and generation calculation',()=>{
  const s=clone(defaults);s.panel.side='roof';s.panel.tilt=30;s.panel.inverter=3000;
  s.panel=applyPanelPreset(s.panel,'ja-deepblue-400');
  const weather={time:Date.UTC(2025,5,21,11),ghi:850,dni:800,dhi:100,temp:30,wind:2};
  const perc=generationAt(s,weather,prepareScene(s),false).power;
  const width=panelGeometry(s).modules[1].center.x-panelGeometry(s).modules[0].center.x;
  s.panel=applyPanelPreset(s.panel,'rec-alpha-pure-rx-460');
  const hjt=generationAt(s,weather,prepareScene(s),false).power;
  assert.ok(hjt>perc);
  assert.ok(Math.abs(panelGeometry(s).modules[1].center.x-panelGeometry(s).modules[0].center.x)>Math.abs(width));
});
