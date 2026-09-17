/**
 * 商品管理
 * 两类商品：独立采购的（自己背成本）和拆号出来的（成本算在母角色头上）
 * 列表里把这两类明确区分开，避免误判成"零成本暴利"
 */

import { state, stats, zoneList, saveProduct, deleteProduct, sellProduct, unsellProduct, createProduct, notify } from '../core/store.js';
import { money, daysText, agingTone, pnlTone, dateText } from '../core/format.js';
import { netFromGross } from '../core/fee.js';
import { CATEGORIES, CATEGORY_MAP, normalizeZone } from '../core/model.js';

export const Products = {
  data() {
    return {
      q: '',
      zoneFilter: '',
      catFilter: '',
      statusFilter: 'all',
      sourceFilter: 'all', // all | standalone | attached
      /** 点「筛选」才生效的条件 */
      applied: { q: '', zoneFilter: '', catFilter: '', statusFilter: 'all', sourceFilter: 'all' },
      sortKey: 'days',
      sortDir: 'desc',
      editing: null,
      selling: null,
      confirmDel: null,
      busy: false,
    };
  },
  computed: {
    s() { return stats.value; },
    st() { return state; },
    categories() { return CATEGORIES; },
    zoneOptions() { return zoneList.value; },
    rows() {
      let list = this.s.productRows;
      const f = this.applied;

      if (f.zoneFilter) list = list.filter((p) => normalizeZone(p.zone) === f.zoneFilter);
      if (f.catFilter) list = list.filter((p) => p.category === f.catFilter);
      if (f.statusFilter !== 'all') list = list.filter((p) => p.status === f.statusFilter);
      if (f.sourceFilter === 'standalone') list = list.filter((p) => !p.role_id);
      if (f.sourceFilter === 'attached') list = list.filter((p) => p.role_id);

      const q = String(f.q || '').trim().toLowerCase();
      if (q) {
        list = list.filter((p) =>
          String(p.name || '').toLowerCase().includes(q) ||
          String(p.note || '').toLowerCase().includes(q)
        );
      }

      const dir = this.sortDir === 'asc' ? 1 : -1;
      const key = this.sortKey;
      return [...list].sort((a, b) => {
        if (key === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh') * dir;
        if (key === 'cost') return (a._cost - b._cost) * dir;
        if (key === 'profit') return (this.rowProfit(a) - this.rowProfit(b)) * dir;
        if (key === 'onHand') return (a._onHand - b._onHand) * dir;
        return ((a._days ?? 0) - (b._days ?? 0)) * dir;
      });
    },
    summary() {
      const l = this.rows;
      const sum = (f) => l.reduce((x, p) => x + f(p), 0);
      return {
        count: l.length,
        cost: sum((p) => (p._attached ? 0 : p._cost)),
        recovered: sum((p) => p._net),
        onHand: sum((p) => p._onHand),
        profit: sum((p) => this.rowProfit(p)),
        stale: l.filter((p) => p.status !== 'sold' && (p._days || 0) >= 60).length,
      };
    },
    viewedAsProject() { return this.st.view === 'project'; },
    /** 按类别分组：同一类别放在一起，空组不显示 */
    groups() {
      return this.categories
        .map((c) => {
          const rows = this.rows.filter((p) => p.category === c.id);
          return {
            id: c.id, name: c.name, icon: c.icon, rows,
            count: rows.length,
            cost: rows.reduce((s2, p) => s2 + (Number(p.purchase_price) || 0), 0),
          };
        })
        .filter((g) => g.rows.length);
    },
  },
  methods: {
    money, daysText, agingTone, pnlTone, dateText, notify,
    catName(id) { return CATEGORY_MAP[id]?.name || id; },
    catIcon(id) { return CATEGORY_MAP[id]?.icon || '📦'; },

    /** 项目视角下拆号商品不背成本，盈亏不具参考意义，返回 null 让 UI 标注 */
    rowProfit(p) {
      if (p._attached && this.viewedAsProject) return null;
      return p._profit;
    },
    rowCost(p) {
      if (p._attached && this.viewedAsProject) return null;
      return p._cost;
    },
    /** 已上架未售出的预估到手 = 上架金额 − 信息费 */
    estNet(p) {
      return netFromGross(p.category, Number(p.listed_price) || 0);
    },
    toggleDir() { this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc'; },
    applyFilters() {
      this.applied = {
        q: this.q,
        zoneFilter: this.zoneFilter,
        catFilter: this.catFilter,
        statusFilter: this.statusFilter,
        sourceFilter: this.sourceFilter,
      };
    },
    resetFilters() {
      this.q = '';
      this.zoneFilter = '';
      this.catFilter = '';
      this.statusFilter = 'all';
      this.sourceFilter = 'all';
      this.applied = { q: '', zoneFilter: '', catFilter: '', statusFilter: 'all', sourceFilter: 'all' };
    },

    openNew() {
      this.editing = createProduct();
    },
    async onSave(payload) {
      const ok = await saveProduct(payload);
      if (ok) this.editing = null;
    },
    async onSell(payload) {
      const ok = await sellProduct(this.selling, payload);
      if (ok) this.selling = null;
    },
    async doUnsell(p) {
      if (!confirm(`把「${p.name}」改回持有中？已登记的售出信息会清掉。`)) return;
      await unsellProduct(p);
    },
    async doDelete(p) {
      this.busy = true;
      await deleteProduct(p.id);
      this.busy = false;
      this.confirmDel = null;
    },
    async quickToggleListed(p) {
      await saveProduct({ ...p, listed: !p.listed });
    },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>商品管理</h2>
        <p class="page-sub">
          独立采购的货自己背成本；从角色身上拆下来的，成本算在母角色那一票里
        </p>
      </div>
      <button class="btn primary" @click="openNew">＋ 新增商品</button>
    </div>

    <div class="toolbar">
      <input class="input search" v-model="q" placeholder="搜索商品名 / 备注"
        @keyup.enter="applyFilters" />
      <select class="input" v-model="zoneFilter">
        <option value="">全部区服</option>
        <option v-for="z in zoneOptions" :key="z" :value="z">{{ z }}</option>
      </select>
      <select class="input" v-model="catFilter">
        <option value="">全部类别</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.icon }} {{ c.name }}</option>
      </select>
      <select class="input" v-model="sourceFilter">
        <option value="all">全部来源</option>
        <option value="standalone">独立采购</option>
        <option value="attached">拆号商品</option>
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
        <option value="days">按持有天数</option>
        <option value="cost">按成本</option>
        <option value="onHand">按在手估值</option>
        <option value="profit">按盈亏</option>
        <option value="name">按名称</option>
      </select>
      <button class="btn tiny" @click="toggleDir">{{ sortDir === 'desc' ? '↓' : '↑' }}</button>
    </div>

    <div class="summary-strip">
      <span><b>{{ summary.count }}</b> 件商品</span>
      <span>自有成本 <b class="accent">{{ money(summary.cost) }}</b></span>
      <span>已回款 <b class="info">{{ money(summary.recovered) }}</b></span>
      <span>在手 <b>{{ money(summary.onHand) }}</b></span>
      <span v-if="!viewedAsProject">盈亏 <b :class="'pnl-' + pnlTone(summary.profit)">{{ money(summary.profit, { sign: true }) }}</b></span>
      <span v-if="summary.stale" class="warn-text">{{ summary.stale }} 件压了 60 天以上</span>
    </div>

    <div class="view-hint" v-if="viewedAsProject">
      当前是<b>项目视角</b>：拆号商品的成本挂在母角色上，所以它们的成本/盈亏列显示为「—」。
      想看单件商品的毛利，切到右上角的「单品视角」。
    </div>

    <div v-for="g in groups" :key="g.id" class="cat-group">
      <div class="cat-group-head">
        <span class="cell-main">{{ g.icon }} {{ g.name }}</span>
        <span class="muted small">{{ g.count }} 件 · 成本合计 <b>{{ money(g.cost) }}</b></span>
      </div>
      <div class="table-wrap">
        <table class="table hoverable">
          <thead>
            <tr>
              <th>商品</th>
              <th>区服</th>
              <th>来源</th>
              <th class="ta-r">成本</th>
              <th class="ta-r">上架价格</th>
              <th class="ta-r">到手</th>
              <th class="ta-c">持有</th>
              <th class="ta-r" title="实 = 已售落袋；预 = 在手按估值">盈亏（实 / 预）</th>
              <th class="ta-c">状态</th>
              <th class="ta-r">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in g.rows" :key="p.id">
              <td>
                <div class="cell-main">{{ p.name }}
                  <Tag v-if="p.from_asset" text="资产流出" tone="accent" /></div>
                <div class="cell-sub">{{ p.sub_category || '默认' }}</div>
              </td>
              <td class="muted">{{ p.zone || '未填区服' }}</td>
              <td>
                <Tag v-if="p.role_id" :text="'拆自 ' + p.roleName" tone="accent" />
                <Tag v-else text="独立采购" tone="default" />
              </td>
              <td class="ta-r num">
                <span :title="p._attached ? '母角色分摊 ' + money(p._allocCost) + ' + 自己填的成本 ' + money(p.purchase_price) : ''">{{ money(p._unitCost) }}</span>
              </td>
              <td class="ta-r num muted">{{ p.listed_price > 0 ? money(p.listed_price) : '—' }}</td>
              <td class="ta-r num">
                <template v-if="p.status === 'sold'"><span class="info">{{ money(p._net) }}</span></template>
                <template v-else-if="p.listed && p.listed_price > 0">
                  <span class="info" title="上架金额 − 信息费">{{ money(estNet(p)) }}</span>
                </template>
                <template v-else><span class="muted">—</span></template>
              </td>
              <td class="ta-c">
                <span :class="'age age-' + agingTone(p._days)">{{ daysText(p._days) }}</span>
              </td>
              <td class="ta-r">
                <template v-if="rowProfit(p) === null"><span class="muted" title="项目视角下不计单品盈亏">—</span></template>
                <div v-else-if="p.status === 'sold'" class="pnl-split">
                  <span class="pv real"><i>实</i><b :class="'pnl-' + pnlTone(rowProfit(p))">{{ money(rowProfit(p), { sign: true }) }}</b></span>
                </div>
                <div v-else class="pnl-split">
                  <span class="pv est"><i>预</i><span :class="'pnl-' + pnlTone(rowProfit(p))">{{ money(rowProfit(p), { sign: true }) }}</span></span>
                </div>
              </td>
              <td class="ta-c">
                <Tag v-if="p.status === 'sold'" text="已售" tone="up" />
                <Tag v-else-if="p.listed" text="已上架" tone="info" />
                <Tag v-else text="在手" tone="warn" />
              </td>
              <td class="ta-r">
                <div class="row-actions">
                  <button class="btn tiny" @click="editing = p">编辑</button>
                  <button v-if="p.status !== 'sold'" class="btn tiny info" @click="selling = p">售出</button>
                  <button v-else class="btn tiny" @click="doUnsell(p)">撤销</button>
                  <button class="btn tiny danger" @click="confirmDel = p">删</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="!rows.length" class="table-wrap">
      <table class="table"><tbody><tr>
        <td><Empty text="没有符合条件的商品" sub="换个筛选条件，或者新增一件" /></td>
      </tr></tbody></table>
    </div>

    <ProductForm v-if="editing" :model="editing" :roles="st.roles"
      @close="editing = null" @save="onSave" />

    <SellForm v-if="selling" :item="selling" kind="product"
      @close="selling = null" @save="onSell" />

    <Modal v-if="confirmDel" title="删除商品" width="420px" @close="confirmDel = null">
      <p class="confirm-text">确认删除「<b>{{ confirmDel.name }}</b>」？这个操作不可撤销。</p>
      <template #footer>
        <button class="btn" @click="confirmDel = null">取消</button>
        <button class="btn danger" :disabled="busy" @click="doDelete(confirmDel)">确认删除</button>
      </template>
    </Modal>

  </div>`,
};
