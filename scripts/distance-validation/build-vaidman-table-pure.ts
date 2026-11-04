// Vaidman 2025 (/data/papers/index.md#vaidman2025) appendix tables → reference rows. See README.md.

import { ADOPTED_BJ_OLD, ADOPTED_EDSD_NEW, type Adopted, type VaidmanRow } from './vaidman-tsv';

export const EXPECTED_A1_ROWS = 119;
export const EXPECTED_A2_ROWS = 13;

/** Paper name → Gaia DR3 source_id, hand-resolved once via SIMBAD and G-mag-verified against the paper; the
 *  names an obvious lookup gets wrong: /data/distance-validation/README.md#name-resolution--gaia_source_id. */
export const NAME_TO_GAIA_DR3: ReadonlyMap<string, string> = new Map([
  ['HD 1070', '429030231736304256'],
  ['BD+60 51', '430381943846423808'],
  ['HD 2928', '430731073149049984'],
  ['HD 3283', '425588485465026048'],
  ['V755 Cas', '524063839226112896'],
  ['BD+61 153', '427677042161748480'],
  ['HD 4717', '523674058051879168'],
  ['HD 4841', '523812051065920768'],
  ['HD 5776', '522964877353947008'],
  ['HD 7902', '413827353180436736'],
  ['HD 7720', '510955908273310976'],
  ['HD 8065', '565226393465365376'],
  ['BD+62 246', '511080702841800320'],
  ['HD 9233', '509253829917189760'],
  ['HD 9311', '509863199881958656'],
  ['HD 9811', '513064148796472064'],
  ['HD 15316', '458089636866031744'],
  ['HD 62888', '5614636782708944384'],
  ['BD+60 331', '511264424368755584'],
  ['BD+60 333', '511264218211789952'],
  ['BD+60 339', '511264699246655488'],
  ['V819 Cas', '2011857518631414656'],
  ['BD+56 386', '504957934907964672'],
  ['HD 11831', '508011587934161408'],
  ['53 Cas', '518061296009524480'],
  ['V472 Per', '506778691804372736'],
  ['HD 13476', '506810435899344896'],
  ['HD 13744', '458762022584923136'],
  ['HD 14010', '515211533672475264'],
  ['HD 14322', '458241541269642880'],
  ['HD 14433', '458456358355233920'],
  ['V474 Per', '457487413730043904'],
  ['V553 Per', '458414542551436672'],
  ['HD 14542', '458463951857361024'],
  ['HD 14899', '458420177549867392'],
  ['V425 Per', '458075652452721664'],
  ['HD 15620', '458172924869294208'],
  ['HD 16778', '464359258321922816'],
  ['HD 236995', '463988100127727872'],
  ['HD 17088', '460900229100122368'],
  ['HD 17145', '460887893954085632'],
  ['V480 Per', '460787426079902208'],
  ['HD 20041', '448103803535751680'],
  ['CS Cam', '462250738616785152'],
  ['CE Cam', '450113435913489792'],
  ['HD 237153', '449919440829879040'],
  ['BD+55 838', '468502561734102400'],
  ['AZ CMi', '3088730511223509376'],
  ['HD 19978', '555179502886541824'],
  ['BD+43 1168', '205501270150651648'],
  ['19 Aur', '181259753177437568'],
  ['HD 35600', '3446200914143500160'],
  ['HD 248587', '3398822751945120128'],
  ['HD 39970', '3427962936819149824'],
  ['HD 40297', '3431199177497199488'],
  ['HD 40589', '3431191274757139328'],
  ['HD 42400', '3375310795296736512'],
  ['HD 253250', '3345828623650264192'],
  ['9 Gem', '3425577786858742272'],
  ['HD 43910', '3332404106371650944'],
  ['13 Mon', '3324424744330466304'],
  ['HR 2409', '3120595698224445312'],
  ['HD 46783', '3326877514251606528'],
  ['HD 48452', '3351229978819788672'],
  ['MWC 536', '3113547759973829120'],
  ['HD 55036', '3059411758795283968'],
  ['HD 58439', '2930605930106115840'],
  ['HD 59612', '5618683092877834368'],
  ['HR 3183', '5713071321401501568'],
  ['HR 3345', '5706229472852227840'],
  ['HD 164865', '4066118901493794816'],
  ['HD 165784', '4069845455625999872'],
  ['V4387 Sgr', '4094860616496202624'],
  ['HD 167838', '4146137303301073792'],
  ['BD-12 4970', '4153511865229770368'],
  ['AS 314', '4103870014799982464'],
  ['HD 175687', '4085003803955277056'],
  ['HD 332757', '2028274429877194752'],
  ['HT Sge', '4323280515006629760'],
  ['HR 7699', '2058352669922023424'],
  ['42 Cyg', '2056972679739120000'],
  ['55 Cyg', '2166348110749083520'],
  ['HD 199478', '2166846047768767488'],
  ['9 Cep', '2216195157578923136'],
  ['Nu Cep', '2216072562036493440'],
  ['HD 207673', '1960290835599977728'],
  ['13 Cep', '2198963817515042560'],
  ['HD 209900', '2005308689947128448'],
  ['V399 Lac', '2005264640764436736'],
  ['HD 239886', '2198645577619377536'],
  ['HD 239895', '2198759823744627328'],
  ['HD 211971', '2201264820470270848'],
  ['4 Lac', '1999776222304976384'],
  ['HD 239950', '2007789428690846464'],
  ['HD 213470', '2007614640707006976'],
  ['BD+62 2210', '2207517777453003904'],
  ['BD+60 2542', '2015460652598301696'],
  ['BD+61 2472', '2015790162481164416'],
  ['HD 22227', '3274329517095420544'],
  ['6 Cas', '2012942564813958656'],
  ['BD+62 2313', '2016139085631723264'],
  ['HD 223767', '2012765337282245888'],
  ['HD 186745', '2020506380187203200'],
  ['HD 184943', '2021020882948644608'],
  ['HD 161695', '4598003837468318464'],
  ['HD 43820', '3344530894990927744'],
  ['HD 17086', '464823080431243008'],
  ['HD 17857', '467904152529229952'],
  ['HD 216912', '2013193665778362752'],
  ['HD 13717', '456764450470593408'],
  ['HD 28747', '253606381338861056'],
  ['BD+60 2582', '2012432631927515264'],
  ['HD 58131', '2930228866344200448'],
  ['HD 47314', '3131881360451817216'],
  ['HD 58585', '5619599329664097536'],
  ['HD 58764', '5620284256691515648'],
  ['44 Cas', '509717686388338816'],
  ['GQ Cam', '469234114921994112'],
  ['ϵ CMa', '5608832155887268480'],
  ['φ Cas', '413828761929696256'],
  ['σ Cyg', '1965171945678382208'],
  ['HD 10756', '511164815483973888'],
  ['θ Aql', '4224225924761329792'],
  ['5 Per', '506664136434780288'],
  ['HD 55493', '3032377276127115008'],
  ['V455 Cep', '2013448099637948672'],
  ['67 Oph', '4469314179061640320'],
  ['η Leo', '622052899598187392'],
  ['HD 187982', '2026641620708032640'],
  ['θ 2 Tau', '3312744219988782720'],
  ['o Sco', '6050060708908632960'],
  ['χ Aur', '3448691754658000640'],
]);

export type AppendixRow = Omit<VaidmanRow, 'gaiaSourceId'>;

const NUMBER = /^-?\d+(\.\d+)?$/;

/** The trailing 8 tokens are numerics, the leading token is N, and everything between is the (possibly
 *  multi-word) name; null for any other line. */
export function parseAppendixRow(line: string, adopted: Adopted): AppendixRow | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 10 || !/^\d+$/.test(tokens[0])) return null;
  const numerics = tokens.slice(-8);
  if (!numerics.every((t) => NUMBER.test(t))) return null;
  const name = tokens.slice(1, -8).join(' ');
  if (name === '') return null;
  const [dBjPaperPc, sigmaDBjPaperPc, ruwe, gMag, dNewPc, sigmaDNewPc, snrTot, priorScalePc] = numerics.map(Number);
  return { name, dBjPaperPc, sigmaDBjPaperPc, ruwe, gMag, dNewPc, sigmaDNewPc, snrTot, priorScalePc, adopted };
}

const A1_START = 'Table A1.';
const A2_START = 'Table A2.';
const A2_END = 'References';

/** Walks `pdftotext -layout` output: rows after a "Table A1." line are EDSD_new, rows after "Table A2."
 *  up to "References" are BJ_old. A "Table A1. Cont." header keeps the A1 regime. */
export function extractTables(text: string): { a1: AppendixRow[]; a2: AppendixRow[] } {
  const a1: AppendixRow[] = [];
  const a2: AppendixRow[] = [];
  let section: 'a1' | 'a2' | null = null;
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (stripped.startsWith(A2_START)) section = 'a2';
    else if (stripped.startsWith(A1_START)) section = 'a1';
    else if (section === 'a2' && stripped.startsWith(A2_END)) section = null;
    else if (section !== null) {
      const row = parseAppendixRow(line, section === 'a1' ? ADOPTED_EDSD_NEW : ADOPTED_BJ_OLD);
      if (row !== null) (section === 'a1' ? a1 : a2).push(row);
    }
  }
  return { a1, a2 };
}

/** Each row with its source_id, or the names the mapping lacks. */
export function attachGaiaSourceIds(
  rows: readonly AppendixRow[],
  mapping: ReadonlyMap<string, string> = NAME_TO_GAIA_DR3,
): { kind: 'resolved'; rows: VaidmanRow[] } | { kind: 'missing'; names: string[] } {
  const names = rows.filter((r) => !mapping.has(r.name)).map((r) => r.name);
  if (names.length > 0) return { kind: 'missing', names };
  return { kind: 'resolved', rows: rows.map((r) => ({ ...r, gaiaSourceId: mapping.get(r.name)! })) };
}
