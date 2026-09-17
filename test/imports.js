/**
 * 导入导出一致性检查：node test/imports.js
 *
 * 抓这类只在浏览器里才炸的错：
 *   - import 了一个模块里并不存在的导出（浏览器报 "does not provide an export named ..."）
 *   - import 了裸模块名（浏览器无法解析，除非 index.html 里有 importmap）
 *   - 相对路径写错 / 文件不存在
 *   - 循环依赖
 *
 * 这类错误在 node 里跑自测时未必暴露，但会让整个页面白屏，所以单独查一遍。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const SRC = path.join(ROOT, 'src');

// index.html 里 importmap 声明过的裸模块名
const BARE_ALLOWED = new Set(['vue']);

const problems = [];
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(SRC);

const rel = (p) => path.relative(ROOT, p);

// -------------------------------------------------- 收集每个文件的导出

function collectExports(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  // export const/let/var/function/class Foo
  for (const m of src.matchAll(/^export\s+(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // export { A, B as C }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    m[1].split(',').forEach((part) => {
      const t = part.trim();
      if (!t) return;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    });
  }
  // export * from './x.js' —— 递归并入
  for (const m of src.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
    const target = resolve(file, m[1]);
    if (target && fs.existsSync(target)) {
      for (const n of collectExports(target)) names.add(n);
    }
  }
  if (/^export\s+default\s/m.test(src)) names.add('default');
  return names;
}

function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base + '.js', base + '.mjs', path.join(base, 'index.js')];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

// -------------------------------------------------- 逐个文件检查 import

const exportCache = new Map();
const getExports = (f) => {
  if (!exportCache.has(f)) exportCache.set(f, collectExports(f));
  return exportCache.get(f);
};

const graph = new Map();

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const deps = new Set();

  const importRe = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src))) {
    const [, defaultName, namedBlock, spec] = m;

    if (spec.startsWith('.')) {
      const target = resolve(file, spec);
      if (!target) {
        problems.push(`[路径不存在] ${rel(file)} → import "${spec}" 找不到文件`);
        continue;
      }
      deps.add(target);

      const exported = getExports(target);
      const wanted = [];
      if (defaultName) wanted.push('default');
      if (namedBlock) wanted.push(...namedBlock.split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));

      for (const w of wanted) {
        if (!exported.has(w) && exported.size) {
          problems.push(`[导出不存在] ${rel(file)} 从 ${rel(target)} import 了 "${w}"，但那边没导出这个名字`);
        } else if (!exported.size) {
          problems.push(`[空模块] ${rel(target)} 没有任何导出，但 ${rel(file)} 从它 import 了 "${w}"`);
        }
      }
    } else if (!BARE_ALLOWED.has(spec)) {
      problems.push(`[裸模块名] ${rel(file)} import 了 "${spec}"；浏览器只能解析 importmap 里声明过的裸模块名`);
    }
  }

  graph.set(path.resolve(file), deps);
}

// -------------------------------------------------- 循环依赖检测

function findCycles() {
  const cycles = [];
  const state = new Map(); // 0 未访问 1 在栈上 2 完成
  const stack = [];

  function dfs(node) {
    state.set(node, 1);
    stack.push(node);
    for (const dep of graph.get(node) || []) {
      if (!graph.has(dep)) continue;
      const st = state.get(dep) || 0;
      if (st === 1) {
        const i = stack.indexOf(dep);
        cycles.push(stack.slice(i).concat(dep).map(rel).join(' → '));
      } else if (st === 0) {
        dfs(dep);
      }
    }
    stack.pop();
    state.set(node, 2);
  }

  for (const n of graph.keys()) if (!state.get(n)) dfs(n);
  return [...new Set(cycles)];
}

const cycles = findCycles();
cycles.forEach((c) => problems.push(`[循环依赖] ${c}`));

// -------------------------------------------------- 输出

console.log(`检查了 ${files.length} 个模块`);
if (!problems.length) {
  console.log('✅ 导入导出关系全部正确，无裸模块名、无循环依赖');
} else {
  console.log(`\n发现 ${problems.length} 处问题：\n`);
  problems.forEach((p) => console.log('  • ' + p));
}
process.exit(problems.length ? 1 : 0);
