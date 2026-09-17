/**
 * Supabase Auth 的零依赖封装
 *
 * 只用 GoTrue 的 REST 接口，不引入 supabase-js，保持整个项目零构建、零外部 JS。
 * 登录后拿到 access_token，后续所有 PostgREST 请求都带上它，
 * 这样数据库的 RLS 策略就能用 auth.uid() 把数据隔离到「你自己的账号」下面。
 *
 * 会话存在 localStorage：access_token + refresh_token + 过期时间。
 * 到期前 60 秒会自动刷新，用户不会在操作中途被踢出去。
 */

import { reactive } from 'vue';

const SESSION_KEY = 'mhxy_cbg_session';
/** 提前多久刷新（毫秒） */
const REFRESH_AHEAD = 60 * 1000;

/** 给 UI 用的响应式状态 */
export const authState = reactive({
  /** idle | signedIn | signedOut | error */
  status: 'idle',
  user: null,          // { id, email }
  error: '',
  busy: false,
  /** 注册后如果需要邮箱验证，Supabase 会返回这个提示 */
  notice: '',
});

let cfg = { url: '', key: '' };
let session = null;      // { access_token, refresh_token, expires_at, user }
let refreshTimer = null;

// ---------------------------------------------------------------- 基础

function normalizedUrl() {
  return String(cfg.url || '').replace(/\/+$/, '');
}

function apiBase() {
  return `${normalizedUrl()}/auth/v1`;
}

function baseHeaders() {
  return {
    apikey: cfg.key,
    'Content-Type': 'application/json',
  };
}

/** 把 Supabase 的英文报错翻译成能看懂的中文 */
function friendlyError(httpStatus, data) {
  const msg = String(
    data?.error_description || data?.msg || data?.message || data?.error || ''
  );
  const code = String(data?.error_code || data?.code || data?.error || '');

  if (/invalid login credentials/i.test(msg) || code === 'invalid_credentials') {
    return '邮箱或密码不正确';
  }
  if (/email not confirmed/i.test(msg) || code === 'email_not_confirmed') {
    return '邮箱还没验证。去收件箱点一下确认链接；或者到 Supabase 控制台把该用户设为已确认（Auto Confirm）。';
  }
  if (/user already registered|already been registered/i.test(msg)) {
    return '这个邮箱已经注册过了，直接登录吧';
  }
  if (/password should be at least/i.test(msg)) {
    return '密码太短了，Supabase 默认要求至少 6 位';
  }
  if (/signups? not allowed|signup.*disabled|Email signups are disabled/i.test(msg)) {
    return '这个项目关闭了注册。请到 Supabase 控制台 → Authentication → Users 里手工建账号。';
  }
  if (/invalid api key|no api key/i.test(msg)) {
    return 'anon key 不对，检查一下有没有复制完整';
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return '连不上 Supabase，检查一下 Project URL 是否正确、网络是否通畅';
  }
  if (httpStatus === 429) return '请求太频繁，等一分钟再试';
  if (httpStatus === 400 && /email/i.test(msg)) return `邮箱格式或内容有问题：${msg}`;
  return msg || `请求失败（HTTP ${httpStatus}）`;
}

async function call(path, { method = 'POST', body, token } = {}) {
  // fetch 本身失败（DNS 解析不了、断网、被墙、项目暂停）不会返回 HTTP 状态，
  // 而是直接抛异常，这里统一转成能看懂的中文，并加 15 秒超时防空转。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: token
        ? { ...baseHeaders(), Authorization: `Bearer ${token}` }
        : baseHeaders(),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const isAbort = e?.name === 'AbortError';
    const err = new Error(
      isAbort
        ? '请求超时。检查一下 Project URL 是否填对、网络是否通畅（国内访问 Supabase 有时需要代理）。'
        : '连不上 Supabase。检查三件事：① Project URL 是否填对（要以 https:// 开头）；② 网络是否通畅（国内访问 Supabase 有时需要代理）；③ 项目是不是被暂停了。'
    );
    err.network = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
  }

  if (!res.ok) {
    const err = new Error(friendlyError(res.status, data));
    err.status = res.status;
    err.raw = data;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- 会话存取

function persist() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* 隐私模式可能写不了，忽略 */ }
}

function toSession(data) {
  if (!data || !data.access_token) return null;
  const expiresIn = Number(data.expires_in) || 3600;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session?.refresh_token || '',
    expires_at: Date.now() + expiresIn * 1000,
    user: data.user
      ? { id: data.user.id, email: data.user.email }
      : (session?.user || null),
  };
}

function applySession(next) {
  session = next;
  persist();
  if (next) {
    authState.user = next.user;
    authState.status = 'signedIn';
    authState.error = '';
    scheduleRefresh();
  } else {
    authState.user = null;
    authState.status = 'signedOut';
    clearRefresh();
  }
}

// ---------------------------------------------------------------- 自动刷新

function clearRefresh() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
}

function scheduleRefresh() {
  clearRefresh();
  if (!session) return;
  const delay = Math.max(5000, session.expires_at - Date.now() - REFRESH_AHEAD);
  refreshTimer = setTimeout(() => {
    refreshSession().catch(() => {
      // 刷新失败（比如 refresh_token 被撤销）→ 退出登录
      applySession(null);
    });
  }, delay);
}

// ---------------------------------------------------------------- 对外接口

/** 配置 Supabase 连接信息（改配置后需要重新登录） */
export function configureAuth(url, anonKey) {
  cfg = { url: String(url || '').trim(), key: String(anonKey || '').trim() };
}

export function getAccessToken() {
  return session?.access_token || '';
}

export function getUserId() {
  return session?.user?.id || '';
}

export function isSignedIn() {
  return !!session && authState.status === 'signedIn';
}

/** 启动时从 localStorage 恢复会话；过期就尝试刷新 */
export async function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch { saved = null; }

  if (!saved?.access_token) {
    authState.status = 'signedOut';
    return false;
  }

  session = saved;
  authState.user = saved.user || null;
  authState.status = 'signedIn';

  // 已过期或快过期 → 先刷新
  if (Date.now() > (saved.expires_at || 0) - REFRESH_AHEAD) {
    try {
      await refreshSession();
    } catch {
      applySession(null);
      return false;
    }
  } else {
    scheduleRefresh();
  }

  // 顺手验证一下 token 还有效（比如密码被改过、会话被撤销）
  try {
    const user = await call('/user', { method: 'GET', token: session.access_token });
    session.user = { id: user.id, email: user.email };
    persist();
    authState.user = session.user;
  } catch (e) {
    if (e.status === 401) {
      try {
        await refreshSession();
      } catch {
        applySession(null);
        return false;
      }
    }
    // 其它错误（比如网络抖动）不动会话，让上层自己处理
  }

  return true;
}

export async function signIn(email, password) {
  authState.busy = true;
  authState.error = '';
  try {
    const data = await call('/token?grant_type=password', {
      body: { email: String(email).trim(), password },
    });
    if (!data?.access_token) throw new Error('登录成功但没拿到 token，请检查 anon key');
    applySession(toSession(data));
    return true;
  } catch (e) {
    authState.error = e.message;
    authState.status = 'signedOut';
    return false;
  } finally {
    authState.busy = false;
  }
}

export async function signUp(email, password) {
  authState.busy = true;
  authState.error = '';
  authState.notice = '';
  try {
    const data = await call('/signup', {
      body: { email: String(email).trim(), password },
    });

    // 开了「邮箱验证」时，signup 不返回 token，只返回 user
    if (data?.access_token) {
      applySession(toSession(data));
      return true;
    }

    if (data?.user) {
      authState.notice = '注册成功。你的项目开启了邮箱验证，去收件箱点确认链接后再回来登录。';
      authState.status = 'signedOut';
      return false;
    }

    throw new Error('注册没有返回预期结果，请到 Supabase 控制台检查 Auth 设置');
  } catch (e) {
    authState.error = e.message;
    return false;
  } finally {
    authState.busy = false;
  }
}

export async function refreshSession() {
  if (!session?.refresh_token) throw new Error('没有可用的 refresh_token');
  const data = await call('/token?grant_type=refresh_token', {
    body: { refresh_token: session.refresh_token },
  });
  const next = toSession(data);
  if (!next) throw new Error('刷新会话失败');
  applySession(next);
  return true;
}

export async function signOut() {
  const token = session?.access_token;
  applySession(null);
  if (token) {
    // 通知服务端撤销会话，失败也无所谓，本地已经清了
    try { await call('/logout', { token }); } catch { /* ignore */ }
  }
}

/** 发一封重置密码的邮件（需要在 Supabase 配好 Site URL） */
export async function sendPasswordReset(email) {
  authState.busy = true;
  authState.error = '';
  authState.notice = '';
  try {
    await call('/recover', { body: { email: String(email).trim() } });
    authState.notice = '重置密码的邮件已发出，去收件箱看看（记得先在 Supabase 配好 Site URL，否则链接会跳到 localhost）。';
    return true;
  } catch (e) {
    authState.error = e.message;
    return false;
  } finally {
    authState.busy = false;
  }
}

/** 清掉登录失败之类的一次性提示 */
export function clearAuthMessages() {
  authState.error = '';
  authState.notice = '';
}
