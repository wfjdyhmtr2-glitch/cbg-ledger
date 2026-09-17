/**
 * 区服 —— 只读的数据透出视图
 *
 * 区服不再是一个要手工维护的模块：它从角色 / 商品里的区服字段自动汇总而来。
 * 所以这个页面没有「新增 / 改名 / 删除」—— 数据里有什么区，这里就显示什么区。
 *
 * 每个区可以展开，直接透出该区下的角色和商品明细。
 */

import { state, stats } from '../core/store.js';
import { normalizeZone } from '../core/model.js';
import { money, pct, wan, pnlTone, daysText } from '../core/format.js';
import { CATEGORY_MAP } from '../core/model.js';

export const Zones = {
  data() {
    return { expanded: {} };
  },
  computed: {
    s() { return stats.value; },
    st() { return state; },
    rows() { return this.s.zoneRows; },
    grand() { return this.s.totals; },
    maxLocked() { return Math.max(1, ...this.rows.map((r) => r.locked || 0)); },
    emptyHint() {
      return !this.st.roles.length && !this.st.products.length;
    },
  },
  methods: {
    money, pct, wan, pnlTone, daysText,
    catName(id) { return CATEGORY_MAP[id]?.name || id; },
    catIcon(id) { return CATEGORY_MAP[id]?.icon || '📦'; },
    toggle(id) { this.expanded[id] = !this.expanded[id]; },
    lockedBar(z) {
      return `${Math.max(2, ((z.locked || 0) / this.maxLocked) * 100)}%`;
    },
    /** 该区下的角色（按买入日期倒序） */
    zoneRoles(z) {
      return this.s.roleRows
        .filter((r) => normalizeZone(r.zone) === z.name)
        .sort((a, b) => String(b.purchase_date || '').localeCompare(String(a.purchase_date || '')));
    },
    /** 该区下的商品（独立采购 + 拆号出来的都算，按所在区） */
    zoneProducts(z) {
      return this.s.productRows
        .filter((p) => normalizeZone(p.zone) === z.name)
        .sort((a, b) => String(b.purchase_date || '').localeCompare(String(a.purchase_date || '')));
    },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>区服</h2>
        <p class="page-sub">
          区服从你的数据里自动汇总 —— 录角色 / 商品时填了哪个区，这里就自动出现哪个区。
          这里只读不可改，想调整区服就去改对应的那条角色或商品
        </p>
      </div>
    </div>

    <Empty v-if="emptyHint" text="还没有任何数据" sub="先去「角色」页录一个号，或者去「商品」页录一件货，区服就会自动出现">
      <NavLink class="btn primary" to="/roles">去新增角色</NavLink>
    </Empty>

    <template v-else>

      <div class="zone-summary">
        <div class="zs-item">
          <span class="zs-label">资金占用（在手）</span>
          <span class="zs-value accent">{{ money(grand.onHandInvest) }}</span>
          <span class="zs-note">
            还压在货上的本金（占盘子 {{ pct(grand.invest ? grand.onHandInvest / grand.invest : 0) }}）
            · 全部区服投入 {{ money(grand.invest) }} 中已回款 {{ money(grand.recovered) }}
          </span>
        </div>
        <div class="zs-item">
          <span class="zs-label">实际盈亏（已落袋）</span>
          <span class="zs-value" :class="'pnl-' + pnlTone(grand.realizedProfit)">
            {{ money(grand.realizedProfit, { sign: true }) }}
          </span>
          <span class="zs-note">已卖出资产：回款 − 成本</span>
        </div>
        <div class="zs-item">
          <span class="zs-label">预计盈亏（未落袋）</span>
          <span class="zs-value" :class="'pnl-' + pnlTone(grand.unrealizedProfit)">
            {{ money(grand.unrealizedProfit, { sign: true }) }}
          </span>
          <span class="zs-note">
            在手资产：估值 − 未收回成本 · 合计总盈亏 {{ money(grand.totalProfit, { sign: true }) }}
          </span>
        </div>
      </div>

      <div class="zone-grid">
        <div class="zone-card" v-for="z in rows" :key="z.id" :class="{ open: expanded[z.id] }">
          <div class="zc-head">
            <h3>{{ z.name }}</h3>
            <button class="btn tiny" @click="toggle(z.id)">
              {{ expanded[z.id] ? '收起明细' : '看明细' }}
            </button>
          </div>

          <div class="zc-metrics">
            <div class="zc-m">
              <span>投入</span>
              <b class="accent">{{ money(z.invest) }}</b>
            </div>
            <div class="zc-m">
              <span>已回款</span>
              <b class="info">{{ money(z.recovered) }}</b>
            </div>
            <div class="zc-m">
              <span>在手</span>
              <b>{{ money(z.onHand) }}</b>
            </div>
            <div class="zc-m">
              <span title="已卖出资产：回款 − 已售资产成本">实际盈亏</span>
              <b :class="'pnl-' + pnlTone(z.realized)">{{ money(z.realized, { sign: true }) }}</b>
            </div>
            <div class="zc-m">
              <span title="在手资产：估值 − 未收回成本（实际 + 预计 = 总盈亏）">预计盈亏</span>
              <b :class="'pnl-' + pnlTone(z.profit - z.realized)">{{ money(z.profit - z.realized, { sign: true }) }}</b>
            </div>
          </div>

          <div class="zc-lock">
            <div class="zc-lock-track"><i :style="{ width: lockedBar(z) }"></i></div>
            <span class="zc-lock-text">占用资金 ¥{{ wan(z.locked) }}</span>
          </div>

          <div class="zc-foot">
            <span>角色 {{ z.roleCount }}（持 {{ z.holdingRoles }}<template v-if="z.shellRoles"> · 空壳 {{ z.shellRoles }}</template>）</span>
            <span>商品 {{ z.productCount }}（持 {{ z.holdingProducts }}）</span>
            <span v-if="z.avgCycle != null">平均周转 {{ z.avgCycle }} 天</span>
            <span v-else class="muted">还没卖出过</span>
          </div>

          <div class="zc-transfer" v-if="z.transferredIn || z.transferredOut">
            <span v-if="z.transferredIn" class="muted" title="别的区买入、转到这个区卖掉的成交额">
              ↓ 转入卖出 {{ money(z.transferredIn) }}
            </span>
            <span v-if="z.transferredOut" class="muted" title="在这个区买入、转到别的区卖掉的成交额">
              ↑ 转出卖出 {{ money(z.transferredOut) }}
            </span>
          </div>

          <!-- 数据透出：这个区下的角色 -->
          <div class="zc-detail" v-if="expanded[z.id]">
            <div class="zc-detail-sec">
              <h4>角色 <span class="muted">{{ zoneRoles(z).length }}</span></h4>
              <table class="table compact sub-table" v-if="zoneRoles(z).length">
                <thead>
                  <tr>
                    <th>角色</th><th class="ta-r">买入价</th>
                    <th class="ta-c">持有</th><th class="ta-c">状态</th><th class="ta-r" title="实 = 已售落袋；预 = 在手按估值">盈亏（实 / 预）</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in zoneRoles(z)" :key="r.id">
                    <td>
                      <div class="cell-main">
                        {{ r.name }}
                        <Tag v-if="r.is_shell" text="空壳" tone="dim" />
                      </div>
                      <div class="cell-sub">{{ r.level ? r.level + '级' : '' }} {{ r.school }}</div>
                    </td>
                    <td class="ta-r num">{{ money(r._cost) }}</td>
                    <td class="ta-c">
                      <span :class="'age age-' + agingTone(r.status === 'sold' ? r._daysToSell : r._days)">
                        {{ daysText(r.status === 'sold' ? r._daysToSell : r._days) }}
                      </span>
                    </td>
                    <td class="ta-c">
                      <Tag v-if="r.status === 'sold'" text="已售" tone="up" />
                      <Tag v-else-if="r.listed" text="挂牌中" tone="info" />
                      <Tag v-else text="持有中" tone="warn" />
                    </td>
                    <td class="ta-r"><Pnl :value="r._totalProfit" /></td>
                  </tr>
                </tbody>
              </table>
              <p class="muted small" v-else>这个区还没有角色</p>
            </div>

            <!-- 数据透出：这个区下的商品 -->
            <div class="zc-detail-sec">
              <h4>商品 <span class="muted">{{ zoneProducts(z).length }}</span></h4>
              <table class="table compact sub-table" v-if="zoneProducts(z).length">
                <thead>
                  <tr>
                    <th>商品</th><th>来源</th>
                    <th class="ta-r">成本</th><th class="ta-c">状态</th><th class="ta-r">到手/估值</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in zoneProducts(z)" :key="p.id">
                    <td>
                      <div class="cell-main">{{ catIcon(p.category) }} {{ p.name }}</div>
                      <div class="cell-sub">{{ catName(p.category) }}</div>
                    </td>
                    <td class="muted small">
                      <template v-if="p.role_id">拆自 {{ p.roleName }}</template>
                      <template v-else>独立采购</template>
                    </td>
                    <td class="ta-r num">
                      <template v-if="p.role_id && st.view === 'project'"><span class="muted">—</span></template>
                      <template v-else>{{ money(p._cost) }}</template>
                    </td>
                    <td class="ta-c">
                      <Tag v-if="p.status === 'sold'" text="已售" tone="up" />
                      <Tag v-else-if="p.listed" text="挂牌中" tone="info" />
                      <Tag v-else text="在手" tone="warn" />
                    </td>
                    <td class="ta-r num">{{ p.status === 'sold' ? money(p._net) : money(p._onHand) }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="muted small" v-else>这个区还没有商品</p>
            </div>
          </div>

        </div>
      </div>

    </template>
  </div>`,
};
