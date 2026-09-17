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
} from '../core/store.js';
import { newAsset, newChar, normalizeZone, CATEGORIES, CATEGORY_MAP, assetLockInfo } from '../core/model.js';
import { money, dateText } from '../core/format.js';
import { num, round2 } from '../core/model.js';

export const Assets = {
  data() {
    return {
      editing: null,       // { type: 'asset'|'char', model }
      confirmDelChar: null,
      confirmDelAsset: null,
      busy: false,
    };
  },
  computed: {
    st() { return state; },
    empty() { return !state.chars.length && !state.assets.length; },

    /**
     * 区 → 号 → 物品 的三层分组。
     * 没挂号（char_id 为空）的物品归进虚拟组「未归号」，提醒用户去归位。
     */
    groups() {
      const zoneMap = new Map();   // zone -> charObjs
      const charIndex = new Map(); // charId -> charObj

      const ensureZone = (z) => {
        if (!zoneMap.has(z)) zoneMap.set(z, []);
        return zoneMap.get(z);
      };

      state.chars.forEach((c) => {
        const obj = { ...c, items: [], itemCost: 0 };
        ensureZone(normalizeZone(c.zone)).push(obj);
        charIndex.set(c.id, obj);
      });

      let unassignedCost = 0;
      const unassigned = [];
      state.assets.forEach((a) => {
        const holder = a.char_id ? charIndex.get(a.char_id) : null;
        if (holder) {
          holder.items.push(a);
          holder.itemCost = round2(holder.itemCost + num(a.cost));
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
            purchase_price: 0, items: unassigned, itemCost: unassignedCost, isVirtual: true,
          }],
          charCost: 0,
          itemCost: unassignedCost,
          total: unassignedCost,
        });
      }

      return groups.sort((a, b) => b.total - a.total);
    },

    totals() {
      const charCost = round2(state.chars.reduce((s, c) => s + num(c.purchase_price), 0));
      const itemCost = round2(state.assets.reduce((s, a) => s + num(a.cost), 0));
      return {
        charCost,
        itemCost,
        total: round2(charCost + itemCost),
        charCount: state.chars.length,
        assetCount: state.assets.length,
      };
    },
  },
  methods: {
    money, dateText, notify, round2, num,
    catName(id) { return CATEGORY_MAP[id]?.name || id; },
    catIcon(id) { return CATEGORY_MAP[id]?.icon || '📦'; },
    lockOf(a) { return assetLockInfo(a); },

    openNewAsset(charId) { this.editing = { type: 'asset', isNew: true, model: newAsset({ char_id: charId || null }) }; },
    openEditAsset(a) { this.editing = { type: 'asset', model: a }; },
    openNewChar() { this.editing = { type: 'char', isNew: true, model: newChar() }; },
    openEditChar(c) { this.editing = { type: 'char', model: c }; },

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
          <b>完全独立于倒卖核算</b>：不计入投入、回款和盈亏，不出现在价值计算和分析页
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

      <section class="kpi-row">
        <StatCard big label="这个号总共砸了" :value="money(totals.total)" tone="accent"
          :sub="'号本身 ' + money(totals.charCost) + ' + 号内物品 ' + money(totals.itemCost)" />
        <StatCard label="自玩号" :value="totals.charCount + ' 个'"
          sub="固定资产的容器，按区归置" />
        <StatCard label="号内物品" :value="totals.assetCount + ' 件'"
          sub="只记购入成本，不估值、不参与倒卖" />
        <StatCard label="与倒卖的关系" value="相互独立" tone="neutral"
          sub="这里的钱不影响任何盈亏报表，只在这一页可见" />
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
                <Tag v-if="c.isVirtual" text="未归号" tone="warn" />
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
          </div>

          <table class="table compact sub-table" v-if="c.items.length">
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
                <td><div class="cell-main">{{ catIcon(a.category) }} {{ a.name }}</div></td>
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
                  <div class="row-actions" v-if="!c.isVirtual">
                    <button class="btn tiny" @click="openEditAsset(a)">编辑</button>
                    <button class="btn tiny danger" @click="confirmDelAsset = a">删</button>
                  </div>
                  <span v-else class="muted small">—</span>
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

    </template>

    <CharForm v-if="editing && editing.type === 'char'" :model="editing.model" :is-new="editing.isNew"
      @close="editing = null" @save="onSave" />

    <AssetForm v-if="editing && editing.type === 'asset'" :model="editing.model" :is-new="editing.isNew"
      @close="editing = null" @save="onSave" />

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
