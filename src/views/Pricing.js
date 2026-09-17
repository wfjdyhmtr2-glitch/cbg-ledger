/**
 * 价值计算 —— 保本价与目标价
 *
 * 回答一个问题：「这个成本的东西，最少要挂多少钱卖才不亏？」
 *
 * 逻辑：给定购入成本 C，保本挂牌价 P 满足「税后到手 = C」。
 * 藏宝阁的手续费是分段/有上下限的（角色还有 60 元保底），
 * 所以不能简单除以 0.95，这里直接用 fee.js 里的 grossFromNet 迭代反推，
 * 和售出登记用的是同一套费率引擎 —— 算出来的数和真实结算一致。
 *
 * 成本支持两种来源：直接手输，或从当前持仓里选一条自动带入（带入后仍可改）。
 */

import { state, stats } from '../core/store.js';
import { num, round2 } from '../core/model.js';
import { calcFee, netFromGross, grossFromNet, feeRuleText } from '../core/fee.js';
import { money } from '../core/format.js';

/** 参与保本计算的品类（费率就这 4 档） */
const FEE_CATS = [
  { id: 'role',      name: '角色（5%，最低 60 最高 1000）' },
  { id: 'equipment', name: '装备 / 召唤兽 / 灵饰（5%，最高 1000）' },
  { id: 'currency',  name: '梦幻币（5%，无上下限）' },
  { id: 'gift',      name: '礼盒礼币（10%）' },
];

/** 利润率档位：-10% 到 +50%，覆盖"割肉出"到"吃大肉" */
const MARGINS = [-0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5];

export const Pricing = {
  data() {
    return {
      source: '',          // '' = 手动输入；否则为持仓条目 id
      cost: 8600,
      cat: 'role',
      tryGross: 0,         // 反算区：假设挂这个价
      feeCats: FEE_CATS,
    };
  },
  computed: {
    s() { return stats.value; },
    st() { return state; },
    holdingOptions() { return this.s.holdingItems; },
    costNum() { return Math.max(0, num(this.cost)); },

    /** 保本挂牌价：税后到手恰好等于成本 */
    breakEven() {
      const gross = grossFromNet(this.cat, this.costNum);
      const fee = calcFee(this.cat, gross);
      const net = netFromGross(this.cat, gross);
      return { gross, fee, net };
    },

    hasCost() { return this.costNum > 0; },

    /** 利润率档位表 */
    tiers() {
      if (!this.hasCost) return [];
      return MARGINS.map((m) => {
        const targetNet = round2(this.costNum * (1 + m));
        const gross = grossFromNet(this.cat, targetNet);
        const fee = calcFee(this.cat, gross);
        const actualNet = netFromGross(this.cat, gross);
        const profit = round2(actualNet - this.costNum);
        return {
          key: String(m),
          label: m === 0 ? '保本' : (m > 0 ? `+${Math.round(m * 100)}%` : `${Math.round(m * 100)}%`),
          targetNet,
          gross,
          fee,
          actualNet,
          profit,
          tone: profit > 0.004 ? 'up' : profit < -0.004 ? 'down' : 'flat',
        };
      });
    },

    /** 反算区：挂 tryGross 能到手多少 */
    tryResult() {
      const gross = num(this.tryGross);
      if (!(gross > 0)) return null;
      const fee = calcFee(this.cat, gross);
      const net = netFromGross(this.cat, gross);
      const profit = round2(net - this.costNum);
      return {
        gross,
        fee,
        net,
        profit,
        tone: profit > 0.004 ? 'up' : profit < -0.004 ? 'down' : 'flat',
        verdict: profit > 0.004 ? '有得赚' : profit < -0.004 ? '要亏' : '保本',
      };
    },
  },
  methods: {
    money,
    feeRuleText,
    pickHolding() {
      const item = this.holdingOptions.find((i) => i.id === this.source);
      if (!item) return;
      this.cost = round2(item.cost);
      this.cat = item.kind === 'role' ? 'role' : item.category;
    },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>价值计算</h2>
        <p class="page-sub">
          一个成本，最少要挂多少钱才不亏？ —— 按藏宝阁真实费率反推，
          和「登记售出」用的是同一套手续费引擎
        </p>
      </div>
    </div>

    <!-- 输入区 -->
    <section class="card">
      <div class="card-head">
        <h3>购入成本</h3>
        <span class="muted">成本可以直接改；也可以从持仓里选一条自动带入，带入后照样能改</span>
      </div>
      <div class="form-grid">
        <Field label="从持仓带入（可选）">
          <select class="input" v-model="source" @change="pickHolding">
            <option value="">— 手动输入 —</option>
            <option v-for="i in holdingOptions" :key="i.kind + i.id" :value="i.id">
              {{ i.kind === 'role' ? '角色' : '商品' }} · {{ i.name }}（成本 {{ money(i.cost) }}）
            </option>
          </select>
        </Field>
        <Field label="品类" :hint="feeRuleText(cat)">
          <select class="input" v-model="cat">
            <option v-for="c in feeCats" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </Field>
        <Field label="购入成本" hint="买入价 + 转服费 + 其他杂费，自己加总填进来">
          <input class="input" type="number" step="0.01" min="0" v-model="cost" />
        </Field>
        <Field label="试算：假设挂这个价" hint="填一个挂牌价，看看到手多少、赚还是亏">
          <input class="input" type="number" step="0.01" min="0" v-model="tryGross" placeholder="0.00" />
        </Field>
      </div>
    </section>

    <!-- 保本线 -->
    <section class="kpi-row" v-if="hasCost">
      <StatCard big label="保本挂牌价" :value="money(breakEven.gross)" tone="accent"
        :sub="'挂到这个价，税后到手 ' + money(breakEven.net) + '，正好回本'"
        hint="由成本反推：使得手价 − 信息费 = 购入成本。信息费不足 1 分按 1 分收，所以实际到手只多不少" />
      <StatCard label="其中信息费" :value="money(breakEven.fee)" tone="neutral"
        :sub="feeRuleText(cat)" />
      <StatCard label="到手金额" :value="money(breakEven.net)" tone="info"
        :sub="'= 挂牌价 − 信息费'" />
      <StatCard label="试算结果" :value="tryResult ? money(tryResult.profit, { sign: true }) : '—'"
        :tone="tryResult ? tryResult.tone : 'neutral'"
        :sub="tryResult ? ('挂 ¥' + tryResult.gross.toFixed(2) + ' → 到手 ¥' + tryResult.net.toFixed(2) + '，' + tryResult.verdict) : '在上方填一个挂牌价试试'" />
    </section>

    <Empty v-if="!hasCost" text="先填一个购入成本" sub="填 0 或留空没法算，成本记得把杂费也算进去" />

    <!-- 档位表 -->
    <section class="card" v-if="hasCost">
      <div class="card-head">
        <h3>目标价速查</h3>
        <span class="muted">按利润率档位直接给出建议挂牌价 —— 挂表里的价，到手不会低于目标</span>
      </div>
      <div class="table-wrap">
        <table class="table compact">
          <thead>
            <tr>
              <th>目标</th>
              <th class="ta-r">想到手</th>
              <th class="ta-r">建议挂牌价</th>
              <th class="ta-r">其中信息费</th>
              <th class="ta-r">实际到手</th>
              <th class="ta-r">净赚</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tiers" :key="t.key" :class="{ 'row-highlight': t.key === '0' }">
              <td>
                <Tag :text="t.label" :tone="t.key === '0' ? 'accent' : (t.tone === 'up' ? 'up' : 'default')" />
              </td>
              <td class="ta-r num">{{ money(t.targetNet) }}</td>
              <td class="ta-r num strong">{{ money(t.gross) }}</td>
              <td class="ta-r num muted">{{ money(t.fee) }}</td>
              <td class="ta-r num">{{ money(t.actualNet) }}</td>
              <td class="ta-r"><Pnl :value="t.profit" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small" style="margin: 10px 2px 0">
        「建议挂牌价」按你的成本 + 目标利润反推并向上取整到分，
        所以「实际到手」只会比「想到手」多一两分钱，不会少 —— 保证不亏。
      </p>
    </section>

  </div>`,
};
