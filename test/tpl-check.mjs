/**
 * 模板静态检查 —— 专抓那两类「引擎自测和导入自测都看不见、一上浏览器就整页空白」的错：
 *
 *   1) 对象字面量里出现了重复的顶层选项键（比如两个 methods），后者会静默覆盖前者，
 *      方法就这么凭空丢了。JS 不报错，肉眼也容易看漏。
 *   2) 模板里调用了组件没暴露的函数（比如模板写 num(x) 但 num 不在 methods 里），
 *      渲染时才抛 TypeError。
 *
 * 为什么不用真正的编译器：项目是「零依赖、不需要 npm install」的纯静态前端，
 * 为了跑个检查去装 @vue/compiler-dom 会破坏这个前提。这两类错用文本分析足够抓准。
 *
 * 用法：node test/tpl-check.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

// src/ 里的模块用裸模块名 'vue'，浏览器靠 index.html 的 importmap 解析，Node 里得靠这个钩子
register('./vue-resolve-hooks.mjs', import.meta.url);

const DIRS = ['src/views', 'src/components'];
const OPTION_KEYS = [
  'name', 'mixins', 'components', 'directives', 'props', 'emits',
  'data', 'computed', 'watch', 'methods', 'template',
  'created', 'mounted', 'beforeUnmount', 'unmounted',
];

// main.js 里全局 mixin 注册的方法 —— 模板里到处在用，属于「已暴露」
const GLOBAL_METHODS = [
  'money', 'wan', 'pct', 'pctRaw', 'daysText', 'dateText',
  'pnlTone', 'pnlClass', 'agingTone', 'agingText', 'truncate', 'barWidth', '$notify',
];

const JS_GLOBALS = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'Math', 'Number', 'String',
  'Boolean', 'Array', 'Object', 'JSON', 'Date', 'RegExp', 'Set', 'Map', 'Promise', 'Error',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'console', 'window', 'document', 'setTimeout', 'clearTimeout', 'typeof', 'new', 'return',
  'if', 'else', 'in', 'of', 'function', 'this', 'arguments', 'void', 'delete', 'instanceof',
  '$event', '$emit', '$refs', '$slots', '$attrs', '$props', '$el', '$options',
]);

const problems = [];

/** 抽出顶层选项键（按项目稳定的 2 空格缩进判断层级） */
function checkDuplicateKeys(file) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');

  // 定位每个 `export const X = {` 的范围（大括号配对）
  const starts = [];
  lines.forEach((line, i) => {
    if (/^export const [A-Z][\w$]* = \{/.test(line)) starts.push(i);
  });

  starts.forEach((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const name = lines[start].match(/^export const ([\w$]+)/)[1];
    const seen = new Map();

    for (let i = start + 1; i < end; i++) {
      const m = lines[i].match(/^  ([A-Za-z_$][\w$]*)\s*[:(]/);
      if (!m) continue;
      const key = m[1];
      if (!OPTION_KEYS.includes(key)) continue;
      if (seen.has(key)) {
        problems.push(
          `${file} → ${name}：顶层键「${key}」重复定义（第 ${seen.get(key) + 1} 行 和 第 ${i + 1} 行）\n` +
          `     后者会静默覆盖前者，前面的内容会凭空消失`
        );
      } else {
        seen.set(key, i);
      }
    }
  });
}

/** 抽出模板里的函数调用，核对组件是否真的暴露了这些名字 */
async function checkTemplateCalls(file, comp, label) {
  const tpl = comp.template;
  if (typeof tpl !== 'string') return;

  // 运行时可见的方法 / 计算属性（重复键此时已经塌陷，正好反映真实可用集合）
  const available = new Set(GLOBAL_METHODS);
  const merge = (obj, key) => {
    if (obj && typeof obj[key] === 'object') Object.keys(obj[key]).forEach((k) => available.add(k));
  };
  merge(comp, 'methods');
  merge(comp, 'computed');
  (comp.mixins || []).forEach((mx) => {
    merge(mx, 'methods');
    merge(mx, 'computed');
  });

  // 只取「真正会执行 JS」的片段：{{ 差值 }} 和 v- / : / @ 指令的取值。
  // 否则 SVG 的 transform="rotate(...)"、CSS 的 var(--x) 会被当成函数调用误报。
  const exprs = [];
  for (const m of tpl.matchAll(/\{\{([\s\S]*?)\}\}/g)) exprs.push(m[1]);
  for (const m of tpl.matchAll(/(?:^|[\s"])(?:v-[\w:.-]+|[:@][\w:.-]+)\s*=\s*"([^"]*)"/g)) exprs.push(m[1]);
  for (const m of tpl.matchAll(/(?:^|[\s"])(?:v-[\w:.-]+|[:@][\w:.-]+)\s*=\s*'([^']*)'/g)) exprs.push(m[1]);

  // 模板内定义的局部变量：v-for 别名、箭头函数参数
  for (const m of tpl.matchAll(/v-for\s*=\s*"\s*\(?([^)"]*?)\)?\s+(?:in|of)\s/g)) {
    m[1].split(',').forEach((n) => available.add(n.trim()));
  }

  const called = new Set();
  for (const raw of exprs) {
    // 去掉字符串字面量，剩下的才是真调用（'rotate(' + x + ')' 里的 rotate 不算）
    const code = raw
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');
    for (const m of code.matchAll(/(\w+)\s*=>/g)) available.add(m[1]);
    for (const m of code.matchAll(/\(\s*([\w$,\s]+)\s*\)\s*=>/g)) {
      m[1].split(',').forEach((n) => available.add(n.trim()));
    }
    for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1]);
  }

  const missing = [...called].filter((n) => !available.has(n) && !JS_GLOBALS.has(n));
  if (missing.length) {
    problems.push(
      `${file} → ${label}：模板调用了未暴露的函数 ${missing.join(', ')}\n` +
      `     这些名字不在 methods / computed / 全局 mixin 里，渲染时会抛 TypeError`
    );
  }
}

for (const dir of DIRS) {
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.js')) continue;
    checkDuplicateKeys(`${dir}/${file}`);

    const mod = await import(`../${dir}/${file}`);
    for (const [name, comp] of Object.entries(mod)) {
      if (!comp || typeof comp !== 'object') continue;
      await checkTemplateCalls(`${dir}/${file}`, comp, name);
    }
  }
}

if (problems.length) {
  console.log(`发现 ${problems.length} 个问题：\n`);
  problems.forEach((p) => console.log(`  ❌ ${p}`));
  process.exit(1);
}
console.log('✅ 模板检查通过：无重复选项键，模板调用的函数均已暴露');
