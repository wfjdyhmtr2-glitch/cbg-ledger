/**
 * 藏宝阁信息费（手续费）计算
 *
 * 官方规则（卖家承担，买家不收费）：
 *   角色        交易额 × 5%，最低 60 元，最高 1000 元
 *   道具/召唤兽/装备/灵饰/宝石   交易额 × 5%，最高 1000 元
 *   梦幻币      交易额 × 5%，无上下限
 *   礼盒礼币    交易额 × 10%，无上下限
 *
 * 细节：信息费不足 1 分钱的部分，按 1 分钱收取（即向上取整到分）。
 */

import { CATEGORY_MAP, num } from './model.js';

/** 向上取整到「分」，复刻官方「不足一分按一分收取」 */
function ceilToCent(n) {
  return Math.ceil(num(n) * 100 - 1e-9) / 100;
}

function clamp(v, min, max) {
  if (min != null && v < min) return min;
  if (max != null && v > max) return max;
  return v;
}

/**
 * 计算卖家信息费
 * @param {string} category 商品类别 id，角色请传 'role'
 * @param {number} gross    成交价（挂牌价）
 * @param {object} [rules]  可覆盖的费率配置 { rate, min, max }
 * @returns {number} 信息费金额
 */
export function calcFee(category, gross, rules) {
  const g = num(gross);
  if (g <= 0) return 0;

  // 用户自定义费率优先
  if (rules && num(rules.rate) > 0) {
    return ceilToCent(clamp(g * num(rules.rate), rules.min, rules.max));
  }

  if (category === 'role') {
    // 5%，最低 60，最高 1000
    return ceilToCent(clamp(g * 0.05, 60, 1000));
  }

  const feeType = CATEGORY_MAP[category]?.feeType || 'item';

  if (feeType === 'gift') {
    // 礼盒礼币 10%，无上下限
    return ceilToCent(g * 0.1);
  }
  if (feeType === 'currency') {
    // 梦幻币 5%，无上下限
    return ceilToCent(g * 0.05);
  }
  // 道具/召唤兽/装备/灵饰/宝石：5%，上限 1000
  return ceilToCent(clamp(g * 0.05, null, 1000));
}

/**
 * 由挂牌价推算实际到手金额
 * @returns {number} 税后净收入
 */
export function netFromGross(category, gross, rules) {
  const g = num(gross);
  if (g <= 0) return 0;
  return Math.round((g - calcFee(category, g, rules)) * 100) / 100;
}

/** 反推：想净到手 net，挂牌价需要挂多少（用于定价参考） */
export function grossFromNet(category, net) {
  const target = num(net);
  if (target <= 0) return 0;
  // 5% 档：gross = net / 0.95；10% 档：net / 0.9
  const feeType = CATEGORY_MAP[category]?.feeType || 'item';
  if (category === 'role') {
    // 角色有 60 元保底，简单迭代求解
    let g = target / 0.95;
    for (let i = 0; i < 20; i++) {
      const need = target + calcFee('role', g);
      if (Math.abs(need - g) < 0.005) break;
      g = need;
    }
    return Math.ceil(g * 100) / 100;
  }
  const rate = feeType === 'gift' ? 0.1 : 0.05;
  let g = target / (1 - rate);
  // 上限 1000 的类别再校验一次
  for (let i = 0; i < 20; i++) {
    const need = target + calcFee(category, g);
    if (Math.abs(need - g) < 0.005) break;
    g = need;
  }
  return Math.ceil(g * 100) / 100;
}

/** 手续费规则说明文案 */
export function feeRuleText(category) {
  if (category === 'role') return '角色 5%，最低 60 元，最高 1000 元';
  const feeType = CATEGORY_MAP[category]?.feeType || 'item';
  if (feeType === 'gift') return '礼盒礼币 10%，无上下限';
  if (feeType === 'currency') return '梦幻币 5%，无上下限';
  return '道具/召唤兽/装备/灵饰 5%，最高 1000 元';
}
