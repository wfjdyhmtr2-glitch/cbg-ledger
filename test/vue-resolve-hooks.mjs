/**
 * Node 侧的 'vue' 解析钩子 —— 把裸模块名映射到项目内置的 vendor 打包文件。
 * 浏览器里这件事由 index.html 的 importmap 负责，Node 里没有 importmap，
 * 所以测试脚本要自己补上这一步。
 */

export function resolve(specifier, context, next) {
  if (specifier === 'vue') {
    return next(new URL('../vendor/vue.esm-browser.prod.js', import.meta.url).href, context);
  }
  return next(specifier, context);
}
