/**
 * Supabase 数据适配器（PostgREST）
 *
 * 与 auth.js 配合：每个请求都带当前登录用户的 access_token，
 * 数据库那边用 RLS 的 auth.uid() 保证你只能读写自己的记录。
 *
 * token 过期时会自动刷新并重试一次；刷新失败则抛出 authExpired，
 * 由上层清理登录态、回到登录页。
 *
 * 四张表：roles / products（倒卖） + chars / assets（固定资产）。
 * 区服是 roles / products 身上的文本字段（zone / sold_zone），不单独建表 —— 列表由前端汇总得出。
 * chars / assets 是固定资产（自己常玩的号 + 号里的东西），完全独立于倒卖核算。
 */

import { num } from '../core/model.js';
import { getAccessToken, refreshSession } from '../core/auth.js';

const TABLES = ['roles', 'products', 'chars', 'assets'];

/** 把前端对象规整成数据库行，避免多出未知字段导致 PostgREST 400 */
function toRow(table, row) {
  const base = {
    id: String(row.id),
    created_at: row.created_at || new Date().toISOString(),
  };
  if (table === 'roles') {
    return {
      ...base,
      zone: row.zone || '',
      name: row.name || '',
      level: row.level == null || row.level === '' ? null : Math.round(num(row.level)),
      school: row.school || '',
      purchase_price: num(row.purchase_price),
      purchase_date: row.purchase_date || null,
      transfer_fee: num(row.transfer_fee),
      other_cost: num(row.other_cost),
      status: row.status || 'holding',
      is_shell: !!row.is_shell,
      listed: !!row.listed,
      listed_price: num(row.listed_price),
      est_value: row.est_value === '' || row.est_value == null ? null : num(row.est_value),
      sale_price: num(row.sale_price),
      sale_net: row.sale_net === '' || row.sale_net == null ? null : num(row.sale_net),
      sale_date: row.sale_date || null,
      sold_zone: row.sold_zone || '',
      note: row.note || '',
    };
  }
  if (table === 'chars') {
    return {
      ...base,
      zone: row.zone || '',
      name: row.name || '',
      purchase_price: num(row.purchase_price),
      purchase_date: row.purchase_date || null,
      note: row.note || '',
    };
  }
  if (table === 'assets') {
    return {
      ...base,
      char_id: row.char_id || null,
      name: row.name || '',
      category: row.category || 'equipment',
      sub_category: row.sub_category || '',
      cost: num(row.cost),
      purchase_date: row.purchase_date || null,
      cross_server: row.cross_server === true,
      note: row.note || '',
    };
  }
  return {
    ...base,
    zone: row.zone || '',
    name: row.name || '',
    category: row.category || 'equipment',
    sub_category: row.sub_category || '',
    from_asset: !!row.from_asset,
    role_id: row.role_id || null,
    purchase_price: num(row.purchase_price),
    purchase_date: row.purchase_date || null,
    allocated_cost: row.allocated_cost === '' || row.allocated_cost == null ? null : num(row.allocated_cost),
    est_value: row.est_value === '' || row.est_value == null ? null : num(row.est_value),
    status: row.status || 'holding',
    listed: !!row.listed,
    listed_price: num(row.listed_price),
    sale_price: num(row.sale_price),
    sale_net: row.sale_net === '' || row.sale_net == null ? null : num(row.sale_net),
    sale_date: row.sale_date || null,
    sold_zone: row.sold_zone || '',
    note: row.note || '',
  };
}

/** 把数据库行还原成前端对象（补默认值，避免 null 到处飞） */
function fromRow(table, r) {
  const out = { ...r };
  const pad = table === 'assets'
    ? ['purchase_date']
    : ['purchase_date', 'sale_date', 'zone', 'sold_zone'];
  pad.forEach((k) => { if (out[k] == null) out[k] = ''; });
  if (table === 'products' && out.role_id === undefined) out.role_id = null;
  return out;
}

export function createSupabaseAdapter(url, key) {
  const base = String(url || '').replace(/\/+$/, '');
  const apiKey = String(key || '').trim();

  const headers = (extra = {}) => ({
    apikey: apiKey,
    // 已登录就用用户的 token（RLS 才能按 auth.uid() 过滤）
    Authorization: `Bearer ${getAccessToken() || apiKey}`,
    'Content-Type': 'application/json',
    ...extra,
  });

  async function raw(path, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      return await fetch(`${base}/rest/v1/${path}`, {
        ...opts,
        headers: headers(opts.headers),
        signal: ctrl.signal,
      });
    } catch (e) {
      const err = new Error(
        e?.name === 'AbortError'
          ? '请求超时，Supabase 没有响应'
          : '连不上 Supabase，检查网络或 Project URL 是否正确'
      );
      err.network = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function req(path, opts = {}, retried = false) {
    const res = await raw(path, opts);

    if (res.ok) return res;

    // token 过期 → 刷新一次再重试
    if (res.status === 401 && !retried) {
      try {
        await refreshSession();
      } catch {
        const err = new Error('登录已过期，请重新登录');
        err.authExpired = true;
        throw err;
      }
      return req(path, opts, true);
    }

    if (res.status === 401) {
      const err = new Error('登录已过期，请重新登录');
      err.authExpired = true;
      throw err;
    }

    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    const err = new Error(`Supabase ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
    err.status = res.status;
    if (res.status === 404) {
      err.hint = '表不存在，请先在 Supabase SQL Editor 执行 supabase/schema.sql';
    } else if (res.status === 403) {
      err.hint = '没权限。多半是 RLS 策略没按 schema.sql 建好，或者 owner 字段没填上。';
    }
    throw err;
  }

  async function select(table) {
    const res = await req(`${table}?select=*&order=created_at.asc`);
    const rows = await res.json();
    return rows.map((r) => fromRow(table, r));
  }

  return {
    id: 'supabase',
    label: 'Supabase 云端',

    /** 探活：确认地址、密钥、表结构、RLS 都通了 */
    async init() {
      if (!base || !apiKey) throw new Error('请先填写 Supabase URL 和 anon key');
      await req('roles?select=id&limit=1');
    },

    async loadAll() {
      const [roles, products, chars, assets] = await Promise.all(TABLES.map(select));
      return { roles, products, chars, assets };
    },

    async save(table, row) {
      await req(table, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(toRow(table, row)),
      });
      return row;
    },

    async saveMany(table, rows) {
      if (!rows.length) return;
      await req(table, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.map((r) => toRow(table, r))),
      });
    },

    async remove(table, id) {
      await req(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    async clear(table) {
      const targets = table ? [table] : TABLES;
      for (const t of targets) {
        await req(`${t}?id=not.is.null`, { method: 'DELETE' });
      }
    },

    async replaceAll(data) {
      await this.clear();
      for (const t of TABLES) {
        const rows = data[t] || [];
        if (rows.length) await this.saveMany(t, rows);
      }
    },
  };
}
