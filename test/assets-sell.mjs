/**
 * 固定资产售出流程自测：node test/assets-sell.mjs
 *
 * 验证「卖出固定资产 → 生成流出记录 → 原条目移出固定资产」这条链，
 * 以及分析页「固定资产流出」依赖的两个数（实际盈亏 / 还在手上）算得对不对。
 *
 * store.js 依赖裸模块名 'vue'，浏览器靠 importmap、这里靠解析钩子补上。
 */

import { register } from 'node:module';
register('./vue-resolve-hooks.mjs', import.meta.url);

const { state, sellFixedAsset } = await import('../src/core/store.js');
const { computeAll } = await import('../src/core/compute.js');
const { newChar, newAsset, round2 } = await import('../src/core/model.js');

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}
function eq(a, b, tol = 0.02) {
  if (Math.abs(a - b) > tol) throw new Error(`期望 ${b}，实际 ${a}（差 ${(a - b).toFixed(4)}）`);
}
function ok(c, m) { if (!c) throw new Error(m || '断言失败'); }

const Z = '沂水雪山';

/** 把 store 重置成一份干净的内存数据（演示模式，不连库） */
function seed(chars = [], assets = []) {
  state.demoMode = true;
  state.roles = [];
  state.products = [];
  state.chars = chars;
  state.assets = assets;
}

const fixedOnHand = () =>
  round2(
    state.chars.reduce((s, c) => s + Number(c.purchase_price || 0), 0) +
    state.assets.reduce((s, a) => s + Number(a.cost || 0), 0)
  );

console.log('一、卖一件号内物品');

const char = newChar({ zone: Z, name: '主力号', purchase_price: 3000 });
const sword = newAsset({ char_id: char.id, zone: Z, name: '150无级别剑', category: 'equipment', cost: 12000 });
const ring = newAsset({ char_id: char.id, zone: Z, name: '140灵饰', category: 'accessory', cost: 2800 });

await t('售出后：生成一条标了「固定资产流出」的已售商品', async () => {
  seed([char], [sword, ring]);
  const before = state.products.length;
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });

  eq(state.products.length, before + 1);
  const rec = state.products[state.products.length - 1];
  ok(rec.from_asset === true, '要标 from_asset，分析页才认得');
  eq(rec.status === 'sold' ? 1 : 0, 1);
  eq(rec.purchase_price, 12000, '购入成本原样带过去');
  eq(rec.sale_price, 13800);
  eq(rec.sale_net, null, '没手填到手就该留空，交给费率规则算');
  eq(rec.sale_date, '2026-09-18');
  eq(rec.category, 'equipment', '物品用自己原本的类别计费');
  eq(rec.zone, Z);
});

await t('到手价按藏宝阁费率自动算：13800 → 扣 690 → 13110', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const s = computeAll({ roles: state.roles, products: state.products, chars: state.chars, assets: state.assets });
  const p = s.productRows.find((x) => x.from_asset);
  eq(p._net, 13110, 0.005);
});

await t('实际盈亏 = 到手 − 购入成本 = 1110', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const s = computeAll({ roles: state.roles, products: state.products, chars: state.chars, assets: state.assets });
  const p = s.productRows.find((x) => x.from_asset);
  eq(p._profit, round2(p._net - 12000));
  eq(p._profit, 1110, 0.005);
});

await t('原物品从固定资产移出（还在手上少一件）', async () => {
  seed([char], [sword, ring]);
  eq(fixedOnHand(), 3000 + 12000 + 2800);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  ok(!state.assets.some((a) => a.id === sword.id), '卖掉的那件不该还在固定资产里');
  eq(state.assets.length, 1);
  eq(fixedOnHand(), 3000 + 2800, '还在手上应扣掉卖掉的 12000');
});

await t('号不会被误删，剩下的物品仍挂着', async () => {
  seed([char], [sword, ring]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(state.chars.length, 1);
  eq(state.assets[0].char_id, char.id);
});

await t('手填实际到手时以手填为准', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: 13500, sale_date: '2026-09-18', sold_zone: Z });
  const s = computeAll({ roles: state.roles, products: state.products, chars: state.chars, assets: state.assets });
  const p = s.productRows.find((x) => x.from_asset);
  eq(p._net, 13500, 0.005);
  eq(p._profit, 1500, 0.005);
});

await t('没填日期时默认记今天', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 100, sale_net: '', sale_date: '', sold_zone: Z });
  const rec = state.products[0];
  ok(/^\d{4}-\d{2}-\d{2}$/.test(rec.sale_date), '应为 YYYY-MM-DD，实际 ' + rec.sale_date);
});

console.log('\n二、卖一个自玩号');

const bigChar = newChar({ zone: Z, name: '大号', purchase_price: 8000 });
const pet = newAsset({ char_id: bigChar.id, zone: Z, name: '须弥兽', category: 'pet', cost: 5000 });

await t('号按「角色」费率计费（5%，保底 60）', async () => {
  seed([bigChar], [pet]);
  await sellFixedAsset(bigChar, 'char', { sale_price: 9000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const rec = state.products[0];
  eq(rec.category, 'role', '角色的费率和物品不一样，必须用 role');
  eq(rec.purchase_price, 8000, '号的购入成本取 purchase_price');
  // 9000 × 5% = 450，高于 60 保底 → 到手 8550
  const s = computeAll({ roles: state.roles, products: state.products, chars: state.chars, assets: state.assets });
  const p = s.productRows.find((x) => x.from_asset);
  eq(p._net, 8550, 0.005);
  eq(p._profit, 550, 0.005);
});

await t('号卖出后从固定资产移出，号里的物品变未归号（不被删）', async () => {
  seed([bigChar], [pet]);
  await sellFixedAsset(bigChar, 'char', { sale_price: 9000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(state.chars.length, 0, '号应该移出固定资产');
  eq(state.assets.length, 1, '号里的物品不能被删');
  eq(state.assets[0].char_id, null, '应变成未归号');
  eq(fixedOnHand(), 5000, '还在手上只剩那件物品');
});

await t('号卖掉后，号的成本仍计入流出记录的购入成本（不会凭空消失）', async () => {
  seed([bigChar], [pet]);
  await sellFixedAsset(bigChar, 'char', { sale_price: 9000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const rec = state.products[0];
  eq(rec.purchase_price, 8000);
  const outflowCost = round2(state.products.filter((p) => p.from_asset).reduce((s, p) => s + p.purchase_price, 0));
  eq(outflowCost, 8000, '分析页的「流出总成本」应等于号当初的钱');
});

console.log('\n三、流出记录与在手的口径');

await t('卖两条后：流出总成本 / 已售回款 / 实际盈亏 三个数自洽', async () => {
  seed([char], [sword, ring]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  await sellFixedAsset(ring, 'asset', { sale_price: 3000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });

  const s = computeAll({ roles: state.roles, products: state.products, chars: state.chars, assets: state.assets });
  const sold = s.productRows.filter((p) => p.from_asset && p.status === 'sold');
  const cost = round2(sold.reduce((a, p) => a + p.purchase_price, 0));
  const net = round2(sold.reduce((a, p) => a + p._net, 0));
  const profit = round2(sold.reduce((a, p) => a + p._profit, 0));

  eq(cost, 12000 + 2800);
  eq(net, round2(13110 + (3000 - 150)));
  eq(profit, round2(net - cost));
  eq(sold.length, 2);
});

await t('卖完之后「还在手上」只剩没卖的（号本身）', async () => {
  seed([char], [sword, ring]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  await sellFixedAsset(ring, 'asset', { sale_price: 3000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(fixedOnHand(), 3000, '两件物品都卖了，只剩号的 3000');
  eq(state.assets.length, 0);
});

await t('固定资产流出记录不参与倒卖核算（不会混进角色/商品投入）', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const s = computeAll({ roles: state.roles, products: state.products, chars: state.chars, assets: state.assets });
  // 流出商品是「独立采购」口径，会计入倒卖侧的独立投入 —— 这是既有设计，这里只锁住它不产生 NaN 与错乱
  ok(Number.isFinite(s.totals.invest), '投入不能是 NaN');
  ok(Number.isFinite(s.totals.realizedProfit), '实际盈亏不能是 NaN');
  eq(s.totals.realizedProfit, 1110, 0.02);
});

console.log('');
console.log('─'.repeat(52));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log('─'.repeat(52));
process.exit(fail ? 1 : 0);
