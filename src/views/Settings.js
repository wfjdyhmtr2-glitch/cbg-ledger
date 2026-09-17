/**
 * 设置 —— 账号、数据源、备份恢复，以及把「后台到底怎么算账」讲清楚
 */

import {
  state, auth, stats, logout, resetConfig,
  exportJSON, importJSON, loadDemo, clearAll, notify,
} from '../core/store.js';
import { money, pct } from '../core/format.js';
import { calcFee, netFromGross } from '../core/fee.js';

export const Settings = {
  data() {
    return {
      busy: false,
      confirmClear: false,
      confirmLogout: false,
      mergeImport: false,
      calcCat: 'role',
      calcPrice: 3000,
      calcCats: [
        { id: 'role', name: '角色（5%，最低60最高1000）' },
        { id: 'equipment', name: '装备 / 召唤兽 / 灵饰（5%，最高1000）' },
        { id: 'currency', name: '梦幻币（5%，无上下限）' },
        { id: 'gift', name: '礼盒礼币（10%）' },
      ],
    };
  },
  computed: {
    s() { return stats.value; },
    st() { return state; },
    me() { return auth.user; },
    host() {
      try { return new URL(state.cfg.supabaseUrl).host; } catch { return state.cfg.supabaseUrl; }
    },
    totalRecords() { return state.roles.length + state.products.length + (state.assets?.length || 0); },
    calcResult() {
      const cat = this.calcCat;
      const price = Number(this.calcPrice) || 0;
      const fee = calcFee(cat, price);
      const net = netFromGross(cat, price);
      return { fee, net, rate: price > 0 ? fee / price : 0, price };
    },
  },
  methods: {
    money, pct,
    async doLogout() {
      this.confirmLogout = false;
      await logout();
      window.location.hash = '#/';
    },
    async changeProject() {
      if (!confirm('要换一个 Supabase 项目吗？当前登录状态会被清掉（云端数据不受影响）。')) return;
      await resetConfig();
      window.location.hash = '#/';
    },
    download() {
      const blob = new Blob([exportJSON()], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      a.download = `藏宝阁台账_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('备份文件已导出', 'ok');
    },
    onFile(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        this.busy = true;
        await importJSON(String(reader.result), { merge: this.mergeImport });
        this.busy = false;
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    },
    async doDemo() {
      if (this.totalRecords && !confirm('会覆盖云端当前数据，继续？')) return;
      this.busy = true;
      await loadDemo();
      this.busy = false;
    },
    async doClear() {
      this.busy = true;
      await clearAll();
      this.busy = false;
      this.confirmClear = false;
    },
  },
  template: `
  <div class="page">

    <div class="page-head">
      <div>
        <h2>设置</h2>
        <p class="page-sub">账号、数据源、备份，以及这个后台是怎么帮你算账的</p>
      </div>
    </div>

    <!-- 账号 -->
    <section class="card">
      <div class="card-head">
        <h3>账号</h3>
        <span class="conn-badge ok">已登录</span>
      </div>
      <div class="ds-grid">
        <div class="ds-card active">
          <h4>当前登录</h4>
          <p><b>{{ me && me.email }}</b></p>
          <ul class="ds-list">
            <li>数据按账号隔离：只有用这个账号登录，才看得到下面这些台账</li>
            <li>换设备、换浏览器，只要登录同一个账号，数据都在</li>
            <li>会话会自动续期；退出登录后需要重新输入密码</li>
          </ul>
          <button class="btn danger" @click="confirmLogout = true">退出登录</button>
        </div>

        <div class="ds-card">
          <h4>数据源</h4>
          <p>数据存放在你自己的 Supabase 项目里：<b>{{ host }}</b></p>
          <ul class="ds-list">
            <li>数据库结构见项目里的 <code>supabase/schema.sql</code></li>
            <li>行级安全（RLS）已开启，只有你自己账号能读写</li>
            <li>想换项目：点下面的按钮重新连接</li>
          </ul>
          <button class="btn" @click="changeProject">换一个 Supabase 项目</button>
        </div>
      </div>
    </section>

    <!-- 备份 -->
    <section class="card">
      <div class="card-head">
        <h3>备份与恢复</h3>
        <span class="muted">
          云端当前 {{ totalRecords }} 条记录（{{ st.roles.length }} 角色 / {{ st.products.length }} 商品 / {{ st.assets ? st.assets.length : 0 }} 固定资产）
        </span>
      </div>
      <div class="backup-row">
        <div class="backup-item">
          <h4>导出备份</h4>
          <p class="muted">下载一个 JSON 文件，包含全部区服、角色、商品。数据在云端，导出一份本地存档更安心。</p>
          <button class="btn primary" @click="download">导出 JSON</button>
        </div>
        <div class="backup-item">
          <h4>导入恢复</h4>
          <p class="muted">从备份文件恢复数据。</p>
          <label class="check"><input type="checkbox" v-model="mergeImport" /><span>合并导入（保留现有数据，同 ID 覆盖）</span></label>
          <label class="btn file-btn">
            选择备份文件
            <input type="file" accept=".json,application/json" @change="onFile" hidden />
          </label>
        </div>
        <div class="backup-item">
          <h4>演示数据</h4>
          <p class="muted">载入一批样例单据，先看看后台长什么样（会覆盖云端现有数据）。</p>
          <button class="btn" :disabled="busy" @click="doDemo">载入演示数据</button>
        </div>
        <div class="backup-item danger-zone">
          <h4>清空数据</h4>
          <p class="muted">把你账号下的区服、角色、商品全部删掉，不可撤销。别人的账号不受影响。</p>
          <button class="btn danger" @click="confirmClear = true">清空全部数据</button>
        </div>
      </div>
    </section>

    <!-- 手续费计算器 -->
    <section class="card">
      <div class="card-head">
        <h3>藏宝阁手续费速算</h3>
        <span class="muted">官方规则：卖家承担，买家不收费；不足 1 分按 1 分收取</span>
      </div>
      <div class="calc-row">
        <select class="input" v-model="calcCat">
          <option v-for="c in calcCats" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <input class="input" type="number" step="0.01" v-model="calcPrice" placeholder="挂牌价" />
      </div>
      <div class="calc-result">
        <span>挂牌 <b>¥{{ calcResult.price.toFixed(2) }}</b></span>
        <span class="fee-arrow">−</span>
        <span>信息费 <b class="down">¥{{ calcResult.fee.toFixed(2) }}</b>
          <span class="muted">（实际费率 {{ pct(calcResult.rate) }}）</span></span>
        <span class="fee-arrow">=</span>
        <span>到手 <b class="up">¥{{ calcResult.net.toFixed(2) }}</b></span>
      </div>
    </section>

    <!-- 核算口径 -->
    <section class="card">
      <div class="card-head"><h3>这个后台是怎么算账的</h3></div>
      <div class="doc">
        <h4>① 角色是「项目」，商品是「批次里的产物」</h4>
        <p>
          买一个号，就当开了一票生意。这个号上拆出来的装备、召唤兽、灵饰都挂在它名下。
          这一票赚没赚，看的是：<b>已回款 + 手上还剩的东西估值 − 总投入</b>。
          所以拆号之后你不用手工去摊成本，母角色那一行就是这票的总账。
        </p>

        <h4>② 两种视角，随时切（右上角）</h4>
        <ul>
          <li><b>项目视角（默认）</b>：角色整体一张账。拆出来的商品不单独背成本，报表最省事，也最贴近真实经营。</li>
          <li><b>单品视角</b>：按估值权重把角色成本摊到每件商品和空壳号上，于是每件货都能看到自己的毛利。
              想知道"到底哪件在赚钱、哪件是搭头"，切到这个视角。</li>
        </ul>
        <p class="muted">两个视角的总盈亏一致，只是拆分方式不同；切换不会改数据，只是换个算法看同一份账。</p>

        <h4>③ 角色可以转手、可以拆、可以转服</h4>
        <ul>
          <li><b>整体转手</b>：买进来直接加价卖，登记售出即可。</li>
          <li><b>拆号变现</b>：装备召唤兽单独上架 → 点角色行的「拆号」把商品挂到它名下 → 全部卖完后，空壳号还能再卖一笔。
              空壳的买入成本会被自动摊出来一部分，剩余按残值继续留在账上。</li>
          <li><b>转服卖</b>：在「售出」弹窗里把「成交时所在区服」改成新服。
              <b>整票（成本和成交）仍算在买入区</b> —— 一票生意不该被拆成两半导致两边都失真；
              成交区那边只标注「由其他区转入卖出 ¥X」，方便你看这个区的出货能力。</li>
        </ul>

        <h4>④ 没卖出去的东西怎么估值（在手资产）</h4>
        <p>
          <b>挂了牌的按上架价</b>，没上架的按<b>买入成本</b>。
          想更新市值就把东西挂上价（或改上架价），账面会自动跟着走。

        <h4>实际盈亏 vs 预计盈亏</h4>
        <p>
          <b>实际盈亏</b> = 已售资产的实际到手 − 成本，钱已经落袋，不会变。<br />
          <b>预计盈亏</b> = 在手资产的当前估值 − 成本，随上架价波动，卖了才算数。<br />
          各模块的「实」= 实际、「预」= 预计；总盈亏 = 实际 + 预计。
        </p>
        </p>
        <p class="muted">
          有个例外：<b>已经拆号、只剩空壳的角色</b>，它的价值其实已经转移到拆出去的装备召唤兽上了。
          如果没填估值也没挂价，就按 <b>0</b> 计 —— 宁可显示成还没回本，也不拿买入全价当空壳残值把盈亏虚抬上去。
          首页会提醒你有几个空壳号还没估值，补一下账就准了。
        </p>

        <h4>⑤ 已实现 vs 浮动</h4>
        <ul>
          <li><b>已实现盈亏</b>：已经卖掉的部分，成交到手额 − 分摊成本。这部分是落袋的。</li>
          <li><b>浮动盈亏</b>：还在手上的，估值 − 成本。这部分只要没卖就还会变。</li>
          <li><b>回本进度</b>：已回款 ÷ 总投入。到 100% 说明本金全收回来了，剩下的持仓都是利润。</li>
        </ul>

        <h4>⑥ 手续费怎么算的</h4>
        <table class="table compact doc-table">
          <thead><tr><th>类别</th><th>费率</th><th>上下限</th></tr></thead>
          <tbody>
            <tr><td>角色</td><td>5%</td><td>最低 60 元，最高 1000 元</td></tr>
            <tr><td>装备 / 召唤兽 / 灵饰 / 未鉴定装备 / 宝石</td><td>5%</td><td>最高 1000 元</td></tr>
            <tr><td>梦幻币</td><td>5%</td><td>无上下限</td></tr>
            <tr><td>礼盒礼币</td><td>10%</td><td>无上下限</td></tr>
          </tbody>
        </table>
        <p class="muted">
          全部由卖家承担。登记售出时后台会自动按这个规则算到手金额；
          如果实际到账和算出来的有出入（比如转服时间锁的特殊服务费），
          直接在「实际到手」里填你真实的到账数就行，以你的数为准。
        </p>
      </div>
    </section>

    <Modal v-if="confirmLogout" title="退出登录" width="420px" @close="confirmLogout = false">
      <p class="confirm-text">
        退出后需要重新输入邮箱和密码。数据在云端，不会丢。
      </p>
      <template #footer>
        <button class="btn" @click="confirmLogout = false">取消</button>
        <button class="btn danger" @click="doLogout">确认退出</button>
      </template>
    </Modal>

    <Modal v-if="confirmClear" title="清空全部数据" width="440px" @close="confirmClear = false">
      <p class="confirm-text">
        确认清空？会把你账号下的 <b>{{ st.roles.length }}</b> 个角色、<b>{{ st.products.length }}</b> 件商品、<b>{{ st.assets ? st.assets.length : 0 }}</b> 件固定资产全部删除，且无法撤销。
        <br /><br />
        建议先「导出 JSON」做一份备份。
      </p>
      <template #footer>
        <button class="btn" @click="confirmClear = false">取消</button>
        <button class="btn danger" :disabled="busy" @click="doClear">确认清空</button>
      </template>
    </Modal>

  </div>`,
};
