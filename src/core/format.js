/**
 * 展示层格式化工具
 * 金额统一走「税后净额」口径，颜色遵循 A 股/国内习惯：红=盈利涨、绿=亏损跌。
 */

import { num } from './model.js';

export function money(n, opts = {}) {
  const v = num(n);
  const { sign = false, digits = 2 } = opts;
  const abs = Math.abs(v).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (v < 0) return `-¥${abs}`;
  return `${sign ? '+' : ''}¥${abs}`;
}

/** 大额简写，列表里省地方：1.2万 / 32.5万 */
export function wan(n, opts = {}) {
  const v = num(n);
  const abs = Math.abs(v);
  const digits = opts.digits ?? (abs >= 100000 ? 0 : 1);
  if (abs >= 10000) {
    const s = (abs / 10000).toFixed(digits);
    return `${v < 0 ? '-' : ''}${s}万`;
  }
  return `${v < 0 ? '-' : ''}${abs.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

export function pct(n, digits = 1) {
  return `${(num(n) * 100).toFixed(digits)}%`;
}

/** 输入已经是百分数（如 12.5） */
export function pctRaw(n, digits = 1) {
  return `${num(n).toFixed(digits)}%`;
}

export function daysText(d) {
  if (d == null || d < 0) return '—';
  if (d === 0) return '今天';
  if (d >= 365) return `${Math.floor(d / 365)}年${d % 365}天`;
  return `${d} 天`;
}

export function dateText(s) {
  if (!s) return '—';
  const str = String(s).slice(0, 10);
  const [y, m, d] = str.split('-');
  return `${y}/${m}/${d}`;
}

/** 盈亏配色：正数=红（赚）、负数=绿（亏） */
export function pnlTone(v) {
  const n = num(v);
  if (n > 0.004) return 'up';
  if (n < -0.004) return 'down';
  return 'flat';
}

export function pnlClass(v) {
  return `pnl-${pnlTone(v)}`;
}

/** 账龄风险等级 */
export function agingTone(days) {
  const d = num(days);
  if (d >= 120) return 'danger';
  if (d >= 60) return 'warn';
  if (d >= 30) return 'info';
  return 'ok';
}

export function agingText(days) {
  const d = num(days);
  if (d >= 120) return '严重滞销';
  if (d >= 60) return '偏慢';
  if (d >= 30) return '正常';
  return '新鲜';
}

export function truncate(s, n = 14) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

/** 百分比进度条宽度（0–100） */
export function barWidth(ratio) {
  const v = Math.max(0, Math.min(1, num(ratio)));
  return `${(v * 100).toFixed(2)}%`;
}
