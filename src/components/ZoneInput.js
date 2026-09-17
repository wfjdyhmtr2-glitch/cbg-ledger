/**
 * ZoneInput —— 区服自动补全输入框
 *
 * 替代原生 datalist（样式不可控、触发时机看浏览器脸色）。
 *
 * 数据池（按优先级合并）：
 *   1. 你数据里出现过的区服（roles / products / chars 汇总）
 *   2. 手动输过的新区（localStorage 记录，输过一次下次优先弹）
 *   3. 内置的梦幻西游区服字典（400+ 服务器，输「日」就出「日光岩」）
 *
 * 匹配规则：包含即命中，前缀命中的排前面；键盘 ↑↓ 选择、回车确认、Esc 关闭。
 */

import { state } from '../core/store.js';
import { collectZoneNames } from '../core/model.js';
import { BUILTIN_ZONES, BUILTIN_ZONE_REGION } from '../core/zones-data.js';

const CUSTOM_KEY = 'mhxy_zones_custom';

function loadCustom() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]') || []; }
  catch { return []; }
}

/** 把一个非内置的区服记进「我的区服」（手动输入保存后调用） */
function rememberCustomZone(name) {
  const s = String(name || '').trim();
  if (!s || BUILTIN_ZONES.includes(s)) return;
  const list = loadCustom();
  if (!list.includes(s)) {
    list.push(s);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }
}

export const ZoneInput = {
  props: {
    modelValue: String,
    placeholder: String,
  },
  emits: ['update:modelValue'],
  data() {
    return { text: this.modelValue || '', open: false, active: -1 };
  },
  computed: {
    pool() {
      const used = collectZoneNames(state.roles, state.products, state.chars);
      return [...new Set([...used, ...loadCustom(), ...BUILTIN_ZONES])];
    },
    matches() {
      const q = this.text.trim();
      if (!q) return this.pool.slice(0, 60);   // 空输入：弹 60 个（下拉可滚动）
      const starts = [];
      const contains = [];
      for (const z of this.pool) {
        if (z.startsWith(q)) starts.push(z);
        else if (z.includes(q)) contains.push(z);
        if (starts.length >= 30) break;
      }
      return [...starts, ...contains.slice(0, 30 - starts.length)];
    },
  },
  watch: {
    modelValue(v) {
      if ((v || '') !== this.text) this.text = v || '';
    },
  },
  methods: {
    regionOf(z) { return BUILTIN_ZONE_REGION[z] || ''; },
    onInput(e) {
      this.text = e.target.value;
      this.open = true;
      this.active = -1;
      this.$emit('update:modelValue', this.text);
    },
    onFocus() { this.open = true; this.active = -1; },
    onBlur() {
      // 延迟关闭：给下拉项的 mousedown 让路
      setTimeout(() => { this.open = false; }, 160);
      this.commit();
    },
    commit() {
      const v = this.text.trim();
      if (v) rememberCustomZone(v);
      this.$emit('update:modelValue', v);
    },
    choose(z) {
      this.text = z;
      this.open = false;
      this.active = -1;
      rememberCustomZone(z);
      this.$emit('update:modelValue', z);
    },
    onKey(e) {
      if (!this.open || !this.matches.length) {
        if (e.key === 'Enter') { this.commit(); this.open = false; }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.active = Math.min(this.active + 1, this.matches.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.active = Math.max(this.active - 1, 0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.active >= 0) this.choose(this.matches[this.active]);
        else { this.commit(); this.open = false; }
      } else if (e.key === 'Escape') {
        this.open = false;
      }
    },
  },
  template: `
  <div class="zone-input" @keydown="onKey">
    <input class="input" :value="text" :placeholder="placeholder"
      autocomplete="off" spellcheck="false"
      @input="onInput" @focus="onFocus" @blur="onBlur" />
    <div class="zone-pop" v-if="open && matches.length">
      <div class="zone-opt" v-for="(z, i) in matches" :key="z"
        :class="{ active: i === active }"
        @mousedown.prevent="choose(z)"
        @mouseenter="active = i">
        <span class="zone-name">{{ z }}</span>
        <span class="zone-region" v-if="regionOf(z)">{{ regionOf(z) }}</span>
        <span class="zone-region mine" v-else>我的区服</span>
      </div>
    </div>
  </div>`,
};
