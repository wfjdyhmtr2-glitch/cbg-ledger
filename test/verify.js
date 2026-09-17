/**
 * 自测脚本：node test/verify.js
 *
 * 重点验证三件事：
 *   1. 藏宝阁手续费算得和官方一致（含保底/封顶/进位到分）
 *   2. 角色项目的账目恒等式成立（投入、回款、在手、盈亏能对上）
 *   3. 成本分摊守恒（各商品分摊额 + 空壳残值 = 角色总成本）
 *      并且两种核算视角算出的总盈亏一致
 */

import { calcFee, netFromGross, grossFromNet } from '../src/core/fee.js';
import { computeAll, computeRole, allocateRoleCost } from '../src/core/compute.js';
import { demoData, round2 } from '../src/core/model.js';

let pass = 0;
let fail = 0;

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}

function eq(actual, expected, tol = 0.005) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`期望 ${expected}，实际 ${actual}（差 ${(actual - expected).toFixed(4)}）`);
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function group(title) {
  console.log(`\n${title}`);
}

// ============================================================ 手续费

group('一、藏宝阁手续费');

t('角色 官方示例：1200.3 元 → 信息费 60.02，到手 1140.28', () => {
  eq(calcFee('role', 1200.3), 60.02);
  eq(netFromGross('role', 1200.3), 1140.28);
});

t('角色 有 60 元保底：卖 100 元也要扣 60', () => {
  eq(calcFee('role', 100), 60);
  eq(netFromGross('role', 100), 40);
});

t('角色 有 1000 元封顶：卖 10 万只扣 1000', () => {
  eq(calcFee('role', 100000), 1000);
  eq(calcFee('role', 25000), 1000);
});

t('角色 封顶临界点：20000 元时恰好 1000', () => {
  eq(calcFee('role', 20000), 1000);
  eq(calcFee('role', 19999), 999.95);
});

t('道具 官方示例：100.3 元 → 信息费 5.02，到手 95.28', () => {
  eq(calcFee('equipment', 100.3), 5.02);
  eq(netFromGross('equipment', 100.3), 95.28);
});

t('各品类基础费率', () => {
  eq(calcFee('equipment', 1000), 50);      // 装备 5%
  eq(calcFee('pet', 1000), 50);            // 召唤兽 5%
  eq(calcFee('accessory', 1000), 50);      // 灵饰 5%
  eq(calcFee('gem', 1000), 50);            // 宝石 5%
  eq(calcFee('currency', 1000), 50);       // 梦幻币 5%
  eq(calcFee('gift', 1000), 100);          // 礼盒礼币 10%
});

t('道具封顶 1000，梦幻币不封顶', () => {
  eq(calcFee('equipment', 100000), 1000);
  eq(calcFee('currency', 100000), 5000);
  eq(calcFee('gift', 100000), 10000);
});

t('整数金额不打多余的进位（5.01 不该变成 5.02）', () => {
  eq(calcFee('equipment', 100.2), 5.01);
  eq(calcFee('equipment', 1000.2), 50.01);
});

t('零/负数不产生手续费', () => {
  eq(calcFee('role', 0), 0);
  eq(calcFee('equipment', -50), 0);
});

t('反推挂牌价：想净到手 1140.28，需要挂 1200.30', () => {
  eq(grossFromNet('role', 1140.28), 1200.3, 0.02);
});

// ============================================================ 核算恒等式

group('二、角色项目核算');

const zone = { id: 'z1', name: '测试区' };

function mkRole(patch = {}) {
  return {
    id: 'r1', zone: '测试区', name: '测试角色', level: 175, school: '大唐官府',
    purchase_price: 8600, purchase_date: '2026-01-01',
    transfer_fee: 0, other_cost: 0,
    status: 'holding', is_shell: false, listed: false, listed_price: 0,
    est_value: null, sale_price: 0, sale_net: null, sale_date: '', sold_zone: '',
    note: '', created_at: '2026-01-01T00:00:00Z', ...patch,
  };
}
function mkProduct(patch = {}) {
  return {
    id: 'p1', zone: '测试区', name: '商品', category: 'equipment', role_id: null,
    purchase_price: 0, purchase_date: '2026-01-01', allocated_cost: null, est_value: null,
    status: 'holding', listed: false, listed_price: 0, sale_price: 0, sale_net: null,
    sale_date: '', sold_zone: '', note: '', created_at: '2026-01-01T00:00:00Z', ...patch,
  };
}

const role1 = mkRole();
const itemA = mkProduct({
  id: 'pA', name: '130无级别帽子', role_id: 'r1',
  status: 'sold', sale_price: 4200, sale_date: '2026-02-01',
});
const itemB = mkProduct({
  id: 'pB', name: '7技能须弥', category: 'pet', role_id: 'r1',
  status: 'holding', listed: true, listed_price: 1500,
});
const state1 = { roles: [role1], products: [itemA, itemB] };
const today = '2026-03-01';

t('已售商品按规则扣费后计入回款', () => {
  const r = computeRole(role1, [itemA, itemB], { today });
  // 4200 - 5% = 3990
  eq(r._childNet, 3990);
  eq(r._recovered, 3990);
});

t('在手商品按挂牌价毛值估值（不再扣税、不再手工估算）', () => {
  const r = computeRole(role1, [itemA, itemB], { today });
  eq(r._childOnHand, 1500);   // = 挂牌价本身
});

t('总投入只算角色一次，拆出商品不重复计入', () => {
  const s = computeAll(state1, { today });
  eq(s.totals.invest, 8600);
  eq(s.totals.roleInvest, 8600);
  eq(s.totals.standaloneInvest, 0);
});

t('恒等式：总盈亏 = 已回款 + 在手 − 总投入', () => {
  const s = computeAll(state1, { today });
  eq(s.totals.totalProfit, round2(s.totals.recovered + s.totals.onHand - s.totals.invest));
});

t('成本分摊守恒：各商品分摊额 + 空壳残值 = 角色总成本', () => {
  const alloc = allocateRoleCost(role1, [itemA, itemB]);
  const sum = Object.values(alloc.map).reduce((a, b) => a + b, 0) + alloc.shellCost;
  eq(sum, 8600, 0.02);
});

t('两种视角算出的总盈亏一致', () => {
  const proj = computeAll(state1, { today, view: 'project' });
  const unit = computeAll(state1, { today, view: 'unit' });
  eq(proj.totals.totalProfit, unit.totals.totalProfit, 0.02);
});

t('项目视角下拆出商品不背成本；单品视角下会分到成本', () => {
  const proj = computeAll(state1, { today, view: 'project' });
  const unit = computeAll(state1, { today, view: 'unit' });
  const pa = proj.productRows.find((p) => p.id === 'pA');
  const ua = unit.productRows.find((p) => p.id === 'pA');
  eq(pa._cost, 0);
  ok(ua._unitCost > 0 && ua._unitCost < 8600, '单品视角应分到正的分摊成本');
  eq(ua._cost, ua._unitCost);
});

t('持有天数：未售算到今天，已售算到成交日', () => {
  const r = computeRole(role1, [itemA, itemB], { today });
  eq(r._days, 59);              // 01-01 → 03-01
  const pa = r._children.find((c) => c.id === 'pA');
  eq(pa._days, 31);             // 01-01 → 02-01
  const pb = r._children.find((c) => c.id === 'pB');
  eq(pb._days, 59);
});

// ---------------------------------------------------------- 空壳号场景

group('三、拆号 + 空壳号卖出（角色转手这条链）');

const role2 = mkRole({ id: 'r2', name: '拆号角色', is_shell: true });
const itemC = mkProduct({
  id: 'pC', name: '拆出装备', role_id: 'r2',
  status: 'sold', sale_price: 5000, sale_date: '2026-02-10',
});

t('空壳号还没卖、也没估值时：残值按 0 计（保守，避免虚增盈亏）', () => {
  const s = computeAll({ roles: [role2], products: [itemC] }, { today });
  eq(s.totals.recovered, 4750);                      // 5000 - 250
  eq(s.totals.onHand, 0);                            // 空壳没估值 → 0
  eq(s.totals.totalProfit, round2(4750 - 8600));     // 宁可显示还没回本
  ok(s.unvaluedShells.length === 1, '应该把它列进「空壳待估值」提醒');
});

t('空壳号挂了价后，盈亏立刻变准（估值 = 挂牌价）', () => {
  const valuedShell = { ...role2, listed_price: 3000, listed: true };
  const s = computeAll({ roles: [valuedShell], products: [itemC] }, { today });
  eq(s.totals.onHand, 3000);
  eq(s.totals.totalProfit, round2(4750 + 3000 - 8600));
  ok(!s.unvaluedShells.length, '挂过价就不该再提醒');
});

t('空壳号卖掉之后，整票账目闭合', () => {
  const shellSold = { ...role2, status: 'sold', sale_price: 3200, sale_date: '2026-02-20', is_shell: true };
  const s = computeAll({ roles: [shellSold], products: [itemC] }, { today });
  eq(s.totals.recovered, round2(4750 + (3200 - 160)));   // 空壳 3200 - 5% = 3040
  eq(s.totals.onHand, 0);
  eq(s.totals.totalProfit, round2(s.totals.recovered - 8600));
  eq(s.totals.realizedProfit, s.totals.totalProfit, 0.02); // 全卖完了，已实现 = 总盈亏
});

// ---------------------------------------------------------- 跨区转卖

group('四、跨区转卖');

t('整票归买入区：全站只算一次，卖出区只做标注', () => {
  const moved = mkRole({
    id: 'r3', zone: '测试区', sold_zone: '卖出区',
    status: 'sold', sale_price: 15200, sale_date: '2026-02-15', transfer_fee: 300,
  });
  const s = computeAll({ roles: [moved], products: [] }, { today });
  const buyZone = s.zoneRows.find((z) => z.name === '测试区');
  const sellZone = s.zoneRows.find((z) => z.name === '卖出区');

  eq(buyZone.invest, 8900);           // 8600 + 300 转服费记在买入区
  eq(buyZone.recovered, 14440);       // 15200 - 760，成交也归买入区（一票一笔账）
  eq(sellZone.recovered, 0);          // 不在卖出区重复计一遍
  eq(sellZone.transferredIn, 14440);  // 但会标注「从别区转来卖掉的」
  eq(buyZone.transferredOut, 14440);
  eq(s.totals.recovered, 14440);      // 全站口径不重复
});

// ---------------------------------------------------------- 独立商品

group('五、独立采购商品');

t('独立商品自己背成本，单独算盈亏', () => {
  const p = mkProduct({
    id: 'pX', name: '独立买的宝石', category: 'gem', role_id: null,
    purchase_price: 1800, purchase_date: '2026-01-10',
    status: 'sold', sale_price: 2350, sale_date: '2026-02-08',
  });
  const s = computeAll({ roles: [], products: [p] }, { today });
  eq(s.totals.invest, 1800);
  eq(s.totals.recovered, round2(2350 - 2350 * 0.05));  // 2232.5
  eq(s.totals.totalProfit, round2(2232.5 - 1800));
  eq(s.totals.onHand, 0);
  eq(s.totals.realizedProfit, s.totals.totalProfit, 0.02);
});

t('独立商品和角色混在一起时，投入不重不漏', () => {
  const p = mkProduct({
    id: 'pY', name: '独立的货', category: 'gem', role_id: null,
    purchase_price: 1800, purchase_date: '2026-01-10',
  });
  const s = computeAll({ roles: [role1], products: [itemA, itemB, p] }, { today });
  eq(s.totals.invest, 8600 + 1800);
});

// ---------------------------------------------------------- 手工覆盖

group('六、手工覆盖自动计算');

t('手填「实际到手」时，以手填为准（覆盖规则计算）', () => {
  const p = mkProduct({
    id: 'pZ', name: '有出入的货', category: 'equipment', role_id: null,
    purchase_price: 1000, purchase_date: '2026-01-01',
    status: 'sold', sale_price: 2000, sale_net: 1850, sale_date: '2026-02-01',
  });
  const s = computeAll({ roles: [], products: [p] }, { today });
  eq(s.totals.recovered, 1850);      // 而不是 1900
  eq(s.totals.realizedProfit, 850);
});

t('未挂牌的资产按成本计（无估算市值概念）', () => {
  const p = mkProduct({
    id: 'pE', name: '未挂牌', category: 'equipment', role_id: null,
    purchase_price: 1000, purchase_date: '2026-01-01',
    status: 'holding', listed: false, listed_price: 0,
  });
  const s = computeAll({ roles: [], products: [p] }, { today });
  eq(s.totals.onHand, 1000);         // = 成本
  eq(s.totals.estTotal, 0);          // 没挂牌，不计入总预估市值
});

t('总预估市值 = 在手资产挂牌价合计', () => {
  const a = mkProduct({
    id: 'pE1', name: '挂着', category: 'equipment', role_id: null,
    purchase_price: 1000, purchase_date: '2026-01-01',
    status: 'holding', listed: true, listed_price: 5000,
  });
  const b = mkProduct({
    id: 'pE2', name: '没挂', category: 'equipment', role_id: null,
    purchase_price: 800, purchase_date: '2026-01-01',
    status: 'holding', listed: false, listed_price: 0,
  });
  const s = computeAll({ roles: [], products: [a, b] }, { today });
  eq(s.totals.estTotal, 5000);       // 只算挂牌的
  eq(s.totals.onHand, 5800);         // 挂牌的按挂牌价 + 没挂的按成本
});

t('手工指定分摊成本会被尊重，且不破坏守恒以外的账目', () => {
  const r = mkRole({ id: 'r9', name: '手工分摊' });
  const a = mkProduct({ id: 'pM1', role_id: 'r9', allocated_cost: 5000, status: 'holding', listed: true, listed_price: 3000 });
  const b = mkProduct({ id: 'pM2', role_id: 'r9', status: 'holding', listed: true, listed_price: 3000 });
  const alloc = allocateRoleCost(r, [a, b]);
  eq(alloc.map.pM1, 5000);
  ok(alloc.map.pM2 > 0, '未手工指定的商品仍按权重分摊');
});

// ---------------------------------------------------------- 汇总一致性

group('七、汇总口径自洽（用演示数据）');

t('演示数据：各分项加总等于总额', () => {
  const s = computeAll(demoData());
  const t0 = s.totals;

  eq(t0.invest, round2(t0.roleInvest + t0.standaloneInvest));
  eq(t0.recovered, round2(t0.roleRecovered + t0.productRecovered));
  eq(t0.onHand, round2(t0.roleOnHand + t0.productOnHand));
  eq(t0.totalProfit, round2(t0.recovered + t0.onHand - t0.invest));
  eq(t0.soldCost + t0.unsoldCost, t0.invest, 0.02);
  eq(t0.realizedProfit + t0.unrealizedProfit, t0.totalProfit, 0.02);
});

t('演示数据：区服分项加总等于全站总额', () => {
  const s = computeAll(demoData());
  const sum = (f) => round2(s.zoneRows.reduce((a, z) => a + f(z), 0));
  eq(sum((z) => z.invest), s.totals.invest, 0.02);
  eq(sum((z) => z.recovered), s.totals.recovered, 0.02);
  eq(sum((z) => z.onHand), s.totals.onHand, 0.02);
});

t('演示数据：账龄分桶覆盖全部在手资产', () => {
  const s = computeAll(demoData());
  const count = s.buckets.reduce((a, b) => a + b.count, 0);
  const amount = round2(s.buckets.reduce((a, b) => a + b.amount, 0));
  eq(count, s.holdingItems.length);
  eq(amount, s.totals.onHand, 0.02);
});

t('演示数据：两种视角总盈亏一致', () => {
  const a = computeAll(demoData(), { view: 'project' });
  const b = computeAll(demoData(), { view: 'unit' });
  eq(a.totals.totalProfit, b.totals.totalProfit, 0.02);
});

t('金额字段不会出现 NaN', () => {
  const s = computeAll(demoData());
  Object.entries(s.totals).forEach(([k, v]) => {
    ok(Number.isFinite(v), `totals.${k} 不是有效数字：${v}`);
  });
});

// ============================================================

console.log(`\n${'─'.repeat(52)}`);
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log(`${'─'.repeat(52)}\n`);

process.exit(fail ? 1 : 0);
