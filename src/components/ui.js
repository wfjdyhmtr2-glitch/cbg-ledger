/**
 * 通用 UI 组件（全部为 Vue 3 选项式组件，模板内联，零构建）
 */

import { money, pnlTone, pct } from '../core/format.js';

export const Modal = {
  props: { title: String, width: { type: String, default: '600px' }, sub: String },
  emits: ['close'],
  template: `
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal" :style="{ maxWidth: width }">
      <header class="modal-head">
        <div>
          <h3>{{ title }}</h3>
          <p class="modal-sub" v-if="sub">{{ sub }}</p>
        </div>
        <button class="icon-btn" @click="$emit('close')" title="关闭">✕</button>
      </header>
      <div class="modal-body"><slot /></div>
      <footer class="modal-foot" v-if="$slots.footer"><slot name="footer" /></footer>
    </div>
  </div>`,
};

export const Tag = {
  props: { text: String, tone: { type: String, default: 'default' } },
  template: `<span class="tag" :class="'tag-'+tone"><slot>{{ text }}</slot></span>`,
};

export const Gap = { template: `<span class="gap"></span>` };

export const StatCard = {
  props: {
    label: String,
    value: [String, Number],
    sub: String,
    tone: { type: String, default: 'default' },
    hint: String,
    big: Boolean,
  },
  template: `
  <div class="stat" :class="[ 'stat-'+tone, big ? 'stat-big' : '' ]">
    <div class="stat-label">
      {{ label }}
      <span class="stat-hint" v-if="hint" :title="hint">?</span>
    </div>
    <div class="stat-value">{{ value }}</div>
    <div class="stat-sub" v-if="sub">{{ sub }}</div>
  </div>`,
};

/** 回本进度条 */
export const RecoverBar = {
  props: { rate: Number, cost: Number, recovered: Number },
  computed: {
    w() { return `${Math.max(0, Math.min(1, this.rate || 0)) * 100}%`; },
    tone() { return (this.rate || 0) >= 1 ? 'done' : (this.rate || 0) >= 0.5 ? 'half' : 'low'; },
  },
  template: `
  <div class="rbar" :title="'已回款 ' + recovered + ' / 投入 ' + cost">
    <div class="rbar-track"><div class="rbar-fill" :class="'rbar-'+tone" :style="{width: w}"></div></div>
    <span class="rbar-text">{{ Math.round((rate||0)*100) }}%</span>
  </div>`,
};

export const Empty = {
  props: { text: { type: String, default: '还没有数据' }, sub: String },
  template: `
  <div class="empty">
    <div class="empty-icon">◇</div>
    <p>{{ text }}</p>
    <p class="empty-sub" v-if="sub">{{ sub }}</p>
    <slot />
  </div>`,
};

export const Field = {
  props: { label: String, hint: String, span: Boolean },
  template: `
  <label class="field" :class="{ 'field-span': span }">
    <span class="field-label">{{ label }}</span>
    <slot />
    <span class="field-hint" v-if="hint">{{ hint }}</span>
  </label>`,
};

/** 分段切换（项目视角 / 单品视角） */
export const Segmented = {
  props: { modelValue: String, options: Array },
  emits: ['update:modelValue'],
  template: `
  <div class="segmented">
    <button v-for="o in options" :key="o.value"
      :class="{ active: modelValue === o.value }"
      :title="o.hint"
      @click="$emit('update:modelValue', o.value)">{{ o.label }}</button>
  </div>`,
};

/** 盈亏数字，自带红绿着色 */
export const Pnl = {
  props: { value: Number, digits: { type: Number, default: 0 }, showSign: { type: Boolean, default: true } },
  computed: {
    tone() { return pnlTone(this.value); },
    text() { return money(this.value, { sign: this.showSign, digits: this.digits }); },
  },
  template: `<span class="pnl" :class="'pnl-'+tone">{{ text }}</span>`,
};

/** 带「盈 / 亏 / 平」结论的小徽标 */
export const Verdict = {
  props: { value: Number, done: { type: Boolean, default: false } },
  computed: {
    tone() { return pnlTone(this.value); },
    label() {
      const t = this.tone;
      if (t === 'up') return this.done ? '已盈利' : '预计盈利';
      if (t === 'down') return this.done ? '已亏损' : '预计亏损';
      return '持平';
    },
  },
  template: `<span class="verdict" :class="'verdict-'+tone">{{ label }}</span>`,
};

export const InfoDot = {
  props: { text: String },
  template: `<span class="info-dot" :title="text">i</span>`,
};

/** 极简 hash 路由链接，避免引入 vue-router */
export const NavLink = {
  props: { to: { type: String, required: true }, exact: Boolean },
  computed: {
    href() { return `#${this.to}`; },
    active() {
      const cur = (location.hash || '#/').replace('#', '');
      return this.exact ? cur === this.to : cur.startsWith(this.to);
    },
  },
  template: `<a :href="href" :class="{ active }"><slot /></a>`,
};

/** 表格内的「展开 / 收起」小按钮 */
export const Expander = {
  props: { open: Boolean },
  emits: ['toggle'],
  template: `
  <button class="expander" :class="{ open }" @click.stop="$emit('toggle')" title="展开拆号明细">
    <span class="caret">▸</span>
  </button>`,
};

/** 空态里的大按钮组容器 */
export const ActionRow = {
  template: `<div class="action-row"><slot /></div>`,
};
