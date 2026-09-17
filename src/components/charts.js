/**
 * 自绘图表组件（纯 SVG / CSS，零第三方依赖）
 * 配色与深色主题一致，红=盈利/回款、金=投入、绿=亏损。
 */

import { wan, pct } from '../core/format.js';

export const PALETTE = [
  '#c8a45c', '#58a6ff', '#a371f7', '#39c5cf',
  '#f0883e', '#db61a2', '#3fb950', '#e5534b',
];

/** 环形图 —— 用于区服资金分布 */
export const Donut = {
  props: {
    items: { type: Array, default: () => [] },
    unit: { type: String, default: '元' },
  },
  computed: {
    list() {
      return this.items.filter((i) => Number(i.value) > 0);
    },
    total() {
      return this.list.reduce((s, i) => s + Number(i.value || 0), 0);
    },
    segs() {
      const C = 2 * Math.PI * 50;
      let acc = 0;
      return this.list.map((i, idx) => {
        const frac = this.total > 0 ? Number(i.value) / this.total : 0;
        const len = frac * C;
        const seg = {
          key: i.id || i.label || idx,
          label: i.label,
          value: i.value,
          frac,
          color: i.color || PALETTE[idx % PALETTE.length],
          dash: `${len} ${C - len}`,
          offset: -acc,
        };
        acc += len;
        return seg;
      });
    },
  },
  methods: { wan, pct },
  template: `
  <div class="donut-wrap">
    <svg viewBox="0 0 120 120" class="donut">
      <g transform="translate(60,60) rotate(-90)">
        <circle r="50" fill="none" stroke="var(--card-2)" stroke-width="24" />
        <circle v-for="s in segs" :key="s.key" r="50" fill="none"
          :stroke="s.color" stroke-width="24" stroke-linecap="butt"
          :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
      </g>
      <g v-if="!segs.length">
        <circle r="50" cx="60" cy="60" fill="none" stroke="var(--card-2)" stroke-width="24" />
      </g>
    </svg>
    <ul class="donut-legend">
      <li v-for="s in segs" :key="s.key">
        <i :style="{ background: s.color }"></i>
        <span class="dl-name">{{ s.label }}</span>
        <span class="dl-val">¥{{ wan(s.value) }}</span>
        <span class="dl-pct">{{ pct(s.frac) }}</span>
      </li>
      <li v-if="!segs.length" class="donut-empty">暂无在手资产</li>
    </ul>
  </div>`,
};

/** 月度投入 / 回款双柱图 */
export const MonthlyBars = {
  props: { data: { type: Array, default: () => [] } },
  computed: {
    max() {
      const vals = this.data.flatMap((d) => [Number(d.invest) || 0, Number(d.recovered) || 0]);
      return Math.max(1, ...vals);
    },
    rows() {
      return this.data.map((d) => ({
        ...d,
        hIn: `${((Number(d.invest) || 0) / this.max) * 100}%`,
        hRe: `${((Number(d.recovered) || 0) / this.max) * 100}%`,
        hasData: (Number(d.invest) || 0) > 0 || (Number(d.recovered) || 0) > 0,
      }));
    },
  },
  methods: { wan },
  template: `
  <div class="mbars">
    <div class="mbars-head">
      <span class="lg"><i class="lg-in"></i>投入</span>
      <span class="lg"><i class="lg-re"></i>回款</span>
      <span class="mbars-scale">峰值 ¥{{ wan(max) }}</span>
    </div>
    <div class="mbars-plot">
      <div class="mbars-col" v-for="d in rows" :key="d.key">
        <div class="mbars-bars">
          <div class="mbars-bar mbars-in" :style="{ height: d.hIn }"
            :title="d.key + ' 投入 ¥' + wan(d.invest)"></div>
          <div class="mbars-bar mbars-re" :style="{ height: d.hRe }"
            :title="d.key + ' 回款 ¥' + wan(d.recovered)"></div>
        </div>
        <span class="mbars-x">{{ d.label }}</span>
      </div>
    </div>
  </div>`,
};

/** 账龄分布 —— 看资金压了多久 */
export const AgingBars = {
  props: { buckets: { type: Array, default: () => [] } },
  computed: {
    max() {
      return Math.max(1, ...this.buckets.map((b) => Number(b.amount) || 0));
    },
    rows() {
      return this.buckets.map((b, i) => ({
        ...b,
        tone: ['ok', 'ok', 'warn', 'danger', 'danger'][i] || 'ok',
        w: `${((Number(b.amount) || 0) / this.max) * 100}%`,
      }));
    },
  },
  methods: { wan },
  template: `
  <div class="aging">
    <div class="aging-row" v-for="b in rows" :key="b.label">
      <span class="aging-label">{{ b.label }}</span>
      <div class="aging-track">
        <div class="aging-fill" :class="'aging-'+b.tone" :style="{ width: b.w }"></div>
      </div>
      <span class="aging-count">{{ b.count }} 项</span>
      <span class="aging-amount">¥{{ wan(b.amount) }}</span>
    </div>
  </div>`,
};

/** 迷你横向条：用于列表里的小占比展示 */
export const MiniBar = {
  props: { value: Number, max: Number, tone: { type: String, default: 'accent' } },
  computed: {
    w() {
      const m = Number(this.max) || 1;
      return `${Math.max(2, Math.min(100, ((Number(this.value) || 0) / m) * 100))}%`;
    },
  },
  template: `<span class="mini-bar"><i :class="'mini-'+tone" :style="{width: w}"></i></span>`,
};
