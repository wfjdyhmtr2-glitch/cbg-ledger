/**
 * 登录 / 首次连接
 *
 * 三步走：
 *   1. 没填过连接信息 → 引导填 Supabase URL + anon key
 *   2. 填过但没登录   → 登录 / 注册
 *   3. 登录已过期     → 同样回到这里
 */

import { state, auth, saveConfig, login, register, resetPassword, setNewPassword } from '../core/store.js';

export const Login = {
  data() {
    return {
      url: state.cfg.supabaseUrl || '',
      key: state.cfg.supabaseKey || '',
      email: '',
      password: '',
      tab: 'signin',
      pwd1: '',
      pwd2: '',
      showKey: false,
      showPwd: false,
      showGuide: false,
      localErr: '',
    };
  },
  computed: {
    phase() { return state.phase; },
    busy() { return auth.busy || state.loading; },
    err() { return this.localErr || auth.error || state.bootError; },
    notice() { return auth.notice; },
    hasCfg() { return !!(state.cfg.supabaseUrl && state.cfg.supabaseKey); },
    /** 从「忘记密码」邮件跳回来的：先设新密码 */
    recovery() { return auth.recovery === true; },
    /** 模板里不能直接用模块导入的 auth，包一层 */
    userEmail() { return auth.user?.email || ''; },
    /** 项目关了注册就不显示「注册新账号」——那时点了必然报错，纯属误导 */
    signupDisabled() { return auth.signupDisabled === true; },
    submitting() {
      return state.phase === 'loading' || auth.busy;
    },
  },
  mounted() {
    // 从「设置」里退出登录回来时，光标直接落在邮箱框
    this.$nextTick(() => {
      const el = this.$refs.email;
      if (el) el.focus();
    });
  },
  methods: {
    async submitConfig() {
      this.localErr = '';
      if (!this.url.trim()) { this.localErr = '请填写 Project URL'; return; }
      if (!this.key.trim()) { this.localErr = '请填写 anon public key'; return; }
      if (!/^https?:\/\//i.test(this.url.trim())) {
        this.localErr = 'Project URL 要以 https:// 开头，例如 https://abcdefg.supabase.co';
        return;
      }
      await saveConfig(this.url, this.key);
    },
    async submitAuth() {
      this.localErr = '';
      if (!this.email.trim()) { this.localErr = '请填写邮箱'; return; }
      if (!this.password) { this.localErr = '请填写密码'; return; }
      if (this.tab === 'signup') await register(this.email, this.password);
      else await login(this.email, this.password);
    },
    async forgot() {
      this.localErr = '';
      if (!this.email.trim()) { this.localErr = '先填写邮箱，再点忘记密码'; return; }
      await resetPassword(this.email);
    },
    /** 设新密码 —— 成功后 store 会直接把人送进后台 */
    async submitNewPwd() {
      this.localErr = '';
      if (!this.pwd1) { this.localErr = '请填写新密码'; return; }
      if (this.pwd1.length < 6) { this.localErr = '密码至少 6 位'; return; }
      if (this.pwd1 !== this.pwd2) { this.localErr = '两次输入的密码不一致'; return; }
      await setNewPassword(this.pwd1);
    },
    switchTab(t) {
      this.tab = t;
      this.localErr = '';
      auth.error = '';
      auth.notice = '';
    },
  },
  template: `
  <div class="login-wrap">
    <div class="login-card">

      <div class="login-brand">
        <span class="logo">藏</span>
        <div class="brand-text">
          <b>藏宝阁台账</b>
          <span class="brand-sub">梦幻西游</span>
        </div>
      </div>

      <!-- 正在恢复会话 -->
      <template v-if="phase === 'loading'">
        <div class="login-loading">
          <div class="spinner"></div>
          <p class="muted">正在恢复登录状态…</p>
        </div>
      </template>

      <!-- 第 1 步：连接 Supabase -->
      <template v-else-if="!hasCfg">
        <h2>连接你的 Supabase</h2>
        <p class="login-sub">
          数据全部存放在你自己的 Supabase 项目里，用法等同于「你自己的数据库」。
          先填一下连接信息，之后只需要登录即可。
        </p>

        <Field label="Project URL">
          <input class="input" v-model.trim="url" placeholder="https://xxxxxxxx.supabase.co"
            autocomplete="off" @keyup.enter="submitConfig" />
        </Field>

        <Field label="anon public key" hint="只填 anon 这个公开密钥；service_role 是管理员密钥，绝对不能填进来">
          <div class="input-with-btn">
            <input class="input" :type="showKey ? 'text' : 'password'" v-model.trim="key"
              placeholder="eyJhbGciOiJIUzI1NiIs..." autocomplete="off" @keyup.enter="submitConfig" />
            <button class="btn tiny" type="button" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
          </div>
        </Field>

        <p class="form-err" v-if="err">{{ err }}</p>

        <button class="btn primary block" :disabled="submitting" @click="submitConfig">
          {{ submitting ? '正在连接…' : '保存并继续' }}
        </button>

        <button class="guide-toggle" @click="showGuide = !showGuide">
          {{ showGuide ? '▾' : '▸' }} 还没建项目？点这里看步骤
        </button>

        <ol class="login-guide" v-if="showGuide">
          <li>到 <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> 注册并新建一个项目（免费额度够用）</li>
          <li>项目建好后，左侧 <b>Project Settings → API</b></li>
          <li>复制 <b>Project URL</b> 和 <b>anon public key</b>，填到上面两个框里</li>
          <li>到 Supabase 左侧 <b>SQL Editor</b>，把项目里 <code>supabase/schema.sql</code> 的内容整段粘贴执行一次</li>
          <li>建账号：默认可以在上面点「注册新账号」；<b>如果关了注册</b>，就到 Supabase 的
            <b>Authentication → Users → Add user</b> 手工建一个（勾上 Auto Confirm）</li>
          <li>回到这里登录，就能开始录数据了</li>
        </ol>
      </template>

      <!-- 从「忘记密码」邮件跳回来：先设新密码，设完直接进后台 -->
      <template v-else-if="recovery">
        <h2>设置新密码</h2>
        <p class="login-sub">
          邮箱已验证，设一个新密码就完成。
          <template v-if="userEmail">（{{ userEmail }}）</template>
        </p>

        <Field label="新密码" hint="至少 6 位">
          <div class="input-with-btn">
            <input class="input" :type="showPwd ? 'text' : 'password'" v-model="pwd1"
              placeholder="••••••••" autocomplete="new-password" @keyup.enter="submitNewPwd" />
            <button class="btn tiny" type="button" @click="showPwd = !showPwd">{{ showPwd ? '隐藏' : '显示' }}</button>
          </div>
        </Field>

        <Field label="再输一次">
          <input class="input" :type="showPwd ? 'text' : 'password'" v-model="pwd2"
            placeholder="••••••••" autocomplete="new-password" @keyup.enter="submitNewPwd" />
        </Field>

        <p class="form-err" v-if="err">{{ err }}</p>
        <p class="form-hint" v-if="notice && !err">{{ notice }}</p>

        <button class="btn primary block" :disabled="submitting" @click="submitNewPwd">
          {{ submitting ? '保存中…' : '保存新密码并进入' }}
        </button>
      </template>

      <!-- 第 2 步：登录 / 注册 -->
      <template v-else>
        <h2>{{ tab === 'signin' ? '登录' : '注册新账号' }}</h2>
        <p class="login-sub">
          {{ tab === 'signin'
            ? '登录后即可读写你账号下的全部角色、商品数据。'
            : '注册后这个账号就是你的专属入口，别人看不到你的数据。' }}
        </p>

        <div class="login-tabs" v-if="!signupDisabled">
          <button :class="{ active: tab === 'signin' }" @click="switchTab('signin')">登录</button>
          <button :class="{ active: tab === 'signup' }" @click="switchTab('signup')">注册新账号</button>
        </div>

        <Field label="邮箱">
          <input class="input" ref="email" type="email" v-model.trim="email"
            placeholder="you@example.com" autocomplete="username" @keyup.enter="submitAuth" />
        </Field>

        <Field label="密码" :hint="tab === 'signup' ? '至少 6 位' : ''">
          <div class="input-with-btn">
            <input class="input" :type="showPwd ? 'text' : 'password'" v-model="password"
              placeholder="••••••••" autocomplete="current-password" @keyup.enter="submitAuth" />
            <button class="btn tiny" type="button" @click="showPwd = !showPwd">{{ showPwd ? '隐藏' : '显示' }}</button>
          </div>
        </Field>

        <p class="form-err" v-if="err">{{ err }}</p>
        <p class="form-hint" v-if="notice">{{ notice }}</p>

        <button class="btn primary block" :disabled="submitting" @click="submitAuth">
          {{ submitting ? '处理中…' : (tab === 'signin' ? '登录' : '注册并进入') }}
        </button>

        <div class="login-foot">
          <a v-if="tab === 'signin'" class="link" @click="forgot">忘记密码？</a>
          <span v-else class="muted small">注册后如果提示需要验证邮箱，去收件箱点一下确认链接即可</span>
        </div>
      </template>

    </div>
  </div>`,
};
