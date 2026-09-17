/**
 * 应用入口：组件注册 + 极简 hash 路由 + 启动
 *
 * 未登录（或还没配置 Supabase）时只渲染登录页；登录成功后才进后台。
 */

import { createApp } from 'vue';
import { state, auth, boot, setView, notify, logout } from './core/store.js';
import {
  money, wan, pct, pctRaw, daysText, dateText,
  pnlTone, pnlClass, agingTone, agingText, truncate, barWidth,
} from './core/format.js';

// UI 基础件
import {
  Modal, Tag, Gap, StatCard, RecoverBar, Empty, Field,
  Segmented, Pnl, Verdict, InfoDot, NavLink, Expander, ActionRow,
} from './components/ui.js';
// 图表
import { Donut, MonthlyBars, AgingBars, MiniBar } from './components/charts.js';
import { ZoneInput } from './components/ZoneInput.js';
// 表单
import { RoleForm, ProductForm, SellForm, AssetForm, CharForm, AssetSellForm } from './components/forms.js';
// 页面
import { Login } from './views/Login.js';
import { Dashboard } from './views/Dashboard.js';
import { Roles } from './views/Roles.js';
import { Products } from './views/Products.js';
import { Zones } from './views/Zones.js';
import { Analysis } from './views/Analysis.js';
import { Settings } from './views/Settings.js';
import { Pricing } from './views/Pricing.js';
import { Assets } from './views/Assets.js';

const routes = {
  '/': Dashboard,
  '/roles': Roles,
  '/products': Products,
  '/zones': Zones,
  '/analysis': Analysis,
  '/pricing': Pricing,
  '/assets': Assets,
  '/settings': Settings,
};

const NAV = [
  { path: '/', title: '总览' },
  { path: '/roles', title: '角色' },
  { path: '/products', title: '商品' },
  { path: '/zones', title: '区服' },
  { path: '/analysis', title: '分析' },
  { path: '/pricing', title: '价值计算' },
  { path: '/assets', title: '固定资产' },
  { path: '/settings', title: '设置' },
];

function currentRoute() {
  const h = (window.location.hash || '#/').replace(/^#/, '');
  const clean = h.split('?')[0] || '/';
  return routes[clean] ? clean : '/';
}

const App = {
  data() {
    return { route: currentRoute(), nav: NAV };
  },
  computed: {
    comp() { return routes[this.route]; },
    viewOptions() {
      return [
        { value: 'project', label: '项目视角', hint: '角色为一个核算单元，看整票赚没赚' },
        { value: 'unit', label: '单品视角', hint: '把角色成本摊到每件商品上，看单品毛利' },
      ];
    },
    notice() { return state.notice; },
    ready() { return state.phase === 'ready'; },
    userEmail() { return auth.user?.email || ''; },
  },
  mounted() {
    window.addEventListener('hashchange', () => {
      this.route = currentRoute();
      window.scrollTo(0, 0);
    });
    boot();
  },
  methods: {
    setView,
    async doLogout() {
      if (!confirm('确认退出登录？云端数据不会丢，下次登录还能看到。')) return;
      await logout();
      window.location.hash = '#/';
      this.route = '/';
    },
  },
  template: `
  <div class="app">

    <!-- 未登录：只显示登录页 -->
    <Login v-if="!ready" />

    <!-- 已登录：完整后台 -->
    <template v-else>
      <header class="topbar">
        <div class="brand">
          <span class="logo">藏</span>
          <div class="brand-text">
            <b>藏宝阁台账</b>
            <span class="brand-sub">梦幻西游</span>
          </div>
        </div>

        <nav class="nav">
          <a v-for="n in nav" :key="n.path" :href="'#' + n.path"
            :class="{ active: route === n.path }">{{ n.title }}</a>
        </nav>

        <div class="topbar-right">
          <Segmented :modelValue="state.view" :options="viewOptions" @update:modelValue="setView" />
          <div class="user-box">
            <span class="user-email" :title="userEmail">{{ userEmail }}</span>
            <button class="btn tiny" @click="doLogout">退出</button>
          </div>
        </div>
      </header>

      <main class="main">
        <component :is="comp" :key="route" />
      </main>
    </template>

    <transition name="toast">
      <div v-if="notice" class="toast" :class="'toast-' + notice.type">{{ notice.text }}</div>
    </transition>

  </div>`,
};

const app = createApp(App);
app.config.globalProperties.state = state;

// 全局注册组件
const COMPONENTS = {
  Modal, Tag, Gap, StatCard, RecoverBar, Empty, Field, Segmented, Pnl, Verdict,
  InfoDot, NavLink, Expander, ActionRow,
  Donut, MonthlyBars, AgingBars, MiniBar, ZoneInput,
  RoleForm, ProductForm, SellForm, AssetForm, CharForm, AssetSellForm,  Login,
};
Object.entries(COMPONENTS).forEach(([name, comp]) => app.component(name, comp));

// 格式化方法做成全局 mixin，模板里可以直接写 money(x) / daysText(x)
app.mixin({
  methods: {
    money, wan, pct, pctRaw, daysText, dateText,
    pnlTone, pnlClass, agingTone, agingText, truncate, barWidth,
    $notify: notify,
  },
});

app.mount('#app');
