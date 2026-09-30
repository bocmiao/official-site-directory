import { loadCategories, loadSites, validate } from './lib/data.js';

const categories = loadCategories();
const sites = loadSites();
const errors = validate(categories, sites);

if (errors.length) {
  console.error(`数据校验失败，共 ${errors.length} 个问题：\n`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`✓ 数据校验通过：${categories.length} 个分类，${sites.length} 条记录（含待审核候选）`);
