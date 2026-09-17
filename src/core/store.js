/**
 * 应用状态与数据编排（纯云端模式）
 *
 * 数据一律放在 Supabase，通过登录账号访问；不再有「存在浏览器本地」这条路径。
 *
 * 生命周期：
 *   loading → needConfig（还没填 Supabase 连接信息）
 *           → needLogin （填好了但没登录 / 登录过期）
 *           → ready     （已登录，数据可用）
 *           → error     （连上了但出了别的岔子）
 */

import { reactive, computed } from 'vue';
import { createSupabaseAdapter } from '../adapters/supabase.js';
import {
  configureAuth, restoreSession, signIn, signUp, signOut, sendPasswordReset,
  authState, clearAuthMessages,
} from './auth.js';
import { computeAll, fixedAssetPnl } from './compute.js';
import { newRole, newProduct, newAsset, newChar, demoData, uid, collectZoneNames, num, round2, todayStr } from './model.js';

const CFG_KEY = 'mhxy_cbg_cfg';

function loadCfg() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
function persistCfg(cfg) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch { /* 隐私模式下可能失败，不影响主流程 */ }
}

const savedCfg = loadCfg();

/** index.html 里可以预置一份连接信息（公开密钥用）；没手动填过就用它 */
const presetCfg = (typeof window !== 'undefined' && window.__CBG_DEFAULT_CFG__) || {};

export const state = reactive({
  /** loading | needConfig | needLogin | error | ready */
  phase: 'loading',
  bootError: '',

  loading: false,
  syncing: false,

  /** 'project'（项目视角） | 'unit'（单品视角） */
  view: savedCfg.view || 'project',

  roles: [],
  products: [],
  /** 固定资产：自己常玩的号（chars）+ 号里的东西（assets），独立于倒卖核算 */
  chars: [],
  assets: [],

  cfg: {
    supabaseUrl: savedCfg.supabaseUrl || presetCfg.supabaseUrl || '',
    supabaseKey: savedCfg.supabaseKey || presetCfg.supabaseKey || '',
  },

  notice: null,

  /** ?demo=1 演示预览：数据只放在内存里，不落库，保存操作会被拦下 */
  demoMode: false,
});

/** 登录状态（透传 auth.js 的响应式对象，UI 直接绑） */
export const auth = authState;

/** 全站统计（响应式，数据一改就重算） */
export const stats = computed(() => computeAll(state, { view: state.view }));

/**
 * 区服列表：从角色 / 商品里自动汇总去重，永远是数据的真实映射。
 * 不需要（也无法）手工维护 —— 你录一个新区，它自己就出现了。
 */
export const zoneList = computed(() => collectZoneNames(state.roles, state.products));

/**
 * 固定资产统一视图：自玩号 + 号内物品，一条条带上「已售」账目。
 *
 * 卖掉的条目**保留在列表里**（只标 sold），所以这里天然分成 holding / sold 两拨：
 * 固定资产页用它渲染已售状态，分析页「固定资产流出」直接读 sold 那拨出账。
 * 这样同一笔卖只在数据里存在一份，不会出现「记录」和「流出商品」对不上的情况。
 */
export const fixedAssets = computed(() => {
  const decorate = (row, kind) => {
    const pnl = fixedAssetPnl(row, kind);
    return {
      ...row,
      __kind: kind,
      _cost: pnl.cost,
      _fee: pnl.fee,
      _net: pnl.net,
      _profit: pnl.profit,
      _category: pnl.category,
    };
  };
  const rows = [
    ...state.chars.map((c) => decorate(c, 'char')),
    ...state.assets.map((a) => decorate(a, 'asset')),
  ];
  const holding = rows.filter((r) => !r.sold);
  const sold = rows.filter((r) => r.sold);
  const sum = (list, f) => round2(list.reduce((s, r) => s + f(r), 0));
  return {
    rows,
    holding,
    sold,
    holdingCost: sum(holding, (r) => r._cost),
    soldCost: sum(sold, (r) => r._cost),
    soldNet: sum(sold, (r) => r._net),
    soldProfit: sum(sold, (r) => r._profit),
  };
});

export const roleById = (id) => state.roles.find((r) => r.id === id) || null;

// ---------------------------------------------------------------- 通知

let noticeTimer = null;
export function notify(text, type = 'info') {
  state.notice = { id: uid(), text, type };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { state.notice = null; }, 4200);
}

// ---------------------------------------------------------------- 适配器

let adapter = null;

function makeAdapter() {
  return createSupabaseAdapter(state.cfg.supabaseUrl, state.cfg.supabaseKey);
}

/** 登录过期 → 清数据、回登录页 */
function handleAuthExpired(message) {
  state.roles = [];
  state.products = [];
  adapter = null;
  state.phase = 'needLogin';
  notify(message || '登录已过期，请重新登录', 'warn');
}

// ---------------------------------------------------------------- 启动

export async function boot() {
  // ?demo=1 —— 不连库、不落库，直接用演示数据预览界面。
  // 给「数据库还没建好，想先看看后台长什么样」和排查问题用。
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')) {
    const d = demoData();
    state.roles = d.roles;
    state.products = d.products;
    state.chars = d.chars || [];
    state.assets = d.assets || [];
    state.demoMode = true;
    state.phase = 'ready';
    return;
  }

  state.phase = 'loading';
  state.bootError = '';

  if (!state.cfg.supabaseUrl || !state.cfg.supabaseKey) {
    state.phase = 'needConfig';
    return;
  }

  configureAuth(state.cfg.supabaseUrl, state.cfg.supabaseKey);

  let signed = false;
  try {
    signed = await restoreSession();
  } catch (e) {
    state.bootError = e.message;
    state.phase = 'needLogin';
    return;
  }

  if (!signed) {
    state.phase = 'needLogin';
    return;
  }

  await enterApp();
}

/** 登录成功（或会话恢复）后加载数据、进入后台 */
async function enterApp() {
  state.loading = true;
  try {
    adapter = makeAdapter();
    await adapter.init();
    await reload();
    state.phase = 'ready';
  } catch (e) {
    if (e.authExpired) {
      handleAuthExpired();
      return;
    }
    state.bootError = e.hint ? `${e.message}　·　${e.hint}` : e.message;
    state.phase = 'error';
  } finally {
    state.loading = false;
  }
}

export async function reload() {
  if (!adapter) return;
  const data = await adapter.loadAll();
  state.roles = data.roles || [];
  state.products = data.products || [];
  state.chars = data.chars || [];
  state.assets = data.assets || [];
}

// ---------------------------------------------------------------- 连接配置 & 登录

/** 保存 Supabase 连接信息（保存后需要登录） */
export async function saveConfig(url, key) {
  state.cfg.supabaseUrl = String(url || '').trim().replace(/\/+$/, '');
  state.cfg.supabaseKey = String(key || '').trim();
  persistCfg({ view: state.view, supabaseUrl: state.cfg.supabaseUrl, supabaseKey: state.cfg.supabaseKey });
  configureAuth(state.cfg.supabaseUrl, state.cfg.supabaseKey);
  clearAuthMessages();
  state.bootError = '';
  state.phase = 'needLogin';
}

/** 换一个 Supabase 项目：清掉连接信息和登录态 */
export async function resetConfig() {
  await signOut();
  state.cfg.supabaseUrl = '';
  state.cfg.supabaseKey = '';
  persistCfg({ view: state.view });
  state.roles = [];
  state.products = [];
  adapter = null;
  clearAuthMessages();
  state.bootError = '';
  state.phase = 'needConfig';
}

export async function login(email, password) {
  const ok = await signIn(email, password);
  if (ok) await enterApp();
  return ok;
}

export async function register(email, password) {
  const ok = await signUp(email, password);
  if (ok) await enterApp();
  return ok;
}

export async function resetPassword(email) {
  return sendPasswordReset(email);
}

export async function logout() {
  await signOut();
  state.roles = [];
  state.products = [];
  adapter = null;
  clearAuthMessages();
  state.phase = 'needLogin';
  notify('已退出登录', 'ok');
}

export function setView(v) {
  state.view = v;
  persistCfg({ view: v, supabaseUrl: state.cfg.supabaseUrl, supabaseKey: state.cfg.supabaseKey });
}

// ---------------------------------------------------------------- CRUD

async function persist(table, row) {
  // 演示模式：只改内存里的数据，刷新即还原 —— 让你在配好数据库前完整体验增删改
  if (state.demoMode) {
    const list = state[table];
    const i = list.findIndex((x) => x.id === row.id);
    if (i >= 0) list[i] = { ...row }; else list.push({ ...row });
    return true;
  }
  if (!adapter) { notify('还没连上数据源', 'error'); return false; }
  state.syncing = true;
  try {
    await adapter.save(table, row);
    const list = state[table];
    const i = list.findIndex((x) => x.id === row.id);
    if (i >= 0) list[i] = { ...row }; else list.push({ ...row });
    return true;
  } catch (e) {
    if (e.authExpired) { handleAuthExpired(); return false; }
    notify(`保存失败：${e.message}`, 'error');
    return false;
  } finally {
    state.syncing = false;
  }
}

async function drop(table, id) {
  if (state.demoMode) {
    state[table] = state[table].filter((x) => x.id !== id);
    return true;
  }
  if (!adapter) return false;
  state.syncing = true;
  try {
    await adapter.remove(table, id);
    state[table] = state[table].filter((x) => x.id !== id);
    return true;
  } catch (e) {
    if (e.authExpired) { handleAuthExpired(); return false; }
    notify(`删除失败：${e.message}`, 'error');
    return false;
  } finally {
    state.syncing = false;
  }
}

export const saveRole = (row) => persist('roles', row);
export const saveProduct = (row) => persist('products', row);

/** 删除角色：名下商品解除挂靠，不删商品 */
export async function deleteRole(id) {
  const children = state.products.filter((p) => p.role_id === id);
  for (const c of children) {
    await persist('products', { ...c, role_id: null });
  }
  return drop('roles', id);
}

export const deleteProduct = (id) => drop('products', id);
export const saveAsset = (row) => persist('assets', row);
export const deleteAsset = (id) => drop('assets', id);
export const saveChar = (row) => persist('chars', row);
export const deleteChar = (id) => drop('chars', id);

/** 删除自玩号：号内的物品解除挂靠（变未归号），不删物品 */
export async function deleteCharKeepAssets(id) {
  const items = state.assets.filter((a) => a.char_id === id);
  for (const a of items) {
    await persist('assets', { ...a, char_id: null });
  }
  return drop('chars', id);
}

// ---------------------------------------------------------------- 业务动作

export function createRole(patch = {}) {
  return newRole({ ...patch });
}

export function createProduct(patch = {}) {
  return newProduct({ ...patch });
}

export async function sellRole(role, payload) {
  const next = {
    ...role,
    status: 'sold',
    listed: true,
    sale_price: payload.sale_price,
    sale_net: payload.sale_net === '' || payload.sale_net == null ? null : payload.sale_net,
    sale_date: payload.sale_date || '',
    sold_zone: payload.sold_zone || role.zone,
  };
  const ok = await saveRole(next);
  if (ok) notify(`「${role.name}」已登记售出`, 'ok');
  return ok;
}

export async function unsellRole(role) {
  const ok = await saveRole({ ...role, status: 'holding', sale_date: '', sale_price: 0, sale_net: null });
  if (ok) notify(`「${role.name}」已回到持有中`, 'ok');
  return ok;
}

export async function sellProduct(product, payload) {
  const next = {
    ...product,
    status: 'sold',
    listed: true,
    sale_price: payload.sale_price,
    sale_net: payload.sale_net === '' || payload.sale_net == null ? null : payload.sale_net,
    sale_date: payload.sale_date || '',
    sold_zone: payload.sold_zone || product.zone,
  };
  const ok = await saveProduct(next);
  if (ok) notify(`「${product.name}」已登记售出`, 'ok');
  return ok;
}

export async function unsellProduct(product) {
  const ok = await saveProduct({ ...product, status: 'holding', sale_date: '', sale_price: 0, sale_net: null });
  if (ok) notify(`「${product.name}」已回到持有中`, 'ok');
  return ok;
}

export async function toggleListed(item) {
  const table = state.products.some((p) => p.id === item.id) ? 'products' : 'roles';
  return persist(table, { ...item, listed: !item.listed });
}

/**
 * 固定资产售出 —— 在**原记录上打标记**，记录保留。
 *
 * 号 / 物品带着购入成本继续留在固定资产里，只是标成「已售」：
 * 不再算「还在手上」，但售出价、到手价、实际盈亏都能回看，也能撤销。
 * 分析页的「固定资产流出」直接读这批已售记录，不另外复制一份，避免同一笔账存两份。
 *
 * 号卖出时按「角色」类别计费（5%、保底 60、封顶 1000）；号里的物品不受影响，
 * 还是挂在它名下。
 *
 * @param {object} source 被卖的固定资产条目（char 或 asset）
 * @param {'char'|'asset'} kind
 * @param {{sale_price:number|string, sale_net:number|string|null, sale_date:string, sold_zone:string}} payload
 */
export async function sellFixedAsset(source, kind, payload) {
  const isChar = kind === 'char';
  const table = isChar ? 'chars' : 'assets';
  const name = String(source.name || '').trim() || (isChar ? '自玩号' : '固定资产');

  const next = {
    ...source,
    sold: true,
    sale_price: num(payload.sale_price),
    sale_net: payload.sale_net === '' || payload.sale_net == null ? null : num(payload.sale_net),
    sale_date: payload.sale_date || todayStr(),
    sold_zone: String(payload.sold_zone || source.zone || '').trim(),
  };

  const ok = await persist(table, next);
  if (ok) notify(`「${name}」已标记售出，转去分析页「固定资产流出」出账`, 'ok');
  return ok;
}

/** 撤销售出：清掉标记和售出信息，重新算回「还在手上」 */
export async function unsellFixedAsset(source, kind) {
  const isChar = kind === 'char';
  const table = isChar ? 'chars' : 'assets';
  const next = {
    ...source,
    sold: false,
    sale_price: 0,
    sale_net: null,
    sale_date: '',
    sold_zone: '',
  };
  const ok = await persist(table, next);
  if (ok) notify(`「${source.name}」已撤销售出，回到还在手上`, 'ok');
  return ok;
}

// ---------------------------------------------------------------- 备份

export function exportJSON() {
  return JSON.stringify(
    {
      _app: 'mhxy-cbg-manager',
      _version: 1,
      _exportedAt: new Date().toISOString(),
      _account: authState.user?.email || '',
      roles: state.roles,
      products: state.products,
      assets: state.assets,
    },
    null,
    2
  );
}

export async function importJSON(text, { merge = false } = {}) {
  if (!adapter) { notify('还没连上数据源', 'error'); return false; }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    notify('导入失败：不是合法的 JSON 文件', 'error');
    return false;
  }
  if (!data || (!data.roles && !data.products && !data.assets && !data.chars)) {
    notify('导入失败：文件里没有可识别的数据', 'error');
    return false;
  }
  state.loading = true;
  try {
    const payload = {
      roles: data.roles || [],
      products: Object.keys(data).includes('products') ? data.products : [],
      chars: Object.keys(data).includes('chars') ? data.chars : [],
      assets: Object.keys(data).includes('assets') ? data.assets : [],
    };
    if (merge) {
      for (const t of ['chars', 'roles', 'products', 'assets']) {
        for (const row of payload[t]) await persist(t, row);
      }
    } else {
      await adapter.replaceAll(payload);
      await reload();
    }
    notify(`导入完成：${payload.roles.length} 个角色 / ${payload.products.length} 件商品 / ${payload.assets.length} 件固定资产`, 'ok');
    return true;
  } catch (e) {
    if (e.authExpired) { handleAuthExpired(); return false; }
    notify(`导入失败：${e.message}`, 'error');
    return false;
  } finally {
    state.loading = false;
  }
}

export async function loadDemo() {
  if (!adapter) { notify('还没连上数据源', 'error'); return; }
  state.loading = true;
  try {
    await adapter.replaceAll(demoData());
    await reload();
    notify('已载入演示数据，可随时在「设置」里清空', 'ok');
  } catch (e) {
    if (e.authExpired) { handleAuthExpired(); return; }
    notify(`载入失败：${e.message}`, 'error');
  } finally {
    state.loading = false;
  }
}

export async function clearAll() {
  if (!adapter) return;
  state.loading = true;
  try {
    await adapter.clear();
    await reload();
    notify('数据已清空', 'ok');
  } catch (e) {
    if (e.authExpired) { handleAuthExpired(); return; }
    notify(`清空失败：${e.message}`, 'error');
  } finally {
    state.loading = false;
  }
}
