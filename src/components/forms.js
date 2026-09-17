/**
 * 录入表单：角色（含拆号入口） / 商品 / 售出登记
 *
 * 区服不再是一个要单独维护的模块 —— 这里的区服输入框既能手打新区，
 * 也能从「数据里已经出现过的区服」里补全选择（datalist）。
 * 列表由 collectZoneNames 自动汇总，所以你录到哪个区，哪个区就自动出现。
 */

import { newRole, newProduct, newAsset, newChar, plain, todayStr, daysBetween, CATEGORIES, SCHOOLS, num, round2, collectZoneNames, assetLockInfo, ASSET_LOCK_DAYS, subOptionsOf, normalizeZone, roleOptionsForZone } from '../core/model.js';
import { state, notify } from '../core/store.js';
import { calcFee, netFromGross, feeRuleText } from '../core/fee.js';
import { money } from '../core/format.js';

/** 表单通用：本地副本 + 校验 + 提交 */
const formMixin = {
  data() {
    const src = this.model || this.blank();
    return { f: JSON.parse(JSON.stringify(src)), err: '' };
  },
  methods: {
    money,
    num,
    zoneSuggestions() {
      return collectZoneNames(state.roles, state.products);
    },
    update(key, v) { this.f[key] = v; },
    close() { this.$emit('close'); },
    submit() {
      const ok = this.validate();
      if (ok !== true) { this.err = ok; return; }
      this.$emit('save', plain(this.f));
    },
  },
};

export const RoleForm = {
  mixins: [formMixin],
  props: { model: Object },
  emits: ['close', 'save'],
  methods: {
    blank: () => newRole(),
    validate() {
      if (!String(this.f.name || '').trim()) return '请填写角色名或编号，方便以后认出来';
      if (!String(this.f.zone || '').trim()) return '请填写区服名称';
      if (num(this.f.purchase_price) < 0) return '买入价不能为负数';
      return true;
    },
  },
  data() {
    return { SCHOOLS };
  },
  computed: {
    feeTip() {
      const p = num(this.f.listed_price);
      if (!p) return '';
      return `挂牌 ¥${p} → 信息费 ¥${calcFee('role', p)} → 到手 ¥${netFromGross('role', p)}`;
    },
    forgotDate: {
      get() { return !this.f.purchase_date; },
      set(v) {
        // 勾上 = 忘了日期，清空（显示 —）；取消勾选 = 先按今天，可再改
        this.f.purchase_date = v ? '' : todayStr();
      },
    },
  },
  template: `
  <Modal :title="model ? '编辑角色' : '新增角色'" width="680px"
    sub="角色既是一个可转手的资产，也是拆号商品的归属批次" @close="close">
    <div class="form-grid">
      <Field label="区服" hint="输几个字就弹候选 —— 内置梦幻全服清单 + 你的历史区服，点击选中">
        <ZoneInput v-model="f.zone" placeholder="例如：日光岩 / 华南一区·缘定三生" />
      </Field>
      <Field label="角色名 / 编号">
        <input class="input" v-model.trim="f.name" placeholder="例如：剑影流光 或 号A-01" />
      </Field>

      <Field label="等级">
        <input class="input" type="number" v-model="f.level" placeholder="175" />
      </Field>
      <Field label="门派">
        <select class="input" v-model="f.school">
          <option value="">— 未填 —</option>
          <option v-for="s in SCHOOLS" :key="s" :value="s">{{ s }}</option>
        </select>
      </Field>

      <Field label="买入价" hint="藏宝阁实际支付金额">
        <input class="input" type="number" step="0.01" v-model="f.purchase_price" placeholder="0.00" />
      </Field>
      <Field label="买入日期">
        <input class="input" type="date" v-model="f.purchase_date" :disabled="forgotDate"
          :class="{ dimmed: forgotDate }" />
        <label class="check-line" style="margin-top: 6px">
          <input type="checkbox" v-model="forgotDate" />
          不记得购入日期（显示为 —）
        </label>
      </Field>

      <Field label="转服费" hint="买入后转过服才填">
        <input class="input" type="number" step="0.01" v-model="f.transfer_fee" placeholder="0.00" />
      </Field>
      <Field label="其他成本" hint="点卡、代练、解绑等零散支出">
        <input class="input" type="number" step="0.01" v-model="f.other_cost" placeholder="0.00" />
      </Field>

      <Field label="挂牌价" :hint="feeTip || '挂在藏宝阁的标价；在手资产按这个价计入预估市值'">
        <input class="input" type="number" step="0.01" v-model="f.listed_price" placeholder="0.00" />
      </Field>
    </div>

    <div class="check-row">
      <label class="check"><input type="checkbox" v-model="f.listed" /><span>已上架出售</span></label>
      <label class="check"><input type="checkbox" v-model="f.is_shell" /><span>已拆号（装备/召唤兽已单独上架，只剩空壳）</span></label>
    </div>

    <Field label="备注" span>
      <textarea class="input" rows="2" v-model.trim="f.note" placeholder="例如：拆号时装备卖得好，空壳亏一点出也行"></textarea>
    </Field>

    <p class="form-err" v-if="err">{{ err }}</p>

    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" @click="submit">保存</button>
    </template>
  </Modal>`,
};

export const ProductForm = {
  mixins: [formMixin],
  props: { model: Object, roles: Array, defaultRoleId: String },
  emits: ['close', 'save'],
  methods: {
    blank: () => newProduct({ role_id: null }),
    validate() {
      if (!String(this.f.name || '').trim()) return '请填写商品名称';
      if (!String(this.f.zone || '').trim()) return '请填写区服名称';
      return true;
    },
    /** 从「来源角色」反填区服：角色在哪个区，这票货就在哪个区 */
    syncZoneFromRole() {
      const r = (this.roles || []).find((x) => x.id === this.f.role_id);
      if (r && String(r.zone || '').trim()) this.f.zone = r.zone;
    },
  },
  data() {
    const f = JSON.parse(JSON.stringify(this.model || this.blank()));
    if (!this.model && this.defaultRoleId) {
      const r = (this.roles || []).find((x) => x.id === this.defaultRoleId);
      if (r) { f.role_id = r.id; f.zone = r.zone; }
    }
    return { f, err: '', CATEGORIES };
  },
  computed: {
    parent() { return (this.roles || []).find((r) => r.id === this.f.role_id) || null; },
    /** 母角色的总成本 = 买入价 + 转服费 + 其他成本 */
    parentCost() {
      const p = this.parent;
      if (!p) return 0;
      return num(p.purchase_price) + num(p.transfer_fee) + num(p.other_cost);
    },
    /**
     * 「买入价」这格的提示。
     * 口径：这件货的成本 = 母角色分摊过来的部分 + 这里填的钱，两者会相加。
     * 所以成本全在角色上就填 0；如果这件货是角色之外另外花钱买的，就把它填上。
     */
    buyHint() {
      if (this.f.from_asset) return '固定资产流出的东西，建议填它的原购入成本，盈亏才准';
      if (!this.parent) return '独立采购：这里就是这件货的成本';
      if (!(this.parentCost > 0)) {
        return '⚠️ 角色「' + this.parent.name + '」没记买入价 —— 这格务必填上这件货的成本，留空会被当成纯赚';
      }
      return '成本全算在角色「' + this.parent.name + '」上就填 0；这件货若在角色之外另花了钱，填这里（会与角色成本相加）';
    },
    /** 当前区服是否已填（没填就不做区服过滤，否则新增时啥都选不到） */
    zoneFiltered() { return !!String(this.f.zone || '').trim(); },
    roleOptions() {
      return roleOptionsForZone(this.roles, this.f.zone, this.f.role_id);
    },
    feeTip() {
      const p = num(this.f.listed_price);
      if (!p) return '';
      return `上架 ¥${p} → 信息费 ¥${calcFee(this.f.category, p)} → 到手 ¥${netFromGross(this.f.category, p)}`;
    },
    ruleText() { return feeRuleText(this.f.category); },
    subOptions() { return subOptionsOf(this.f.category); },
    holdDaysText() {
      if (this.f.from_asset || !this.f.purchase_date) return '—';
      const d = daysBetween(this.f.purchase_date, todayStr());
      return d == null ? '—' : d + ' 天';
    },
    forgotDate: {
      get() { return !this.f.purchase_date; },
      set(v) {
        // 勾上 = 忘了日期，清空（显示 —）；取消勾选 = 先按今天，可再改
        this.f.purchase_date = v ? '' : todayStr();
      },
    },
  },
  watch: {
    'f.category'() {
      // 一级分类换了，原二级分类不属于新类别时清空
      if (this.f.sub_category && !this.subOptions.includes(this.f.sub_category)) {
        this.f.sub_category = '';
      }
    },
    'f.zone'(val) {
      // 区服一改，原来挂着的角色可能就不在这个区了 —— 一票货的买入区不该跨区，
      // 这时清掉角色选择退回「独立采购」，否则会记出一条自相矛盾的账。
      if (!this.f.role_id) return;
      const zone = String(val || '').trim();
      if (!zone) return;
      const r = (this.roles || []).find((x) => x.id === this.f.role_id);
      if (r && normalizeZone(r.zone) !== normalizeZone(zone)) {
        this.f.role_id = null;
        notify(`区服换成「${zone}」了，已取消「${r.name}」的拆号关系，改成独立采购`, 'info');
      }
    },
  },
  template: `
  <Modal :title="model ? '编辑商品' : '新增商品'" width="680px"
    :sub="f.role_id ? '挂在角色名下 —— 成本由母角色承担，这里只记收入' : '独立采购的商品，自己单独核算盈亏'"
    @close="close">
    <div class="form-grid">
      <Field label="区服" hint="输几个字就弹候选，点击选中">
        <ZoneInput v-model="f.zone" placeholder="例如：日光岩 / 华南一区·缘定三生" />
      </Field>
      <Field label="商品名称">
        <input class="input" v-model.trim="f.name" placeholder="例如：130无级别·帽子" />
      </Field>

      <Field label="类别" :hint="ruleText">
        <select class="input" v-model="f.category">
          <option v-for="c in CATEGORIES" :key="c.id" :value="c.id">{{ c.icon }} {{ c.name }}</option>
        </select>
      </Field>
      <Field label="二级分类" hint="选填；留空显示为「默认」">
        <select class="input" v-model="f.sub_category" :disabled="!subOptions.length">
          <option value="">— 默认 —</option>
          <option v-for="s in subOptions" :key="s" :value="s">{{ s }}</option>
        </select>
      </Field>
      <Field label="来源角色"
        :hint="zoneFiltered
          ? '只列出「' + String(f.zone).trim() + '」的在手角色；选角色 = 拆号出来的，留空 = 自己单独买的'
          : '选角色 = 拆号出来的；留空 = 自己单独买的'">
        <select class="input" v-model="f.role_id" @change="syncZoneFromRole">
          <option :value="null">— 独立采购 —</option>
          <option v-for="r in roleOptions" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        <p class="muted small" v-if="zoneFiltered && !roleOptions.length" style="margin-top: 6px">
          「{{ String(f.zone).trim() }}」下没有可挂的角色 —— 该区还没录角色，或角色都已售出
        </p>
      </Field>

      <Field label="买入价" :hint="buyHint">
        <input class="input" type="number" step="0.01" v-model="f.purchase_price" placeholder="0.00" />
      </Field>
      <Field label="买入 / 入库日期" :hint="f.from_asset ? '固定资产流出不涉及新买入，日期不适用' : ''">
        <input class="input" type="date" v-model="f.purchase_date" :disabled="f.from_asset || forgotDate"
          :class="{ dimmed: f.from_asset || forgotDate }" />
        <label class="check-line" style="margin-top: 6px">
          <input type="checkbox" v-model="forgotDate" />
          不记得购入日期（显示为 —）
        </label>
      </Field>
      <Field label="持有天数" hint="自动按今天 − 买入日期计算，无需手填">
        <input class="input" :value="holdDaysText" disabled :class="{ dimmed: holdDaysText === '—' }" />
      </Field>

      <Field label="固定资产流出" span
        hint="勾选 = 这是自己号里（固定资产）的东西拿出来卖，不是新买入的倒卖货">
        <label class="check-line">
          <input type="checkbox" v-model="f.from_asset" />
          来自固定资产流出（购入日期将置灰）
        </label>
      </Field>

      <Field label="上架价格" :hint="feeTip">
        <input class="input" type="number" step="0.01" v-model="f.listed_price" placeholder="0.00" />
      </Field>
    </div>

    <div class="check-row">
      <label class="check"><input type="checkbox" v-model="f.listed" /><span>已上架出售</span></label>
    </div>

    <Field label="备注" span>
      <textarea class="input" rows="2" v-model.trim="f.note"></textarea>
    </Field>

    <p class="form-err" v-if="err">{{ err }}</p>

    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" @click="submit">保存</button>
    </template>
  </Modal>`,
};

/** 售出登记 —— 自动按藏宝阁规则算信息费，也可手填实际到手金额 */
export const SellForm = {
  props: { item: Object, kind: { type: String, default: 'role' } },
  emits: ['close', 'save'],
  data() {
    const it = this.item || {};
    return {
      f: {
        sale_price: num(it.sale_price) || num(it.listed_price) || 0,
        sale_net: '',
        sale_date: todayStr(),
        sold_zone: it.sold_zone || '',
      },
      err: '',
    };
  },
  computed: {
    category() { return this.kind === 'role' ? 'role' : (this.item.category || 'equipment'); },
    fee() { return calcFee(this.category, this.f.sale_price); },
    autoNet() { return netFromGross(this.category, this.f.sale_price); },
    finalNet() {
      return this.f.sale_net === '' || this.f.sale_net == null ? this.autoNet : num(this.f.sale_net);
    },
    profit() {
      const cost = this.kind === 'role'
        ? num(this.item._cost ?? this.item.purchase_price)
        : num(this.item._unitCost ?? this.item.purchase_price);
      return this.finalNet - cost;
    },
    ruleText() { return feeRuleText(this.category); },
    buyZoneName() { return String(this.item.zone || '').trim() || '原区'; },
    moved() { return String(this.f.sold_zone || '').trim() && this.f.sold_zone !== this.item.zone; },
  },
  methods: {
    num,
    money,
    close() { this.$emit('close'); },
    submit() {
      if (!(num(this.f.sale_price) > 0) && (this.f.sale_net === '' || this.f.sale_net == null)) {
        this.err = '至少填一个：成交价 或 实际到手金额';
        return;
      }
      this.$emit('save', { ...this.f });
    },
  },
  template: `
  <Modal title="登记售出" width="560px"
    :sub="(kind === 'role' ? '角色' : '商品') + '：' + item.name" @close="close">

    <div class="sell-summary">
      <div class="sell-line">
        <span>成本</span>
        <b>{{ money(kind === 'role' ? (item._cost || item.purchase_price) : (item._unitCost || item.purchase_price)) }}</b>
      </div>
      <div class="sell-line" v-if="item._childCount">
        <span>拆出商品已回款</span>
        <b>{{ money(item._childNet) }}</b>
      </div>
    </div>

    <div class="form-grid">
      <Field label="成交价（上架价格）">
        <input class="input" type="number" step="0.01" v-model="f.sale_price" placeholder="0.00" />
      </Field>
      <Field label="成交日期">
        <input class="input" type="date" v-model="f.sale_date" />
      </Field>
      <Field label="实际到手" hint="留空则按规则自动扣费；如果实际有出入，以你到账的数为准">
        <input class="input" type="number" step="0.01" v-model="f.sale_net" placeholder="自动计算" />
      </Field>
      <Field label="成交时所在区服" hint="转过服的才需要改这里；留空 = 和买入同区">
        <ZoneInput v-model="f.sold_zone" :placeholder="buyZoneName" />
      </Field>
    </div>

    <div class="fee-box" v-if="num(f.sale_price) > 0">
      <div class="fee-line">
        <span class="muted">藏宝阁规则</span>
        <span>{{ ruleText }}</span>
      </div>
      <div class="fee-calc">
        <span>上架 ¥{{ num(f.sale_price).toFixed(2) }}</span>
        <span class="fee-arrow">−</span>
        <span class="fee-amount">信息费 ¥{{ fee.toFixed(2) }}</span>
        <span class="fee-arrow">=</span>
        <span class="fee-net">到手 ¥{{ finalNet.toFixed(2) }}</span>
      </div>
      <div class="fee-profit">
        这笔的盈亏：
        <span :class="'pnl-' + (profit > 0.004 ? 'up' : profit < -0.004 ? 'down' : 'flat')">
          {{ money(profit, { sign: true }) }}
        </span>
        <span class="muted" v-if="kind === 'role' && item._childCount">（含拆出商品回款 {{ money(item._childNet) }}）</span>
      </div>
    </div>

    <p class="form-hint" v-if="moved">
      已记为跨区售出。这一票的账仍然整笔算在买入区「{{ buyZoneName }}」（成本和成交都在那边），
      成交区只做「由其他区转入卖出」的标注，不会重复计算。
    </p>
    <p class="form-err" v-if="err">{{ err }}</p>

    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" @click="submit">确认售出</button>
    </template>
  </Modal>`,
};

/** 固定资产 —— 自己常玩的号里买入的东西，只记成本不参与倒卖核算 */
export const AssetForm = {
  mixins: [formMixin],
  props: { model: Object, isNew: Boolean },
  emits: ['close', 'save'],
  methods: {
    blank: () => newAsset(),
    validate() {
      if (!String(this.f.name || '').trim()) return '请填写名称，比如「160无级别·剑」';
      if (num(this.f.cost) < 0) return '成本不能为负数';
      return true;
    },
    charOptions() { return state.chars || []; },
    lockInfoOf(a) { return assetLockInfo(a); },
  },
  data() {
    return { CATEGORIES, ASSET_LOCK_DAYS };
  },
  computed: {
    lockPreview() {
      if (!this.f.cross_server) return null;
      return assetLockInfo(this.f);
    },
    subOptions() { return subOptionsOf(this.f.category); },
    forgotDate: {
      get() { return !this.f.purchase_date; },
      set(v) {
        // 勾上 = 忘了日期，清空（显示 —）；取消勾选 = 先按今天，可再改
        this.f.purchase_date = v ? '' : todayStr();
      },
    },
  },
  watch: {
    'f.category'() {
      if (this.f.sub_category && !this.subOptions.includes(this.f.sub_category)) {
        this.f.sub_category = '';
      }
    },
  },
  template: `
  <Modal :title="isNew ? '新增固定资产' : '编辑固定资产'" width="600px"
    sub="只记购入成本，不参与倒卖的投入 / 回款 / 盈亏 —— 这是你自己号里的家当" @close="close">
    <div class="form-grid">
      <Field label="所属号" hint="选它挂在哪个号名下；还没建号就先选「未归号」，之后再归">
        <select class="input" v-model="f.char_id">
          <option :value="null">— 未归号 —</option>
          <option v-for="c in charOptions()" :key="c.id" :value="c.id">
            {{ c.name }}{{ c.zone ? '（' + c.zone + '）' : '' }}
          </option>
        </select>
      </Field>
      <Field label="类别">
        <select class="input" v-model="f.category">
          <option v-for="c in CATEGORIES" :key="c.id" :value="c.id">{{ c.icon }} {{ c.name }}</option>
        </select>
      </Field>
      <Field label="二级分类" hint="选填；留空显示为「默认」">
        <select class="input" v-model="f.sub_category" :disabled="!subOptions.length">
          <option value="">— 默认 —</option>
          <option v-for="s in subOptions" :key="s" :value="s">{{ s }}</option>
        </select>
      </Field>
      <Field label="名称">
        <input class="input" v-model.trim="f.name" placeholder="例如：160无级别·剑" />
      </Field>
      <Field label="购入成本" hint="当时的入手价；之后涨价跌价都不影响这份账">
        <input class="input" type="number" step="0.01" min="0" v-model="f.cost" placeholder="0.00" />
      </Field>
      <Field label="购入日期">
        <input class="input" type="date" v-model="f.purchase_date" :disabled="forgotDate"
          :class="{ dimmed: forgotDate }" />
        <label class="check-line" style="margin-top: 6px">
          <input type="checkbox" v-model="forgotDate" />
          不记得购入日期（显示为 —）
        </label>
      </Field>
      <Field label="是否跨服购买" hint="勾选后按藏宝阁规则自动计算 180 天时间锁的解锁日">
        <label class="check-line">
          <input type="checkbox" v-model="f.cross_server" />
          跨服购买（180 天时间锁）
        </label>
      </Field>
    </div>

    <div class="lock-hint" v-if="lockPreview">
      <template v-if="lockPreview.unlockDate">
        🔒 解锁日期：<b>{{ lockPreview.unlockDate }}</b>
        <span class="muted">
          （{{ lockPreview.unlocked ? '已解锁' : '还需等待 ' + lockPreview.daysLeft + ' 天' }}）
        </span>
      </template>
      <template v-else>🔒 跨服锁 {{ ASSET_LOCK_DAYS }} 天 —— 填上购入日期后自动算解锁日</template>
    </div>

    <Field label="备注" span>
      <textarea class="input" rows="2" v-model.trim="f.note" placeholder="例如：主力号的兵器，自己用不卖"></textarea>
    </Field>

    <p class="form-err" v-if="err">{{ err }}</p>

    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" @click="submit">保存</button>
    </template>
  </Modal>`,
};

/** 自玩号 —— 固定资产的容器 */
export const CharForm = {
  mixins: [formMixin],
  props: { model: Object, isNew: Boolean },
  emits: ['close', 'save'],
  methods: {
    blank: () => newChar(),
    validate() {
      if (!String(this.f.name || '').trim()) return '请填写号名';
      return true;
    },
  },
  template: `
  <Modal :title="isNew ? '新增自玩号' : '编辑自玩号'" width="520px"
    sub="号本身也是资产 —— 买来的号记购入价，自己练起来的填 0" @close="close">
    <div class="form-grid">
      <Field label="号名">
        <input class="input" v-model.trim="f.name" placeholder="例如：主力号·灵犀居士" />
      </Field>
      <Field label="所在区服" hint="输几个字就弹候选">
        <ZoneInput v-model="f.zone" placeholder="例如：日光岩 / 华南一区·缘定三生" />
      </Field>
      <Field label="号本身的购入成本" hint="买来的号填入手价；自己练起来的填 0">
        <input class="input" type="number" step="0.01" min="0" v-model="f.purchase_price" placeholder="0.00" />
      </Field>
      <Field label="购入 / 建号日期">
        <input class="input" type="date" v-model="f.purchase_date" />
      </Field>
    </div>

    <Field label="备注" span>
      <textarea class="input" rows="2" v-model.trim="f.note"></textarea>
    </Field>

    <p class="form-err" v-if="err">{{ err }}</p>

    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" @click="submit">保存</button>
    </template>
  </Modal>`,
};

/**
 * 固定资产售出 —— 自玩号 / 号内物品都能卖。
 *
 * 只填一个售出价格，到手价按藏宝阁费率自动算（可手填覆盖），
 * 底下实时预览这一笔的实际盈亏；确认后这条资产转成「固定资产流出」记录。
 */
export const AssetSellForm = {
  props: { source: Object, kind: String }, // kind: 'char' | 'asset'
  emits: ['close', 'save'],
  data() {
    return {
      f: { sale_price: '', sale_net: '', sale_date: todayStr(), sold_zone: '' },
      err: '',
    };
  },
  computed: {
    isChar() { return this.kind === 'char'; },
    /** 自玩号按「角色」费率，物品按自己的类别 */
    category() { return this.isChar ? 'role' : (this.source.category || 'other'); },
    /** 购入成本：号看 purchase_price，物品看 cost */
    cost() { return this.isChar ? num(this.source.purchase_price) : num(this.source.cost); },
    autoNet() { return netFromGross(this.category, this.f.sale_price); },
    fee() { return calcFee(this.category, this.f.sale_price); },
    finalNet() {
      return this.f.sale_net === '' || this.f.sale_net == null ? this.autoNet : num(this.f.sale_net);
    },
    profit() { return round2(this.finalNet - this.cost); },
    ruleText() { return feeRuleText(this.category); },
    buyZoneName() { return String(this.source.zone || '').trim() || '原区'; },
    /** 号里还有东西时提醒一下 —— 号卖掉后它们会变成未归号 */
    childItems() { return this.isChar ? num(this.source.items && this.source.items.length) : 0; },
  },
  methods: {
    num, money, round2,
    close() { this.$emit('close'); },
    submit() {
      if (!(num(this.f.sale_price) > 0) && (this.f.sale_net === '' || this.f.sale_net == null)) {
        this.err = '至少填一个：售出价格 或 实际到手金额';
        return;
      }
      this.$emit('save', { ...this.f });
    },
  },
  template: `
  <Modal title="固定资产售出" width="560px"
    :sub="(isChar ? '自玩号' : '号内物品') + '：' + source.name" @close="close">

    <div class="sell-summary">
      <div class="sell-line">
        <span>购入成本</span>
        <b>{{ money(cost) }}</b>
      </div>
      <div class="sell-line">
        <span>费率</span>
        <span class="muted small">{{ ruleText }}</span>
      </div>
    </div>

    <div class="form-grid">
      <Field label="售出价格" hint="你想卖多少（挂牌价）">
        <input class="input" type="number" step="0.01" v-model="f.sale_price" placeholder="0.00" />
      </Field>
      <Field label="成交日期">
        <input class="input" type="date" v-model="f.sale_date" />
      </Field>
      <Field label="实际到手" hint="留空 = 按规则自动扣费；实际有出入就以你到账的数为准">
        <input class="input" type="number" step="0.01" v-model="f.sale_net" placeholder="自动计算" />
      </Field>
      <Field label="成交时所在区服" hint="转过服的才需要改；留空 = 和原来同区">
        <ZoneInput v-model="f.sold_zone" :placeholder="buyZoneName" />
      </Field>
    </div>

    <div class="fee-box" v-if="num(f.sale_price) > 0">
      <div class="fee-line">
        <span class="muted">藏宝阁规则</span>
        <span>{{ ruleText }}</span>
      </div>
      <div class="fee-calc">
        <span>售出 ¥{{ num(f.sale_price).toFixed(2) }}</span>
        <span class="fee-arrow">−</span>
        <span class="fee-amount">信息费 ¥{{ fee.toFixed(2) }}</span>
        <span class="fee-arrow">=</span>
        <span class="fee-net">到手 ¥{{ finalNet.toFixed(2) }}</span>
      </div>
      <div class="fee-profit">
        这笔的实际盈亏：
        <span :class="'pnl-' + pnlTone(profit)">{{ money(profit, { sign: true }) }}</span>
        <span class="muted small">（到手 − 购入成本）</span>
      </div>
    </div>

    <p class="confirm-text" style="margin-top: 14px">
      ℹ️ 确认后这条资产会<b>标记为已售</b>并保留在固定资产里 —— 不再算「还在手上」，
      同时出现在「分析 → 固定资产流出」里出账，那边的<b>实际盈亏</b>和<b>还在手上</b>会一起更新。
      <template v-if="childItems">
        <br /><br />这个号里还有 <b>{{ childItems }}</b> 件物品，它们不受影响，仍挂在这个号名下。
      </template>
      <br /><br />填错了随时在这一行点「撤销售出」还原。
    </p>

    <p class="form-err" v-if="err">{{ err }}</p>

    <template #footer>
      <button class="btn" @click="close">取消</button>
      <button class="btn primary" @click="submit">确认售出</button>
    </template>
  </Modal>`,
};
