export const displayName = (site) => site.localization?.name_zh || site.name;
export const LOCALIZATION_LABELS = { source: '来源中文名', existing: '已有中文名', wikidata: '维基数据中文名', editorial: '参考译名', machine: '机器译名，待校对', retained: '专名保留原文' };
const regions = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

export function displayDescription(site) {
  if (!site.category.startsWith('institutions-')) return site.description;
  const region = site.region && site.region !== 'GLOBAL' ? regions.of(site.region) : '未注明所在地';
  const source = site.source.id === 'ror' ? '全球研究机构注册目录（ROR）' : 'Hipo 高校目录';
  return `${region}的教育机构目录记录，来源：${source}。官网归属与机构资质待核对。`;
}

export function validateLocalization(value, site) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['original_name', 'name_zh', 'method', 'source_record', 'input', 'review_note', 'wikidata_id', 'wikidata_revision'];
  return Object.keys(value).every((k) => keys.includes(k)) && value.original_name === site.name &&
    value.source_record === site.source?.record && Object.hasOwn(LOCALIZATION_LABELS, value.method) &&
    typeof value.name_zh === 'string' && value.name_zh.trim().length > 0 && value.name_zh.length <= 300 &&
    !/[\u0000-\u001f\u007f]/.test(value.name_zh) &&
    (value.method === 'retained' || /[\u3400-\u9fff]/.test(value.name_zh)) &&
    (value.method !== 'wikidata' || (/^Q[1-9]\d*$/.test(value.wikidata_id || '') && Number.isSafeInteger(value.wikidata_revision) && value.wikidata_revision > 0)) &&
    (value.input == null || typeof value.input === 'string') && (value.review_note == null || typeof value.review_note === 'string');
}
