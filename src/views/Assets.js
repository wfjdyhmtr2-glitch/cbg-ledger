/**
 * 固定资产 —— 自己常玩的号里的家当账
 *
 * 呈现逻辑：区 → 号 → 号内物品。
 * 空号本身也是资产（买号的钱），号里陆续买入的东西挂在号名下，
 * 每个号都能看到「号本身成本 + 号内物品成本 = 这一号的总投入」。
 *
 * 完全独立于倒卖核算：这里的钱不计入投入 / 回款 / 盈亏，不出现在价值计算和分析页。
 */

import {
  state, saveAsset, deleteAsset, saveChar, deleteCharKeepAssets, notify,
  sellFixedAsset, unsellFixedAsset, fixedAssets,
} from '../core/store.js';
import { newAsset, newChar, normalizeZone, CATEGORIES, CATEGORY_MAP, assetLockInfo } from '../core/model.js';
import { money, dateText } from '../core/format.js';
import { num, round2 } from '../core/model.js';

export const Assets = {
  data() {
    return {
      editing: null,       // { type: 'asset'|'char', model }
      selling: null,       // { source, kind: 'char'|'asset' } —— 售出登记
      confirmDelChar: null,
      confirmDelAsset: null,
      busy: false,
    };
  },
  computed: {
    st() { return state; },
    empty() { return !state.chars.length && !state.assets.length; },
    fa() { return fixedAssets.value; },
    /** 按 kind:id 索引，模板里按行取「已售」账目 */
    faByKey() {
      const m = {};
      this.fa.rows.forEach((r) => { m[r.__kind + ':' + r.id] = r; });
      return m;
    },

    /**
     * 区 → 号 → 物品 的三层分组。
     * 没挂号（char_id 为空）的物品归进虚拟组「未归号」，提醒用户去归位。
     * 已售的号 / 物品**不在这里出现** —— 它们全部归到下面独立的「已售」区，
     * 免得和「还在手上」的家当混在一起看错（也方便集中撤销）。
     */
    groups() {
      const zoneMap = new Map();   // zone -> charObjs
      const charIndex = new Map(); // charId -> charObj

      const ensureZone = (z) => {
        if (!zoneMap.has(z)) zoneMap.set(z, []);
        return zoneMap.get(z);
      };

      state.chars.filter((c) => !c.sold).forEach((c) => {
        const obj = { ...c, items: [], itemCost: 0 };
        ensureZone(normalizeZone(c.zone)).push(obj);
        charIndex.set(c.id, obj);
      });

      let unassignedCost = 0;
      const unassigned = [];
      // 号自己卖掉了、但号里的东西还没卖 —— 它们仍在你手上，得有个准确的位置，
      // 不能混进「未归号」（那会让人以为根本没登记过号）。
      let orphanCost = 0;
      const orphanOfSoldChar = [];
      const soldCharIds = new Set(state.chars.filter((c) => c.sold).map((c) => c.id));

      state.assets.filter((a) => !a.sold).forEach((a) => {
        const holder = a.char_id ? charIndex.get(a.char_id) : null;
        if (holder) {
          holder.items.push(a);
          holder.itemCost = round2(holder.itemCost + num(a.cost));
        } else if (a.char_id && soldCharIds.has(a.char_id)) {
          orphanOfSoldChar.push(a);
          orphanCost = round2(orphanCost + num(a.cost));
        } else {
          unassigned.push(a);
          unassignedCost = round2(unassignedCost + num(a.cost));
        }
      });

      // 物品按购入成本降序 —— 贵的排前面
      const byCostDesc = (arr) =>
        arr.sort((x, y) => num(y.cost) - num(x.cost));
      charIndex.forEach((c) => byCostDesc(c.items));
      byCostDesc(unassigned);
      byCostDesc(orphanOfSoldChar);

      const groups = [...zoneMap.entries()].map(([zone, chars]) => {
        const charCost = round2(chars.reduce((s, c) => s + num(c.purchase_price), 0));
        const itemCost = round2(chars.reduce((s, c) => s + c.itemCost, 0));
        return {
          zone,
          chars: chars.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh')),
          charCost,
          itemCost,
          total: round2(charCost + itemCost),
        };
      });

      if (unassigned.length) {
        groups.push({
          zone: '未归号',
          chars: [{
            id: '__unassigned__', name: '未归号的物品', zone: '',
            purchase_price: 0, items: unassigned, itemCost: unassignedCost,
            isVirtual: true, virtualTag: '未归号',
          }],
          charCost: 0,
          itemCost: unassignedCost,
          total: unassignedCost,
        });
      }

      if (orphanOfSoldChar.length) {
        const names = [...new Set(orphanOfSoldChar.map((a) => {
          const c = state.chars.find((x) => x.id === a.char_id);
          return (c && c.name) || '已售出的号';
        }))];
        groups.push({
          zone: '号已售出 · 物品还在手',
          chars: [{
            id: '__soldchar__', isVirtual: true, zone: '',
            name: '原号（' + names.join('、') + '）已卖掉，这些物品仍在你手上',
            purchase_price: 0, items: orphanOfSoldChar, itemCost: orphanCost,
          }],
          charCost: 0,
          itemCost: orphanCost,
          total: orphanCost,
        });
      }

      return groups.sort((a, b) => b.total - a.total);
    },

    /**
     * 已售区 —— 卖掉的号 / 物品集中在这里，一行一条，方便核对和撤销。
     * 自带「原属哪个号」的上下文，所以从原来的分组里挪出来也不会看不懂。
     */
    soldList() {
      const charName = {};
      const charZone = {};
      state.chars.forEach((c) => { charName[c.id] = c.name; charZone[c.id] = c.zone; });

      const fromChars = state.chars.filter((c) => c.sold).map((c) => ({
        kind: 'char',
        key: 'char:' + c.id,
        name: c.name || '（未命名自玩号）',
        typeLabel: '自玩号',
        parentLabel: '—',
        zone: c.zone,
        category: 'role',
        sub_category: '',
        cost: num(c.purchase_price),
        row: c,
      }));

      const fromAssets = state.assets.filter((a) => a.sold).map((a) => ({
        kind: 'asset',
        key: 'asset:' + a.id,
        name: a.name || '（未命名物品）',
        typeLabel: CATEGORY_MAP[a.category]?.name || a.category || '其他',
        parentLabel: a.char_id ? (charName[a.char_id] || '（所属号已删除）') : '未归号',
        zone: a.zone || charZone[a.char_id] || '',
        category: a.category,
        sub_category: a.sub_category || '',
        cost: num(a.cost),
        row: a,
      }));

      return [...fromChars, ...fromAssets]
        .map((r) => {
          const pnl = this.pnlOf(r.kind, r.row.id) || {};
          return {
            ...r,
            sale_price: num(r.row.sale_price),
            sale_date: r.row.sale_date || '',
            net: num(pnl._net),
            fee: num(pnl._fee),
            profit: num(pnl._profit),
          };
        })
        .sort((a, b) => String(b.sale_date || '').localeCompare(String(a.sale_date || '')));
    },

    totals() {
      // 只算「还在手上」的；已售的单独出「已售变现」口径
      const charCost = round2(state.chars.filter((c) => !c.sold).reduce((s, c) => s + num(c.purchase_price), 0));
      const itemCost = round2(state.assets.filter((a) => !a.sold).reduce((s, a) => s + num(a.cost), 0));
      const soldItems = state.assets.filter((a) => a.sold).length + state.chars.filter((c) => c.sold).length;
      return {
        charCost,
        itemCost,
        total: round2(charCost + itemCost),
        charCount: state.chars.filter((c) => !c.sold).length,
        assetCount: state.assets.filter((a) => !a.sold).length,
        soldCount: soldItems,
        soldCost: this.fa.soldCost,
        soldNet: this.fa.soldNet,
        soldProfit: this.fa.soldProfit,
      };
    },
  },
  methods: {
    money, dateText, notify, round2, num,
    catName(id) { return CATEGORY_MAP[id]?.name || id; },
    catIcon(id) { return CATEGORY_MAP[id]?.icon || '📦'; },
    lockOf(a) { return assetLockInfo(a); },

    /** 取某条固定资产的「已售」账目（带成本/到手/盈亏），没卖掉也返回，字段为 0 */
    pnlOf(kind, id) { return this.faByKey[kind + ':' + id] || null; },

    openNewAsset(charId) { this.editing = { type: 'asset', isNew: true, model: newAsset({ char_id: charId || null }) }; },
    openEditAsset(a) { this.editing = { type: 'asset', model: a }; },
    openNewChar() { this.editing = { type: 'char', isNew: true, model: newChar() }; },
    openEditChar(c) { this.editing = { type: 'char', model: c }; },

    /** 卖一件号内物品 */
    openSellAsset(a) { this.selling = { source: a, kind: 'asset' }; },
    /** 卖一个自玩号（号里的物品不受影响，仍挂在它名下） */
    openSellChar(c) { this.selling = { source: c, kind: 'char' }; },

    /**
     * 取原始记录 —— 分组后的号对象带着 items / itemCost 这类展示字段，
     * 直接落库会把它们一起写进去，所以按 id 回到 state 里拿真身。
     */
    rawOf(kind, id) {
      const list = kind === 'char' ? state.chars : state.assets;
      return list.find((x) => x.id === id) || null;
    },

    async onSell(payload) {
      const { source, kind } = this.selling;
      const raw = this.rawOf(kind, source.id) || source;
      this.busy = true;
      const ok = await sellFixedAsset(raw, kind, payload);
      this.busy = false;
      if (ok) this.selling = null;
    },
    async doUnsell(source, kind) {
      const raw = this.rawOf(kind, source.id) || source;
      this.busy = true;
      await unsellFixedAsset(raw, kind);
      this.busy = false;
    },

    async onSave(payload) {
      const isChar = this.editing.type === 'char';
      const ok = isChar ? await saveChar(payload) : await saveAsset(payload);
      if (ok) {
        this.editing = null;
        notify(isChar ? '自玩号已保存' : '固定资产已保存', 'ok');
      }
    },
    async doDeleteChar() {
      const c = this.confirmDelChar;
      this.busy = true;
      await deleteCharKeepAssets(c.id);
      this.busy = false;
      this.confirmDelChar = null;
      notify(`「${c.name}」已删除，号里的物品变成了未归号`, 'ok');
    },
    async doDeleteAsset() {
      this.busy = true;
      await deleteAsset(this.confirmDelAsset.id);
      this.busy = false;
      this.confirmDelAsset = null;
      notify('已删除', 'ok');
    },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>固定资产</h2>
        <p class="page-sub">
          自己常玩的号里的家当 —— 按区、按号归置。
          <b>不计入倒卖核算</b>：不影响投入、回款和盈亏；
          想卖的号或物品点那一行的「售出」，填上售出价格就会转到「分析 → 固定资产流出」出账
        </p>
      </div>
      <div class="action-row" style="margin: 0">
        <button class="btn primary" @click="openNewAsset(null)">＋ 记一件物品</button>
        <button class="btn" @click="openNewChar">＋ 新增自玩号</button>
      </div>
    </div>

    <Empty v-if="empty" text="还没有登记自玩号和家当"
      sub="先建一个自己的号（空号也算资产），再把号里的装备召唤兽一件件记进来">
      <button class="btn primary" @click="openNewChar">＋ 新增自玩号</button>
    </Empty>

    <template v-else>

      <section class="kpi-row five">
        <StatCard big label="还在手上" :value="money(totals.total)" tone="accent"
          :sub="'号本身 ' + money(totals.charCost) + ' + 号内物品 ' + money(totals.itemCost)" />
        <StatCard label="自玩号" :value="totals.charCount + ' 个'"
          sub="固定资产的容器，按区归置" />
        <StatCard label="号内物品" :value="totals.assetCount + ' 件'"
          sub="只记购入成本，不估值、不参与倒卖" />
        <StatCard label="已售变现" :value="money(totals.soldNet)" tone="info"
          :sub="totals.soldCount + ' 项已售 · 成本 ' + money(totals.soldCost)" />
        <StatCard label="实际盈亏（已售）" :value="money(totals.soldProfit, { sign: true })"
          :tone="pnlTone(totals.soldProfit)"
          sub="到手 − 购入成本，明细见分析页「固定资产流出」" />
      </section>

      <!-- 区 → 号 → 物品 -->
      <div class="card" v-for="g in groups" :key="g.zone">
        <div class="card-head">
          <h3>📍 {{ g.zone }}</h3>
          <span class="muted">
            区合计 <b class="accent">{{ money(g.total) }}</b>
            <template v-if="g.charCost"> （号 {{ money(g.charCost) }} + 物品 {{ money(g.itemCost) }}）</template>
          </span>
        </div>

        <div class="char-card" v-for="c in g.chars" :key="c.id">
          <div class="char-head">
            <div>
              <div class="cell-main" style="font-size: 14.5px">
                🎭 {{ c.name }}
                <Tag v-if="c.virtualTag" :text="c.virtualTag" tone="warn" />
              </div>
              <div class="cell-sub">
                号本身 {{ money(c.purchase_price) }}
                <template v-if="c.purchase_date"> · {{ dateText(c.purchase_date) }}</template>
                <template v-if="c.note"> · {{ c.note }}</template>
              </div>
            </div>
            <div class="char-costs">
              <span class="muted small">物品 {{ c.items.length }} 件 · {{ money(c.itemCost) }}</span>
              <b class="accent">小计 {{ money(round2(num(c.purchase_price) + c.itemCost)) }}</b>
            </div>
            <button class="btn tiny info" v-if="!c.isVirtual" @click="openSellChar(c)"
              title="卖出这个自玩号，只做标记，可撤销">售出</button>
          </div>

          <table class="table compact sub-table hoverable" v-if="c.items.length">
            <thead>
              <tr>
                <th>物品</th><th>类别</th>
                <th class="ta-r">购入成本</th><th class="ta-c">购入日期</th>
                <th class="ta-c">时间锁</th>
                <th>备注</th><th class="ta-r">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in c.items" :key="a.id">
                <td>
                  <div class="cell-main">{{ catIcon(a.category) }} {{ a.name }}</div>
                </td>
                <td><Tag :text="catName(a.category) + ' · ' + (a.sub_category || '默认')" tone="default" /></td>
                <td class="ta-r num">{{ money(a.cost) }}</td>
                <td class="ta-c muted">{{ dateText(a.purchase_date) }}</td>
                <td class="ta-c">
                  <span v-if="lockOf(a) && lockOf(a).unlockDate"
                    class="lock-chip" :class="{ open: lockOf(a).unlocked }"
                    :title="'跨服购买 · ' + lockOf(a).unlockDate + ' 解锁'">
                    {{ lockOf(a).unlocked ? '🔓 已解锁' : '🔒 ' + lockOf(a).daysLeft + ' 天' }}
                  </span>
                  <span v-else-if="lockOf(a)" class="muted small" title="跨服购买，未填购入日期">🔒 待定</span>
                  <span v-else class="muted small">—</span>
                </td>
                <td class="muted small">{{ a.note || '—' }}</td>
                <td class="ta-r">
                  <!-- 物品本身是真的，虚拟分组（未归号 / 号已售出）里也要能卖能改 -->
                  <div class="row-actions">
                    <button class="btn tiny info" @click="openSellAsset(a)"
                      title="卖出这件物品，只做标记，可撤销">售出</button>
                    <button class="btn tiny" @click="openEditAsset(a)">编辑</button>
                    <button class="btn tiny danger" @click="confirmDelAsset = a">删</button>
                  </div>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="strong">物品小计</td>
                <td colspan="2"></td>
                <td class="ta-r num strong accent" colspan="4">{{ money(c.itemCost) }}</td>
              </tr>
            </tfoot>
          </table>
          <p class="muted small" style="margin: 8px 2px 0" v-else>
            这个号还没记物品 —— 点「加物品」把号里的装备召唤兽一件件记进来
          </p>

          <div class="char-actions" v-if="!c.isVirtual">
            <button class="btn tiny" @click="openNewAsset(c.id)">＋ 加物品</button>
            <button class="btn tiny" @click="openEditChar(c)">编辑号</button>
            <button class="btn tiny danger" @click="confirmDelChar = c">删号</button>
          </div>
        </div>
      </div>

      <!-- 已售 —— 卖掉的号 / 物品集中在这里，一条一行，方便核对和撤销 -->
      <div class="card sold-card" v-if="soldList.length">
        <div class="card-head">
          <h3>📤 已售</h3>
          <span class="muted">
            {{ soldList.length }} 项 · 购入成本 <b>{{ money(totals.soldCost) }}</b>
            · 变现 <b class="info">{{ money(totals.soldNet) }}</b>
            · 实际盈亏
            <b :class="'pnl-' + pnlTone(totals.soldProfit)">{{ money(totals.soldProfit, { sign: true }) }}</b>
          </span>
        </div>
        <p class="muted small" style="margin: 0 0 10px">
          这些已经从「还在手上」移出，账目在「分析 → 固定资产流出」里。点「撤销」可以还原回固定资产。
        </p>
        <div class="table-wrap">
          <table class="table compact hoverable">
            <thead>
              <tr>
                <th>名称</th><th>类型</th><th>原属</th><th>区服</th>
                <th class="ta-r">购入成本</th><th class="ta-r">售出价</th>
                <th class="ta-r">到手</th><th class="ta-r">实际盈亏</th>
                <th class="ta-c">成交日期</th><th class="ta-r">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in soldList" :key="s.key">
                <td><div class="cell-main">{{ s.kind === 'char' ? '🎭' : catIcon(s.category) }} {{ s.name }}</div></td>
                <td><Tag :text="s.typeLabel + (s.sub_category ? ' · ' + s.sub_category : '')" tone="default" /></td>
                <td class="muted small">{{ s.parentLabel }}</td>
                <td class="muted small">{{ s.zone || '未填写区服' }}</td>
                <td class="ta-r num">{{ money(s.cost) }}</td>
                <td class="ta-r num">{{ money(s.sale_price) }}</td>
                <td class="ta-r num info">{{ money(s.net) }}</td>
                <td class="ta-r num strong" :class="'pnl-' + pnlTone(s.profit)">
                  {{ money(s.profit, { sign: true }) }}
                </td>
                <td class="ta-c muted">{{ dateText(s.sale_date) || '—' }}</td>
                <td class="ta-r">
                  <div class="row-actions">
                    <button class="btn tiny" @click="doUnsell(s.row, s.kind)"
                      title="撤销售出，还原回固定资产">撤销</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>

    <CharForm v-if="editing && editing.type === 'char'" :model="editing.model" :is-new="editing.isNew"
      @close="editing = null" @save="onSave" />

    <AssetForm v-if="editing && editing.type === 'asset'" :model="editing.model" :is-new="editing.isNew"
      @close="editing = null" @save="onSave" />

    <AssetSellForm v-if="selling" :source="selling.source" :kind="selling.kind"
      @close="selling = null" @save="onSell" />

    <Modal v-if="confirmDelChar" title="删除自玩号" width="460px" @close="confirmDelChar = null">
      <p class="confirm-text">
        确认删除「<b>{{ confirmDelChar.name }}</b>」？
        <template v-if="confirmDelChar.items && confirmDelChar.items.length">
          <br /><br />号里还有 <b>{{ confirmDelChar.items.length }}</b> 件物品，
          删除后它们会变成「未归号」，不会被删掉。
        </template>
      </p>
      <template #footer>
        <button class="btn" @click="confirmDelChar = null">取消</button>
        <button class="btn danger" :disabled="busy" @click="doDeleteChar">确认删除</button>
      </template>
    </Modal>

    <Modal v-if="confirmDelAsset" title="删除固定资产" width="420px" @close="confirmDelAsset = null">
      <p class="confirm-text">
        确认删除「<b>{{ confirmDelAsset.name }}</b>」（{{ money(confirmDelAsset.cost) }}）？这个操作不可撤销。
      </p>
      <template #footer>
        <button class="btn" @click="confirmDelAsset = null">取消</button>
        <button class="btn danger" :disabled="busy" @click="doDeleteAsset">确认删除</button>
      </template>
    </Modal>

  </div>`,
};
