/**
 * 梦幻西游藏宝阁 — 倒卖管理后台
 * 数据模型与领域常量
 *
 * 两个核心设计：
 *
 * 1. 角色是「容器型资产」
 *    既能整体转手，又能拆开变现，还能转服换区。
 *    所以角色被建模为「核算单元（批次）」，商品通过 role_id 挂靠到来源角色。
 *
 * 2. 区服是「派生出来的」，不是一个要手工维护的清单
 *    角色和商品上各自记着它在哪个区（纯文本），
 *    区服列表由这些数据自动汇总去重得到 —— 你录一个新区，它就自动出现了。
 */

// ---------------------------------------------------------------- 常量

/** 商品类别。feeType 决定藏宝阁手续费规则 */
export const CATEGORIES = [
  { id: 'equipment',   name: '装备',       feeType: 'item',     icon: '⚔️' },
  { id: 'pet',         name: '召唤兽',     feeType: 'item',     icon: '🐾' },
  { id: 'accessory',   name: '灵饰',       feeType: 'item',     icon: '💍' },
  { id: 'unappraised', name: '未鉴定装备', feeType: 'item',     icon: '❓' },
  { id: 'gem',         name: '宝石/五宝',  feeType: 'item',     icon: '💎' },
  { id: 'yujiang',     name: '玉魄',       feeType: 'item',     icon: '🟢' },
  { id: 'zhonglingshi', name: '钟灵石',    feeType: 'item',     icon: '🔮' },
  { id: 'currency',    name: '梦幻币',     feeType: 'currency', icon: '💰' },
  { id: 'gift',        name: '礼盒礼币',   feeType: 'gift',     icon: '🎁' },
  { id: 'other',       name: '其他',       feeType: 'item',     icon: '📦' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/**
 * 二级分类 —— 只有一级分类在下面列出的才有；非必填，
 * 留空或该类别没有二级分类的显示为「默认」。
 */
export const SUB_CATEGORIES = {
  equipment: ['头盔', '项链', '武器', '衣服', '腰带', '鞋子'],
  accessory: ['佩饰', '手镯', '戒指', '耳饰'],
  yujiang:   ['阴玉', '阳玉'],
};

/** 某一级分类下的二级分类列表（没有则空数组） */
export function subOptionsOf(categoryId) {
  return SUB_CATEGORIES[categoryId] || [];
}

export const SCHOOLS = [
  '大唐官府', '化生寺', '女儿村', '方寸山', '天宫', '龙宫', '五庄观',
  '普陀山', '阴曹地府', '魔王寨', '狮驼岭', '盘丝洞', '神木林', '凌波城',
  '无底洞', '花果山', '女魃墓', '天机城', '东海渊', '九黎城', '无门派',
];

/** 角色状态 */
export const ROLE_STATUS = {
  holding: { id: 'holding', name: '持有中', color: 'info' },
  sold:    { id: 'sold',    name: '已售出', color: 'up' },
};

/** 商品状态 */
export const PRODUCT_STATUS = {
  holding: { id: 'holding', name: '持有中', color: 'info' },
  sold:    { id: 'sold',    name: '已售出', color: 'up' },
};

/** 持有天数预警阈值（天） */
export const AGING_WARN = 60;
export const AGING_DANGER = 120;

/** 区服名留空的兜底显示 */
export const NO_ZONE = '未填写区服';

// ---------------------------------------------------------------- 工具

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 解析日期为本地时间戳（避免 UTC 偏移导致差一天） */
export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

/** 两个日期之间的天数 */
export function daysBetween(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

/** 非法或超出合理范围时回退为 0，避免 NaN 污染全部报表 */
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 保留两位小数（金融场景统一走这个） */
export function round2(n) {
  return Math.round((num(n) + Number.EPSILON) * 100) / 100;
}

/** 区服名归一：去空白，空值统一成 NO_ZONE */
export function normalizeZone(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  return s || NO_ZONE;
}

/** 去掉核算引擎附加上去的临时字段（下划线开头），只留要落库的原始字段 */
export function plain(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    if (!k.startsWith('_')) out[k] = obj[k];
  });
  return out;
}

/**
 * 从角色 / 商品里汇总出所有出现过的区服名（含转服后的成交区）。
 * 这就是「区服自动更新」的实现：数据里有，列表里就有。
 */
export function collectZoneNames(roles = [], products = [], chars = []) {
  const set = new Set();
  // 买入区 / 所在区：留空也算一个「未填写区服」分组，免得这些记录凭空消失
  roles.forEach((r) => {
    set.add(normalizeZone(r.zone));
    const sz = String(r.sold_zone || '').trim();
    if (sz) set.add(sz);          // 成交区只在真的转服过时才有值
  });
  products.forEach((p) => {
    set.add(normalizeZone(p.zone));
    const sz = String(p.sold_zone || '').trim();
    if (sz) set.add(sz);
  });
  chars.forEach((c) => set.add(normalizeZone(c.zone)));
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
}

// ---------------------------------------------------------------- 工厂

export function newRole(patch = {}) {
  return {
    id: uid(),
    zone: '',              // 买入时所在区服（纯文本）
    name: '',
    level: null,
    school: '',
    purchase_price: 0,
    purchase_date: todayStr(),
    transfer_fee: 0,       // 转服费
    other_cost: 0,
    status: 'holding',
    is_shell: false,       // 是否已拆成空壳号
    listed: false,
    listed_price: 0,
    est_value: null,
    sale_price: 0,
    sale_net: null,
    sale_date: '',
    sold_zone: '',         // 成交时所在区服（转服后与 zone 不同）
    note: '',
    created_at: new Date().toISOString(),
    ...patch,
  };
}

export function newProduct(patch = {}) {
  return {
    id: uid(),
    zone: '',
    name: '',
    category: 'equipment',
    sub_category: '',      // 二级分类，非必填；空显示为「默认」
    from_asset: false,     // 固定资产流出 —— 自己号里的东西拿出来卖，不是新买入
    role_id: null,         // 指向母角色 = 拆号出来的；null = 独立采购
    purchase_price: 0,
    purchase_date: todayStr(),
    allocated_cost: null,  // 手工指定分摊成本
    est_value: null,       // 手工估算市值
    status: 'holding',
    listed: false,
    listed_price: 0,
    sale_price: 0,
    sale_net: null,
    sale_date: '',
    sold_zone: '',
    note: '',
    created_at: new Date().toISOString(),
    ...patch,
  };
}

/**
 * 自玩号 —— 固定资产的「容器」。
 * 号本身也是资产：买来的号记购入价，自己练起来的填 0。
 */
export function newChar(patch = {}) {
  return {
    id: uid(),
    zone: '',
    name: '',
    purchase_price: 0,
    purchase_date: todayStr(),
    note: '',
    created_at: new Date().toISOString(),
    ...patch,
  };
}

/**
 * 固定资产 —— 自己常玩的号里，陆续买入的东西。
 * 挂 char_id 指向所属号；不挂 = 未归号。
 * 这一块完全独立于倒卖核算：不计入投入/回款/盈亏，只归集「购入总成本」，
 * 回答"我这个号往里砸了多少钱"。
 */
export function newAsset(patch = {}) {
  return {
    id: uid(),
    char_id: null,
    name: '',
    category: 'equipment',
    sub_category: '',      // 二级分类，非必填；空显示为「默认」
    cost: 0,
    purchase_date: todayStr(),
    cross_server: false,   // 跨服购买的物品有 180 天时间锁
    note: '',
    created_at: new Date().toISOString(),
    ...patch,
  };
}

/** 跨服购买物品的时间锁时长（天） */
export const ASSET_LOCK_DAYS = 180;

/**
 * 固定资产的时间锁信息。
 * 解锁日 = 购入日期 + 180 天；没填购入日期的算不出确切日期，daysLeft 为 null。
 */
export function assetLockInfo(asset) {
  if (!asset || !asset.cross_server) return null;
  const d = String(asset.purchase_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return { hasLock: true, unlockDate: null, daysLeft: null, unlocked: false };
  }
  const unlockTs = parseDate(d) + ASSET_LOCK_DAYS * 86400000;
  const u = new Date(unlockTs);
  const p = (n) => String(n).padStart(2, '0');
  const unlockDate = `${u.getFullYear()}-${p(u.getMonth() + 1)}-${p(u.getDate())}`;
  const diff = daysBetween(todayStr(), unlockDate);
  return { hasLock: true, unlockDate, daysLeft: Math.max(0, diff), unlocked: diff <= 0 };
}

/** 一组演示数据，方便首次打开时直观看到后台长什么样 */
export function demoData() {
  const Z1 = '华南一区·缘定三生';
  const Z2 = '华东二区·月光宝盒';
  const Z3 = '华北三区·雷霆万钧';

  const d = (n) => {
    const t = new Date(Date.now() - n * 86400000);
    const p = (x) => String(x).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  };

  const r1 = newRole({
    zone: Z1, name: '剑影流光', level: 175, school: '大唐官府',
    purchase_price: 8600, purchase_date: d(52), status: 'holding',
    is_shell: true, listed: true, listed_price: 3200,
    note: '拆号：装备召唤兽已单独上架，空壳号挂 3200 待售',
  });
  const r2 = newRole({
    zone: Z2, name: '雨落青衫', level: 159, school: '龙宫',
    purchase_price: 5200, purchase_date: d(18), status: 'holding',
    listed: true, listed_price: 6400,
  });
  const r3 = newRole({
    zone: Z3, name: '风起长林', level: 175, school: '狮驼岭',
    purchase_price: 12800, purchase_date: d(96),
    transfer_fee: 300, status: 'sold',
    sale_price: 15200, sale_date: d(11), sold_zone: Z1,
    note: '从华北三区转服到华南一区后加价卖出',
  });
  const r4 = newRole({
    zone: Z1, name: '小号·灵犀', level: 109, school: '化生寺',
    purchase_price: 1200, purchase_date: d(7), status: 'holding',
  });

  const p1 = newProduct({ sub_category: '武器',
    zone: Z1, name: '130无级别·帽子', category: 'equipment',
    role_id: r1.id, purchase_price: 0, purchase_date: d(50),
    status: 'sold', sale_price: 4200, sale_date: d(30),
    note: '拆自 剑影流光',
  });
  const p2 = newProduct({
    zone: Z1, name: '7技能须弥·天兵', category: 'pet',
    role_id: r1.id, purchase_price: 0, purchase_date: d(50),
    status: 'sold', sale_price: 2600, sale_date: d(21),
  });
  const p3 = newProduct({ sub_category: '戒指',
    zone: Z1, name: '130简易·腰带', category: 'equipment',
    role_id: r1.id, purchase_price: 0, purchase_date: d(50),
    status: 'holding', listed: true, listed_price: 1500,
  });
  const p4 = newProduct({
    zone: Z2, name: '9级太阳石×10', category: 'gem',
    purchase_price: 1800, purchase_date: d(40),
    status: 'sold', sale_price: 2350, sale_date: d(9),
  });
  const p5 = newProduct({
    zone: Z2, name: '1500万梦幻币', category: 'currency',
    purchase_price: 900, purchase_date: d(25),
    status: 'holding',
  });
  const p6 = newProduct({
    zone: Z3, name: '140灵饰·龙鳞', category: 'accessory',
    purchase_price: 3200, purchase_date: d(140),
    status: 'holding', listed: true, listed_price: 3050,
    note: '挂了两个月没动，考虑降价',
  });
  const p7 = newProduct({
    zone: Z1, name: '自用·140灵饰·戒指', category: 'accessory', sub_category: '戒指',
    from_asset: true, purchase_price: 2800, purchase_date: '',
    status: 'holding',
  });

  const c1 = newChar({
    zone: Z1, name: '主力号·灵犀居士', purchase_price: 3000,
    purchase_date: d(400), note: '常玩的大号，里面的东西都不卖',
  });

  const a1 = newAsset({
    char_id: c1.id, name: '160无级别·剑', category: 'equipment', sub_category: '武器', cost: 12000,
    purchase_date: d(300), note: '主力号的兵器，自己用不卖',
  });
  const a2 = newAsset({
    char_id: c1.id, name: '8技能须弥·童子', category: 'pet', cost: 4500, purchase_date: d(200),
  });
  const a5 = newAsset({
    char_id: c1.id, name: '150无级别·女衣', category: 'equipment', cost: 9800,
    purchase_date: d(30), cross_server: true, note: '藏宝阁跨服买的，还锁着',
  });
  const a3 = newAsset({
    char_id: c1.id, name: '140灵饰·戒指', category: 'accessory', cost: 2800, purchase_date: d(150),
  });
  const a4 = newAsset({
    char_id: c1.id, name: '锦衣·云鹤', category: 'other', cost: 688, purchase_date: d(90),
    note: '好看就行，别问值不值',
  });

  return {
    roles: [r1, r2, r3, r4],
    products: [p1, p2, p3, p4, p5, p6, p7],
    chars: [c1],
    assets: [a1, a2, a3, a4, a5],
  };
}
