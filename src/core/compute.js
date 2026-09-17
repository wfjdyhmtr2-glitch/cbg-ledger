/**
 * 核算引擎 —— 整个后台的业务心脏
 *
 * 角色是「容器型资产」：可以整体转手、可以拆开变现、可以转服换区。
 * 因此角色被当作一个「项目批次」，挂 role_id 指向它的商品都是它的产物。
 *
 * 两种核算视角，随时切换：
 *
 *   project（项目视角，默认）
 *     角色整体作为一个核算单元：看「已回款 + 在手资产估值 − 总投入」，
 *     回答"这一票到底赚没赚"。拆出来的商品不单独背成本，报表最省事、最贴近真实经营。
 *
 *   unit（单品视角）
 *     按估值权重把角色成本摊到每件装备/召唤兽/空壳号上，
 *     于是每件商品都能算出自己的毛利，回答"到底哪件在赚钱"。
 *
 * 所有金额均为「税后净额」口径（已扣除藏宝阁信息费），详见 fee.js。
 */

import { num, round2, daysBetween, todayStr, normalizeZone, collectZoneNames } from './model.js';
import { netFromGross } from './fee.js';

// ---------------------------------------------------------------- 基础取值

/** 成交净收入（税后到手）。用户手填的 sale_net 优先，否则按手续费规则自动算 */
export function netIncome(item, kind) {
  const manual = item.sale_net;
  if (manual !== null && manual !== undefined && manual !== '') return num(manual);
  const gross = num(item.sale_price);
  if (gross <= 0) return 0;
  return netFromGross(kind === 'role' ? 'role' : item.category, gross);
}

/** 手续费支出 */
export function feePaid(item, kind) {
  const gross = num(item.sale_price);
  if (gross <= 0) return 0;
  const manual = item.sale_net;
  if (manual !== null && manual !== undefined && manual !== '') {
    return round2(gross - num(manual));
  }
  return round2(gross - netFromGross(kind === 'role' ? 'role' : item.category, gross));
}

/**
 * 固定资产条目（自玩号 / 号内物品）的「已售」账目。
 *
 * 号和物品的费率不一样：号走角色档（5%、保底 60、封顶 1000），物品按自己的类别。
 * 卖掉的号/物品保留在固定资产里只做标记，所以这里既给它自己的行用，也给分析页用。
 *
 * @param {object} item  char 或 asset 记录（要有 sold / sale_price / sale_net）
 * @param {'char'|'asset'} kind
 */
export function fixedAssetPnl(item, kind) {
  const isChar = kind === 'char';
  const category = isChar ? 'role' : (item.category || 'other');
  const cost = isChar ? num(item.purchase_price) : num(item.cost);
  const gross = num(item.sale_price);
  // 卖掉了才算出账；没卖就是纯在手成本
  const net = item.sold
    ? (item.sale_net !== null && item.sale_net !== undefined && item.sale_net !== ''
        ? num(item.sale_net)
        : netFromGross(category, gross))
    : 0;
  return {
    category,
    cost: round2(cost),
    gross: round2(gross),
    net: round2(net),
    fee: round2(gross - net),
    profit: item.sold ? round2(net - cost) : 0,
  };
}

/**
 * 未售资产「在手值多少钱」
 * 口径：挂了牌的按挂牌价，没挂的按成本价。
 *
 * 例外：已拆号的空壳角色，它的价值已经转移到拆出去的装备/召唤兽上了。
 *      如果没挂价，就按 0 计 —— 宁可保守（显示成还没回本），
 *      也不要拿买入全价当空壳残值，那会把整票盈亏虚假地抬上去。
 */
export function onHandValue(item, kind) {
  const listed = num(item.listed_price);
  if (listed > 0) return listed;
  if (kind === 'role' && item.is_shell) return 0;
  return num(item.purchase_price);
}

/** 持有天数：未售 = 至今；已售 = 成交日 − 买入日 */
export function holdingDays(item, today = todayStr()) {
  if (!item.purchase_date) return null;
  const end = item.status === 'sold' && item.sale_date ? item.sale_date : today;
  return daysBetween(item.purchase_date, end);
}

/** 角色总成本 = 买入价 + 转服费 + 其他成本 */
export function roleCost(role) {
  return round2(num(role.purchase_price) + num(role.transfer_fee) + num(role.other_cost));
}

// ---------------------------------------------------------------- 成本分摊

/**
 * 按估值权重把角色成本摊到「空壳号 + 各拆出商品」上。
 * 权重：已售商品取成交价，未售商品取在手估值，空壳号取自身在手估值。
 * 商品若手工填了 allocated_cost，则尊重手工值。
 *
 * @returns {{shellCost:number, map:Record<string,number>, total:number}}
 */
export function allocateRoleCost(role, children) {
  const total = roleCost(role);
  const out = { shellCost: total, map: {}, total };
  if (!children.length) return out;

  const shellWeight = onHandValue(role, 'role') || 1;
  const rows = children.map((p) => {
    let w = p.status === 'sold' ? num(p.sale_price) : onHandValue(p, 'product');
    if (!(w > 0)) w = num(p.purchase_price) || 1;
    return { p, w };
  });

  const totalW = shellWeight + rows.reduce((s, r) => s + r.w, 0);
  if (!(totalW > 0)) return out;

  rows.forEach((r) => {
    const manual = r.p.allocated_cost;
    out.map[r.p.id] =
      manual !== null && manual !== undefined && manual !== ''
        ? round2(num(manual))
        : round2(total * r.w / totalW);
  });
  out.shellCost = round2(total * shellWeight / totalW);
  return out;
}

// ---------------------------------------------------------------- 角色核算

/**
 * 核算一个角色项目
 * @param {object} role
 * @param {object[]} allProducts
 * @param {{view?:'project'|'unit', today?:string, alloc?:object}} opts
 */
export function computeRole(role, allProducts, opts = {}) {
  const view = opts.view || 'project';
  const today = opts.today || todayStr();

  const children = allProducts.filter((p) => p.role_id === role.id);
  // 号本身买来花了多少 vs 这一票的总成本（拆出商品各自另花的钱也要算进来）
  const roleOwnCost = roleCost(role);
  const childOwnCost = round2(children.reduce((s, p) => s + num(p.purchase_price), 0));
  const cost = round2(roleOwnCost + childOwnCost);
  const alloc = opts.alloc || allocateRoleCost(role, children);

  // ---- 回款
  const roleNet = role.status === 'sold' ? netIncome(role, 'role') : 0;
  const soldChildren = children.filter((p) => p.status === 'sold');
  const holdingChildren = children.filter((p) => p.status !== 'sold');
  const childNet = round2(soldChildren.reduce((s, p) => s + netIncome(p, 'product'), 0));
  const recovered = round2(roleNet + childNet);

  // ---- 已售部分的成本（单品口径，两种视角下都算，用于「已实现盈亏」）
  // 已售商品自己填的买入价是在角色成本之外另花的，同样计入
  const childSoldCost = round2(
    soldChildren.reduce((s, p) => s + (alloc.map[p.id] || 0) + num(p.purchase_price), 0)
  );
  const selfSoldCost = role.status === 'sold' ? (children.length ? alloc.shellCost : roleOwnCost) : 0;
  const soldCost = round2(childSoldCost + selfSoldCost);
  const realized = round2(recovered - soldCost);

  // ---- 在手资产
  const roleOnHand = role.status === 'sold' ? 0 : onHandValue(role, 'role');
  const childOnHand = round2(holdingChildren.reduce((s, p) => s + onHandValue(p, 'product'), 0));
  const onHand = round2(roleOnHand + childOnHand);

  // ---- 总盈亏（含浮动）
  const totalProfit = round2(recovered + onHand - cost);

  // ---- 周期
  const days = holdingDays(role, today);
  const daysToSell =
    role.status === 'sold' && role.sale_date ? daysBetween(role.purchase_date, role.sale_date) : null;

  // ---- 拆出商品明细
  const childRows = children.map((p) => {
    const shareCost = alloc.map[p.id] || 0;
    // 计入成本 = 从母角色摊来的部分 + 商品自己填的买入价（两者相加，和汇总口径一致）
    const ownPay = num(p.purchase_price);
    const effCost = round2(shareCost + ownPay);
    const net = p.status === 'sold' ? netIncome(p, 'product') : 0;
    const oh = p.status === 'sold' ? 0 : onHandValue(p, 'product');
    return {
      ...p,
      _kind: 'product',
      _unitCost: effCost,
      _allocCost: round2(shareCost),
      _net: net,
      _onHand: oh,
      _profit: round2(net + oh - effCost),
      _days: holdingDays(p, today),
    };
  });

  return {
    ...role,
    _kind: 'role',
    _cost: cost,
    _roleCost: roleOwnCost,
    _childOwnCost: childOwnCost,
    _children: childRows,
    _childCount: children.length,
    _soldChildCount: soldChildren.length,
    _holdingChildCount: holdingChildren.length,
    _recovered: recovered,
    _roleNet: roleNet,
    _childNet: childNet,
    _soldCost: soldCost,
    _realized: realized,
    _onHand: onHand,
    _roleOnHand: roleOnHand,
    _childOnHand: childOnHand,
    _totalProfit: totalProfit,
    _days: days,
    _daysToSell: daysToSell,
    _recoverRate: cost > 0 ? recovered / cost : 0,
    _roi: cost > 0 ? totalProfit / cost : 0,
    _shellCost: alloc.shellCost,
    _unitProfit: round2(
      // 单品口径下这个项目已实现 + 在手的总盈亏（用于视角切换时对照）
      recovered + onHand - cost
    ),
    _view: view,
  };
}

// ---------------------------------------------------------------- 商品核算

/**
 * 核算一件商品
 * @param {object} p
 * @param {{view?:string, today?:string, unitCost?:number|null}} opts
 */
export function computeProduct(p, opts = {}) {
  const view = opts.view || 'project';
  const today = opts.today || todayStr();
  const attached = !!p.role_id;

  // 分摊成本（unitCost 由 computeAll 预先算好，避免重复计算）
  const unitCost = opts.unitCost != null ? round2(opts.unitCost) : (attached ? null : num(p.purchase_price));

  // 当前视角下这件商品"自己承担多少成本"
  let cost;
  if (!attached) cost = num(p.purchase_price);
  else if (view === 'unit') cost = unitCost == null ? 0 : unitCost;
  else cost = num(p.purchase_price); // 项目视角：成本挂在母角色上，商品本身不背成本

  const net = p.status === 'sold' ? netIncome(p, 'product') : 0;
  const oh = p.status === 'sold' ? 0 : onHandValue(p, 'product');
  const profit = round2(net + oh - cost);

  return {
    ...p,
    _kind: 'product',
    _cost: round2(cost),
    _unitCost: unitCost,
    _net: net,
    _onHand: oh,
    _profit: profit,
    _realized: p.status === 'sold' ? round2(net - cost) : 0,
    _days: holdingDays(p, today),
    _attached: attached,
    _roi: cost > 0 ? profit / cost : null,
    _view: view,
  };
}

// ---------------------------------------------------------------- 全局汇总

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * 全站汇总：总览指标 + 区服分布 + 账龄 + 周转 + 月度曲线 + 预警
 */
export function computeAll(state, opts = {}) {
  const view = opts.view || 'project';
  const today = opts.today || todayStr();
  const roles = state.roles || [];
  const products = state.products || [];

  // 预计算每个角色的成本分摊表（单品视角 & 已售明细都要用）
  const allocByRole = {};
  roles.forEach((r) => {
    allocByRole[r.id] = allocateRoleCost(r, products.filter((p) => p.role_id === r.id));
  });

  const roleById = Object.fromEntries(roles.map((r) => [r.id, r]));
  const roleRows = roles.map((r) => computeRole(r, products, { view, today, alloc: allocByRole[r.id] }));

  /**
   * 商品自己填的买入价一律另计为成本 —— 即使它挂在角色名下。
   *
   * 口径：一个区的总成本 = 角色买入价 + 名下商品成本价 + 独立采购商品成本价。
   * 所以拆号商品的成本 = 母角色摊过来的部分 + 它自己填的买入价（`_allocCost + purchase_price`）。
   *
   * 拆号时把成本全记在角色上（商品填 0）是最常见的用法，那样结果与旧口径一模一样；
   * 但「角色之外还单独花钱买了这件货」也说得通，这时自填的成本必须算进去，
   * 否则这件货的成本凭空消失，整笔成交额会被记成利润，盈亏虚高。
   */
  const productRows = products.map((p) => {
    const attached = !!p.role_id;
    const share = attached ? num(allocByRole[p.role_id]?.map[p.id]) : 0;
    const own = num(p.purchase_price);
    const row = computeProduct(p, {
      view,
      today,
      // 拆号商品：分摊成本 + 自填成本；母角色被删（分摊缺失）时就只剩自填那部分
      unitCost: attached ? round2(share + own) : null,
    });
    // 列表里要显示「拆自 xxx」，把来源角色名一并带上，省得模板里再去查
    row.roleName = attached ? (roleById[p.role_id]?.name || '') : '';
    // 从母角色摊到的那部分，单独留一份用于展示「分摊 + 自付」的拆解
    row._allocCost = round2(share);
    return row;
  });

  // ---- 投入 = 角色买入价 + 所有商品自己填的买入价
  // 角色这边只算号本身的买入价（_roleCost），拆出商品自填的成本在商品那边单独算一次，
  // 两边相加刚好不重不漏 —— 这才对得上「总成本 = 角色买入价 + 商品成本价」
  const roleInvest = round2(roleRows.reduce((s, r) => s + r._roleCost, 0));
  const standalone = productRows.filter((p) => !p.role_id);
  const standaloneInvest = round2(standalone.reduce((s, p) => s + num(p.purchase_price), 0));
  const productOwnInvest = round2(productRows.reduce((s, p) => s + num(p.purchase_price), 0));
  const totalInvest = round2(roleInvest + productOwnInvest);

  // ---- 回款：角色本体（含空壳号）成交净额 + 所有已售商品净额
  const roleRecovered = round2(roleRows.reduce((s, r) => s + r._roleNet, 0));
  const productRecovered = round2(
    productRows.filter((p) => p.status === 'sold').reduce((s, p) => s + p._net, 0)
  );
  const totalRecovered = round2(roleRecovered + productRecovered);

  // ---- 在手资产
  const roleOnHand = round2(roleRows.reduce((s, r) => s + r._roleOnHand, 0));
  const productOnHand = round2(
    productRows.filter((p) => p.status !== 'sold').reduce((s, p) => s + p._onHand, 0)
  );
  const totalOnHand = round2(roleOnHand + productOnHand);

  // ---- 已实现盈亏 = 回款 − 已售资产成本（成本按单品口径分摊，跨视角保持一致）
  // 角色行的 _soldCost 已经含了「名下已售商品的分摊成本 + 它们自填的成本」，
  // 所以这里只需再补上「不属于任何现存角色」的商品（独立采购 + 母角色被删的），
  // 避免同一笔钱被角色和商品各算一次。
  const uncoveredSold = productRows.filter(
    (p) => p.status === 'sold' && !(p.role_id && roleById[p.role_id])
  );
  const soldCostTotal = round2(
    roleRows.reduce((s, r) => s + r._soldCost, 0) +
    uncoveredSold.reduce((s, p) => s + num(p.purchase_price), 0)
  );
  const realizedProfit = round2(totalRecovered - soldCostTotal);
  const totalProfit = round2(totalRecovered + totalOnHand - totalInvest);
  const unsoldCost = round2(totalInvest - soldCostTotal);

  // ---- 资金占用（在手）/ 全部区服投入：两者是同一个口径，不重复展示
  //      = 角色买入价 + 商品成本 − 已回款金额
  //      等价于「还没回本的成本」= 总投入 − 已售资产成本。
  const onHandInvest = round2(totalInvest - soldCostTotal);

  // ---- 区服维度
  // 区服不是手工维护的清单，而是从角色/商品里「长出来」的：
  // 数据里出现过的区服名（含转服后的成交区）自动汇总，去重后就是这个列表。
  const zoneNames = collectZoneNames(roles, products);

  const zoneRows = zoneNames
    .map((zname) => {
      const zRoles = roleRows.filter((r) => normalizeZone(r.zone) === zname);
      const zAllProducts = productRows.filter((p) => normalizeZone(p.zone) === zname);
      // 不属于任何现存角色的商品（独立采购 + 母角色被删）—— 它们的成本没被角色行收进去
      const zUncovered = zAllProducts.filter((p) => !(p.role_id && roleById[p.role_id]));

      // 该区投入 = 角色买入价 + 区内所有商品自己填的买入价
      const invest = round2(
        zRoles.reduce((s, r) => s + r._roleCost, 0) +
        zAllProducts.reduce((s, p) => s + num(p.purchase_price), 0)
      );
      const recovered = round2(
        zRoles.reduce((s, r) => s + r._roleNet, 0) +
        zAllProducts.filter((p) => p.status === 'sold').reduce((s, p) => s + p._net, 0)
      );
      const onHand = round2(
        zRoles.reduce((s, r) => s + r._roleOnHand, 0) +
        zAllProducts.filter((p) => p.status !== 'sold').reduce((s, p) => s + p._onHand, 0)
      );
      const soldCost = round2(
        zRoles.reduce((s, r) => s + r._soldCost, 0) +
        zUncovered.filter((p) => p.status === 'sold').reduce((s, p) => s + num(p.purchase_price), 0)
      );

      const zSoldCycles = [
        ...zRoles.filter((r) => r._daysToSell != null).map((r) => r._daysToSell),
        ...zAllProducts.filter((p) => p.status === 'sold' && p._days != null).map((p) => p._days),
      ];

      // 跨区流转：这个区「收进来卖掉的」和「从这个区卖到别处的」。
      // 盈亏按买入区归集（一票生意不该被拆成两半），这两项只作展示参考。
      const soldRoles = zRoles.filter((r) => r.status === 'sold');
      const soldProducts = zAllProducts.filter((p) => p.status === 'sold');

      const transferredIn = round2(
        roleRows.filter((r) => r.status === 'sold'
          && normalizeZone(r.sold_zone) === zname
          && normalizeZone(r.zone) !== zname).reduce((s, r) => s + r._roleNet, 0) +
        productRows.filter((p) => p.status === 'sold'
          && normalizeZone(p.sold_zone) === zname
          && normalizeZone(p.zone) !== zname).reduce((s, p) => s + p._net, 0)
      );
      const transferredOut = round2(
        soldRoles.filter((r) => String(r.sold_zone || '').trim() && normalizeZone(r.sold_zone) !== zname)
          .reduce((s, r) => s + r._roleNet, 0) +
        soldProducts.filter((p) => String(p.sold_zone || '').trim() && normalizeZone(p.sold_zone) !== zname)
          .reduce((s, p) => s + p._net, 0)
      );

      return {
        id: zname,
        name: zname,
        invest,
        recovered,
        onHand,
        soldCost,
        realized: round2(recovered - soldCost),
        profit: round2(recovered + onHand - invest),
        // 与全局同一口径：角色买入价 + 商品成本 − 已回款金额（= 还没回本的成本）
        locked: round2(invest - soldCost),
        transferredIn,
        transferredOut,
        roleCount: zRoles.length,
        holdingRoles: zRoles.filter((r) => r.status !== 'sold').length,
        soldRoles: soldRoles.length,
        shellRoles: zRoles.filter((r) => r.is_shell).length,
        productCount: zAllProducts.length,
        holdingProducts: zAllProducts.filter((p) => p.status !== 'sold').length,
        soldProducts: soldProducts.length,
        avgCycle: zSoldCycles.length
          ? Math.round(zSoldCycles.reduce((s, d) => s + d, 0) / zSoldCycles.length)
          : null,
      };
    })
    .sort((a, b) => b.invest - a.invest || b.onHand - a.onHand);

  // ---- 持仓明细（账龄 / 滞销用）
  // 注意：角色行只记「本体」的在手估值（_roleOnHand），它拆出的商品会单独成行，
  //       否则同一份资产会被统计两次。
  const holdingItems = [
    ...roleRows.filter((r) => r.status !== 'sold').map((r) => ({
      id: r.id, kind: 'role', name: r.name, zone: normalizeZone(r.zone),
      cost: r._childCount ? r._shellCost : r._cost,
      ownCost: r._childCount ? r._shellCost : r._cost,
      onHand: r._roleOnHand,
      totalOnHand: r._onHand,
      days: r._days, listed: r.listed, listedPrice: num(r.listed_price),
      category: 'role', isShell: r.is_shell, childCount: r._childCount,
      holdingChildCount: r._holdingChildCount,
      roleName: r.name, level: r.level, school: r.school,
    })),
    ...productRows.filter((p) => p.status !== 'sold').map((p) => ({
      id: p.id, kind: 'product', name: p.name, zone: normalizeZone(p.zone),
      cost: p._cost, ownCost: p._unitCost, onHand: p._onHand, totalOnHand: p._onHand,
      days: p._days, listed: p.listed, listedPrice: num(p.listed_price), category: p.category,
      isShell: false, childCount: 0, holdingChildCount: 0,
      roleName: p.role_id ? (roleById[p.role_id]?.name || '') : '',
    })),
  ].sort((a, b) => (b.days || 0) - (a.days || 0));

  // ---- 已售明细（周转分析用，统一单品口径）
  const soldItems = [
    ...roleRows.filter((r) => r.status === 'sold').map((r) => ({
      id: r.id, kind: 'role', name: r.name, zone: normalizeZone(r.zone),
      cost: round2(r._childCount ? r._shellCost : r._cost),
      net: r._roleNet, days: r._daysToSell, saleDate: r.sale_date,
      profit: round2(r._roleNet - (r._childCount ? r._shellCost : r._cost)),
      category: 'role', isShell: r._childCount > 0, roleName: r.name,
    })),
    ...productRows.filter((p) => p.status === 'sold').map((p) => ({
      id: p.id, kind: 'product', name: p.name, zone: normalizeZone(p.zone),
      cost: p._attached ? (p._unitCost || 0) : num(p.purchase_price),
      net: p._net, days: p._days, saleDate: p.sale_date,
      profit: round2(p._net - (p._attached ? (p._unitCost || 0) : num(p.purchase_price))),
      category: p.category, isShell: false,
      roleName: p.role_id ? (roleById[p.role_id]?.name || '') : '',
    })),
  ].sort((a, b) => String(b.saleDate).localeCompare(String(a.saleDate)));

  const cycles = soldItems.filter((i) => i.days != null).map((i) => i.days);
  const avgCycle = cycles.length ? Math.round(cycles.reduce((s, d) => s + d, 0) / cycles.length) : null;

  // ---- 账龄分桶（按在手资产估值）
  const bucketDefs = [
    { label: '0–30 天', min: 0, max: 30 },
    { label: '31–60 天', min: 31, max: 60 },
    { label: '61–90 天', min: 61, max: 90 },
    { label: '91–180 天', min: 91, max: 180 },
    { label: '180 天以上', min: 181, max: Infinity },
  ];
  const buckets = bucketDefs.map((b) => {
    const hit = holdingItems.filter((i) => {
      const d = Math.max(0, i.days == null ? 0 : i.days); // 防止误填未来日期导致漏桶
      return d >= b.min && d <= b.max;
    });
    return {
      ...b,
      count: hit.length,
      amount: round2(hit.reduce((s, i) => s + i.onHand, 0)),
      cost: round2(hit.reduce((s, i) => s + i.cost, 0)),
    };
  });

  // ---- 近 12 个月投入 / 回款
  const monthly = buildMonthly(roleRows, productRows, today);

  // ---- 滞销预警
  const alerts = holdingItems.filter((i) => (i.days || 0) >= 60);

  // ---- 空壳号还没估值：会被当成 0 残值，导致这一票的盈亏被低估，提醒用户补填
  const unvaluedShells = roleRows.filter(
    (r) => r.status !== 'sold' && r.is_shell && !num(r.listed_price)
  );

  return {
    today,
    view,
    roleRows,
    productRows,
    totals: {
      invest: totalInvest,
      roleInvest,
      standaloneInvest,
      productOwnInvest,
      recovered: totalRecovered,
      roleRecovered,
      productRecovered,
      onHand: totalOnHand,
      // 全部区服投入 = 资金占用（在手）= 角色买入价 + 商品成本 − 已回款金额
      onHandInvest,
      roleOnHand,
      productOnHand,
      estTotal: holdingItems.reduce((s2, i) => s2 + num(i.listedPrice), 0),
      soldCost: soldCostTotal,
      unsoldCost,
      realizedProfit,
      unrealizedProfit: round2(totalOnHand - unsoldCost),
      totalProfit,
      unlockRate: totalInvest > 0 ? totalRecovered / totalInvest : 0,
    },
    counts: {
      zones: zoneRows.length,
      roles: roleRows.length,
      holdingRoles: roleRows.filter((r) => r.status !== 'sold').length,
      soldRoles: roleRows.filter((r) => r.status === 'sold').length,
      shellRoles: roleRows.filter((r) => r.is_shell).length,
      products: productRows.length,
      holdingProducts: productRows.filter((p) => p.status !== 'sold').length,
      soldProducts: productRows.filter((p) => p.status === 'sold').length,
      listed: [...roleRows, ...productRows].filter((x) => x.listed && x.status !== 'sold').length,
    },
    zoneRows,
    holdingItems,
    soldItems,
    avgCycle,
    medianCycle: median(cycles),
    buckets,
    monthly,
    alerts,
    unvaluedShells,
  };
}

/** 近 12 个月的投入 / 回款时间序列 */
function buildMonthly(roleRows, productRows, today) {
  const now = new Date(today);
  const list = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${d.getMonth() + 1}月`,
      invest: 0,
      recovered: 0,
    });
  }
  const idx = Object.fromEntries(list.map((m, i) => [m.key, i]));
  const push = (date, field, amount) => {
    if (!date) return;
    const i = idx[String(date).slice(0, 7)];
    if (i === undefined) return;
    list[i][field] = round2(list[i][field] + num(amount));
  };

  roleRows.forEach((r) => {
    // 只算号本身的买入价；拆出商品自填的成本在商品那一遍里记
    push(r.purchase_date, 'invest', r._roleCost);
    if (r.status === 'sold' && r._roleNet) push(r.sale_date, 'recovered', r._roleNet);
  });
  productRows.forEach((p) => {
    // 每件商品自己填的买入价都算一笔投入（拆号商品也一样，是角色成本之外另花的）
    push(p.purchase_date, 'invest', num(p.purchase_price));
    if (p.status === 'sold') push(p.sale_date, 'recovered', p._net);
  });
  return list;
}
