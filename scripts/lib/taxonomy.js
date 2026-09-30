// Discovery labels are editorial rules, never evidence of official identity.
export const TOPICS = [
  ['dev', 'software', '开发与编程', /开发|编程|编辑器|版本控制|\b(ide|code editor|text editor|developer|development|programming|debugger|database client|sql|terminal|git client|api client|command-line)\b/i],
  ['browser', 'software', '浏览与搜索', /浏览器|\b(browser|web search|search engine)\b/i],
  ['security', 'software', '隐私与安全', /密码|安全|\b(password|encrypt|firewall|antivirus|privacy|vpn|security)\b/i],
  ['design', 'software', '设计与创作', /设计|绘图|\b(design|drawing|illustration|animation|3d model|cad|photo editor|image editor)\b/i],
  ['media', 'software', '影音与媒体', /影音|音乐|视频|\b(audio|video|music|media player|podcast|streaming|screen record)\b/i],
  ['office', 'software', '办公与效率', /办公|笔记|\b(productivity|notes|note-taking|calendar|task manager|spreadsheet|document|clipboard|pdf|office)\b/i],
  ['communication', 'software', '沟通与协作', /聊天|沟通|\b(messaging|chat|email|mail client|collaboration|meeting)\b/i],
  ['games', 'software', '游戏与娱乐', /游戏|\b(game|gaming|emulator)\b/i],
  ['utility', 'software', '系统与工具', /系统|工具|压缩|\b(utility|system|window manager|file manager|backup|disk|monitor|uninstaller|launcher|file transfer|archive manager)\b/i],
  ['software-other', 'software', '其他软件', null],
  ['vocational', 'education', '职业与技术教育', /职业|高职|技师|\b(vocational|polytechnic|technical college|community college)\b/i],
  ['university', 'education', '大学与学院', /大学|学院|大学校|\b(university|universities|college|universit[yaée]|universidade|universidad|universität|università|hochschule)\b/i],
  ['school', 'education', '学校与教育机构', /学校|中学|小学|\b(school|lycée|ecole|école)\b/i],
  ['research', 'education', '研究与专业机构', /研究|实验室|\b(research|laboratory|institute|institut|academy|academia)\b/i],
  ['education-other', 'education', '其他教育资源', null],
].map(([id, category, name, pattern]) => ({ id, category, name, pattern }));

const subjects = [
  ['医药与健康', /医科|医学|医药|护理|\b(medical|medicine|pharmacy|nursing|health sciences)\b/i],
  ['工程与技术', /理工|工程|工业|科技|\b(engineering|technology|technological)\b/i],
  ['艺术与设计', /艺术|美术|音乐|设计|\b(arts|art and design|music|conservatory)\b/i],
  ['财经与管理', /财经|金融|商学|经济|\b(business|economics|commerce|management)\b/i],
  ['师范与教育', /师范|\b(teacher|teachers|pedagogical|normal university)\b/i],
  ['农业与环境', /农业|农林|林业|\b(agricultural|agriculture|forestry|environmental)\b/i],
];

export function classify(site) {
  const topicText = [site.name, ...(site.aliases || []), ...(site.category === 'software' ? [site.description, ...(site.tags || [])] : [])].join(' ');
  const candidates = TOPICS.filter((t) => t.category === site.category);
  const editorialTopic = ({ nodejs: 'dev', git: 'dev', vscode: 'dev', python: 'dev', '7zip': 'utility' })[site.id];
  const matches = candidates.filter((t) => t.id === editorialTopic || t.pattern?.test(topicText));
  const topic = matches[0] || candidates.find((t) => !t.pattern);
  const tags = [...(site.tags || []), ...matches.map((t) => t.name)];
  if (!candidates.length) tags.push(({ gov: '政务服务', finance: '银行金融', telecom: '生活服务', travel: '出行交通', shopping: '购物电商', social: '社交与内容', devices: '数码品牌' })[site.category] || site.category);
  if (site.category === 'education') for (const [label, pattern] of subjects) if (pattern.test(topicText)) tags.push(label);
  if (topic && !matches.length) tags.push(topic.name);
  return { ...site, subcategory: topic?.id || site.category, tags: [...new Set(tags)].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    classification: 'rules-v1' };
}

export const topicName = (id, categories = []) => TOPICS.find((t) => t.id === id)?.name || categories.find((c) => c.id === id)?.name || id;
