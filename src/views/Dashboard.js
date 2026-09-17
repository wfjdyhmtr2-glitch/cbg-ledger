/**
 * 总览 —— 一屏看清盘子的全貌
 *   投入了多少 / 回了多少 / 还压着多少 / 到底赚没赚 / 钱压了多久
 */

import { state, stats, setView, loadDemo } from '../core/store.js';
import { money, wan, pct, daysText, agingTone, pnlTone } from '../core/format.js';
import { PALETTE } from '../components/charts.js';

export const Dashboard = {
  methods: { money, wan, pct, daysText, agingTone, pnlTone, loadDemo },
  computed: {
    s() { return stats.value; },
    st() { return state; },
    t() { return this.s.totals; },
    /** 固定资产总投入 = 自玩号本身成本 + 号内物品成本（独立于倒卖核算） */
    assetInfo() {
      const chars = state.chars || [];
      const assets = state.assets || [];
      const charCost = chars.reduce((s2, c) => s2 + (Number(c.purchase_price) || 0), 0);
      const itemCost = assets.reduce((s2, a) => s2 + (Number(a.cost) || 0), 0);
      return {
        total: Math.round((charCost + itemCost) * 100) / 100,
        charCount: chars.length,
        itemCount: assets.length,
        charCost: Math.round(charCost * 100) / 100,
        itemCost: Math.round(itemCost * 100) / 100,
      };
    },
    c() { return this.s.counts; },
    empty() {
      return !this.st.roles.length && !this.st.products.length;
    },
    viewOptions() {
      return [
        { value: 'project', label: '项目视角', hint: '角色为一个核算单元，看整票赚没赚' },
        { value: 'unit', label: '单品视角', hint: '把角色成本摊到每件商品上，看单品毛利' },
      ];
    },
    donutItems() {
      return this.s.zoneRows
        .filter((z) => z.onHand > 0)
        .map((z, i) => ({ id: z.id, label: z.name, value: z.onHand, color: PALETTE[i % PALETTE.length] }));
    },
    profitSplit() {
      return [
        { label: '已实现', value: this.t.realizedProfit, tone: pnlTone(this.t.realizedProfit) },
        { label: '浮动', value: this.t.unrealizedProfit, tone: pnlTone(this.t.unrealizedProfit) },
      ];
    },
    topZones() {
      return this.s.zoneRows.slice(0, 5);
    },
    unlockPct() {
      return Math.min(100, (this.t.unlockRate || 0) * 100);
    },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>资金总览</h2>
        <p class="page-sub">
          截至 {{ s.today }}　·　
          <span :class="st.mode === 'supabase' ? 'dot-ok' : 'dot-local'"></span>
          {{ st.mode === 'supabase' ? '云端数据' : '本地数据' }}
          <span class="muted">　·　当前为{{ st.view === 'unit' ? '单品' : '项目' }}视角，可在右上角切换</span>
        </p>
      </div>
    </div>

    <Empty v-if="empty" text="后台还是空的" sub="先加一个区服、录一个角色，或者载入一份演示数据看看效果">
      <div class="empty-actions">
        <button class="btn primary" @click="loadDemo">载入演示数据</button>
        <NavLink class="btn" to="/roles">去新增角色</NavLink>
      </div>
    </Empty>

    <template v-else>

      <!-- 核心指标 -->
      <section class="kpi-row six">
        <StatCard big label="总投入" :value="money(t.invest)" tone="accent"
          :sub="c.roles + ' 个角色 · ' + c.products + ' 件商品 · ' + c.zones + ' 个区服'" />
        <StatCard label="已回款" :value="money(t.recovered)" tone="info"
          :sub="'回本率 ' + pct(t.unlockRate)" />
        <StatCard label="总预估市值" :value="money(t.estTotal)" tone="neutral"
          :sub="c.listed + ' 项已上架 · 按上架价合计'" />
        <StatCard label="固定资产" :value="money(assetInfo.total)" tone="neutral"
          :sub="assetInfo.charCount + ' 个自玩号 · ' + assetInfo.itemCount + ' 件物品 · 独立核算'" />
        <StatCard label="实际盈亏" :value="money(t.realizedProfit, { sign: true })" :tone="pnlTone(t.realizedProfit)"
          sub="已售落袋 · 回款 − 成本" />
        <StatCard label="预计盈亏" :value="money(t.unrealizedProfit, { sign: true })" :tone="pnlTone(t.unrealizedProfit)"
          sub="在手估值 − 成本 · 未落袋" />
      </section>

      <!-- 回本进度 -->
      <section class="card">
        <div class="card-head">
          <h3>回本进度</h3>
          <span class="muted">已回款 ÷ 总投入 —— 到 100% 说明本金全部收回，剩下的都是在手纯利润</span>
        </div>
        <div class="unlock">
          <div class="unlock-bar">
            <div class="unlock-fill" :class="{ done: unlockPct >= 100 }" :style="{ width: unlockPct + '%' }"></div>
            <span class="unlock-mark" v-for="p in [25,50,75]" :key="p" :style="{ left: p + '%' }"></span>
          </div>
          <div class="unlock-scale">
            <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>
        <div class="split-row">
          <div class="split" v-for="sp in profitSplit" :key="sp.label">
            <span class="split-label">{{ sp.label }}盈亏</span>
            <span class="split-value" :class="'pnl-' + sp.tone">{{ money(sp.value, { sign: true }) }}</span>
            <span class="split-note">{{ sp.label === '已实现' ? '已经落袋的' : '在手资产估值 − 其成本' }}</span>
          </div>
          <div class="split">
            <span class="split-label">平均周转</span>
            <span class="split-value accent">{{ s.avgCycle == null ? '—' : s.avgCycle + ' 天' }}</span>
            <span class="split-note">中位数 {{ s.medianCycle == null ? '—' : s.medianCycle + ' 天' }}</span>
          </div>
        </div>
      </section>

      <!-- 图表区 -->
      <section class="grid-3">
        <div class="card">
          <div class="card-head"><h3>在手资产 · 区服分布</h3></div>
          <Donut :items="donutItems" />
        </div>
        <div class="card span-2">
          <div class="card-head">
            <h3>近 12 个月 投入 / 回款</h3>
            <span class="muted">回款柱追上投入柱，说明周转在转起来</span>
          </div>
          <MonthlyBars :data="s.monthly" />
        </div>
      </section>

      <section class="grid-2">
        <div class="card">
          <div class="card-head">
            <h3>账龄分布</h3>
            <span class="muted">按在手资产估值</span>
          </div>
          <AgingBars :buckets="s.buckets" />
        </div>

        <div class="card">
          <div class="card-head">
            <h3>区服概览</h3>
            <NavLink class="link" to="/zones">全部区服 →</NavLink>
          </div>
          <table class="table compact">
            <thead>
              <tr><th>区服</th><th class="ta-r">投入</th><th class="ta-r">在手</th><th class="ta-r">预计盈亏</th></tr>
            </thead>
            <tbody>
              <tr v-for="z in topZones" :key="z.id">
                <td>
                  <div class="cell-main">{{ z.name }}</div>
                  <div class="cell-sub">{{ z.holdingRoles }} 号 / {{ z.holdingProducts }} 货在手</div>
                </td>
                <td class="ta-r num">{{ wan(z.invest) }}</td>
                <td class="ta-r num">{{ wan(z.onHand) }}</td>
                <td class="ta-r"><Pnl :value="z.profit" /></td>
              </tr>
              <tr v-if="!topZones.length"><td colspan="4" class="ta-c muted">还没有区服数据</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 空壳待估值提醒 -->
      <section class="card tip-card" v-if="s.unvaluedShells.length">
        <div class="card-head">
          <h3>有 {{ s.unvaluedShells.length }} 个空壳号还没估值</h3>
          <span class="muted">不影响已卖出部分的账，但会让这一票的盈亏被低估</span>
        </div>
        <p class="tip-text">
          拆号之后，空壳号的价值其实已经转移到卖出去的那些装备/召唤兽上了。
          如果你不填估值也不挂价，后台会保守地按 <b>0</b> 计它的残值，
          于是「预计盈亏」看起来会比实际差。补个估值就准了。
        </p>
        <div class="tip-list">
          <span class="tip-item" v-for="r in s.unvaluedShells" :key="r.id">
            {{ r.name }}<i class="muted">· {{ r.zone || '未填区服' }}</i>
          </span>
        </div>
        <p class="muted small">到「角色」页点编辑，挂个价（填挂牌价）即可计入市值。</p>
      </section>

      <!-- 预警 -->
      <section class="card" v-if="s.alerts.length">
        <div class="card-head">
          <h3>滞销预警 <span class="badge-count">{{ s.alerts.length }}</span></h3>
          <span class="muted">持有超过 60 天还在手上的资产，越久越难卖、越容易掉价</span>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>名称</th><th>区服</th><th>类型</th>
              <th class="ta-r">成本</th><th class="ta-r">在手估值</th>
              <th class="ta-r">持有</th><th class="ta-c">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in s.alerts.slice(0, 8)" :key="a.id">
              <td>
                <div class="cell-main">{{ a.name }}</div>
                <div class="cell-sub" v-if="a.roleName && a.kind === 'product'">来自角色「{{ a.roleName }}」</div>
              </td>
              <td class="muted">{{ a.zone }}</td>
              <td>
                <Tag v-if="a.kind === 'role'" text="角色" tone="accent" />
                <Tag v-else :text="a.category" tone="default" />
              </td>
              <td class="ta-r num">{{ money(a.cost) }}</td>
              <td class="ta-r num">{{ money(a.onHand) }}</td>
              <td class="ta-r">
                <span :class="'age age-' + agingTone(a.days)">{{ daysText(a.days) }}</span>
              </td>
              <td class="ta-c">
                <Tag v-if="a.listed" text="挂牌中" tone="info" />
                <Tag v-else text="未挂" tone="warn" />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

    </template>
  </div>`,
};
