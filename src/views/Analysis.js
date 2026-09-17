/**
 * 盈亏 & 周转分析
 * 回答两个问题：钱是被哪一票赚走的 / 哪一票拖了后腿、压了多久
 */

import { state, stats } from '../core/store.js';
import { money, pct, daysText, agingTone, pnlTone, dateText } from '../core/format.js';
import { CATEGORY_MAP, num } from '../core/model.js';

export const Analysis = {
  data() {
    return { tab: 'cycle' };
  },
  computed: {
    s() { return stats.value; },
    st() { return state; },
    t() { return this.s.totals; },

    soldList() {
      return this.s.soldItems.filter((i) => i.days != null);
    },
    avgCycle() { return this.s.avgCycle; },
    medianCycle() { return this.s.medianCycle; },

    /** 周转速度分布（细分到一年，超一年的归入「一年以上」） */
    cycleBuckets() {
      const defs = [
        { label: '7 天内（快）', min: 0, max: 7, tone: 'ok' },
        { label: '8–14 天', min: 8, max: 14, tone: 'ok' },
        { label: '15–30 天', min: 15, max: 30, tone: 'ok' },
        { label: '31–45 天', min: 31, max: 45, tone: 'ok' },
        { label: '46–60 天', min: 46, max: 60, tone: 'warn' },
        { label: '61–90 天', min: 61, max: 90, tone: 'warn' },
        { label: '91–120 天', min: 91, max: 120, tone: 'warn' },
        { label: '121–150 天', min: 121, max: 150, tone: 'warn' },
        { label: '151–180 天（半年）', min: 151, max: 180, tone: 'danger' },
        { label: '181–240 天', min: 181, max: 240, tone: 'danger' },
        { label: '241–300 天', min: 241, max: 300, tone: 'danger' },
        { label: '301–365 天（一年）', min: 301, max: 365, tone: 'danger' },
        { label: '一年以上（积压）', min: 366, max: Infinity, tone: 'danger' },
      ];
      const max = Math.max(1, ...defs.map((d) =>
        this.soldList.filter((i) => i.days >= d.min && i.days <= d.max).length));
      return defs.map((d) => {
        const hit = this.soldList.filter((i) => i.days >= d.min && i.days <= d.max);
        return {
          ...d,
          count: hit.length,
          amount: hit.reduce((x, i) => x + (i.net || 0), 0),
          profit: hit.reduce((x, i) => x + (i.profit || 0), 0),
          w: `${(hit.length / max) * 100}%`,
        };
      });
    },

    /** 赚钱榜 / 亏钱榜 */
    winners() {
      return [...this.s.soldItems].sort((a, b) => b.profit - a.profit).slice(0, 8);
    },
    losers() {
      return [...this.s.soldItems].sort((a, b) => a.profit - b.profit).slice(0, 8);
    },

    /** 区服盈亏排行 */
    zoneRank() {
      return [...this.s.zoneRows].sort((a, b) => b.profit - a.profit);
    },

    /** 已实现 vs 浮动 */
    realized() { return this.t.realizedProfit; },
    unrealized() { return this.t.unrealizedProfit; },

    /** 滞销榜（在手 + 按天数排序） */
    stale() {
      return this.s.holdingItems.filter((i) => (i.days || 0) >= 30).slice(0, 12);
    },

    /** 固定资产流出明细 —— 商品上标了「固定资产流出」的，单独列账 */
    assetOutflow() {
      const rows = [...this.s.productRows]
        .filter((p) => p.from_asset)
        .sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''));
      const sold = rows.filter((p) => p.status === 'sold');
      return {
        rows,
        sold,
        holding: rows.filter((p) => p.status !== 'sold'),
        cost: rows.reduce((s2, p) => s2 + num(p.purchase_price), 0),
        soldNet: sold.reduce((s2, p) => s2 + (p._net || 0), 0),
        profit: sold.reduce((s2, p) => s2 + (p._profit || 0), 0),
        onHand: rows.filter((p) => p.status !== 'sold').reduce((s2, p) => s2 + (p._onHand || 0), 0),
      };
    },
  },
  methods: {
    money, pct, daysText, agingTone, pnlTone, dateText,
    catName(id) { return id === 'role' ? '角色' : (CATEGORY_MAP[id]?.name || id); },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>盈亏与周转分析</h2>
        <p class="page-sub">钱是被哪一票赚走的、哪一票在拖后腿、资金压了多久</p>
      </div>
    </div>

    <section class="kpi-row">
      <StatCard label="实际盈亏（已落袋）" :value="money(realized, { sign: true })" :tone="pnlTone(realized)"
        sub="已经落袋的部分（成交额 − 对应成本）" hint="只统计已卖出的资产，成本按估值权重分摊，跨视角口径一致" />
      <StatCard label="预计盈亏（未落袋）" :value="money(unrealized, { sign: true })" :tone="pnlTone(unrealized)"
        sub="在手资产 · 估值 − 成本 · 未落袋" hint="挂了牌的按上架价格，没挂的按成本" />
      <StatCard label="总盈亏（实际 + 预计）" :value="money(t.totalProfit, { sign: true })" :tone="pnlTone(t.totalProfit)"
        sub="已实现 + 浮动" big />
      <StatCard label="平均周转" :value="avgCycle == null ? '—' : avgCycle + ' 天'"
        :sub="'中位数 ' + (medianCycle == null ? '—' : medianCycle + ' 天')"
        hint="从买入到卖出的天数；只统计已售出的资产" />
    </section>

    <div class="tabs">
      <button :class="{ active: tab === 'cycle' }" @click="tab = 'cycle'">周转情况</button>
      <button :class="{ active: tab === 'rank' }" @click="tab = 'rank'">盈亏排行</button>
      <button :class="{ active: tab === 'zone' }" @click="tab = 'zone'">区服对比</button>
      <button :class="{ active: tab === 'asset' }" @click="tab = 'asset'">固定资产流出</button>
    </div>

    <!-- 周转 -->
    <template v-if="tab === 'cycle'">
      <section class="card">
        <div class="card-head">
          <h3>周转速度分布</h3>
          <span class="muted">已售出资产按「持有天数」分档 —— 越快越好，90 天以上要警惕</span>
        </div>
        <div class="cycle-list">
          <div class="cycle-row" v-for="b in cycleBuckets" :key="b.label">
            <span class="cycle-label">{{ b.label }}</span>
            <div class="cycle-track">
              <div class="cycle-fill" :class="'aging-' + b.tone" :style="{ width: b.w }"></div>
            </div>
            <span class="cycle-count">{{ b.count }} 笔</span>
            <span class="cycle-amount">回款 {{ money(b.amount) }}</span>
            <span class="cycle-profit" :class="'pnl-' + pnlTone(b.profit)">{{ money(b.profit, { sign: true }) }}</span>
          </div>
          <p class="muted" v-if="!soldList.length">还没有卖出记录，先登记一笔售出吧</p>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3>已售明细</h3>
          <span class="muted">共 {{ soldList.length }} 笔 · 成本为分摊口径</span>
        </div>
        <div class="table-wrap">
          <table class="table compact">
            <thead>
              <tr>
                <th>名称</th><th>区服</th><th>类型</th>
                <th class="ta-r">成本</th><th class="ta-r">到手</th>
                <th class="ta-r">盈亏</th><th class="ta-c">周转</th><th class="ta-c">卖出日</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in soldList" :key="i.kind + i.id">
                <td>
                  <div class="cell-main">{{ i.name }}</div>
                  <div class="cell-sub" v-if="i.roleName && i.kind === 'product'">来自「{{ i.roleName }}」</div>
                </td>
                <td class="muted">{{ i.zone }}</td>
                <td>
                  <Tag v-if="i.kind === 'role'" :text="i.isShell ? '空壳号' : '角色'" tone="accent" />
                  <Tag v-else :text="catName(i.category)" tone="default" />
                </td>
                <td class="ta-r num">{{ money(i.cost) }}</td>
                <td class="ta-r num info">{{ money(i.net) }}</td>
                <td class="ta-r"><Pnl :value="i.profit" /></td>
                <td class="ta-c">
                  <span :class="'age age-' + agingTone(i.days)">{{ daysText(i.days) }}</span>
                </td>
                <td class="ta-c muted">{{ dateText(i.saleDate) }}</td>
              </tr>
              <tr v-if="!soldList.length"><td colspan="8"><Empty text="还没有卖出记录" /></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 排行 -->
    <template v-if="tab === 'rank'">
      <section class="grid-2">
        <div class="card">
          <div class="card-head"><h3>赚钱榜 TOP 8</h3></div>
          <ol class="rank-list">
            <li v-for="(i, idx) in winners" :key="'w' + i.kind + i.id">
              <span class="rank-no" :class="{ gold: idx === 0 }">{{ idx + 1 }}</span>
              <div class="rank-main">
                <div class="cell-main">{{ i.name }}</div>
                <div class="cell-sub">
                  {{ i.zone }}
                  <template v-if="i.kind === 'product' && i.roleName"> · 来自「{{ i.roleName }}」</template>
                  · 周转 {{ daysText(i.days) }}
                </div>
              </div>
              <span class="rank-val" :class="'pnl-' + pnlTone(i.profit)">{{ money(i.profit, { sign: true }) }}</span>
            </li>
            <li v-if="!winners.length" class="muted ta-c">暂无数据</li>
          </ol>
        </div>

        <div class="card">
          <div class="card-head"><h3>亏钱榜</h3><span class="muted">亏了就得复盘：是买贵了还是砸手里了</span></div>
          <ol class="rank-list">
            <li v-for="i in losers" :key="'l' + i.kind + i.id">
              <span class="rank-no">&nbsp;</span>
              <div class="rank-main">
                <div class="cell-main">{{ i.name }}</div>
                <div class="cell-sub">
                  {{ i.zone }} · 周转 {{ daysText(i.days) }}
                  · 成本 {{ money(i.cost) }} → 到手 {{ money(i.net) }}
                </div>
              </div>
              <span class="rank-val" :class="'pnl-' + pnlTone(i.profit)">{{ money(i.profit, { sign: true }) }}</span>
            </li>
            <li v-if="!losers.length" class="muted ta-c">暂无数据</li>
          </ol>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>滞销榜</h3><span class="muted">手上压了 30 天以上的，优先处理</span></div>
        <table class="table compact">
          <thead>
            <tr>
              <th>名称</th><th>区服</th><th class="ta-r">在手估值</th>
              <th class="ta-r">上架价格</th><th class="ta-c">持有</th><th class="ta-c">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in stale" :key="i.kind + i.id">
              <td>
                <div class="cell-main">{{ i.name }}</div>
                <div class="cell-sub" v-if="i.kind === 'product' && i.roleName">来自「{{ i.roleName }}」</div>
              </td>
              <td class="muted">{{ i.zone }}</td>
              <td class="ta-r num">{{ money(i.onHand) }}</td>
              <td class="ta-r num muted">{{ i.listedPrice > 0 ? money(i.listedPrice) : '—' }}</td>
              <td class="ta-c"><span :class="'age age-' + agingTone(i.days)">{{ daysText(i.days) }}</span></td>
              <td class="ta-c">
                <Tag v-if="i.listed" text="已上架" tone="info" />
                <Tag v-else text="未挂" tone="warn" />
              </td>
            </tr>
            <tr v-if="!stale.length"><td colspan="6"><Empty text="没有滞销资产，周转很健康" /></td></tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- 区服对比 -->
    <template v-if="tab === 'zone'">
      <section class="card">
        <div class="card-head">
          <h3>区服盈亏对比</h3>
          <span class="muted">按投入金额排序</span>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>区服</th>
              <th class="ta-r">投入</th>
              <th class="ta-r">已回款</th>
              <th class="ta-r">回本率</th>
              <th class="ta-r">在手占用</th>
              <th class="ta-r">预计盈亏</th>
              <th class="ta-r">回报率</th>
              <th class="ta-c">平均周转</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="z in zoneRank" :key="z.id">
              <td>
                <div class="cell-main">{{ z.name }}</div>
                <div class="cell-sub">角色 {{ z.roleCount }} · 商品 {{ z.productCount }}</div>
              </td>
              <td class="ta-r num">{{ money(z.invest) }}</td>
              <td class="ta-r num info">{{ money(z.recovered) }}</td>
              <td class="ta-r num">{{ pct(z.invest ? z.recovered / z.invest : 0) }}</td>
              <td class="ta-r num">{{ money(z.locked) }}</td>
              <td class="ta-r"><Pnl :value="z.profit" /></td>
              <td class="ta-r num" :class="'pnl-' + pnlTone(z.invest ? z.profit / z.invest : 0)">
                {{ pct(z.invest ? z.profit / z.invest : 0) }}
              </td>
              <td class="ta-c">{{ z.avgCycle == null ? '—' : z.avgCycle + ' 天' }}</td>
            </tr>
            <tr v-if="!zoneRank.length"><td colspan="8"><Empty text="还没有区服数据" /></td></tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- 固定资产流出 -->
    <template v-if="tab === 'asset'">
      <section class="stat-grid">
        <StatCard label="流出总成本" :value="money(assetOutflow.cost)" tone="neutral"
          sub="这些东西当初记进固定资产的钱" />
        <StatCard label="已售回款" :value="money(assetOutflow.soldNet)" tone="info"
          :sub="'已售出 ' + assetOutflow.sold.length + ' 件'" />
        <StatCard label="实际盈亏（已售变现）" :value="money(assetOutflow.profit, { sign: true })"
          :tone="pnlTone(assetOutflow.profit)"
          sub="回款 − 原购入成本（税费已扣）" />
        <StatCard label="还在手上" :value="money(assetOutflow.onHand)" tone="neutral"
          :sub="'还有 ' + assetOutflow.holding.length + ' 件没卖'" />
      </section>

      <section class="card">
        <div class="card-head">
          <h3>固定资产流出明细</h3>
          <span class="muted">商品里标了「资产流出」的 —— 自己号里的东西拿出来卖的账，独立于倒卖货</span>
        </div>
        <div class="table-wrap">
          <table class="table compact">
            <thead>
              <tr>
                <th>名称</th><th>区服</th><th>类别</th>
                <th class="ta-r">原成本</th><th class="ta-c">状态</th>
                <th class="ta-r">到手 / 估值</th><th class="ta-r">盈亏</th><th class="ta-c">日期</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in assetOutflow.rows" :key="p.id">
                <td><div class="cell-main">{{ p.name }}</div></td>
                <td class="muted">{{ p.zone }}</td>
                <td><Tag :text="catName(p.category) + (p.sub_category ? ' · ' + p.sub_category : '')" tone="default" /></td>
                <td class="ta-r num">{{ money(p.purchase_price) }}</td>
                <td class="ta-c">
                  <Tag v-if="p.status === 'sold'" text="已售出" tone="ok" />
                  <Tag v-else-if="p.listed" text="已上架" tone="info" />
                  <Tag v-else text="持有中" tone="warn" />
                </td>
                <td class="ta-r num" :class="p.status === 'sold' ? 'info' : 'muted'">
                  {{ money(p.status === 'sold' ? p._net : p._onHand) }}
                </td>
                <td class="ta-r num strong" :class="'pnl-' + pnlTone(p._profit)">
                  {{ money(p._profit, { sign: true }) }}
                </td>
                <td class="ta-c muted">{{ dateText(p.status === 'sold' ? p.sale_date : p.purchase_date) || '—' }}</td>
              </tr>
              <tr v-if="!assetOutflow.rows.length">
                <td colspan="8"><Empty text="还没有固定资产流出的记录 —— 在商品模块勾选「固定资产流出」登记" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

  </div>`,
};
