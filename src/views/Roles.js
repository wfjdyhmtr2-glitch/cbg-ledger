/**
 * 角色管理
 * 一个角色 = 一个项目批次：买进来 → （可选拆号）→ 本体/空壳卖出
 * 表格里直接看得到「投入 / 已回款 / 在手 / 预计盈亏 / 持有天数」，展开能看拆号明细
 */

import {
  state, stats, zoneList, saveRole, deleteRole, sellRole, unsellRole,
  createRole, createProduct, saveProduct,
} from '../core/store.js';
import { normalizeZone } from '../core/model.js';
import { money, wan, pct, daysText, agingTone, pnlTone, dateText } from '../core/format.js';

export const Roles = {
  data() {
    return {
      q: '',
      zoneFilter: '',
      statusFilter: 'all',
      /** 点「筛选」才生效的条件（草稿在 q / zoneFilter / statusFilter 上） */
      applied: { q: '', zoneFilter: '', statusFilter: 'all' },
      sortKey: 'purchase_date',
      sortDir: 'desc',
      expanded: {},
      editing: null,
      selling: null,
      splitting: null,
      confirmDel: null,
      busy: false,
    };
  },
  computed: {
    s() { return stats.value; },
    st() { return state; },
    zoneOptions() { return zoneList.value; },
    rows() {
      let list = this.s.roleRows;
      const f = this.applied;

      if (f.zoneFilter) list = list.filter((r) => normalizeZone(r.zone) === f.zoneFilter);
      if (f.statusFilter !== 'all') list = list.filter((r) => r.status === f.statusFilter);

      const q = String(f.q || '').trim().toLowerCase();
      if (q) {
        list = list.filter((r) =>
          String(r.name || '').toLowerCase().includes(q) ||
          String(r.school || '').toLowerCase().includes(q) ||
          String(r.level || '').includes(q) ||
          String(r.note || '').toLowerCase().includes(q)
        );
      }

      const dir = this.sortDir === 'asc' ? 1 : -1;
      const key = this.sortKey;
      return [...list].sort((a, b) => {
        if (key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh') * dir;
        if (key === 'profit') return (a._totalProfit - b._totalProfit) * dir;
        if (key === 'days') return ((a._days ?? 0) - (b._days ?? 0)) * dir;
        if (key === 'cost') return (a._cost - b._cost) * dir;
        return String(a.purchase_date || '').localeCompare(String(b.purchase_date || '')) * dir;
      });
    },
    summary() {
      const l = this.rows;
      const sum = (f) => l.reduce((s, r) => s + f(r), 0);
      return {
        count: l.length,
        cost: sum((r) => r._cost),
        recovered: sum((r) => r._recovered),
        onHand: sum((r) => r._onHand),
        profit: sum((r) => r._totalProfit),
        realized: sum((r) => r._realized),
        losers: l.filter((r) => r._totalProfit < -0.004).length,
      };
    },
  },
  methods: {
    money, wan, pct, daysText, agingTone, pnlTone, dateText,
    toggle(id) { this.expanded[id] = !this.expanded[id]; },
    toggleDir() { this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc'; },
    applyFilters() {
      this.applied = { q: this.q, zoneFilter: this.zoneFilter, statusFilter: this.statusFilter };
    },
    resetFilters() {
      this.q = '';
      this.zoneFilter = '';
      this.statusFilter = 'all';
      this.applied = { q: '', zoneFilter: '', statusFilter: 'all' };
    },

    openNew() {
      this.editing = createRole();
    },
    openSplit(role) {
      this.splitting = { roleId: role.id };
    },
    async saveSplit(payload) {
      const ok = await saveProduct({ ...payload, role_id: payload.role_id, status: 'holding' });
      if (ok) {
        const role = state.roles.find((r) => r.id === payload.role_id);
        if (role && !role.is_shell) await saveRole({ ...role, is_shell: true });
      }
      this.splitting = null;
    },

    async onSaveRole(payload) {
      const ok = await saveRole(payload);
      if (ok) this.editing = null;
    },
    async onSell(payload) {
      const ok = await sellRole(this.selling, payload);
      if (ok) this.selling = null;
    },
    async doUnsell(role) {
      if (!confirm(`把「${role.name}」改回持有中？已登记的售出信息会清掉。`)) return;
      await unsellRole(role);
    },
    async doDelete(role) {
      this.busy = true;
      await deleteRole(role.id);
      this.busy = false;
      this.confirmDel = null;
    },
    async quickToggleListed(role) {
      await saveRole({ ...role, listed: !role.listed });
    },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>角色管理</h2>
        <p class="page-sub">每个角色当成一票生意：买入 → （可拆号）→ 本体或空壳卖出</p>
      </div>
      <button class="btn primary" @click="openNew">＋ 新增角色</button>
    </div>

    <div class="toolbar">
      <input class="input search" v-model="q" placeholder="搜索角色名 / 门派 / 等级 / 备注"
        @keyup.enter="applyFilters" />
      <select class="input" v-model="zoneFilter">
        <option value="">全部区服</option>
        <option v-for="z in zoneOptions" :key="z" :value="z">{{ z }}</option>
      </select>
      <select class="input" v-model="statusFilter">
        <option value="all">全部状态</option>
        <option value="holding">持有中</option>
        <option value="sold">已售出</option>
      </select>

      <button class="btn primary" @click="applyFilters" title="应用当前筛选条件">筛选</button>
      <button class="btn" @click="resetFilters" title="清空全部筛选条件">重置</button>

      <span class="toolbar-gap"></span>

      <select class="input" v-model="sortKey" title="排序方式（即时生效）">
        <option value="purchase_date">按买入日期</option>
        <option value="days">按持有天数</option>
        <option value="cost">按买入价</option>
        <option value="profit">按盈亏</option>
        <option value="name">按名称</option>
      </select>
      <button class="btn tiny" @click="toggleDir" :title="sortDir === 'desc' ? '降序' : '升序'">
        {{ sortDir === 'desc' ? '↓' : '↑' }}
      </button>
    </div>

    <div class="summary-strip">
      <span><b>{{ summary.count }}</b> 个角色</span>
      <span>投入 <b class="accent">{{ money(summary.cost) }}</b></span>
      <span>已回款 <b class="info">{{ money(summary.recovered) }}</b></span>
      <span>在手 <b>{{ money(summary.onHand) }}</b></span>
      <span>实际盈亏 <b :class="'pnl-' + pnlTone(summary.realized)">{{ money(summary.realized, { sign: true }) }}</b></span>
      <span>预计盈亏 <b :class="'pnl-' + pnlTone(summary.profit - summary.realized)">{{ money(summary.profit - summary.realized, { sign: true }) }}</b></span>
      <span v-if="summary.losers" class="warn-text">其中 {{ summary.losers }} 个亏损</span>
    </div>

    <div class="table-wrap">
      <table class="table hoverable roles-table">
        <thead>
          <tr>
            <th class="w-32"></th>
            <th>角色</th>
            <th>区服</th>
            <th class="ta-r">买入价</th>
            <th class="ta-r">已回款</th>
            <th class="ta-r">在手估值</th>
            <th class="ta-c">回本进度</th>
            <th class="ta-c">持有</th>
            <th class="ta-r" title="实 = 已售落袋；预 = 在手按估值">盈亏（实 / 预）</th>
            <th class="ta-c">结论</th>
            <th class="ta-r">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in rows" :key="r.id">
            <tr :class="{ expanded: expanded[r.id] }">
              <td class="ta-c">
                <Expander :open="!!expanded[r.id]" @toggle="toggle(r.id)" />
              </td>
              <td>
                <div class="cell-main">
                  {{ r.name }}
                  <Tag v-if="r.is_shell" text="空壳号" tone="dim" />
                </div>
                <div class="cell-sub">
                  {{ r.level ? r.level + '级' : '等级未填' }}
                  <template v-if="r.school"> · {{ r.school }}</template>
                  <template v-if="r._childCount"> · 拆出 {{ r._childCount }} 件</template>
                </div>
              </td>
              <td class="muted">{{ r.zone || '未填区服' }}</td>
              <td class="ta-r num">{{ money(r._cost) }}</td>
              <td class="ta-r num info">{{ money(r._recovered) }}</td>
              <td class="ta-r num">{{ money(r._onHand) }}</td>
              <td class="ta-c">
                <RecoverBar :rate="r._recoverRate" :cost="r._cost" :recovered="r._recovered" />
              </td>
              <td class="ta-c">
                <span :class="'age age-' + agingTone(r.status === 'sold' ? r._daysToSell : r._days)">
                  {{ daysText(r.status === 'sold' ? r._daysToSell : r._days) }}
                </span>
              </td>
              <td class="ta-r">
                <div class="pnl-split">
                  <span class="pv real"><i>实</i><b :class="'pnl-' + pnlTone(r._realized)">{{ money(r._realized, { sign: true }) }}</b></span>
                  <span class="pv est"><i>预</i><span :class="'pnl-' + pnlTone(r._totalProfit - r._realized)">{{ money(r._totalProfit - r._realized, { sign: true }) }}</span></span>
                </div>
              </td>
              <td class="ta-c">
                <Verdict :value="r._totalProfit" :done="r.status === 'sold'" />
              </td>
              <td class="ta-r">
                <div class="row-actions">
                  <button class="btn tiny" @click="editing = r" title="编辑">编辑</button>
                  <button v-if="r.status !== 'sold'" class="btn tiny" @click="openSplit(r)" title="拆号：把装备召唤兽单独上架">拆号</button>
                  <button v-if="r.status !== 'sold'" class="btn tiny info" @click="selling = r">售出</button>
                  <button v-else class="btn tiny" @click="doUnsell(r)">撤销</button>
                  <button class="btn tiny danger" @click="confirmDel = r" title="删除">删</button>
                </div>
              </td>
            </tr>

            <tr v-if="expanded[r.id]" class="detail-row">
              <td></td>
              <td colspan="10">
                <div class="detail">
                  <div class="detail-head">
                    <span>拆号明细 · {{ r._childCount }} 件</span>
                    <span class="muted" v-if="r._childCount">
                      拆出商品累计回款 {{ money(r._childNet) }}，还有 {{ r._holdingChildCount }} 件在手上
                    </span>
                  </div>
                  <table class="table compact sub-table" v-if="r._childCount">
                    <thead>
                      <tr>
                        <th>商品</th><th>类别</th><th class="ta-r" title="母角色分摊给它的成本 + 它自己填的买入价">计入成本</th>
                        <th class="ta-r">卖出价</th><th class="ta-r">到手</th>
                        <th class="ta-c">持有</th><th class="ta-c">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="c in r._children" :key="c.id">
                        <td>{{ c.name }}</td>
                        <td><Tag :text="c.category" tone="default" /></td>
                        <td class="ta-r num muted">{{ money(c._unitCost) }}</td>
                        <td class="ta-r num">{{ c.status === 'sold' ? money(c.sale_price) : '—' }}</td>
                        <td class="ta-r num">{{ c.status === 'sold' ? money(c._net) : '—' }}</td>
                        <td class="ta-c">
                          <span :class="'age age-' + agingTone(c._days)">{{ daysText(c._days) }}</span>
                        </td>
                        <td class="ta-c">
                          <Tag v-if="c.status === 'sold'" text="已售" tone="up" />
                          <Tag v-else-if="c.listed" text="挂牌中" tone="info" />
                          <Tag v-else text="在手" tone="warn" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p class="muted" v-else>还没有拆出商品。点上面的「拆号」把装备/召唤兽挂到这个角色名下，成本会自动算在角色这一票里。</p>

                  <div class="detail-foot">
                    <span>买入 {{ dateText(r.purchase_date) }} · {{ money(r.purchase_price) }}</span>
                    <span v-if="r.transfer_fee">转服费 {{ money(r.transfer_fee) }}</span>
                    <span v-if="r.other_cost">其他成本 {{ money(r.other_cost) }}</span>
                    <span v-if="r.note" class="note">备注：{{ r.note }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </template>

          <tr v-if="!rows.length">
            <td colspan="11">
              <Empty text="没有符合条件的角色" sub="换个筛选条件，或者点右上角新增一个" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <RoleForm v-if="editing" :model="editing"
      @close="editing = null" @save="onSaveRole" />

    <ProductForm v-if="splitting" :roles="st.roles"
      :defaultRoleId="splitting.roleId"
      @close="splitting = null" @save="saveSplit" />

    <SellForm v-if="selling" :item="selling" kind="role"
      @close="selling = null" @save="onSell" />

    <Modal v-if="confirmDel" title="删除角色" width="460px" @close="confirmDel = null"
      sub="这个操作不可撤销">
      <p class="confirm-text">
        确认删除「<b>{{ confirmDel.name }}</b>」？
        <template v-if="confirmDel._childCount">
          它名下还有 <b>{{ confirmDel._childCount }}</b> 件拆出的商品，删除后这些商品会变成独立商品（不会被删掉）。
        </template>
      </p>
      <template #footer>
        <button class="btn" @click="confirmDel = null">取消</button>
        <button class="btn danger" :disabled="busy" @click="doDelete(confirmDel)">确认删除</button>
      </template>
    </Modal>

  </div>`,
};
