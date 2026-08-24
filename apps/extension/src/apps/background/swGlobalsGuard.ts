/**
 * @file swGlobalsGuard.ts
 * @description Service Worker 全局对象保护垫片
 *
 * Vite 5 会给每个动态 import() 注入 `__vitePreload`（preload）辅助函数，
 * 该函数内部会访问 `document`（创建/追加 <link> 预加载资源）以及
 * `window.dispatchEvent`（派发 `vite:preloadError` 错误事件）。
 *
 * 这两个全局在 MV3 Service Worker 中都不存在（`window` / `document` 均为 undefined），
 * 于是背景脚本在 `autoUpdateRoutes` 里对 `routeManagement` 的动态 import 会抛出
 * `ReferenceError: window is not defined`，被 try/catch 吞成 WARN，导致
 * 后台线路自动更新静默失败。
 *
 * 注意：`build.modulePreload: false` 只关闭 HTML 里的 <link rel=modulepreload> 注入，
 * 并不会移除打包进 chunk 的 preload 辅助函数本身，所以必须在这里做运行期保护。
 *
 * 本模块只在「没有真实 window / document」的环境下（即 Service Worker）安装
 * 最小化的惰性垫片，使 preload 辅助函数可以安全地“空跑”（创建无头 <link>、
 * dispatch 到空 target），随后真正的 `import()` 正常执行。
 * 在 dashboard / popup 等真实页面里 window/document 本就存在，这里不会覆盖它们。
 *
 * 用法：在 background 入口的 import 列表最前面导入本模块，保证其副作用
 * （安装垫片）在任何动态 import 之前执行。
 */

type AnyRecord = Record<string, unknown>;

/** 仅当给定全局确实不存在时，安装一个惰性垫片；已存在则原样保留，绝不覆盖。 */
function installIfAbsent(name: string, factory: () => AnyRecord): void {
  const g = globalThis as unknown as AnyRecord;
  if (name in g) {
    return; // 真实页面（dashboard/popup）或已存在，绝不覆盖
  }
  try {
    Object.defineProperty(g, name, {
      value: factory(),
      writable: true,
      configurable: true,
    });
  } catch {
    try {
      g[name] = factory();
    } catch {
      /* 某些受限上下文无法定义，忽略；不影响真正的 import() 路径 */
    }
  }
}

/**
 * 惰性 document 垫片：只提供 Vite preload 辅助函数会触碰的方法，
 * 全部为“不抛出”的空实现。`head` 提供 appendChild no-op；
 * `createElement` 返回带 setAttribute/addEventListener/appendChild 的空节点。
 */
function makeInertDocument(): AnyRecord {
  const makeElement = (): AnyRecord => ({
    setAttribute: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    appendChild: () => undefined,
    // 允许 .rel / .as / .href 等属性被赋值
    style: {},
  });

  const documentShim: AnyRecord = {
    getElementsByTagName: () => [] as unknown[],
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    createElement: makeElement,
    createDocumentFragment: () => ({
      appendChild: () => undefined,
    }),
    head: {
      appendChild: () => undefined,
      removeChild: () => undefined,
    },
    documentElement: {
      appendChild: () => undefined,
    },
    body: {
      appendChild: () => undefined,
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  return documentShim;
}

/**
 * 惰性 window 垫片：`dispatchEvent` 返回 false（等同“无人监听”），
 * 其它常见读取（location / navigator / chrome）通过 globalThis 透传，
 * 避免 preload 辅助函数或下游代码读取 window.* 时报错。
 */
function makeInertWindow(): AnyRecord {
  const g = globalThis as unknown as AnyRecord;
  const windowShim: AnyRecord = {
    // preload 辅助函数调用：new Event(...) 后 window.dispatchEvent(e)，
    // 返回 false 表示事件未被 preventDefault，随后会 throw 原错误 ——
    // 但在“惰性 document”下 deps 预加载为空，真正 import() 成功时不会走到 throw 分支。
    dispatchEvent: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (...args: unknown[]) => (g.setTimeout as (...a: unknown[]) => unknown)(...args),
    clearTimeout: (...args: unknown[]) => (g.clearTimeout as (...a: unknown[]) => unknown)(...args),
    setInterval: (...args: unknown[]) => (g.setInterval as (...a: unknown[]) => unknown)(...args),
    clearInterval: (...args: unknown[]) => (g.clearInterval as (...a: unknown[]) => unknown)(...args),
    location: g.location,
    navigator: g.navigator,
    chrome: g.chrome,
  };
  return windowShim;
}

/**
 * 安装垫片。幂等、可重复调用；仅在 Service Worker（无真实 window/document）时生效。
 */
export function ensureSwGlobals(): void {
  try {
    installIfAbsent('window', makeInertWindow);
    installIfAbsent('document', makeInertDocument);
  } catch {
    /* 极端受限环境下静默失败，不阻断后台启动 */
  }
}

// 模块导入即安装（副作用）。放在 background 入口 import 列表最前面，
// 确保在任何动态 import()（preload 辅助函数运行）之前完成。
ensureSwGlobals();
