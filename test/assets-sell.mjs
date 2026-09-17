/**
 * 固定资产售出自测（标记已售版）：node test/assets-sell.mjs
 *
 * 卖出的号/物品**保留在固定资产里**，只打 sold 标记：
 *   - 不再算「还在手上」
 *   - 但保留了售出价 / 到手 / 实际盈亏，能查能撤销
 *   - 分析页「固定资产流出」直接读这批标记，不另外复制一份账
 *
 * store.js 依赖裸模块名 'vue'，浏览器靠 importmap、这里靠解析钩子补上。
 */

import { register } from 'node:module';
register('./vue-resolve-hooks.mjs', import.meta.url);

const { state, sellFixedAsset, unsellFixedAsset, fixedAssets } = await import('../src/core/store.js');
const { computeAll, fixedAssetPnl } = await import('../src/core/compute.js');
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

/** 重置成一份干净的内存数据（演示模式，不连库） */
function seed(chars = [], assets = []) {
  state.demoMode = true;
  state.roles = [];
  state.products = [];
  state.chars = chars;
  state.assets = assets;
}
const fa = () => fixedAssets.value;
const findAsset = (id) => state.assets.find((a) => a.id === id);
const findChar = (id) => state.chars.find((c) => c.id === id);

const char = newChar({ zone: Z, name: '主力号', purchase_price: 3000 });
const sword = newAsset({ char_id: char.id, zone: Z, name: '160无级别剑', category: 'equipment', cost: 12000 });
const ring = newAsset({ char_id: char.id, zone: Z, name: '140灵饰', category: 'accessory', cost: 2800 });

console.log('一、卖一件号内物品');

await t('售出只做标记：记录还在，不新建商品、不删除', async () => {
  seed([char], [sword, ring]);
  const prodBefore = state.products.length;
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });

  const a = findAsset(sword.id);
  ok(a, '原物品必须还在固定资产里');
  eq(a.sold, true);
  eq(a.sale_price, 13800);
  eq(a.sale_net, null, '没手填到手就留空，交给费率算');
  eq(a.sale_date, '2026-09-18');
  eq(a.sold_zone, Z);
  eq(state.products.length, prodBefore, '不该再复制一份商品记录（同一笔账只存一处）');
  eq(state.assets.length, 2);
});

await t('到手价按藏宝阁费率自动算：13800 → 扣 690 → 13110', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const pnl = fixedAssetPnl(findAsset(sword.id), 'asset');
  eq(pnl.fee, 690, 0.005);
  eq(pnl.net, 13110, 0.005);
});

await t('实际盈亏 = 到手 − 购入成本 = 1110', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const pnl = fixedAssetPnl(findAsset(sword.id), 'asset');
  eq(pnl.profit, 1110, 0.005);
  eq(fa().soldProfit, 1110, 0.005);
});

await t('已售的不再算「还在手上」，但成本仍留在记录里', async () => {
  seed([char], [sword, ring]);
  eq(fa().holdingCost, 3000 + 12000 + 2800);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(fa().holdingCost, 3000 + 2800, '还在手上应扣掉卖掉的 12000');
  eq(fa().soldCost, 12000, '已售那批的购入成本要单独留着');
  eq(fa().holding.length, 2);
  eq(fa().sold.length, 1);
});

await t('手填实际到手时以手填为准', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: 13500, sale_date: '2026-09-18', sold_zone: Z });
  const pnl = fixedAssetPnl(findAsset(sword.id), 'asset');
  eq(pnl.net, 13500, 0.005);
  eq(pnl.profit, 1500, 0.005);
});

await t('没填日期时默认记今天', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 100, sale_net: '', sale_date: '', sold_zone: Z });
  ok(/^\d{4}-\d{2}-\d{2}$/.test(findAsset(sword.id).sale_date), '应为 YYYY-MM-DD');
});

await t('可以撤销：清掉标记，重新算回还在手上', async () => {
  seed([char], [sword, ring]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(fa().holdingCost, 3000 + 2800);
  await unsellFixedAsset(findAsset(sword.id), 'asset');
  const a = findAsset(sword.id);
  eq(a.sold, false);
  eq(a.sale_price, 0);
  eq(a.sale_net, null);
  eq(a.sale_date, '');
  eq(fa().holdingCost, 3000 + 12000 + 2800, '撤销后应回到全部在手上');
  eq(fa().sold.length, 0);
});

console.log('\n二、卖一个自玩号');

const bigChar = newChar({ zone: Z, name: '大号', purchase_price: 8000 });
const pet = newAsset({ char_id: bigChar.id, zone: Z, name: '须弥兽', category: 'pet', cost: 5000 });

await t('号按「角色」费率计费（5%，保底 60）', async () => {
  seed([bigChar], [pet]);
  await sellFixedAsset(bigChar, 'char', { sale_price: 9000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const pnl = fixedAssetPnl(findChar(bigChar.id), 'char');
  eq(pnl.category, 'role', '角色费率和物品不同，必须走 role');
  eq(pnl.cost, 8000, '号的成本取 purchase_price');
  // 9000 × 5% = 450（高于 60 保底）→ 到手 8550 → 盈亏 550
  eq(pnl.net, 8550, 0.005);
  eq(pnl.profit, 550, 0.005);
});

await t('号卖出后，号里的物品不受影响，仍挂在它名下', async () => {
  seed([bigChar], [pet]);
  await sellFixedAsset(bigChar, 'char', { sale_price: 9000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(state.chars.length, 1, '号要保留在固定资产里');
  eq(findChar(bigChar.id).sold, true);
  eq(state.assets.length, 1);
  eq(findAsset(pet.id).char_id, bigChar.id, '物品不该变成未归号');
  eq(fa().holdingCost, 5000, '还在手上只剩那件物品');
});

await t('号卖掉后，号的成本仍计入流出总成本（不会凭空消失）', async () => {
  seed([bigChar], [pet]);
  await sellFixedAsset(bigChar, 'char', { sale_price: 9000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(fa().soldCost, 8000);
  eq(fa().soldNet, 8550, 0.005);
  eq(fa().soldProfit, 550, 0.005);
});

console.log('\n三、流出与在手的口径');

await t('卖两条后：流出总成本 / 已售回款 / 实际盈亏 三个数自洽', async () => {
  seed([char], [sword, ring]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  await sellFixedAsset(ring, 'asset', { sale_price: 3000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });

  eq(fa().soldCost, 12000 + 2800);
  eq(fa().soldNet, round2(13110 + (3000 - 150)), 0.005);
  eq(fa().soldProfit, round2(fa().soldNet - fa().soldCost), 0.005);
  eq(fa().sold.length, 2);
});

await t('卖完之后「还在手上」只剩没卖的（号本身）', async () => {
  seed([char], [sword, ring]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  await sellFixedAsset(ring, 'asset', { sale_price: 3000, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  eq(fa().holdingCost, 3000, '两件物品都卖了，只剩号的 3000');
  eq(fa().holding.length, 1);
  eq(state.assets.length, 2, '记录都还在，只是标了已售');
});

await t('已售固定资产不混进倒卖核算（角色/商品那套账不受影响）', async () => {
  seed([char], [sword]);
  await sellFixedAsset(sword, 'asset', { sale_price: 13800, sale_net: '', sale_date: '2026-09-18', sold_zone: Z });
  const s = computeAll({ roles: state.roles, products: state.products, chars: state.chars, assets: state.assets });
  eq(s.totals.invest, 0, '固定资产的钱不进倒卖投入');
  eq(s.totals.recovered, 0, '固定资产的回款也不进倒卖回款');
  eq(s.totals.realizedProfit, 0);
});

await t('没卖过的条目 pnl 全为 0，不会误报盈亏', async () => {
  seed([char], [sword]);
  const pnl = fixedAssetPnl(findAsset(sword.id), 'asset');
  eq(pnl.cost, 12000);
  eq(pnl.net, 0);
  eq(pnl.profit, 0);
  eq(pnl.fee, 0);
});

console.log('');
console.log('─'.repeat(52));
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log('─'.repeat(52));
process.exit(fail ? 1 : 0);
