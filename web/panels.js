// Representative residential modules. Not a sales ranking or a compatibility list.
// STC front-side power, dimensions and Pmax temperature coefficient only.
// Specifications checked against the linked manufacturer datasheets on 2026-10-29.
export const PANEL_SPEC_FIELDS = Object.freeze(['watts','width','length','tempCoefficient']);
export const PANEL_PRESETS = Object.freeze([
  {
    id:'trina-vertex-s-plus-450', label:'Trina Vertex S+ · 450 W',
    model:'TSM-450NEG9R.28', technology:'N-type TOPCon · dual glass',
    watts:450, width:1.134, length:1.762, tempCoefficient:-0.29,
    source:'https://vertexsplus.trinasolar.com/wp-content/uploads/2024/09/240831_Datasheet_Vertex-S_NEG9R.28_EN_2024_C_web.pdf'
  },
  {
    id:'jinko-tiger-neo-440', label:'Jinko Tiger Neo · 440 W',
    model:'JKM440N-54HL4R-V', technology:'N-type TOPCon',
    watts:440, width:1.134, length:1.762, tempCoefficient:-0.29,
    source:'https://jinkosolar.eu/wp-content/uploads/JKM425-445N-54HL4R-V-F1.3C1-EN-BF-EU.pdf'
  },
  {
    id:'ja-deepblue-400', label:'JA Solar DeepBlue 3.0 · 400 W',
    model:'JAM54S31-400/MR', technology:'Monocrystalline PERC',
    watts:400, width:1.134, length:1.722, tempCoefficient:-0.35,
    source:'https://www.jasolar.com/uploadfile/fujian/2024/0430/d3593488314c690.pdf'
  },
  {
    id:'longi-hi-mo-x6-440', label:'LONGi Hi-MO X6 · 440 W',
    model:'LR5-54HTH-440M', technology:'Back contact · HPBC',
    watts:440, width:1.134, length:1.722, tempCoefficient:-0.29,
    source:'https://static.longi.com/L_Gi_LE_PM_T_PMD_059_F130_LR_5_54_HTH_420_440_M_30_30_and_15_Frame_Explorer_V19_4448f2931d.pdf'
  },
  {
    id:'rec-alpha-pure-rx-460', label:'REC Alpha Pure-RX · 460 W',
    model:'REC460AA Pure-RX', technology:'Heterojunction · HJT',
    watts:460, width:1.205, length:1.728, tempCoefficient:-0.24,
    source:'https://www.recgroup.com/sites/default/files/2025-01/Web_DS_REC%20Alpha%20Pure-RX_EN%20US.pdf'
  },
  {
    id:'canadian-tophiku6-450', label:'Canadian Solar TOPHiKu6 · 450 W',
    model:'CS6.2-48TM-450H', technology:'N-type TOPCon · all black',
    watts:450, width:1.134, length:1.762, tempCoefficient:-0.29,
    source:'https://www.canadiansolar.com/wp-content/uploads/sites/3/2026/01/CS-Datasheet-TOPHiKu6_All-Black_CS6.2-48TM-H_v1.0C25_F23_D1_NA-1.pdf'
  }
].map(p=>Object.freeze(p)));

export function applyPanelPreset(panel,id){
  if(id==='custom')return {...panel,preset:'custom'};
  const preset=PANEL_PRESETS.find(p=>p.id===id);
  if(!preset)throw new Error('Unknown panel preset.');
  return {...panel,preset:id,...Object.fromEntries(PANEL_SPEC_FIELDS.map(key=>[key,preset[key]]))};
}

// Old project files retain their exact numeric values. Imported or edited specs
// must never keep a manufacturer's name when their specifications differ.
export function normalizePanelPreset(panel){
  const preset=PANEL_PRESETS.find(p=>p.id===panel.preset);
  const matches=preset&&PANEL_SPEC_FIELDS.every(key=>Number.isFinite(panel[key])&&Math.abs(panel[key]-preset[key])<1e-9);
  return {...panel,preset:matches?preset.id:'custom'};
}
