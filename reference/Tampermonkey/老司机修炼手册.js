// ==UserScript==
// @name               老司机修炼手册
// @name:zh-HK         老司機修煉手冊
// @name:zh-TW         老司機修煉手冊
// @name:en            PornEnhance
// @namespace          http://github.com/GangPeter
// @version            4.0.2
// @author             GangPeter
// @description        支持网站 missav | jable.tv | pornhub | 18comic | 91porn | 91porna | xvideos。100+项功能、去除大部分广告（横幅、弹窗、视频内、新窗口）、自定义界面布局、隐私模式（模糊视频图片、标题）、显示完整标题、显示m3u8、自定义视频加载数量、自动登录、自动转跳无码片源、自动最高画质。支持 PC端 | 移动端。
// @description:zh-HK  支持網站 missav | jable.tv | pornhub | 18comic | 91porn | 91porna | xvideos。100+項功能、去除大部分廣告（橫幅、彈窗、視頻內、新窗口）、自定義界面布局、隱私模式（模糊視頻圖片、標題）、顯示完整標題、顯示m3u8、自定義視頻加載數量、自動登錄、自動轉跳無碼片源、自動最高畫質。支持 PC端 | 移動端。
// @description:zh-TW  支持網站 missav | jable.tv | pornhub | 18comic | 91porn | 91porna | xvideos。100+項功能、去除大部分廣告（橫幅、彈窗、視頻內、新窗口）、自定義界面布局、隱私模式（模糊視頻圖片、標題）、顯示完整標題、顯示m3u8、自定義視頻加載數量、自動登錄、自動轉跳無碼片源、自動最高畫質。支持 PC端 | 移動端。
// @description:en     Supported missav | jable.tv | pornhub | 18comic | 91porn | 91porna | xvideos. 100+ features, Remove Most ads (banner, popup, video, window), Custom Layout, Privacy Mode (Blur Video Image, Title), Display Video Full-Title, Get and Display m3u8, Custom Video Load Number, Automatic Login, Automatic Switch Uncensored, Automatic Switch Highest Video Quality. Supported PC | mobile.
// @license            None
// @icon               https://missav.ws/favicon.ico
// @homepageURL        https://github.com/GangPeter/porn-enhance
// @supportURL         https://github.com/GangPeter/porn-enhance
// @match              *://*.missav.com/*
// @match              *://*.missav.ws/*
// @match              *://*.missav.ai/*
// @match              *://*.jable.tv/*
// @match              *://*.pornhub.com/*
// @match              *://*.18comic.org/*
// @match              *://*.18comic.vip/*
// @match              *://*.91porn.com/*
// @match              *://*.91porna.com/*
// @match              *://*.xvideos.com/*
// @require            https://registry.npmmirror.com/vue/3.5.13/files/dist/vue.global.prod.js
// @grant              GM_addStyle
// @grant              GM_getValue
// @grant              GM_registerMenuCommand
// @grant              GM_setValue
// @grant              unsafeWindow
// @run-at             document-start
// @downloadURL https://update.sleazyfork.org/scripts/519635/%E8%80%81%E5%8F%B8%E6%9C%BA%E4%BF%AE%E7%82%BC%E6%89%8B%E5%86%8C.user.js
// @updateURL https://update.sleazyfork.org/scripts/519635/%E8%80%81%E5%8F%B8%E6%9C%BA%E4%BF%AE%E7%82%BC%E6%89%8B%E5%86%8C.meta.js
// ==/UserScript==

(o=>{if(typeof GM_addStyle=="function"){GM_addStyle(o);return}const e=document.createElement("style");e.textContent=o,document.head.append(e)})(" .m3u8-input-group[data-v-70ae07f7]{display:flex;align-items:center;height:50px;margin:15px 0;border-radius:999px;background-color:#1b1b1b;font-size:15px;border:none}.m3u8-span[data-v-70ae07f7]{align-content:center;width:10%;height:50px;color:#fff;padding:1em}.m3u8-input[data-v-70ae07f7]{width:75%;height:50px;color:#c6c6c6;border:none;background:transparent}.m3u8-button--copy[data-v-70ae07f7]{width:7.5%;height:50px;border-radius:0 999px 999px 0;background-color:#ff9000;color:#000;cursor:pointer;border:none}.m3u8-button--open[data-v-70ae07f7]{width:7.5%;height:50px;background-color:#ff9000;color:#000;cursor:pointer;border:none}.m3u8-button--open[data-v-70ae07f7]:hover,.m3u8-button--copy[data-v-70ae07f7]:hover{color:#fff} ");

(function (e$1) {
  'use strict';

  function _interopNamespaceDefault(e) {
    const n = Object.create(null, { [Symbol.toStringTag]: { value: 'Module' } });
    if (e) {
      for (const k in e) {
        if (k !== 'default') {
          const d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: () => e[k]
          });
        }
      }
    }
    n.default = e;
    return Object.freeze(n);
  }

  const e$1__namespace = /*#__PURE__*/_interopNamespaceDefault(e$1);

  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != "undefined" ? GM_getValue : undefined)();
  var _GM_registerMenuCommand = /* @__PURE__ */ (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : undefined)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : undefined)();
  var _unsafeWindow = /* @__PURE__ */ (() => typeof unsafeWindow != "undefined" ? unsafeWindow : undefined)();
  /*!
   * pinia v2.3.1
   * (c) 2025 Eduardo San Martin Morote
   * @license MIT
   */
  let activePinia;
  const setActivePinia = (pinia) => activePinia = pinia;
  const piniaSymbol = (
    /* istanbul ignore next */
    Symbol()
  );
  function isPlainObject(o2) {
    return o2 && typeof o2 === "object" && Object.prototype.toString.call(o2) === "[object Object]" && typeof o2.toJSON !== "function";
  }
  var MutationType;
  (function(MutationType2) {
    MutationType2["direct"] = "direct";
    MutationType2["patchObject"] = "patch object";
    MutationType2["patchFunction"] = "patch function";
  })(MutationType || (MutationType = {}));
  function createPinia() {
    const scope = e$1.effectScope(true);
    const state = scope.run(() => e$1.ref({}));
    let _p = [];
    let toBeInstalled = [];
    const pinia = e$1.markRaw({
      install(app) {
        setActivePinia(pinia);
        {
          pinia._a = app;
          app.provide(piniaSymbol, pinia);
          app.config.globalProperties.$pinia = pinia;
          toBeInstalled.forEach((plugin) => _p.push(plugin));
          toBeInstalled = [];
        }
      },
      use(plugin) {
        if (!this._a && true) {
          toBeInstalled.push(plugin);
        } else {
          _p.push(plugin);
        }
        return this;
      },
      _p,
      // it's actually undefined here
      // @ts-expect-error
      _a: null,
      _e: scope,
      _s: /* @__PURE__ */ new Map(),
      state
    });
    return pinia;
  }
  const noop$1 = () => {
  };
  function addSubscription(subscriptions, callback, detached, onCleanup = noop$1) {
    subscriptions.push(callback);
    const removeSubscription = () => {
      const idx = subscriptions.indexOf(callback);
      if (idx > -1) {
        subscriptions.splice(idx, 1);
        onCleanup();
      }
    };
    if (!detached && e$1.getCurrentScope()) {
      e$1.onScopeDispose(removeSubscription);
    }
    return removeSubscription;
  }
  function triggerSubscriptions(subscriptions, ...args) {
    subscriptions.slice().forEach((callback) => {
      callback(...args);
    });
  }
  const fallbackRunWithContext = (fn) => fn();
  const ACTION_MARKER = Symbol();
  const ACTION_NAME = Symbol();
  function mergeReactiveObjects(target, patchToApply) {
    if (target instanceof Map && patchToApply instanceof Map) {
      patchToApply.forEach((value, key) => target.set(key, value));
    } else if (target instanceof Set && patchToApply instanceof Set) {
      patchToApply.forEach(target.add, target);
    }
    for (const key in patchToApply) {
      if (!patchToApply.hasOwnProperty(key))
        continue;
      const subPatch = patchToApply[key];
      const targetValue = target[key];
      if (isPlainObject(targetValue) && isPlainObject(subPatch) && target.hasOwnProperty(key) && !e$1.isRef(subPatch) && !e$1.isReactive(subPatch)) {
        target[key] = mergeReactiveObjects(targetValue, subPatch);
      } else {
        target[key] = subPatch;
      }
    }
    return target;
  }
  const skipHydrateSymbol = (
    /* istanbul ignore next */
    Symbol()
  );
  function shouldHydrate(obj) {
    return !isPlainObject(obj) || !obj.hasOwnProperty(skipHydrateSymbol);
  }
  const { assign } = Object;
  function isComputed(o2) {
    return !!(e$1.isRef(o2) && o2.effect);
  }
  function createOptionsStore(id, options, pinia, hot) {
    const { state, actions, getters } = options;
    const initialState = pinia.state.value[id];
    let store;
    function setup() {
      if (!initialState && true) {
        {
          pinia.state.value[id] = state ? state() : {};
        }
      }
      const localState = e$1.toRefs(pinia.state.value[id]);
      return assign(localState, actions, Object.keys(getters || {}).reduce((computedGetters, name) => {
        computedGetters[name] = e$1.markRaw(e$1.computed(() => {
          setActivePinia(pinia);
          const store2 = pinia._s.get(id);
          return getters[name].call(store2, store2);
        }));
        return computedGetters;
      }, {}));
    }
    store = createSetupStore(id, setup, options, pinia, hot, true);
    return store;
  }
  function createSetupStore($id, setup, options = {}, pinia, hot, isOptionsStore) {
    let scope;
    const optionsForPlugin = assign({ actions: {} }, options);
    const $subscribeOptions = { deep: true };
    let isListening;
    let isSyncListening;
    let subscriptions = [];
    let actionSubscriptions = [];
    let debuggerEvents;
    const initialState = pinia.state.value[$id];
    if (!isOptionsStore && !initialState && true) {
      {
        pinia.state.value[$id] = {};
      }
    }
    e$1.ref({});
    let activeListener;
    function $patch(partialStateOrMutator) {
      let subscriptionMutation;
      isListening = isSyncListening = false;
      if (typeof partialStateOrMutator === "function") {
        partialStateOrMutator(pinia.state.value[$id]);
        subscriptionMutation = {
          type: MutationType.patchFunction,
          storeId: $id,
          events: debuggerEvents
        };
      } else {
        mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator);
        subscriptionMutation = {
          type: MutationType.patchObject,
          payload: partialStateOrMutator,
          storeId: $id,
          events: debuggerEvents
        };
      }
      const myListenerId = activeListener = Symbol();
      e$1.nextTick().then(() => {
        if (activeListener === myListenerId) {
          isListening = true;
        }
      });
      isSyncListening = true;
      triggerSubscriptions(subscriptions, subscriptionMutation, pinia.state.value[$id]);
    }
    const $reset = isOptionsStore ? function $reset2() {
      const { state } = options;
      const newState = state ? state() : {};
      this.$patch(($state) => {
        assign($state, newState);
      });
    } : (
      /* istanbul ignore next */
      noop$1
    );
    function $dispose() {
      scope.stop();
      subscriptions = [];
      actionSubscriptions = [];
      pinia._s.delete($id);
    }
    const action = (fn, name = "") => {
      if (ACTION_MARKER in fn) {
        fn[ACTION_NAME] = name;
        return fn;
      }
      const wrappedAction = function() {
        setActivePinia(pinia);
        const args = Array.from(arguments);
        const afterCallbackList = [];
        const onErrorCallbackList = [];
        function after(callback) {
          afterCallbackList.push(callback);
        }
        function onError(callback) {
          onErrorCallbackList.push(callback);
        }
        triggerSubscriptions(actionSubscriptions, {
          args,
          name: wrappedAction[ACTION_NAME],
          store,
          after,
          onError
        });
        let ret;
        try {
          ret = fn.apply(this && this.$id === $id ? this : store, args);
        } catch (error2) {
          triggerSubscriptions(onErrorCallbackList, error2);
          throw error2;
        }
        if (ret instanceof Promise) {
          return ret.then((value) => {
            triggerSubscriptions(afterCallbackList, value);
            return value;
          }).catch((error2) => {
            triggerSubscriptions(onErrorCallbackList, error2);
            return Promise.reject(error2);
          });
        }
        triggerSubscriptions(afterCallbackList, ret);
        return ret;
      };
      wrappedAction[ACTION_MARKER] = true;
      wrappedAction[ACTION_NAME] = name;
      return wrappedAction;
    };
    const partialStore = {
      _p: pinia,
      // _s: scope,
      $id,
      $onAction: addSubscription.bind(null, actionSubscriptions),
      $patch,
      $reset,
      $subscribe(callback, options2 = {}) {
        const removeSubscription = addSubscription(subscriptions, callback, options2.detached, () => stopWatcher());
        const stopWatcher = scope.run(() => e$1.watch(() => pinia.state.value[$id], (state) => {
          if (options2.flush === "sync" ? isSyncListening : isListening) {
            callback({
              storeId: $id,
              type: MutationType.direct,
              events: debuggerEvents
            }, state);
          }
        }, assign({}, $subscribeOptions, options2)));
        return removeSubscription;
      },
      $dispose
    };
    const store = e$1.reactive(partialStore);
    pinia._s.set($id, store);
    const runWithContext = pinia._a && pinia._a.runWithContext || fallbackRunWithContext;
    const setupStore = runWithContext(() => pinia._e.run(() => (scope = e$1.effectScope()).run(() => setup({ action }))));
    for (const key in setupStore) {
      const prop = setupStore[key];
      if (e$1.isRef(prop) && !isComputed(prop) || e$1.isReactive(prop)) {
        if (!isOptionsStore) {
          if (initialState && shouldHydrate(prop)) {
            if (e$1.isRef(prop)) {
              prop.value = initialState[key];
            } else {
              mergeReactiveObjects(prop, initialState[key]);
            }
          }
          {
            pinia.state.value[$id][key] = prop;
          }
        }
      } else if (typeof prop === "function") {
        const actionValue = action(prop, key);
        {
          setupStore[key] = actionValue;
        }
        optionsForPlugin.actions[key] = prop;
      } else ;
    }
    {
      assign(store, setupStore);
      assign(e$1.toRaw(store), setupStore);
    }
    Object.defineProperty(store, "$state", {
      get: () => pinia.state.value[$id],
      set: (state) => {
        $patch(($state) => {
          assign($state, state);
        });
      }
    });
    pinia._p.forEach((extender) => {
      {
        assign(store, scope.run(() => extender({
          store,
          app: pinia._a,
          pinia,
          options: optionsForPlugin
        })));
      }
    });
    if (initialState && isOptionsStore && options.hydrate) {
      options.hydrate(store.$state, initialState);
    }
    isListening = true;
    isSyncListening = true;
    return store;
  }
  /*! #__NO_SIDE_EFFECTS__ */
  // @__NO_SIDE_EFFECTS__
  function defineStore(idOrOptions, setup, setupOptions) {
    let id;
    let options;
    const isSetupStore = typeof setup === "function";
    if (typeof idOrOptions === "string") {
      id = idOrOptions;
      options = isSetupStore ? setupOptions : setup;
    } else {
      options = idOrOptions;
      id = idOrOptions.id;
    }
    function useStore(pinia, hot) {
      const hasContext = e$1.hasInjectionContext();
      pinia = // in test mode, ignore the argument provided as we can always retrieve a
      // pinia instance with getActivePinia()
      pinia || (hasContext ? e$1.inject(piniaSymbol, null) : null);
      if (pinia)
        setActivePinia(pinia);
      pinia = activePinia;
      if (!pinia._s.has(id)) {
        if (isSetupStore) {
          createSetupStore(id, setup, options, pinia);
        } else {
          createOptionsStore(id, options, pinia);
        }
      }
      const store = pinia._s.get(id);
      return store;
    }
    useStore.$id = id;
    return useStore;
  }
  function d$2(u2, e2, r2) {
    let i2 = e$1.ref(r2 == null ? undefined : r2.value), f2 = e$1.computed(() => u2.value !== undefined);
    return [e$1.computed(() => f2.value ? u2.value : i2.value), function(t2) {
      return f2.value || (i2.value = t2), e2 == null ? undefined : e2(t2);
    }];
  }
  var r$2;
  let n$3 = Symbol("headlessui.useid"), o$4 = 0;
  const i$4 = (r$2 = e$1__namespace.useId) != null ? r$2 : function() {
    return e$1__namespace.inject(n$3, () => `${++o$4}`)();
  };
  function o$3(e2) {
    var l2;
    if (e2 == null || e2.value == null) return null;
    let n2 = (l2 = e2.value.$el) != null ? l2 : e2.value;
    return n2 instanceof Node ? n2 : null;
  }
  function u$5(r2, n2, ...a2) {
    if (r2 in n2) {
      let e2 = n2[r2];
      return typeof e2 == "function" ? e2(...a2) : e2;
    }
    let t2 = new Error(`Tried to handle "${r2}" but there is no handler defined. Only defined handlers are: ${Object.keys(n2).map((e2) => `"${e2}"`).join(", ")}.`);
    throw Error.captureStackTrace && Error.captureStackTrace(t2, u$5), t2;
  }
  var i$3 = Object.defineProperty;
  var d$1 = (t2, e2, r2) => e2 in t2 ? i$3(t2, e2, { enumerable: true, configurable: true, writable: true, value: r2 }) : t2[e2] = r2;
  var n$2 = (t2, e2, r2) => (d$1(t2, typeof e2 != "symbol" ? e2 + "" : e2, r2), r2);
  let s$1 = class s {
    constructor() {
      n$2(this, "current", this.detect());
      n$2(this, "currentId", 0);
    }
    set(e2) {
      this.current !== e2 && (this.currentId = 0, this.current = e2);
    }
    reset() {
      this.set(this.detect());
    }
    nextId() {
      return ++this.currentId;
    }
    get isServer() {
      return this.current === "server";
    }
    get isClient() {
      return this.current === "client";
    }
    detect() {
      return typeof window == "undefined" || typeof document == "undefined" ? "server" : "client";
    }
  };
  let c$2 = new s$1();
  function i$2(r2) {
    if (c$2.isServer) return null;
    if (r2 instanceof Node) return r2.ownerDocument;
    if (r2 != null && r2.hasOwnProperty("value")) {
      let n2 = o$3(r2);
      if (n2) return n2.ownerDocument;
    }
    return document;
  }
  let c$1 = ["[contentEditable=true]", "[tabindex]", "a[href]", "area[href]", "button:not([disabled])", "iframe", "input:not([disabled])", "select:not([disabled])", "textarea:not([disabled])"].map((e2) => `${e2}:not([tabindex='-1'])`).join(",");
  var N$2 = ((n2) => (n2[n2.First = 1] = "First", n2[n2.Previous = 2] = "Previous", n2[n2.Next = 4] = "Next", n2[n2.Last = 8] = "Last", n2[n2.WrapAround = 16] = "WrapAround", n2[n2.NoScroll = 32] = "NoScroll", n2))(N$2 || {}), T$2 = ((o2) => (o2[o2.Error = 0] = "Error", o2[o2.Overflow = 1] = "Overflow", o2[o2.Success = 2] = "Success", o2[o2.Underflow = 3] = "Underflow", o2))(T$2 || {}), F = ((t2) => (t2[t2.Previous = -1] = "Previous", t2[t2.Next = 1] = "Next", t2))(F || {});
  var h = ((t2) => (t2[t2.Strict = 0] = "Strict", t2[t2.Loose = 1] = "Loose", t2))(h || {});
  function w$3(e2, r2 = 0) {
    var t2;
    return e2 === ((t2 = i$2(e2)) == null ? undefined : t2.body) ? false : u$5(r2, { [0]() {
      return e2.matches(c$1);
    }, [1]() {
      let l2 = e2;
      for (; l2 !== null; ) {
        if (l2.matches(c$1)) return true;
        l2 = l2.parentElement;
      }
      return false;
    } });
  }
  var y$1 = ((t2) => (t2[t2.Keyboard = 0] = "Keyboard", t2[t2.Mouse = 1] = "Mouse", t2))(y$1 || {});
  typeof window != "undefined" && typeof document != "undefined" && (document.addEventListener("keydown", (e2) => {
    e2.metaKey || e2.altKey || e2.ctrlKey || (document.documentElement.dataset.headlessuiFocusVisible = "");
  }, true), document.addEventListener("click", (e2) => {
    e2.detail === 1 ? delete document.documentElement.dataset.headlessuiFocusVisible : e2.detail === 0 && (document.documentElement.dataset.headlessuiFocusVisible = "");
  }, true));
  function O$1(e2, r2 = (t2) => t2) {
    return e2.slice().sort((t2, l2) => {
      let o2 = r2(t2), i2 = r2(l2);
      if (o2 === null || i2 === null) return 0;
      let n2 = o2.compareDocumentPosition(i2);
      return n2 & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : n2 & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
    });
  }
  function t$1() {
    return /iPhone/gi.test(window.navigator.platform) || /Mac/gi.test(window.navigator.platform) && window.navigator.maxTouchPoints > 0;
  }
  function i$1() {
    return /Android/gi.test(window.navigator.userAgent);
  }
  function n$1() {
    return t$1() || i$1();
  }
  function u$4(e2, t2, n2) {
    c$2.isServer || e$1.watchEffect((o2) => {
      document.addEventListener(e2, t2, n2), o2(() => document.removeEventListener(e2, t2, n2));
    });
  }
  function w$2(e2, n2, t2) {
    c$2.isServer || e$1.watchEffect((o2) => {
      window.addEventListener(e2, n2, t2), o2(() => window.removeEventListener(e2, n2, t2));
    });
  }
  function w$1(f2, m, l2 = e$1.computed(() => true)) {
    function a2(e2, r2) {
      if (!l2.value || e2.defaultPrevented) return;
      let t2 = r2(e2);
      if (t2 === null || !t2.getRootNode().contains(t2)) return;
      let c2 = function o2(n2) {
        return typeof n2 == "function" ? o2(n2()) : Array.isArray(n2) || n2 instanceof Set ? n2 : [n2];
      }(f2);
      for (let o2 of c2) {
        if (o2 === null) continue;
        let n2 = o2 instanceof HTMLElement ? o2 : o$3(o2);
        if (n2 != null && n2.contains(t2) || e2.composed && e2.composedPath().includes(n2)) return;
      }
      return !w$3(t2, h.Loose) && t2.tabIndex !== -1 && e2.preventDefault(), m(e2, t2);
    }
    let u2 = e$1.ref(null);
    u$4("pointerdown", (e2) => {
      var r2, t2;
      l2.value && (u2.value = ((t2 = (r2 = e2.composedPath) == null ? undefined : r2.call(e2)) == null ? undefined : t2[0]) || e2.target);
    }, true), u$4("mousedown", (e2) => {
      var r2, t2;
      l2.value && (u2.value = ((t2 = (r2 = e2.composedPath) == null ? undefined : r2.call(e2)) == null ? undefined : t2[0]) || e2.target);
    }, true), u$4("click", (e2) => {
      n$1() || u2.value && (a2(e2, () => u2.value), u2.value = null);
    }, true), u$4("touchend", (e2) => a2(e2, () => e2.target instanceof HTMLElement ? e2.target : null), true), w$2("blur", (e2) => a2(e2, () => window.document.activeElement instanceof HTMLIFrameElement ? window.document.activeElement : null), true);
  }
  function r$1(t2, e2) {
    if (t2) return t2;
    let n2 = e2 != null ? e2 : "button";
    if (typeof n2 == "string" && n2.toLowerCase() === "button") return "button";
  }
  function s2(t2, e2) {
    let n2 = e$1.ref(r$1(t2.value.type, t2.value.as));
    return e$1.onMounted(() => {
      n2.value = r$1(t2.value.type, t2.value.as);
    }), e$1.watchEffect(() => {
      var u2;
      n2.value || o$3(e2) && o$3(e2) instanceof HTMLButtonElement && !((u2 = o$3(e2)) != null && u2.hasAttribute("type")) && (n2.value = "button");
    }), n2;
  }
  function r(e2) {
    return [e2.screenX, e2.screenY];
  }
  function u$3() {
    let e2 = e$1.ref([-1, -1]);
    return { wasMoved(n2) {
      let t2 = r(n2);
      return e2.value[0] === t2[0] && e2.value[1] === t2[1] ? false : (e2.value = t2, true);
    }, update(n2) {
      e2.value = r(n2);
    } };
  }
  var N$1 = ((o2) => (o2[o2.None = 0] = "None", o2[o2.RenderStrategy = 1] = "RenderStrategy", o2[o2.Static = 2] = "Static", o2))(N$1 || {}), S = ((e2) => (e2[e2.Unmount = 0] = "Unmount", e2[e2.Hidden = 1] = "Hidden", e2))(S || {});
  function A$1({ visible: r2 = true, features: t2 = 0, ourProps: e2, theirProps: o2, ...i2 }) {
    var a2;
    let n2 = j(o2, e2), l2 = Object.assign(i2, { props: n2 });
    if (r2 || t2 & 2 && n2.static) return y(l2);
    if (t2 & 1) {
      let d2 = (a2 = n2.unmount) == null || a2 ? 0 : 1;
      return u$5(d2, { [0]() {
        return null;
      }, [1]() {
        return y({ ...i2, props: { ...n2, hidden: true, style: { display: "none" } } });
      } });
    }
    return y(l2);
  }
  function y({ props: r2, attrs: t2, slots: e2, slot: o2, name: i2 }) {
    var m, h2;
    let { as: n2, ...l2 } = T$1(r2, ["unmount", "static"]), a2 = (m = e2.default) == null ? undefined : m.call(e2, o2), d2 = {};
    if (o2) {
      let u2 = false, c2 = [];
      for (let [p2, f2] of Object.entries(o2)) typeof f2 == "boolean" && (u2 = true), f2 === true && c2.push(p2);
      u2 && (d2["data-headlessui-state"] = c2.join(" "));
    }
    if (n2 === "template") {
      if (a2 = b(a2 != null ? a2 : []), Object.keys(l2).length > 0 || Object.keys(t2).length > 0) {
        let [u2, ...c2] = a2 != null ? a2 : [];
        if (!v(u2) || c2.length > 0) throw new Error(['Passing props on "template"!', "", `The current component <${i2} /> is rendering a "template".`, "However we need to passthrough the following props:", Object.keys(l2).concat(Object.keys(t2)).map((s3) => s3.trim()).filter((s3, g2, R) => R.indexOf(s3) === g2).sort((s3, g2) => s3.localeCompare(g2)).map((s3) => `  - ${s3}`).join(`
`), "", "You can apply a few solutions:", ['Add an `as="..."` prop, to ensure that we render an actual element instead of a "template".', "Render a single element as the child so that we can forward the props onto that element."].map((s3) => `  - ${s3}`).join(`
`)].join(`
`));
        let p2 = j((h2 = u2.props) != null ? h2 : {}, l2, d2), f2 = e$1.cloneVNode(u2, p2, true);
        for (let s3 in p2) s3.startsWith("on") && (f2.props || (f2.props = {}), f2.props[s3] = p2[s3]);
        return f2;
      }
      return Array.isArray(a2) && a2.length === 1 ? a2[0] : a2;
    }
    return e$1.h(n2, Object.assign({}, l2, d2), { default: () => a2 });
  }
  function b(r2) {
    return r2.flatMap((t2) => t2.type === e$1.Fragment ? b(t2.children) : [t2]);
  }
  function j(...r2) {
    if (r2.length === 0) return {};
    if (r2.length === 1) return r2[0];
    let t2 = {}, e2 = {};
    for (let i2 of r2) for (let n2 in i2) n2.startsWith("on") && typeof i2[n2] == "function" ? (e2[n2] != null || (e2[n2] = []), e2[n2].push(i2[n2])) : t2[n2] = i2[n2];
    if (t2.disabled || t2["aria-disabled"]) return Object.assign(t2, Object.fromEntries(Object.keys(e2).map((i2) => [i2, undefined])));
    for (let i2 in e2) Object.assign(t2, { [i2](n2, ...l2) {
      let a2 = e2[i2];
      for (let d2 of a2) {
        if (n2 instanceof Event && n2.defaultPrevented) return;
        d2(n2, ...l2);
      }
    } });
    return t2;
  }
  function E$1(r2) {
    let t2 = Object.assign({}, r2);
    for (let e2 in t2) t2[e2] === undefined && delete t2[e2];
    return t2;
  }
  function T$1(r2, t2 = []) {
    let e2 = Object.assign({}, r2);
    for (let o2 of t2) o2 in e2 && delete e2[o2];
    return e2;
  }
  function v(r2) {
    return r2 == null ? false : typeof r2.type == "string" || typeof r2.type == "object" || typeof r2.type == "function";
  }
  var u$2 = ((e2) => (e2[e2.None = 1] = "None", e2[e2.Focusable = 2] = "Focusable", e2[e2.Hidden = 4] = "Hidden", e2))(u$2 || {});
  let f$2 = e$1.defineComponent({ name: "Hidden", props: { as: { type: [Object, String], default: "div" }, features: { type: Number, default: 1 } }, setup(t2, { slots: n2, attrs: i2 }) {
    return () => {
      var r2;
      let { features: e2, ...d2 } = t2, o2 = { "aria-hidden": (e2 & 2) === 2 ? true : (r2 = d2["aria-hidden"]) != null ? r2 : undefined, hidden: (e2 & 4) === 4 ? true : undefined, style: { position: "fixed", top: 1, left: 1, width: 1, height: 0, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", borderWidth: "0", ...(e2 & 4) === 4 && (e2 & 2) !== 2 && { display: "none" } } };
      return A$1({ ourProps: o2, theirProps: d2, slot: {}, attrs: i2, slots: n2, name: "Hidden" });
    };
  } });
  let n = Symbol("Context");
  var i = ((e2) => (e2[e2.Open = 1] = "Open", e2[e2.Closed = 2] = "Closed", e2[e2.Closing = 4] = "Closing", e2[e2.Opening = 8] = "Opening", e2))(i || {});
  function l() {
    return e$1.inject(n, null);
  }
  function t(o2) {
    e$1.provide(n, o2);
  }
  var o$2 = ((r2) => (r2.Space = " ", r2.Enter = "Enter", r2.Escape = "Escape", r2.Backspace = "Backspace", r2.Delete = "Delete", r2.ArrowLeft = "ArrowLeft", r2.ArrowUp = "ArrowUp", r2.ArrowRight = "ArrowRight", r2.ArrowDown = "ArrowDown", r2.Home = "Home", r2.End = "End", r2.PageUp = "PageUp", r2.PageDown = "PageDown", r2.Tab = "Tab", r2))(o$2 || {});
  function u$1(l2) {
    throw new Error("Unexpected object: " + l2);
  }
  var c = ((i2) => (i2[i2.First = 0] = "First", i2[i2.Previous = 1] = "Previous", i2[i2.Next = 2] = "Next", i2[i2.Last = 3] = "Last", i2[i2.Specific = 4] = "Specific", i2[i2.Nothing = 5] = "Nothing", i2))(c || {});
  function f$1(l2, n2) {
    let t2 = n2.resolveItems();
    if (t2.length <= 0) return null;
    let r2 = n2.resolveActiveIndex(), s3 = r2 != null ? r2 : -1;
    switch (l2.focus) {
      case 0: {
        for (let e2 = 0; e2 < t2.length; ++e2) if (!n2.resolveDisabled(t2[e2], e2, t2)) return e2;
        return r2;
      }
      case 1: {
        s3 === -1 && (s3 = t2.length);
        for (let e2 = s3 - 1; e2 >= 0; --e2) if (!n2.resolveDisabled(t2[e2], e2, t2)) return e2;
        return r2;
      }
      case 2: {
        for (let e2 = s3 + 1; e2 < t2.length; ++e2) if (!n2.resolveDisabled(t2[e2], e2, t2)) return e2;
        return r2;
      }
      case 3: {
        for (let e2 = t2.length - 1; e2 >= 0; --e2) if (!n2.resolveDisabled(t2[e2], e2, t2)) return e2;
        return r2;
      }
      case 4: {
        for (let e2 = 0; e2 < t2.length; ++e2) if (n2.resolveId(t2[e2], e2, t2) === l2.id) return e2;
        return r2;
      }
      case 5:
        return null;
      default:
        u$1(l2);
    }
  }
  function e(i2 = {}, s3 = null, t2 = []) {
    for (let [r2, n2] of Object.entries(i2)) o$1(t2, f(s3, r2), n2);
    return t2;
  }
  function f(i2, s3) {
    return i2 ? i2 + "[" + s3 + "]" : s3;
  }
  function o$1(i2, s3, t2) {
    if (Array.isArray(t2)) for (let [r2, n2] of t2.entries()) o$1(i2, f(s3, r2.toString()), n2);
    else t2 instanceof Date ? i2.push([s3, t2.toISOString()]) : typeof t2 == "boolean" ? i2.push([s3, t2 ? "1" : "0"]) : typeof t2 == "string" ? i2.push([s3, t2]) : typeof t2 == "number" ? i2.push([s3, `${t2}`]) : t2 == null ? i2.push([s3, ""]) : e(t2, s3, i2);
  }
  function p$1(i2) {
    var t2, r2;
    let s3 = (t2 = i2 == null ? undefined : i2.form) != null ? t2 : i2.closest("form");
    if (s3) {
      for (let n2 of s3.elements) if (n2 !== i2 && (n2.tagName === "INPUT" && n2.type === "submit" || n2.tagName === "BUTTON" && n2.type === "submit" || n2.nodeName === "INPUT" && n2.type === "image")) {
        n2.click();
        return;
      }
      (r2 = s3.requestSubmit) == null || r2.call(s3);
    }
  }
  let u = Symbol("DescriptionContext");
  function w() {
    let t2 = e$1.inject(u, null);
    if (t2 === null) throw new Error("Missing parent");
    return t2;
  }
  function k$1({ slot: t2 = e$1.ref({}), name: o2 = "Description", props: s3 = {} } = {}) {
    let e2 = e$1.ref([]);
    function r2(n2) {
      return e2.value.push(n2), () => {
        let i2 = e2.value.indexOf(n2);
        i2 !== -1 && e2.value.splice(i2, 1);
      };
    }
    return e$1.provide(u, { register: r2, slot: t2, name: o2, props: s3 }), e$1.computed(() => e2.value.length > 0 ? e2.value.join(" ") : undefined);
  }
  e$1.defineComponent({ name: "Description", props: { as: { type: [Object, String], default: "p" }, id: { type: String, default: null } }, setup(t2, { attrs: o2, slots: s3 }) {
    var n2;
    let e2 = (n2 = t2.id) != null ? n2 : `headlessui-description-${i$4()}`, r2 = w();
    return e$1.onMounted(() => e$1.onUnmounted(r2.register(e2))), () => {
      let { name: i2 = "Description", slot: l2 = e$1.ref({}), props: d2 = {} } = r2, { ...c2 } = t2, f2 = { ...Object.entries(d2).reduce((a2, [g2, m]) => Object.assign(a2, { [g2]: e$1.unref(m) }), {}), id: e2 };
      return A$1({ ourProps: f2, theirProps: c2, slot: l2.value, attrs: o2, slots: s3, name: i2 });
    };
  } });
  var $$1 = ((o2) => (o2[o2.Open = 0] = "Open", o2[o2.Closed = 1] = "Closed", o2))($$1 || {});
  let T = Symbol("DisclosureContext");
  function O(t2) {
    let r2 = e$1.inject(T, null);
    if (r2 === null) {
      let o2 = new Error(`<${t2} /> is missing a parent <Disclosure /> component.`);
      throw Error.captureStackTrace && Error.captureStackTrace(o2, O), o2;
    }
    return r2;
  }
  let k = Symbol("DisclosurePanelContext");
  function U() {
    return e$1.inject(k, null);
  }
  let N = e$1.defineComponent({ name: "Disclosure", props: { as: { type: [Object, String], default: "template" }, defaultOpen: { type: [Boolean], default: false } }, setup(t$12, { slots: r2, attrs: o2 }) {
    let s3 = e$1.ref(t$12.defaultOpen ? 0 : 1), e2 = e$1.ref(null), i$12 = e$1.ref(null), n2 = { buttonId: e$1.ref(`headlessui-disclosure-button-${i$4()}`), panelId: e$1.ref(`headlessui-disclosure-panel-${i$4()}`), disclosureState: s3, panel: e2, button: i$12, toggleDisclosure() {
      s3.value = u$5(s3.value, { [0]: 1, [1]: 0 });
    }, closeDisclosure() {
      s3.value !== 1 && (s3.value = 1);
    }, close(l2) {
      n2.closeDisclosure();
      let a2 = (() => l2 ? l2 instanceof HTMLElement ? l2 : l2.value instanceof HTMLElement ? o$3(l2) : o$3(n2.button) : o$3(n2.button))();
      a2 == null || a2.focus();
    } };
    return e$1.provide(T, n2), t(e$1.computed(() => u$5(s3.value, { [0]: i.Open, [1]: i.Closed }))), () => {
      let { defaultOpen: l2, ...a2 } = t$12, c2 = { open: s3.value === 0, close: n2.close };
      return A$1({ theirProps: a2, ourProps: {}, slot: c2, slots: r2, attrs: o2, name: "Disclosure" });
    };
  } }), Q = e$1.defineComponent({ name: "DisclosureButton", props: { as: { type: [Object, String], default: "button" }, disabled: { type: [Boolean], default: false }, id: { type: String, default: null } }, setup(t2, { attrs: r2, slots: o2, expose: s$12 }) {
    let e2 = O("DisclosureButton"), i2 = U(), n2 = e$1.computed(() => i2 === null ? false : i2.value === e2.panelId.value);
    e$1.onMounted(() => {
      n2.value || t2.id !== null && (e2.buttonId.value = t2.id);
    }), e$1.onUnmounted(() => {
      n2.value || (e2.buttonId.value = null);
    });
    let l2 = e$1.ref(null);
    s$12({ el: l2, $el: l2 }), n2.value || e$1.watchEffect(() => {
      e2.button.value = l2.value;
    });
    let a2 = s2(e$1.computed(() => ({ as: t2.as, type: r2.type })), l2);
    function c2() {
      var u2;
      t2.disabled || (n2.value ? (e2.toggleDisclosure(), (u2 = o$3(e2.button)) == null || u2.focus()) : e2.toggleDisclosure());
    }
    function D(u2) {
      var S2;
      if (!t2.disabled) if (n2.value) switch (u2.key) {
        case o$2.Space:
        case o$2.Enter:
          u2.preventDefault(), u2.stopPropagation(), e2.toggleDisclosure(), (S2 = o$3(e2.button)) == null || S2.focus();
          break;
      }
      else switch (u2.key) {
        case o$2.Space:
        case o$2.Enter:
          u2.preventDefault(), u2.stopPropagation(), e2.toggleDisclosure();
          break;
      }
    }
    function v2(u2) {
      switch (u2.key) {
        case o$2.Space:
          u2.preventDefault();
          break;
      }
    }
    return () => {
      var C2;
      let u2 = { open: e2.disclosureState.value === 0 }, { id: S2, ...K2 } = t2, M = n2.value ? { ref: l2, type: a2.value, onClick: c2, onKeydown: D } : { id: (C2 = e2.buttonId.value) != null ? C2 : S2, ref: l2, type: a2.value, "aria-expanded": e2.disclosureState.value === 0, "aria-controls": e2.disclosureState.value === 0 || o$3(e2.panel) ? e2.panelId.value : undefined, disabled: t2.disabled ? true : undefined, onClick: c2, onKeydown: D, onKeyup: v2 };
      return A$1({ ourProps: M, theirProps: K2, slot: u2, attrs: r2, slots: o2, name: "DisclosureButton" });
    };
  } }), V = e$1.defineComponent({ name: "DisclosurePanel", props: { as: { type: [Object, String], default: "div" }, static: { type: Boolean, default: false }, unmount: { type: Boolean, default: true }, id: { type: String, default: null } }, setup(t2, { attrs: r2, slots: o2, expose: s3 }) {
    let e2 = O("DisclosurePanel");
    e$1.onMounted(() => {
      t2.id !== null && (e2.panelId.value = t2.id);
    }), e$1.onUnmounted(() => {
      e2.panelId.value = null;
    }), s3({ el: e2.panel, $el: e2.panel }), e$1.provide(k, e2.panelId);
    let i$12 = l(), n2 = e$1.computed(() => i$12 !== null ? (i$12.value & i.Open) === i.Open : e2.disclosureState.value === 0);
    return () => {
      var v2;
      let l2 = { open: e2.disclosureState.value === 0, close: e2.close }, { id: a2, ...c2 } = t2, D = { id: (v2 = e2.panelId.value) != null ? v2 : a2, ref: e2.panel };
      return A$1({ ourProps: D, theirProps: c2, slot: l2, attrs: r2, slots: o2, features: N$1.RenderStrategy | N$1.Static, visible: n2.value, name: "DisclosurePanel" });
    };
  } });
  let a$1 = /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g;
  function o(e2) {
    var r2, i2;
    let n2 = (r2 = e2.innerText) != null ? r2 : "", t2 = e2.cloneNode(true);
    if (!(t2 instanceof HTMLElement)) return n2;
    let u2 = false;
    for (let f2 of t2.querySelectorAll('[hidden],[aria-hidden],[role="img"]')) f2.remove(), u2 = true;
    let l2 = u2 ? (i2 = t2.innerText) != null ? i2 : "" : n2;
    return a$1.test(l2) && (l2 = l2.replace(a$1, "")), l2;
  }
  function g(e2) {
    let n2 = e2.getAttribute("aria-label");
    if (typeof n2 == "string") return n2.trim();
    let t2 = e2.getAttribute("aria-labelledby");
    if (t2) {
      let u2 = t2.split(" ").map((l2) => {
        let r2 = document.getElementById(l2);
        if (r2) {
          let i2 = r2.getAttribute("aria-label");
          return typeof i2 == "string" ? i2.trim() : o(r2).trim();
        }
        return null;
      }).filter(Boolean);
      if (u2.length > 0) return u2.join(", ");
    }
    return o(e2).trim();
  }
  function p(a2) {
    let t2 = e$1.ref(""), r2 = e$1.ref("");
    return () => {
      let e2 = o$3(a2);
      if (!e2) return "";
      let l2 = e2.innerText;
      if (t2.value === l2) return r2.value;
      let u2 = g(e2).trim().toLowerCase();
      return t2.value = l2, r2.value = u2, u2;
    };
  }
  function pe(o2, b2) {
    return o2 === b2;
  }
  var ce = ((r2) => (r2[r2.Open = 0] = "Open", r2[r2.Closed = 1] = "Closed", r2))(ce || {}), ve = ((r2) => (r2[r2.Single = 0] = "Single", r2[r2.Multi = 1] = "Multi", r2))(ve || {}), be = ((r2) => (r2[r2.Pointer = 0] = "Pointer", r2[r2.Other = 1] = "Other", r2))(be || {});
  function me(o2) {
    requestAnimationFrame(() => requestAnimationFrame(o2));
  }
  let $ = Symbol("ListboxContext");
  function A(o2) {
    let b2 = e$1.inject($, null);
    if (b2 === null) {
      let r2 = new Error(`<${o2} /> is missing a parent <Listbox /> component.`);
      throw Error.captureStackTrace && Error.captureStackTrace(r2, A), r2;
    }
    return b2;
  }
  let Ie = e$1.defineComponent({ name: "Listbox", emits: { "update:modelValue": (o2) => true }, props: { as: { type: [Object, String], default: "template" }, disabled: { type: [Boolean], default: false }, by: { type: [String, Function], default: () => pe }, horizontal: { type: [Boolean], default: false }, modelValue: { type: [Object, String, Number, Boolean], default: undefined }, defaultValue: { type: [Object, String, Number, Boolean], default: undefined }, form: { type: String, optional: true }, name: { type: String, optional: true }, multiple: { type: [Boolean], default: false } }, inheritAttrs: false, setup(o2, { slots: b2, attrs: r2, emit: w2 }) {
    let n2 = e$1.ref(1), e$12 = e$1.ref(null), f2 = e$1.ref(null), v2 = e$1.ref(null), s3 = e$1.ref([]), m = e$1.ref(""), p2 = e$1.ref(null), a2 = e$1.ref(1);
    function u2(t2 = (i2) => i2) {
      let i2 = p2.value !== null ? s3.value[p2.value] : null, l2 = O$1(t2(s3.value.slice()), (O2) => o$3(O2.dataRef.domRef)), d2 = i2 ? l2.indexOf(i2) : null;
      return d2 === -1 && (d2 = null), { options: l2, activeOptionIndex: d2 };
    }
    let D = e$1.computed(() => o2.multiple ? 1 : 0), [y2, L] = d$2(e$1.computed(() => o2.modelValue), (t2) => w2("update:modelValue", t2), e$1.computed(() => o2.defaultValue)), M = e$1.computed(() => y2.value === undefined ? u$5(D.value, { [1]: [], [0]: undefined }) : y2.value), k2 = { listboxState: n2, value: M, mode: D, compare(t2, i2) {
      if (typeof o2.by == "string") {
        let l2 = o2.by;
        return (t2 == null ? undefined : t2[l2]) === (i2 == null ? undefined : i2[l2]);
      }
      return o2.by(t2, i2);
    }, orientation: e$1.computed(() => o2.horizontal ? "horizontal" : "vertical"), labelRef: e$12, buttonRef: f2, optionsRef: v2, disabled: e$1.computed(() => o2.disabled), options: s3, searchQuery: m, activeOptionIndex: p2, activationTrigger: a2, closeListbox() {
      o2.disabled || n2.value !== 1 && (n2.value = 1, p2.value = null);
    }, openListbox() {
      o2.disabled || n2.value !== 0 && (n2.value = 0);
    }, goToOption(t2, i2, l2) {
      if (o2.disabled || n2.value === 1) return;
      let d2 = u2(), O2 = f$1(t2 === c.Specific ? { focus: c.Specific, id: i2 } : { focus: t2 }, { resolveItems: () => d2.options, resolveActiveIndex: () => d2.activeOptionIndex, resolveId: (h2) => h2.id, resolveDisabled: (h2) => h2.dataRef.disabled });
      m.value = "", p2.value = O2, a2.value = l2 != null ? l2 : 1, s3.value = d2.options;
    }, search(t2) {
      if (o2.disabled || n2.value === 1) return;
      let l2 = m.value !== "" ? 0 : 1;
      m.value += t2.toLowerCase();
      let O2 = (p2.value !== null ? s3.value.slice(p2.value + l2).concat(s3.value.slice(0, p2.value + l2)) : s3.value).find((I) => I.dataRef.textValue.startsWith(m.value) && !I.dataRef.disabled), h2 = O2 ? s3.value.indexOf(O2) : -1;
      h2 === -1 || h2 === p2.value || (p2.value = h2, a2.value = 1);
    }, clearSearch() {
      o2.disabled || n2.value !== 1 && m.value !== "" && (m.value = "");
    }, registerOption(t2, i2) {
      let l2 = u2((d2) => [...d2, { id: t2, dataRef: i2 }]);
      s3.value = l2.options, p2.value = l2.activeOptionIndex;
    }, unregisterOption(t2) {
      let i2 = u2((l2) => {
        let d2 = l2.findIndex((O2) => O2.id === t2);
        return d2 !== -1 && l2.splice(d2, 1), l2;
      });
      s3.value = i2.options, p2.value = i2.activeOptionIndex, a2.value = 1;
    }, theirOnChange(t2) {
      o2.disabled || L(t2);
    }, select(t2) {
      o2.disabled || L(u$5(D.value, { [0]: () => t2, [1]: () => {
        let i2 = e$1.toRaw(k2.value.value).slice(), l2 = e$1.toRaw(t2), d2 = i2.findIndex((O2) => k2.compare(l2, e$1.toRaw(O2)));
        return d2 === -1 ? i2.push(l2) : i2.splice(d2, 1), i2;
      } }));
    } };
    w$1([f2, v2], (t2, i2) => {
      var l2;
      k2.closeListbox(), w$3(i2, h.Loose) || (t2.preventDefault(), (l2 = o$3(f2)) == null || l2.focus());
    }, e$1.computed(() => n2.value === 0)), e$1.provide($, k2), t(e$1.computed(() => u$5(n2.value, { [0]: i.Open, [1]: i.Closed })));
    let C2 = e$1.computed(() => {
      var t2;
      return (t2 = o$3(f2)) == null ? undefined : t2.closest("form");
    });
    return e$1.onMounted(() => {
      e$1.watch([C2], () => {
        if (!C2.value || o2.defaultValue === undefined) return;
        function t2() {
          k2.theirOnChange(o2.defaultValue);
        }
        return C2.value.addEventListener("reset", t2), () => {
          var i2;
          (i2 = C2.value) == null || i2.removeEventListener("reset", t2);
        };
      }, { immediate: true });
    }), () => {
      let { name: t2, modelValue: i2, disabled: l2, form: d2, ...O2 } = o2, h2 = { open: n2.value === 0, disabled: l2, value: M.value };
      return e$1.h(e$1.Fragment, [...t2 != null && M.value != null ? e({ [t2]: M.value }).map(([I, Q2]) => e$1.h(f$2, E$1({ features: u$2.Hidden, key: I, as: "input", type: "hidden", hidden: true, readOnly: true, form: d2, disabled: l2, name: I, value: Q2 }))) : [], A$1({ ourProps: {}, theirProps: { ...r2, ...T$1(O2, ["defaultValue", "onUpdate:modelValue", "horizontal", "multiple", "by"]) }, slot: h2, slots: b2, attrs: r2, name: "Listbox" })]);
    };
  } });
  e$1.defineComponent({ name: "ListboxLabel", props: { as: { type: [Object, String], default: "label" }, id: { type: String, default: null } }, setup(o2, { attrs: b2, slots: r2 }) {
    var f2;
    let w2 = (f2 = o2.id) != null ? f2 : `headlessui-listbox-label-${i$4()}`, n2 = A("ListboxLabel");
    function e2() {
      var v2;
      (v2 = o$3(n2.buttonRef)) == null || v2.focus({ preventScroll: true });
    }
    return () => {
      let v2 = { open: n2.listboxState.value === 0, disabled: n2.disabled.value }, { ...s3 } = o2, m = { id: w2, ref: n2.labelRef, onClick: e2 };
      return A$1({ ourProps: m, theirProps: s3, slot: v2, attrs: b2, slots: r2, name: "ListboxLabel" });
    };
  } });
  let je = e$1.defineComponent({ name: "ListboxButton", props: { as: { type: [Object, String], default: "button" }, id: { type: String, default: null } }, setup(o2, { attrs: b2, slots: r2, expose: w2 }) {
    var p2;
    let n2 = (p2 = o2.id) != null ? p2 : `headlessui-listbox-button-${i$4()}`, e2 = A("ListboxButton");
    w2({ el: e2.buttonRef, $el: e2.buttonRef });
    function f2(a2) {
      switch (a2.key) {
        case o$2.Space:
        case o$2.Enter:
        case o$2.ArrowDown:
          a2.preventDefault(), e2.openListbox(), e$1.nextTick(() => {
            var u2;
            (u2 = o$3(e2.optionsRef)) == null || u2.focus({ preventScroll: true }), e2.value.value || e2.goToOption(c.First);
          });
          break;
        case o$2.ArrowUp:
          a2.preventDefault(), e2.openListbox(), e$1.nextTick(() => {
            var u2;
            (u2 = o$3(e2.optionsRef)) == null || u2.focus({ preventScroll: true }), e2.value.value || e2.goToOption(c.Last);
          });
          break;
      }
    }
    function v2(a2) {
      switch (a2.key) {
        case o$2.Space:
          a2.preventDefault();
          break;
      }
    }
    function s$12(a2) {
      e2.disabled.value || (e2.listboxState.value === 0 ? (e2.closeListbox(), e$1.nextTick(() => {
        var u2;
        return (u2 = o$3(e2.buttonRef)) == null ? undefined : u2.focus({ preventScroll: true });
      })) : (a2.preventDefault(), e2.openListbox(), me(() => {
        var u2;
        return (u2 = o$3(e2.optionsRef)) == null ? undefined : u2.focus({ preventScroll: true });
      })));
    }
    let m = s2(e$1.computed(() => ({ as: o2.as, type: b2.type })), e2.buttonRef);
    return () => {
      var y2, L;
      let a2 = { open: e2.listboxState.value === 0, disabled: e2.disabled.value, value: e2.value.value }, { ...u2 } = o2, D = { ref: e2.buttonRef, id: n2, type: m.value, "aria-haspopup": "listbox", "aria-controls": (y2 = o$3(e2.optionsRef)) == null ? undefined : y2.id, "aria-expanded": e2.listboxState.value === 0, "aria-labelledby": e2.labelRef.value ? [(L = o$3(e2.labelRef)) == null ? undefined : L.id, n2].join(" ") : undefined, disabled: e2.disabled.value === true ? true : undefined, onKeydown: f2, onKeyup: v2, onClick: s$12 };
      return A$1({ ourProps: D, theirProps: u2, slot: a2, attrs: b2, slots: r2, name: "ListboxButton" });
    };
  } }), Ae = e$1.defineComponent({ name: "ListboxOptions", props: { as: { type: [Object, String], default: "ul" }, static: { type: Boolean, default: false }, unmount: { type: Boolean, default: true }, id: { type: String, default: null } }, setup(o2, { attrs: b2, slots: r2, expose: w2 }) {
    var p2;
    let n2 = (p2 = o2.id) != null ? p2 : `headlessui-listbox-options-${i$4()}`, e2 = A("ListboxOptions"), f2 = e$1.ref(null);
    w2({ el: e2.optionsRef, $el: e2.optionsRef });
    function v2(a2) {
      switch (f2.value && clearTimeout(f2.value), a2.key) {
        case o$2.Space:
          if (e2.searchQuery.value !== "") return a2.preventDefault(), a2.stopPropagation(), e2.search(a2.key);
        case o$2.Enter:
          if (a2.preventDefault(), a2.stopPropagation(), e2.activeOptionIndex.value !== null) {
            let u2 = e2.options.value[e2.activeOptionIndex.value];
            e2.select(u2.dataRef.value);
          }
          e2.mode.value === 0 && (e2.closeListbox(), e$1.nextTick(() => {
            var u2;
            return (u2 = o$3(e2.buttonRef)) == null ? undefined : u2.focus({ preventScroll: true });
          }));
          break;
        case u$5(e2.orientation.value, { vertical: o$2.ArrowDown, horizontal: o$2.ArrowRight }):
          return a2.preventDefault(), a2.stopPropagation(), e2.goToOption(c.Next);
        case u$5(e2.orientation.value, { vertical: o$2.ArrowUp, horizontal: o$2.ArrowLeft }):
          return a2.preventDefault(), a2.stopPropagation(), e2.goToOption(c.Previous);
        case o$2.Home:
        case o$2.PageUp:
          return a2.preventDefault(), a2.stopPropagation(), e2.goToOption(c.First);
        case o$2.End:
        case o$2.PageDown:
          return a2.preventDefault(), a2.stopPropagation(), e2.goToOption(c.Last);
        case o$2.Escape:
          a2.preventDefault(), a2.stopPropagation(), e2.closeListbox(), e$1.nextTick(() => {
            var u2;
            return (u2 = o$3(e2.buttonRef)) == null ? undefined : u2.focus({ preventScroll: true });
          });
          break;
        case o$2.Tab:
          a2.preventDefault(), a2.stopPropagation();
          break;
        default:
          a2.key.length === 1 && (e2.search(a2.key), f2.value = setTimeout(() => e2.clearSearch(), 350));
          break;
      }
    }
    let s3 = l(), m = e$1.computed(() => s3 !== null ? (s3.value & i.Open) === i.Open : e2.listboxState.value === 0);
    return () => {
      var y2, L;
      let a2 = { open: e2.listboxState.value === 0 }, { ...u2 } = o2, D = { "aria-activedescendant": e2.activeOptionIndex.value === null || (y2 = e2.options.value[e2.activeOptionIndex.value]) == null ? undefined : y2.id, "aria-multiselectable": e2.mode.value === 1 ? true : undefined, "aria-labelledby": (L = o$3(e2.buttonRef)) == null ? undefined : L.id, "aria-orientation": e2.orientation.value, id: n2, onKeydown: v2, role: "listbox", tabIndex: 0, ref: e2.optionsRef };
      return A$1({ ourProps: D, theirProps: u2, slot: a2, attrs: b2, slots: r2, features: N$1.RenderStrategy | N$1.Static, visible: m.value, name: "ListboxOptions" });
    };
  } }), Fe = e$1.defineComponent({ name: "ListboxOption", props: { as: { type: [Object, String], default: "li" }, value: { type: [Object, String, Number, Boolean] }, disabled: { type: Boolean, default: false }, id: { type: String, default: null } }, setup(o2, { slots: b2, attrs: r2, expose: w2 }) {
    var C2;
    let n2 = (C2 = o2.id) != null ? C2 : `headlessui-listbox-option-${i$4()}`, e2 = A("ListboxOption"), f2 = e$1.ref(null);
    w2({ el: f2, $el: f2 });
    let v2 = e$1.computed(() => e2.activeOptionIndex.value !== null ? e2.options.value[e2.activeOptionIndex.value].id === n2 : false), s3 = e$1.computed(() => u$5(e2.mode.value, { [0]: () => e2.compare(e$1.toRaw(e2.value.value), e$1.toRaw(o2.value)), [1]: () => e$1.toRaw(e2.value.value).some((t2) => e2.compare(e$1.toRaw(t2), e$1.toRaw(o2.value))) })), m = e$1.computed(() => u$5(e2.mode.value, { [1]: () => {
      var i2;
      let t2 = e$1.toRaw(e2.value.value);
      return ((i2 = e2.options.value.find((l2) => t2.some((d2) => e2.compare(e$1.toRaw(d2), e$1.toRaw(l2.dataRef.value))))) == null ? undefined : i2.id) === n2;
    }, [0]: () => s3.value })), p$12 = p(f2), a2 = e$1.computed(() => ({ disabled: o2.disabled, value: o2.value, get textValue() {
      return p$12();
    }, domRef: f2 }));
    e$1.onMounted(() => e2.registerOption(n2, a2)), e$1.onUnmounted(() => e2.unregisterOption(n2)), e$1.onMounted(() => {
      e$1.watch([e2.listboxState, s3], () => {
        e2.listboxState.value === 0 && s3.value && u$5(e2.mode.value, { [1]: () => {
          m.value && e2.goToOption(c.Specific, n2);
        }, [0]: () => {
          e2.goToOption(c.Specific, n2);
        } });
      }, { immediate: true });
    }), e$1.watchEffect(() => {
      e2.listboxState.value === 0 && v2.value && e2.activationTrigger.value !== 0 && e$1.nextTick(() => {
        var t2, i2;
        return (i2 = (t2 = o$3(f2)) == null ? undefined : t2.scrollIntoView) == null ? undefined : i2.call(t2, { block: "nearest" });
      });
    });
    function u2(t2) {
      if (o2.disabled) return t2.preventDefault();
      e2.select(o2.value), e2.mode.value === 0 && (e2.closeListbox(), e$1.nextTick(() => {
        var i2;
        return (i2 = o$3(e2.buttonRef)) == null ? undefined : i2.focus({ preventScroll: true });
      }));
    }
    function D() {
      if (o2.disabled) return e2.goToOption(c.Nothing);
      e2.goToOption(c.Specific, n2);
    }
    let y2 = u$3();
    function L(t2) {
      y2.update(t2);
    }
    function M(t2) {
      y2.wasMoved(t2) && (o2.disabled || v2.value || e2.goToOption(c.Specific, n2, 0));
    }
    function k2(t2) {
      y2.wasMoved(t2) && (o2.disabled || v2.value && e2.goToOption(c.Nothing));
    }
    return () => {
      let { disabled: t2 } = o2, i2 = { active: v2.value, selected: s3.value, disabled: t2 }, { value: l2, disabled: d2, ...O2 } = o2, h2 = { id: n2, ref: f2, role: "option", tabIndex: t2 === true ? undefined : -1, "aria-disabled": t2 === true ? true : undefined, "aria-selected": s3.value, disabled: undefined, onClick: u2, onFocus: D, onPointerenter: L, onMouseenter: L, onPointermove: M, onMousemove: M, onPointerleave: k2, onMouseleave: k2 };
      return A$1({ ourProps: h2, theirProps: O2, slot: i2, attrs: r2, slots: b2, name: "ListboxOption" });
    };
  } });
  let a = Symbol("LabelContext");
  function d() {
    let t2 = e$1.inject(a, null);
    if (t2 === null) {
      let n2 = new Error("You used a <Label /> component, but it is not inside a parent.");
      throw Error.captureStackTrace && Error.captureStackTrace(n2, d), n2;
    }
    return t2;
  }
  function E({ slot: t2 = {}, name: n2 = "Label", props: i2 = {} } = {}) {
    let e2 = e$1.ref([]);
    function o2(r2) {
      return e2.value.push(r2), () => {
        let l2 = e2.value.indexOf(r2);
        l2 !== -1 && e2.value.splice(l2, 1);
      };
    }
    return e$1.provide(a, { register: o2, slot: t2, name: n2, props: i2 }), e$1.computed(() => e2.value.length > 0 ? e2.value.join(" ") : undefined);
  }
  let K = e$1.defineComponent({ name: "Label", props: { as: { type: [Object, String], default: "label" }, passive: { type: [Boolean], default: false }, id: { type: String, default: null } }, setup(t2, { slots: n2, attrs: i2 }) {
    var r2;
    let e2 = (r2 = t2.id) != null ? r2 : `headlessui-label-${i$4()}`, o2 = d();
    return e$1.onMounted(() => e$1.onUnmounted(o2.register(e2))), () => {
      let { name: l2 = "Label", slot: p2 = {}, props: c2 = {} } = o2, { passive: f2, ...s3 } = t2, u2 = { ...Object.entries(c2).reduce((b2, [g2, m]) => Object.assign(b2, { [g2]: e$1.unref(m) }), {}), id: e2 };
      return f2 && (delete u2.onClick, delete u2.htmlFor, delete s3.onClick), A$1({ ourProps: u2, theirProps: s3, slot: p2, attrs: i2, slots: n2, name: l2 });
    };
  } });
  let C = Symbol("GroupContext"), oe = e$1.defineComponent({ name: "SwitchGroup", props: { as: { type: [Object, String], default: "template" } }, setup(l2, { slots: c2, attrs: i2 }) {
    let r2 = e$1.ref(null), f2 = E({ name: "SwitchLabel", props: { htmlFor: e$1.computed(() => {
      var t2;
      return (t2 = r2.value) == null ? undefined : t2.id;
    }), onClick(t2) {
      r2.value && (t2.currentTarget.tagName === "LABEL" && t2.preventDefault(), r2.value.click(), r2.value.focus({ preventScroll: true }));
    } } }), p2 = k$1({ name: "SwitchDescription" });
    return e$1.provide(C, { switchRef: r2, labelledby: f2, describedby: p2 }), () => A$1({ theirProps: l2, ourProps: {}, slot: {}, slots: c2, attrs: i2, name: "SwitchGroup" });
  } }), ue = e$1.defineComponent({ name: "Switch", emits: { "update:modelValue": (l2) => true }, props: { as: { type: [Object, String], default: "button" }, modelValue: { type: Boolean, default: undefined }, defaultChecked: { type: Boolean, optional: true }, form: { type: String, optional: true }, name: { type: String, optional: true }, value: { type: String, optional: true }, id: { type: String, default: null }, disabled: { type: Boolean, default: false }, tabIndex: { type: Number, default: 0 } }, inheritAttrs: false, setup(l2, { emit: c2, attrs: i2, slots: r2, expose: f2 }) {
    var h2;
    let p2 = (h2 = l2.id) != null ? h2 : `headlessui-switch-${i$4()}`, n2 = e$1.inject(C, null), [t2, s$12] = d$2(e$1.computed(() => l2.modelValue), (e2) => c2("update:modelValue", e2), e$1.computed(() => l2.defaultChecked));
    function m() {
      s$12(!t2.value);
    }
    let E2 = e$1.ref(null), o2 = n2 === null ? E2 : n2.switchRef, L = s2(e$1.computed(() => ({ as: l2.as, type: i2.type })), o2);
    f2({ el: o2, $el: o2 });
    function D(e2) {
      e2.preventDefault(), m();
    }
    function R(e2) {
      e2.key === o$2.Space ? (e2.preventDefault(), m()) : e2.key === o$2.Enter && p$1(e2.currentTarget);
    }
    function x(e2) {
      e2.preventDefault();
    }
    let d2 = e$1.computed(() => {
      var e2, a2;
      return (a2 = (e2 = o$3(o2)) == null ? undefined : e2.closest) == null ? undefined : a2.call(e2, "form");
    });
    return e$1.onMounted(() => {
      e$1.watch([d2], () => {
        if (!d2.value || l2.defaultChecked === undefined) return;
        function e2() {
          s$12(l2.defaultChecked);
        }
        return d2.value.addEventListener("reset", e2), () => {
          var a2;
          (a2 = d2.value) == null || a2.removeEventListener("reset", e2);
        };
      }, { immediate: true });
    }), () => {
      let { name: e2, value: a2, form: K2, tabIndex: y2, ...b2 } = l2, T2 = { checked: t2.value }, B = { id: p2, ref: o2, role: "switch", type: L.value, tabIndex: y2 === -1 ? 0 : y2, "aria-checked": t2.value, "aria-labelledby": n2 == null ? undefined : n2.labelledby.value, "aria-describedby": n2 == null ? undefined : n2.describedby.value, onClick: D, onKeyup: R, onKeypress: x };
      return e$1.h(e$1.Fragment, [e2 != null && t2.value != null ? e$1.h(f$2, E$1({ features: u$2.Hidden, as: "input", type: "checkbox", hidden: true, readOnly: true, checked: t2.value, form: K2, disabled: b2.disabled, name: e2, value: a2 })) : null, A$1({ ourProps: B, theirProps: { ...i2, ...T$1(b2, ["modelValue", "defaultChecked"]) }, slot: T2, attrs: i2, slots: r2, name: "Switch" })]);
    };
  } }), de = K;
  function render$2(_ctx, _cache) {
    return e$1.openBlock(), e$1.createElementBlock("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      "aria-hidden": "true",
      "data-slot": "icon"
    }, [
      e$1.createElementVNode("path", {
        "fill-rule": "evenodd",
        d: "M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z",
        "clip-rule": "evenodd"
      })
    ]);
  }
  function render$1(_ctx, _cache) {
    return e$1.openBlock(), e$1.createElementBlock("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      "aria-hidden": "true",
      "data-slot": "icon"
    }, [
      e$1.createElementVNode("path", {
        "fill-rule": "evenodd",
        d: "M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z",
        "clip-rule": "evenodd"
      })
    ]);
  }
  function render(_ctx, _cache) {
    return e$1.openBlock(), e$1.createElementBlock("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      fill: "currentColor",
      "aria-hidden": "true",
      "data-slot": "icon"
    }, [
      e$1.createElementVNode("path", {
        "fill-rule": "evenodd",
        d: "M10.53 3.47a.75.75 0 0 0-1.06 0L6.22 6.72a.75.75 0 0 0 1.06 1.06L10 5.06l2.72 2.72a.75.75 0 1 0 1.06-1.06l-3.25-3.25Zm-4.31 9.81 3.25 3.25a.75.75 0 0 0 1.06 0l3.25-3.25a.75.75 0 1 0-1.06-1.06L10 14.94l-2.72-2.72a.75.75 0 0 0-1.06 1.06Z",
        "clip-rule": "evenodd"
      })
    ]);
  }
  const _hoisted_1$b = { class: "mt-2.5 h-auto w-full px-3.5 text-base font-bold text-[#c6c6c6]" };
  const _hoisted_2$a = {
    key: 0,
    class: "absolute right-20 inline-block rounded-xl bg-[#ff9000] px-2 text-sm text-black"
  };
  const _sfc_main$c = /* @__PURE__ */ e$1.defineComponent({
    __name: "DisclosureComp",
    props: {
      title: {},
      isFold: { type: Boolean },
      isSpecial: { type: Boolean },
      specialName: {}
    },
    setup(__props) {
      return (_ctx, _cache) => {
        return e$1.openBlock(), e$1.createElementBlock("div", _hoisted_1$b, [
          e$1.createVNode(e$1.unref(N), {
            "default-open": !_ctx.isFold
          }, {
            default: e$1.withCtx(({ open }) => [
              e$1.createVNode(e$1.unref(Q), {
                class: e$1.normalizeClass(["flex min-h-12 w-full justify-between rounded-xl p-3.5 text-left outline-none", {
                  "bg-[#1b1b1b] hover:bg-[#292929]": !_ctx.isSpecial,
                  "bg-[#1f1f1f] hover:bg-[#2D2D2D]": _ctx.isSpecial,
                  "rounded-b-none": open
                }])
              }, {
                default: e$1.withCtx(() => [
                  e$1.createElementVNode("span", null, e$1.toDisplayString(_ctx.title || "Disclosure Title"), 1),
                  _ctx.isSpecial ? (e$1.openBlock(), e$1.createElementBlock("span", _hoisted_2$a, e$1.toDisplayString(_ctx.specialName ? _ctx.specialName : "SPECIAL"), 1)) : e$1.createCommentVNode("", true),
                  e$1.createVNode(e$1.unref(render$1), {
                    class: e$1.normalizeClass([{
                      "rotate-180": open
                    }, "h-6 w-6"])
                  }, null, 8, ["class"])
                ]),
                _: 2
              }, 1032, ["class"]),
              e$1.createVNode(e$1.unref(V), {
                unmount: false,
                class: "rounded-b-xl bg-[#1e1e1e80] pb-2 pt-1"
              }, {
                default: e$1.withCtx(() => [
                  e$1.renderSlot(_ctx.$slots, "default")
                ]),
                _: 3
              })
            ]),
            _: 3
          }, 8, ["default-open"])
        ]);
      };
    }
  });
  const PGStorage = {
    get: (key, defaultValue) => {
      return _GM_getValue(`PGS_${key}`, defaultValue);
    },
    set: (key, value) => {
      _GM_setValue(`PGS_${key}`, value);
    }
  };
  ({
    enableDebugRules: !!PGStorage.get("debug-rules")
  });
  const startTime = performance.now();
  let lastTime = startTime;
  let currTime = startTime;
  const wrapper = (loggingFunc, isEnable) => {
    {
      return (...innerArgs) => {
        currTime = performance.now();
        const during = (currTime - lastTime).toFixed(1);
        loggingFunc(`[老司机] ${during} / ${currTime.toFixed(0)} ms |`, ...innerArgs);
        lastTime = currTime;
      };
    }
  };
  const log = wrapper(console.log);
  const error = wrapper(console.error);
  const waitForEle = async (watchEle, selector, isTargetNode) => {
    let ele = watchEle.querySelector(selector);
    if (ele) {
      return ele;
    }
    return await new Promise((resolve) => {
      const observer = new MutationObserver((mutationList) => {
        mutationList.forEach((mutation) => {
          if (mutation.addedNodes) {
            mutation.addedNodes.forEach((node) => {
              if (isTargetNode(node)) {
                observer.disconnect();
                ele = watchEle.querySelector(selector);
                resolve(ele);
              }
            });
          }
        });
      });
      observer.observe(watchEle, { childList: true, subtree: true });
    });
  };
  const orderedUniq = (arr) => {
    return Array.from(new Set(arr));
  };
  function tryOnScopeDispose(fn) {
    if (e$1.getCurrentScope()) {
      e$1.onScopeDispose(fn);
      return true;
    }
    return false;
  }
  function toValue(r2) {
    return typeof r2 === "function" ? r2() : e$1.unref(r2);
  }
  const isClient = typeof window !== "undefined" && typeof document !== "undefined";
  typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope;
  const notNullish = (val) => val != null;
  const toString = Object.prototype.toString;
  const isObject = (val) => toString.call(val) === "[object Object]";
  const noop = () => {
  };
  function createFilterWrapper(filter, fn) {
    function wrapper2(...args) {
      return new Promise((resolve, reject) => {
        Promise.resolve(filter(() => fn.apply(this, args), { fn, thisArg: this, args })).then(resolve).catch(reject);
      });
    }
    return wrapper2;
  }
  const bypassFilter = (invoke2) => {
    return invoke2();
  };
  function throttleFilter(...args) {
    let lastExec = 0;
    let timer;
    let isLeading = true;
    let lastRejector = noop;
    let lastValue;
    let ms;
    let trailing;
    let leading;
    let rejectOnCancel;
    if (!e$1.isRef(args[0]) && typeof args[0] === "object")
      ({ delay: ms, trailing = true, leading = true, rejectOnCancel = false } = args[0]);
    else
      [ms, trailing = true, leading = true, rejectOnCancel = false] = args;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        lastRejector();
        lastRejector = noop;
      }
    };
    const filter = (_invoke) => {
      const duration = toValue(ms);
      const elapsed = Date.now() - lastExec;
      const invoke2 = () => {
        return lastValue = _invoke();
      };
      clear();
      if (duration <= 0) {
        lastExec = Date.now();
        return invoke2();
      }
      if (elapsed > duration && (leading || !isLeading)) {
        lastExec = Date.now();
        invoke2();
      } else if (trailing) {
        lastValue = new Promise((resolve, reject) => {
          lastRejector = rejectOnCancel ? reject : resolve;
          timer = setTimeout(() => {
            lastExec = Date.now();
            isLeading = true;
            resolve(invoke2());
            clear();
          }, Math.max(0, duration - elapsed));
        });
      }
      if (!leading && !timer)
        timer = setTimeout(() => isLeading = true, duration);
      isLeading = false;
      return lastValue;
    };
    return filter;
  }
  function pausableFilter(extendFilter = bypassFilter) {
    const isActive = e$1.ref(true);
    function pause() {
      isActive.value = false;
    }
    function resume() {
      isActive.value = true;
    }
    const eventFilter = (...args) => {
      if (isActive.value)
        extendFilter(...args);
    };
    return { isActive: e$1.readonly(isActive), pause, resume, eventFilter };
  }
  function getLifeCycleTarget(target) {
    return e$1.getCurrentInstance();
  }
  function watchWithFilter(source, cb, options = {}) {
    const {
      eventFilter = bypassFilter,
      ...watchOptions
    } = options;
    return e$1.watch(
      source,
      createFilterWrapper(
        eventFilter,
        cb
      ),
      watchOptions
    );
  }
  function watchPausable(source, cb, options = {}) {
    const {
      eventFilter: filter,
      ...watchOptions
    } = options;
    const { eventFilter, pause, resume, isActive } = pausableFilter(filter);
    const stop = watchWithFilter(
      source,
      cb,
      {
        ...watchOptions,
        eventFilter
      }
    );
    return { stop, pause, resume, isActive };
  }
  function toRefs(objectRef, options = {}) {
    if (!e$1.isRef(objectRef))
      return e$1.toRefs(objectRef);
    const result = Array.isArray(objectRef.value) ? Array.from({ length: objectRef.value.length }) : {};
    for (const key in objectRef.value) {
      result[key] = e$1.customRef(() => ({
        get() {
          return objectRef.value[key];
        },
        set(v2) {
          var _a;
          const replaceRef = (_a = toValue(options.replaceRef)) != null ? _a : true;
          if (replaceRef) {
            if (Array.isArray(objectRef.value)) {
              const copy = [...objectRef.value];
              copy[key] = v2;
              objectRef.value = copy;
            } else {
              const newObject = { ...objectRef.value, [key]: v2 };
              Object.setPrototypeOf(newObject, Object.getPrototypeOf(objectRef.value));
              objectRef.value = newObject;
            }
          } else {
            objectRef.value[key] = v2;
          }
        }
      }));
    }
    return result;
  }
  function tryOnMounted(fn, sync = true, target) {
    const instance = getLifeCycleTarget();
    if (instance)
      e$1.onMounted(fn, target);
    else if (sync)
      fn();
    else
      e$1.nextTick(fn);
  }
  function watchThrottled(source, cb, options = {}) {
    const {
      throttle = 0,
      trailing = true,
      leading = true,
      ...watchOptions
    } = options;
    return watchWithFilter(
      source,
      cb,
      {
        ...watchOptions,
        eventFilter: throttleFilter(throttle, trailing, leading)
      }
    );
  }
  const defaultWindow = isClient ? window : undefined;
  function unrefElement(elRef) {
    var _a;
    const plain = toValue(elRef);
    return (_a = plain == null ? undefined : plain.$el) != null ? _a : plain;
  }
  function useEventListener(...args) {
    let target;
    let events2;
    let listeners;
    let options;
    if (typeof args[0] === "string" || Array.isArray(args[0])) {
      [events2, listeners, options] = args;
      target = defaultWindow;
    } else {
      [target, events2, listeners, options] = args;
    }
    if (!target)
      return noop;
    if (!Array.isArray(events2))
      events2 = [events2];
    if (!Array.isArray(listeners))
      listeners = [listeners];
    const cleanups = [];
    const cleanup = () => {
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
    };
    const register = (el, event, listener, options2) => {
      el.addEventListener(event, listener, options2);
      return () => el.removeEventListener(event, listener, options2);
    };
    const stopWatch = e$1.watch(
      () => [unrefElement(target), toValue(options)],
      ([el, options2]) => {
        cleanup();
        if (!el)
          return;
        const optionsClone = isObject(options2) ? { ...options2 } : options2;
        cleanups.push(
          ...events2.flatMap((event) => {
            return listeners.map((listener) => register(el, event, listener, optionsClone));
          })
        );
      },
      { immediate: true, flush: "post" }
    );
    const stop = () => {
      stopWatch();
      cleanup();
    };
    tryOnScopeDispose(stop);
    return stop;
  }
  function useMounted() {
    const isMounted = e$1.ref(false);
    const instance = e$1.getCurrentInstance();
    if (instance) {
      e$1.onMounted(() => {
        isMounted.value = true;
      }, instance);
    }
    return isMounted;
  }
  function useSupported(callback) {
    const isMounted = useMounted();
    return e$1.computed(() => {
      isMounted.value;
      return Boolean(callback());
    });
  }
  function useMutationObserver(target, callback, options = {}) {
    const { window: window2 = defaultWindow, ...mutationOptions } = options;
    let observer;
    const isSupported = useSupported(() => window2 && "MutationObserver" in window2);
    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = undefined;
      }
    };
    const targets = e$1.computed(() => {
      const value = toValue(target);
      const items = (Array.isArray(value) ? value : [value]).map(unrefElement).filter(notNullish);
      return new Set(items);
    });
    const stopWatch = e$1.watch(
      () => targets.value,
      (targets2) => {
        cleanup();
        if (isSupported.value && targets2.size) {
          observer = new MutationObserver(callback);
          targets2.forEach((el) => observer.observe(el, mutationOptions));
        }
      },
      { immediate: true, flush: "post" }
    );
    const takeRecords = () => {
      return observer == null ? undefined : observer.takeRecords();
    };
    const stop = () => {
      stopWatch();
      cleanup();
    };
    tryOnScopeDispose(stop);
    return {
      isSupported,
      stop,
      takeRecords
    };
  }
  function useMediaQuery(query, options = {}) {
    const { window: window2 = defaultWindow } = options;
    const isSupported = useSupported(() => window2 && "matchMedia" in window2 && typeof window2.matchMedia === "function");
    let mediaQuery;
    const matches = e$1.ref(false);
    const handler = (event) => {
      matches.value = event.matches;
    };
    const cleanup = () => {
      if (!mediaQuery)
        return;
      if ("removeEventListener" in mediaQuery)
        mediaQuery.removeEventListener("change", handler);
      else
        mediaQuery.removeListener(handler);
    };
    const stopWatch = e$1.watchEffect(() => {
      if (!isSupported.value)
        return;
      cleanup();
      mediaQuery = window2.matchMedia(toValue(query));
      if ("addEventListener" in mediaQuery)
        mediaQuery.addEventListener("change", handler);
      else
        mediaQuery.addListener(handler);
      matches.value = mediaQuery.matches;
    });
    tryOnScopeDispose(() => {
      stopWatch();
      cleanup();
      mediaQuery = undefined;
    });
    return matches;
  }
  const _global = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
  const globalKey = "__vueuse_ssr_handlers__";
  const handlers = /* @__PURE__ */ getHandlers();
  function getHandlers() {
    if (!(globalKey in _global))
      _global[globalKey] = _global[globalKey] || {};
    return _global[globalKey];
  }
  function getSSRHandler(key, fallback) {
    return handlers[key] || fallback;
  }
  function guessSerializerType(rawInit) {
    return rawInit == null ? "any" : rawInit instanceof Set ? "set" : rawInit instanceof Map ? "map" : rawInit instanceof Date ? "date" : typeof rawInit === "boolean" ? "boolean" : typeof rawInit === "string" ? "string" : typeof rawInit === "object" ? "object" : !Number.isNaN(rawInit) ? "number" : "any";
  }
  const StorageSerializers = {
    boolean: {
      read: (v2) => v2 === "true",
      write: (v2) => String(v2)
    },
    object: {
      read: (v2) => JSON.parse(v2),
      write: (v2) => JSON.stringify(v2)
    },
    number: {
      read: (v2) => Number.parseFloat(v2),
      write: (v2) => String(v2)
    },
    any: {
      read: (v2) => v2,
      write: (v2) => String(v2)
    },
    string: {
      read: (v2) => v2,
      write: (v2) => String(v2)
    },
    map: {
      read: (v2) => new Map(JSON.parse(v2)),
      write: (v2) => JSON.stringify(Array.from(v2.entries()))
    },
    set: {
      read: (v2) => new Set(JSON.parse(v2)),
      write: (v2) => JSON.stringify(Array.from(v2))
    },
    date: {
      read: (v2) => new Date(v2),
      write: (v2) => v2.toISOString()
    }
  };
  const customStorageEventName = "vueuse-storage";
  function useStorage(key, defaults2, storage, options = {}) {
    var _a;
    const {
      flush = "pre",
      deep = true,
      listenToStorageChanges = true,
      writeDefaults = true,
      mergeDefaults = false,
      shallow,
      window: window2 = defaultWindow,
      eventFilter,
      onError = (e2) => {
        console.error(e2);
      },
      initOnMounted
    } = options;
    const data = (shallow ? e$1.shallowRef : e$1.ref)(typeof defaults2 === "function" ? defaults2() : defaults2);
    if (!storage) {
      try {
        storage = getSSRHandler("getDefaultStorage", () => {
          var _a2;
          return (_a2 = defaultWindow) == null ? void 0 : _a2.localStorage;
        })();
      } catch (e2) {
        onError(e2);
      }
    }
    if (!storage)
      return data;
    const rawInit = toValue(defaults2);
    const type = guessSerializerType(rawInit);
    const serializer = (_a = options.serializer) != null ? _a : StorageSerializers[type];
    const { pause: pauseWatch, resume: resumeWatch } = watchPausable(
      data,
      () => write(data.value),
      { flush, deep, eventFilter }
    );
    if (window2 && listenToStorageChanges) {
      tryOnMounted(() => {
        if (storage instanceof Storage)
          useEventListener(window2, "storage", update);
        else
          useEventListener(window2, customStorageEventName, updateFromCustomEvent);
        if (initOnMounted)
          update();
      });
    }
    if (!initOnMounted)
      update();
    function dispatchWriteEvent(oldValue, newValue) {
      if (window2) {
        const payload = {
          key,
          oldValue,
          newValue,
          storageArea: storage
        };
        window2.dispatchEvent(storage instanceof Storage ? new StorageEvent("storage", payload) : new CustomEvent(customStorageEventName, {
          detail: payload
        }));
      }
    }
    function write(v2) {
      try {
        const oldValue = storage.getItem(key);
        if (v2 == null) {
          dispatchWriteEvent(oldValue, null);
          storage.removeItem(key);
        } else {
          const serialized = serializer.write(v2);
          if (oldValue !== serialized) {
            storage.setItem(key, serialized);
            dispatchWriteEvent(oldValue, serialized);
          }
        }
      } catch (e2) {
        onError(e2);
      }
    }
    function read(event) {
      const rawValue = event ? event.newValue : storage.getItem(key);
      if (rawValue == null) {
        if (writeDefaults && rawInit != null)
          storage.setItem(key, serializer.write(rawInit));
        return rawInit;
      } else if (!event && mergeDefaults) {
        const value = serializer.read(rawValue);
        if (typeof mergeDefaults === "function")
          return mergeDefaults(value, rawInit);
        else if (type === "object" && !Array.isArray(value))
          return { ...rawInit, ...value };
        return value;
      } else if (typeof rawValue !== "string") {
        return rawValue;
      } else {
        return serializer.read(rawValue);
      }
    }
    function update(event) {
      if (event && event.storageArea !== storage)
        return;
      if (event && event.key == null) {
        data.value = rawInit;
        return;
      }
      if (event && event.key !== key)
        return;
      pauseWatch();
      try {
        if ((event == null ? void 0 : event.newValue) !== serializer.write(data.value))
          data.value = read(event);
      } catch (e2) {
        onError(e2);
      } finally {
        if (event)
          e$1.nextTick(resumeWatch);
        else
          resumeWatch();
      }
    }
    function updateFromCustomEvent(event) {
      update(event.detail);
    }
    return data;
  }
  function useDraggable(target, options = {}) {
    var _a, _b;
    const {
      pointerTypes,
      preventDefault: preventDefault2,
      stopPropagation,
      exact,
      onMove,
      onEnd,
      onStart,
      initialValue,
      axis = "both",
      draggingElement = defaultWindow,
      containerElement,
      handle: draggingHandle = target,
      buttons = [0]
    } = options;
    const position = e$1.ref(
      (_a = toValue(initialValue)) != null ? _a : { x: 0, y: 0 }
    );
    const pressedDelta = e$1.ref();
    const filterEvent = (e2) => {
      if (pointerTypes)
        return pointerTypes.includes(e2.pointerType);
      return true;
    };
    const handleEvent = (e2) => {
      if (toValue(preventDefault2))
        e2.preventDefault();
      if (toValue(stopPropagation))
        e2.stopPropagation();
    };
    const start = (e2) => {
      var _a2;
      if (!toValue(buttons).includes(e2.button))
        return;
      if (toValue(options.disabled) || !filterEvent(e2))
        return;
      if (toValue(exact) && e2.target !== toValue(target))
        return;
      const container = toValue(containerElement);
      const containerRect = (_a2 = container == null ? undefined : container.getBoundingClientRect) == null ? undefined : _a2.call(container);
      const targetRect = toValue(target).getBoundingClientRect();
      const pos = {
        x: e2.clientX - (container ? targetRect.left - containerRect.left + container.scrollLeft : targetRect.left),
        y: e2.clientY - (container ? targetRect.top - containerRect.top + container.scrollTop : targetRect.top)
      };
      if ((onStart == null ? undefined : onStart(pos, e2)) === false)
        return;
      pressedDelta.value = pos;
      handleEvent(e2);
    };
    const move = (e2) => {
      if (toValue(options.disabled) || !filterEvent(e2))
        return;
      if (!pressedDelta.value)
        return;
      const container = toValue(containerElement);
      const targetRect = toValue(target).getBoundingClientRect();
      let { x, y: y2 } = position.value;
      if (axis === "x" || axis === "both") {
        x = e2.clientX - pressedDelta.value.x;
        if (container)
          x = Math.min(Math.max(0, x), container.scrollWidth - targetRect.width);
      }
      if (axis === "y" || axis === "both") {
        y2 = e2.clientY - pressedDelta.value.y;
        if (container)
          y2 = Math.min(Math.max(0, y2), container.scrollHeight - targetRect.height);
      }
      position.value = {
        x,
        y: y2
      };
      onMove == null ? undefined : onMove(position.value, e2);
      handleEvent(e2);
    };
    const end = (e2) => {
      if (toValue(options.disabled) || !filterEvent(e2))
        return;
      if (!pressedDelta.value)
        return;
      pressedDelta.value = undefined;
      onEnd == null ? undefined : onEnd(position.value, e2);
      handleEvent(e2);
    };
    if (isClient) {
      const config = { capture: (_b = options.capture) != null ? _b : true };
      useEventListener(draggingHandle, "pointerdown", start, config);
      useEventListener(draggingElement, "pointermove", move, config);
      useEventListener(draggingElement, "pointerup", end, config);
    }
    return {
      ...toRefs(position),
      position,
      isDragging: e$1.computed(() => !!pressedDelta.value),
      style: e$1.computed(
        () => `left:${position.value.x}px;top:${position.value.y}px;`
      )
    };
  }
  function useResizeObserver(target, callback, options = {}) {
    const { window: window2 = defaultWindow, ...observerOptions } = options;
    let observer;
    const isSupported = useSupported(() => window2 && "ResizeObserver" in window2);
    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = undefined;
      }
    };
    const targets = e$1.computed(() => {
      const _targets = toValue(target);
      return Array.isArray(_targets) ? _targets.map((el) => unrefElement(el)) : [unrefElement(_targets)];
    });
    const stopWatch = e$1.watch(
      targets,
      (els) => {
        cleanup();
        if (isSupported.value && window2) {
          observer = new ResizeObserver(callback);
          for (const _el of els) {
            if (_el)
              observer.observe(_el, observerOptions);
          }
        }
      },
      { immediate: true, flush: "post" }
    );
    const stop = () => {
      cleanup();
      stopWatch();
    };
    tryOnScopeDispose(stop);
    return {
      isSupported,
      stop
    };
  }
  function useElementBounding(target, options = {}) {
    const {
      reset = true,
      windowResize = true,
      windowScroll = true,
      immediate = true,
      updateTiming = "sync"
    } = options;
    const height = e$1.ref(0);
    const bottom = e$1.ref(0);
    const left = e$1.ref(0);
    const right = e$1.ref(0);
    const top2 = e$1.ref(0);
    const width = e$1.ref(0);
    const x = e$1.ref(0);
    const y2 = e$1.ref(0);
    function recalculate() {
      const el = unrefElement(target);
      if (!el) {
        if (reset) {
          height.value = 0;
          bottom.value = 0;
          left.value = 0;
          right.value = 0;
          top2.value = 0;
          width.value = 0;
          x.value = 0;
          y2.value = 0;
        }
        return;
      }
      const rect = el.getBoundingClientRect();
      height.value = rect.height;
      bottom.value = rect.bottom;
      left.value = rect.left;
      right.value = rect.right;
      top2.value = rect.top;
      width.value = rect.width;
      x.value = rect.x;
      y2.value = rect.y;
    }
    function update() {
      if (updateTiming === "sync")
        recalculate();
      else if (updateTiming === "next-frame")
        requestAnimationFrame(() => recalculate());
    }
    useResizeObserver(target, update);
    e$1.watch(() => unrefElement(target), (ele) => !ele && update());
    useMutationObserver(target, update, {
      attributeFilter: ["style", "class"]
    });
    if (windowScroll)
      useEventListener("scroll", update, { capture: true, passive: true });
    if (windowResize)
      useEventListener("resize", update, { passive: true });
    tryOnMounted(() => {
      if (immediate)
        update();
    });
    return {
      height,
      bottom,
      left,
      right,
      top: top2,
      width,
      x,
      y: y2,
      update
    };
  }
  function useWindowSize(options = {}) {
    const {
      window: window2 = defaultWindow,
      initialWidth = Number.POSITIVE_INFINITY,
      initialHeight = Number.POSITIVE_INFINITY,
      listenOrientation = true,
      includeScrollbar = true,
      type = "inner"
    } = options;
    const width = e$1.ref(initialWidth);
    const height = e$1.ref(initialHeight);
    const update = () => {
      if (window2) {
        if (type === "outer") {
          width.value = window2.outerWidth;
          height.value = window2.outerHeight;
        } else if (includeScrollbar) {
          width.value = window2.innerWidth;
          height.value = window2.innerHeight;
        } else {
          width.value = window2.document.documentElement.clientWidth;
          height.value = window2.document.documentElement.clientHeight;
        }
      }
    };
    update();
    tryOnMounted(update);
    useEventListener("resize", update, { passive: true });
    if (listenOrientation) {
      const matches = useMediaQuery("(orientation: portrait)");
      e$1.watch(matches, () => update());
    }
    return { width, height };
  }
  const _hoisted_1$a = { class: "font-serif text-xl text-white" };
  const _hoisted_2$9 = { class: "mb-2 text-xl font-semibold" };
  const _hoisted_3$4 = { class: "text-white" };
  const _hoisted_4$4 = { class: "rounded-md bg-[#ff9000] p-1 text-black" };
  const _hoisted_5$2 = { class: "no-scrollbar flex min-h-[calc(100%-2.5rem)] flex-1 flex-col p-2" };
  const _sfc_main$b = /* @__PURE__ */ e$1.defineComponent({
    __name: "PanelComp",
    props: {
      title: {},
      widthPercent: {},
      heightPercent: {},
      minWidth: {},
      minHeight: {}
    },
    emits: ["close"],
    setup(__props, { emit: __emit }) {
      const emit = __emit;
      const props = __props;
      const panel = e$1.ref(null);
      const bar = e$1.ref(null);
      const windowSize = useWindowSize({ includeScrollbar: false });
      const { width, height } = useElementBounding(bar, { windowScroll: false });
      const maxPos = e$1.computed(() => {
        return {
          x: windowSize.width.value - width.value,
          y: windowSize.height.value - height.value
        };
      });
      let rAF = 0;
      const { style } = useDraggable(panel, {
        initialValue: {
          x: windowSize.width.value / 2 - Math.max(windowSize.width.value * props.widthPercent / 100, props.minWidth) / 2,
          y: windowSize.height.value / 2 - Math.max(windowSize.height.value * props.heightPercent / 100, props.minHeight) / 2
        },
        handle: e$1.computed(() => bar.value),
        preventDefault: true,
        // 限制拖拽范围
        onMove: (pos) => {
          cancelAnimationFrame(rAF);
          rAF = requestAnimationFrame(() => {
            if (pos.x < 0) {
              pos.x = 0;
            }
            if (pos.y < 0) {
              pos.y = 0;
            }
            if (pos.x > maxPos.value.x) {
              pos.x = maxPos.value.x;
            }
            if (pos.y > maxPos.value.y) {
              pos.y = maxPos.value.y;
            }
          });
        }
      });
      const panelStyle = e$1.computed(() => {
        return {
          width: props.widthPercent + "vw",
          height: props.heightPercent + "vh",
          minWidth: props.minWidth + "px",
          minHeight: props.minHeight + "px"
        };
      });
      return (_ctx, _cache) => {
        return e$1.openBlock(), e$1.createElementBlock("div", {
          ref_key: "panel",
          ref: panel,
          style: e$1.normalizeStyle([panelStyle.value, e$1.unref(style)]),
          class: "no-scrollbar fixed z-[10000000] select-none overflow-auto overscroll-none rounded-xl bg-black shadow-lg will-change-[top,left]"
        }, [
          e$1.createElementVNode("div", {
            ref_key: "bar",
            ref: bar,
            class: "sticky top-0 z-10 w-full cursor-move bg-[#0e0e0e] py-1.5 text-center"
          }, [
            e$1.createElementVNode("div", _hoisted_1$a, [
              e$1.createElementVNode("h3", _hoisted_2$9, [
                e$1.createElementVNode("span", _hoisted_3$4, e$1.toDisplayString(_ctx.title.split("&")[0]), 1),
                e$1.createElementVNode("span", _hoisted_4$4, e$1.toDisplayString(_ctx.title.split("&")[1]), 1)
              ])
            ]),
            e$1.createElementVNode("i", {
              class: "absolute right-0 top-0 m-1 cursor-pointer text-[#c6c6c6] hover:text-white",
              onClick: _cache[0] || (_cache[0] = ($event) => emit("close"))
            }, _cache[1] || (_cache[1] = [
              e$1.createElementVNode("svg", {
                xmlns: "http://www.w3.org/2000/svg",
                fill: "none",
                viewBox: "0 0 24 24",
                "stroke-width": "2.5",
                stroke: "currentColor",
                class: "size-8"
              }, [
                e$1.createElementVNode("path", {
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  d: "M6 18 18 6M6 6l12 12"
                })
              ], -1)
            ]))
          ], 512),
          e$1.createElementVNode("div", _hoisted_5$2, [
            e$1.renderSlot(_ctx.$slots, "default")
          ])
        ], 4);
      };
    }
  });
  const _hoisted_1$9 = {
    key: 0,
    class: "mb-1.5"
  };
  const _hoisted_2$8 = { class: "text-sm leading-6 text-[#767676]" };
  const _sfc_main$a = /* @__PURE__ */ e$1.defineComponent({
    __name: "DescriptionComp",
    props: {
      description: {}
    },
    setup(__props) {
      return (_ctx, _cache) => {
        var _a;
        return ((_a = _ctx.description) == null ? undefined : _a.length) ? (e$1.openBlock(), e$1.createElementBlock("div", _hoisted_1$9, [
          e$1.createElementVNode("div", _hoisted_2$8, [
            (e$1.openBlock(true), e$1.createElementBlock(e$1.Fragment, null, e$1.renderList(_ctx.description, (line, index) => {
              return e$1.openBlock(), e$1.createElementBlock("div", { key: index }, [
                e$1.createElementVNode("p", null, [
                  _cache[0] || (_cache[0] = e$1.createElementVNode("span", { class: "mr-1" }, "•", -1)),
                  e$1.createTextVNode(e$1.toDisplayString(line), 1)
                ])
              ]);
            }), 128))
          ])
        ])) : e$1.createCommentVNode("", true);
      };
    }
  });
  const language$1 = {
    title: "老司机&修炼手册",
    menu: "快捷&菜单",
    panel: "显示/隐藏 面板",
    side_btn: "显示/隐藏 快捷键",
    basic_settings: "全局 - 基本设置",
    language: "language",
    language_description: [
      "刷新页面生效",
      "刷新頁面生效",
      "Refresh the page to take effect",
      "ページをリフレッシュして有効になります",
      "페이지를 새로고침하여 적용됩니다"
    ],
    editorBtn: "编辑",
    editorPlaceholder: "请输入内容....",
    editorSaveBtn: "保存",
    editorCloseBtn: "关闭",
    missav: {
      common: {
        basic: {
          name: "全站通用 - 基本功能",
          remove_ads: "移除 广告",
          hide_footer: "隐藏 页底footer",
          hide_new_site_banner: "隐藏 新站复活横幅",
          redirect_new_url: "重定向 到新站点",
          auto_login_email_password: "编辑 账号信息",
          auto_login_email_password_description: ["自动登录所用账号信息"],
          auto_login_email_password_editorTitle: "账号&信息",
          auto_login_email_password_editorDescription: [
            "格式如下:",
            "第一行email, 第二行password"
          ],
          auto_login: "自动 登录"
        },
        header: {
          name: "全站通用 - 顶栏",
          hide_logo: "隐藏 LOGO",
          hide_live_cam_sex: "隐藏 色色主播(广告)",
          hide_comic: "隐藏 无广告免费漫画(广告)",
          hide_subtitle: "隐藏 中文字幕",
          hide_watch_jav: "隐藏 观看日本AV",
          hide_amateur: "隐藏 素人",
          hide_uncensored: "隐藏 无码影片",
          hide_asia_av: "隐藏 国产AV",
          hide_my_collection: "隐藏 我的收藏",
          hide_upgrade_vip: "隐藏 升级VIP",
          hide_upgrade_vip_description: [
            "PC端(宽屏)在我的收藏中",
            "移动端(窄屏)在选单中"
          ],
          hide_more_sites: "隐藏 更多好站(广告)",
          hide_tg: "隐藏 官方电报群(广告)",
          hide_search: "隐藏 搜寻",
          hide_locale_switcher: "隐藏 切换语言",
          hide_site_live: "隐藏 地址发布",
          hide_site_live_description: ["仅在移动端(窄屏)选单中"],
          hide_mobile_right_menu: "隐藏 选单",
          hide_mobile_right_menu_description: [
            "仅移动端(窄屏)显示选单按钮"
          ]
        }
      },
      home: {
        basic: {
          name: "主页 - 基本功能",
          blur_video_image: "模糊 视频图片",
          blur_video_image_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          blur_video_title: "模糊 视频标题",
          blur_video_title_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          hide_search_title: "隐藏 搜索框上方文字",
          hide_search_box: "隐藏 搜索框",
          hide_search_history: "隐藏 搜索历史",
          hide_video_genres: "隐藏 视频类型",
          hide_video_genres_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          hide_video_duration: "隐藏 视频时长",
          hide_video_duration_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          revert_full_title: "显示 完整标题",
          revert_full_title_description: [
            "同步生效：首页、搜索页、视频页"
          ]
        },
        video: {
          name: "主页 - 视频功能",
          recommended_video_load_more: "加载 更多推荐视频",
          recommended_video_quantity_load_number: "自定义 推荐视频数量"
        }
      },
      search: {
        basic: { name: "搜索页 - 基本功能" }
      },
      video: {
        basic: {
          name: "播放页 - 基本功能",
          auto_switch_uncensored: "自动 切换无码",
          auto_switch_uncensored_description: [
            "仅在打开普通视频时生效",
            "查找并自动切换"
          ]
        },
        player: {
          name: "播放页 - 播放器",
          hide_new_site_banner: "隐藏 新域名通知",
          auto_quality: "自动 最高画质",
          speed: "修改 播放速度(-1 禁用)",
          speed_addonText: "倍",
          volume: "修改 播放音量(-1 禁用)",
          volume_addonText: "%",
          hide_play_btn: "隐藏 大播放键",
          hide_play_btn_description: ["视频暂停时显示"],
          cancel_focus_stop: "取消 失去焦点自动暂停",
          hook_open_window: "拦截 播放时打开窗口"
        },
        playerContorl: {
          name: "播放页 - 播放控制栏",
          hide_prev: "隐藏 快退按钮",
          hide_play: "隐藏 播放/暂停按钮",
          hide_next: "隐藏 快进按钮",
          hide_progress: "隐藏 进度条",
          hide_subtitle: "隐藏 字幕按钮",
          hide_volume: "隐藏 音量按钮",
          hide_setting: "隐藏 视频设置按钮",
          hide_pip: "隐藏 画中画按钮",
          hide_full: "隐藏 全屏按钮",
          hide_jump: "隐藏 快进控制栏",
          hide_jump_description: ["仅移动端(窄屏)显示"],
          hide_loop: "隐藏 循环播放控制栏"
        },
        toolbar: {
          name: "播放页 - 视频下方",
          hide_save: "隐藏 收藏",
          hide_playlist: "隐藏 片单",
          hide_download: "隐藏 下载",
          hide_share: "隐藏 分享",
          show_m3u8: "获取 M3U8",
          show_m3u8_description: ["截取并显示m3u8, 可使用其他播放器播放"],
          auto_show_more: "展开 显示更多"
        }
      }
    },
    jabletv: {
      common: {
        basic: {
          name: "全站通用 - 基本功能",
          remove_ads: "移除 广告",
          hide_footer: "隐藏 页底footer"
        },
        header: {
          name: "全站通用 - 顶栏",
          hide_logo: "隐藏 LOGO",
          hide_new: "隐藏 新作",
          hide_blu_ray: "隐藏 藍光無碼(广告)",
          hide_live_sex: "隐藏 成人直播(广告)",
          hide_best_porns: "隐藏 色網大全(广告)",
          hide_more_sites: "隐藏 更多好站(广告)",
          hide_sex_chat: "隐藏 裸聊(广告)",
          hide_javhd: "隐藏 無修正動画(广告)",
          hide_search: "隐藏 搜索",
          hide_lang: "隐藏 语言",
          hide_settings: "隐藏 头像(登入/设置)"
        }
      },
      home: {
        basic: {
          name: "主页 - 基本功能",
          blur_video_image: "模糊 视频图片",
          blur_video_image_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          blur_video_title: "模糊 视频标题",
          blur_video_title_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          hide_video_like: "隐藏 视频点赞",
          hide_video_like_description: ["同步生效：首页、搜索页、视频页"],
          hide_video_duration: "隐藏 视频时长",
          hide_video_duration_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          revert_full_title: "显示 完整标题",
          revert_full_title_description: [
            "同步生效：首页、搜索页、视频页"
          ],
          hide_video_data: "隐藏 视频数据",
          hide_video_data_description: ["同步生效：首页、搜索页、视频页"],
          hide_video_carousel: "隐藏 视频精选",
          hide_section_sub_title: "隐藏 板块副标题"
        }
      },
      search: {
        basic: { name: "搜索页 - 基本功能" }
      },
      video: {
        basic: {
          name: "播放页 - 基本功能"
        },
        player: {
          name: "播放页 - 播放器"
        },
        playerContorl: {
          name: "播放页 - 播放控制栏"
        },
        toolbar: {
          name: "播放页 - 视频下方"
        }
      }
    }
  };
  const language = {
    title: "Porn&Enhance",
    menu: "Show&Menu",
    panel: "Show/Hide Menu Panel",
    side_btn: "Show/Hide Side Button",
    basic_settings: "Global - Basic",
    language: "language",
    language_description: [
      "刷新页面生效",
      "刷新頁面生效",
      "Refresh the page to take effect",
      "ページをリフレッシュして有効になります",
      "페이지를 새로고침하여 적용됩니다"
    ],
    editorBtn: "Edit",
    editorPlaceholder: "Please enter the content...",
    editorSaveBtn: "Save",
    editorCloseBtn: "Close",
    missav: {
      common: {
        basic: {
          name: "Common - Basic",
          remove_ads: "Remove Ads",
          hide_footer: "Hide Footer",
          hide_new_site_banner: "Hide New Site Banner",
          redirect_new_url: "Redirect To New Site",
          auto_login_email_password: "Edit Account Info",
          auto_login_email_password_description: ["Auto Login Account Info"],
          auto_login_email_password_editorTitle: "Account&Info",
          auto_login_email_password_editorDescription: [
            "The format is as follows :",
            "email on the first line, password on the second line"
          ],
          auto_login: "Auto Login"
        },
        header: {
          name: "Common - Header",
          hide_logo: "Hide LOGO",
          hide_live_cam_sex: "Hide Live Cam Sex(AD)",
          hide_comic: "Hide Comic(AD)",
          hide_subtitle: "Hide English subtitle",
          hide_watch_jav: "Hide Watch JAV",
          hide_amateur: "Hide Amateur",
          hide_uncensored: "Hide Uncensored",
          hide_asia_av: "Hide Asia AV",
          hide_my_collection: "Hide My collection",
          hide_upgrade_vip: "Hide Upgrade VIP",
          hide_upgrade_vip_description: [
            "PC (wide screen) In My collection",
            "Mobile (narrow screen) In Right Menu"
          ],
          hide_more_sites: "Hide More sites(AD)",
          hide_tg: "Hide Telegram Group(AD)",
          hide_search: "Hide Search",
          hide_locale_switcher: "Hide Locale Switcher",
          hide_site_live: "Hide Website Publish",
          hide_site_live_description: [
            "Only Displayed In mobile (narrow screen) Right Menu",
            "Not display when page is in English"
          ],
          hide_mobile_right_menu: "Hide Right Menu",
          hide_mobile_right_menu_description: [
            "Only Displayed On Mobile (narrow screen)"
          ]
        }
      },
      home: {
        basic: {
          name: "HomePage - Basic",
          blur_video_image: "Blur Video Image",
          blur_video_image_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          blur_video_title: "Blur Video Title",
          blur_video_title_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          hide_search_title: "Hide Search Title",
          hide_search_box: "Hide Search Box",
          hide_search_history: "Hide Search History",
          hide_video_genres: "Hide Video Genres",
          hide_video_genres_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          hide_video_duration: "Hide Video Duration",
          hide_video_duration_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          revert_full_title: "Revert Full Video Title",
          revert_full_title_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ]
        },
        video: {
          name: "HomePage - Video",
          recommended_video_load_more: "Load More Recommended Video",
          recommended_video_quantity_load_number: "Customize Recommended Video Quantity"
        }
      },
      search: {
        basic: { name: "SearchPage - Basic" }
      },
      video: {
        basic: {
          name: "VideoPage - Basic",
          auto_switch_uncensored: "Auto Switch Uncensored",
          auto_switch_uncensored_description: [
            "Effective only when opening a standard video"
          ]
        },
        player: {
          name: "VideoPage - Player",
          hide_new_site_banner: "Hide New Site Banner",
          auto_quality: "Auto Quality",
          speed: "Modify Speed(-1 Disable)",
          speed_addonText: "x",
          volume: "Modify Volume(-1 Disable)",
          volume_addonText: "%",
          hide_play_btn: "Hide Play Button",
          hide_play_btn_description: ["displayed when video is paused"],
          cancel_focus_stop: "Cancel Auto-pause",
          hook_open_window: "Block Open AD Window"
        },
        playerContorl: {
          name: "VideoPage - PlayerContorl",
          hide_prev: "Hide Prev Button",
          hide_play: "Hide Play/Pause Button",
          hide_next: "Hide Next Button",
          hide_progress: "Hide Progress Bar",
          hide_subtitle: "Hide Subtitle Button",
          hide_volume: "Hide Volume Button",
          hide_setting: "Hide Settings Button",
          hide_pip: "Hide PIP Button",
          hide_full: "Hide Full Screen Buttons ",
          hide_jump: "Hide Jump Control",
          hide_jump_description: [
            "Only Displayed On Mobile (narrow screen)"
          ],
          hide_loop: "Hide Loop Control"
        },
        toolbar: {
          name: "VideoPage - Toolbar",
          hide_save: "Hide Saved",
          hide_playlist: "Hide Playlist",
          hide_download: "Hide Download",
          hide_share: "Hide Share",
          show_m3u8: "Show M3U8",
          show_m3u8_description: [
            "Capture and display m3u8 url",
            "Can play with other media players"
          ],
          auto_show_more: "Auto Show More"
        }
      }
    },
    jabletv: {
      common: {
        basic: {
          name: "Common - Basic",
          remove_ads: "Remove Ads",
          hide_footer: "Hide Footer"
        },
        header: {
          name: "Common - Header",
          hide_logo: "Hide LOGO",
          hide_new: "Hide New",
          hide_blu_ray: "Hide Blu Ray(AD)",
          hide_live_sex: "Hide Live Sex(AD)",
          hide_best_porns: "Hide Best Porns(AD)",
          hide_more_sites: "Hide More Sites(AD)",
          hide_sex_chat: "Hide Sex Chat(AD)",
          hide_javhd: "Hide JavHD(AD)",
          hide_search: "Hide Search",
          hide_lang: "Hide Language",
          hide_settings: "Hide Login/Settings"
        }
      },
      home: {
        basic: {
          name: "HomePage - Basic",
          blur_video_image: "Blur Video Image",
          blur_video_image_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          blur_video_title: "Blur Video Title",
          blur_video_title_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          hide_video_like: "Hide Video Like",
          hide_video_like_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          hide_video_duration: "Hide Video Duration",
          hide_video_duration_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          revert_full_title: "Revert Video Full Title",
          revert_full_title_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          hide_video_data: "Hide Video Data",
          hide_video_data_description: [
            "Synchronization takes effect: HomePage, SearchPage, VideoPage"
          ],
          hide_video_carousel: "Hide Video Carousel",
          hide_section_sub_title: "Hide Section Sub-Title"
        }
      },
      search: {
        basic: { name: "SearchPage - Basic" }
      },
      video: {
        basic: {
          name: "VideoPage - Basic"
        },
        player: {
          name: "VideoPage - Player"
        },
        playerContorl: {
          name: "VideoPage - PlayerContorl"
        },
        toolbar: {
          name: "VideoPage - Toolbar"
        }
      }
    }
  };
  const host = location.host;
  const pathname = location.pathname;
  const missAvPage = () => {
    if (/\/dm[0-9]{1,}\/[a-z]{2,3}$/.test(pathname) || pathname === "") {
      return "missav-homepage";
    }
    const searchRegexps = [
      `\\/search\\/`,
      `\\/(chinese|english)-subtitle(\\?|)$`,
      `\\/new(\\?|)$`,
      `\\/release(\\?|)$`,
      `\\/uncensored-leak(\\?|)$`,
      `\\/genres\\/.*`,
      `\\/makers\\/.*`,
      `\\/today-hot(\\?|)$`,
      `\\/weekly-hot(\\?|)$`,
      `\\/monthly-hot(\\?|)$`,
      `\\/siro(\\?|)$`,
      `\\/luxu(\\?|)$`,
      `\\/gana(\\?|)$`,
      `\\/maan(\\?|)$`,
      `\\/scute(\\?|)$`,
      `\\/ara(\\?|)$`,
      `\\/uncensored-leak(\\?|)$`,
      `\\/fc2(\\?|)$`,
      `\\/heyzo(\\?|)$`,
      `\\/tokyohot(\\?|)$`,
      `\\/1pondo(\\?|)$`,
      `\\/caribbeancom(\\?|)$`,
      `\\/caribbeancompr(\\?|)$`,
      `\\/10musume(\\?|)$`,
      `\\/pacopacomama(\\?|)$`,
      `\\/gachinco(\\?|)$`,
      `\\/xxxav(\\?|)$`,
      `\\/marriedslash(\\?|)$`,
      `\\/naughty4610(\\?|)$`,
      `\\/naughty0930(\\?|)$`,
      `\\/madou(\\?|)$`,
      `\\/twav(\\?|)$`,
      `\\/furuke(\\?|)$`
    ];
    for (let i2 = 0; i2 < searchRegexps.length; i2++) {
      if (new RegExp(searchRegexps[i2]).test(pathname)) {
        return "missav-search";
      }
    }
    if (new RegExp(
      `\\/[A-z].*[0-9](|-uncensored-leak|-(chinese|english)-subtitle)$`
    ).test(pathname)) {
      return "missav-video";
    }
    return "missav";
  };
  const jableTvPage = () => {
    if (pathname === "/") {
      return "jabletv-homepage";
    }
    if (pathname.includes("/videos/")) {
      return "jabletv-video";
    }
    const searchRegexps = [
      /\/search\//,
      /\/categories\//,
      /\/models\//,
      /\/latest-updates\//,
      /\/hot\//,
      /\/tags\//
    ];
    for (let i2 = 0; i2 < searchRegexps.length; i2++) {
      if (new RegExp(searchRegexps[i2]).test(pathname)) {
        return "jabletv-search";
      }
    }
    return "jabletv";
  };
  const _18ComicPage = () => {
    return "18comic";
  };
  const _91PornPage = () => {
    if (pathname === "/view_video.php") {
      return "91porn-video";
    }
    if (pathname === "/v.php") {
      return "91porn-v";
    }
    return "91porn";
  };
  const _91PornaPage = () => {
    return "91porna";
  };
  const pornHubPage = () => {
    if (pathname === "/view_video.php") {
      return "pornhub-video";
    }
    if (pathname === "/video/search") {
      return "pornhub-search";
    }
    return "pornhub";
  };
  const xVideosPage = () => {
    return "xvideos";
  };
  const xHamsterPage = () => {
    return "xhamster";
  };
  const ans = () => {
    log(host);
    switch (host) {
      case "missav.ws":
      case "missav.ai":
      case "missav.com":
      case "thisav.com":
        return missAvPage();
      case "jable.tv":
        return jableTvPage();
      case "pornhub.com":
      case "cn.pornhub.com":
        return pornHubPage();
      case "18comic.org":
      case "18comic.vip":
        return _18ComicPage();
      case "91porn.com":
        return _91PornPage();
      case "91porna.com":
        return _91PornaPage();
      case "www.xvideos.com":
        return xVideosPage();
      case "zh.xhamster.com":
        return xHamsterPage();
      default:
        return "";
    }
  };
  const isPageMissAvHomepage = () => ans() === "missav-homepage";
  const isPageMissAvVideo = () => ans() === "missav-video";
  const isPageMissAvSearch = () => ans() === "missav-search";
  const isPageMissAv = () => ans() === "missav" || ans().startsWith("missav-");
  const isPageJableTvHomepage = () => ans() === "jabletv-homepage";
  const isPageJableTvVideo = () => ans() === "jabletv-video";
  const isPageJableTvSearch = () => ans() === "jabletv-search";
  const isPageJableTv = () => ans() === "jabletv" || ans().startsWith("jabletv-");
  const isPagePornHubVideo = () => ans() === "pornhub-video";
  const isPagePornHub = () => ans() === "pornhub" || ans().startsWith("pornhub-");
  const isPage18Comic = () => ans() === "18comic" || ans().startsWith("18comic-");
  const isPage91Porn = () => ans() === "91porn" || ans().startsWith("91porn-");
  const isPage91PornVideo = () => ans() === "91porn-video";
  const isPage91PornV = () => ans() === "91porn-v";
  const isPage91Porna = () => ans() === "91porna" || ans().startsWith("91porna-");
  const isPageXVideos = () => ans() === "xvideos" || ans().startsWith("xvideos-");
  const languages = {
    "zh-CN": language$1,
    "en-US": language
  };
  class I18n {
    constructor(lang2) {
      __publicField(this, "_language");
      this._language = e$1.ref(languages[lang2]);
    }
    get language() {
      return this._language.value;
    }
    change(lang2) {
      if (Object.keys(languages).includes(lang2)) {
        this._language.value = languages[lang2];
      } else {
        console.log("not support language: ", lang2);
      }
    }
  }
  let lang = PGStorage.get("language", "zh-CN");
  if (!Object.keys(languages).includes(lang)) {
    lang = "zh-CN";
    PGStorage.set("language", "zh-CN");
  }
  if (!isPageMissAv()) {
    lang = "zh-CN";
  }
  const i18n = new I18n(lang);
  const _hoisted_1$8 = { class: "flex w-full flex-1 flex-row rounded-xl p-3.5 hover:bg-[#2f2f2f]" };
  const _hoisted_2$7 = { class: "ml-2 flex-1 self-center" };
  const _hoisted_3$3 = { class: "mx-2 mb-2 flex flex-1 flex-col p-1 text-[#c6c6c6]" };
  const _hoisted_4$3 = ["placeholder"];
  const _hoisted_5$1 = { class: "mt-4 flex justify-around" };
  const _sfc_main$9 = /* @__PURE__ */ e$1.defineComponent({
    __name: "EditorComp",
    props: {
      type: {},
      id: {},
      name: {},
      description: {},
      editorTitle: {},
      editorDescription: {},
      saveFn: { type: Function }
    },
    setup(__props) {
      const item = __props;
      const panel = e$1.ref(null);
      const isEditorShow = e$1.ref(false);
      const saveSuccess = e$1.ref(false);
      const editorData = e$1.ref("");
      const updateData = () => {
        const val = PGStorage.get(item.id, []).join("\n");
        editorData.value = val ? val + "\n" : val;
      };
      const saveData = () => {
        try {
          const data = editorData.value.split("\n").filter((v2) => v2.trim() !== "");
          PGStorage.set(item.id, orderedUniq(data));
          saveSuccess.value = true;
          item.saveFn();
          setTimeout(() => {
            saveSuccess.value = false;
          }, 1500);
        } catch (err) {
          error(`EditorComp ${item.id} saveData error`, err);
        }
      };
      return (_ctx, _cache) => {
        var _a;
        return e$1.openBlock(), e$1.createElementBlock(e$1.Fragment, null, [
          e$1.createElementVNode("label", _hoisted_1$8, [
            e$1.createElementVNode("span", _hoisted_2$7, e$1.toDisplayString(_ctx.name), 1),
            e$1.createElementVNode("button", {
              type: "button",
              class: "relative inline-flex justify-center rounded border border-[#212121] bg-[#151515] px-2.5 py-1.5 text-sm outline-none hover:border-[#ff9000] hover:text-[#ff9000] focus:outline-none",
              onClick: _cache[0] || (_cache[0] = () => {
                isEditorShow.value = true;
                updateData();
              })
            }, e$1.toDisplayString(e$1.unref(i18n).language.editorBtn), 1)
          ]),
          ((_a = _ctx.description) == null ? undefined : _a.length) ? (e$1.openBlock(), e$1.createBlock(_sfc_main$a, {
            key: 0,
            class: "pl-9",
            description: _ctx.description
          }, null, 8, ["description"])) : e$1.createCommentVNode("", true),
          isEditorShow.value ? (e$1.openBlock(), e$1.createBlock(_sfc_main$b, e$1.mergeProps({
            key: 1,
            ref_key: "panel",
            ref: panel
          }, {
            title: _ctx.editorTitle,
            widthPercent: 28,
            heightPercent: 85,
            minWidth: 360,
            minHeight: 600
          }, {
            onClose: _cache[4] || (_cache[4] = ($event) => isEditorShow.value = false)
          }), {
            default: e$1.withCtx(() => {
              var _a2;
              return [
                e$1.createElementVNode("div", _hoisted_3$3, [
                  ((_a2 = _ctx.editorDescription) == null ? undefined : _a2.length) ? (e$1.openBlock(), e$1.createBlock(_sfc_main$a, {
                    key: 0,
                    class: "mb-3",
                    description: _ctx.editorDescription
                  }, null, 8, ["description"])) : e$1.createCommentVNode("", true),
                  e$1.withDirectives(e$1.createElementVNode("textarea", {
                    "onUpdate:modelValue": _cache[1] || (_cache[1] = ($event) => editorData.value = $event),
                    onKeydown: _cache[2] || (_cache[2] = e$1.withModifiers(() => {
                    }, ["stop"])),
                    class: "flex-1 resize-none overscroll-none rounded-xl border-2 border-[#252525] bg-[#252525] p-2 text-[14px] outline-none focus:border-[#2f2f2f]",
                    style: { "scrollbar-width": "thin", "scrollbar-color": "#999 #00000000" },
                    spellcheck: "false",
                    placeholder: e$1.unref(i18n).language.editorPlaceholder
                  }, null, 40, _hoisted_4$3), [
                    [e$1.vModelText, editorData.value]
                  ]),
                  e$1.createElementVNode("div", _hoisted_5$1, [
                    e$1.createElementVNode("button", {
                      class: e$1.normalizeClass([
                        "w-24 self-center rounded border border-white bg-[#2f2f2f] py-0.5 text-center hover:border-[#ff9000] hover:text-[#ff9000]",
                        saveSuccess.value ? "border-green-600 bg-green-950 hover:border-green-600 hover:bg-green-950" : ""
                      ]),
                      onClick: saveData
                    }, e$1.toDisplayString(e$1.unref(i18n).language.editorSaveBtn), 3),
                    e$1.createElementVNode("button", {
                      class: "w-24 self-center rounded border border-white bg-[#2f2f2f] py-0.5 text-center hover:border-[#ff9000] hover:text-[#ff9000]",
                      onClick: _cache[3] || (_cache[3] = ($event) => isEditorShow.value = false)
                    }, e$1.toDisplayString(e$1.unref(i18n).language.editorCloseBtn), 1)
                  ])
                ])
              ];
            }),
            _: 1
          }, 16)) : e$1.createCommentVNode("", true)
        ], 64);
      };
    }
  });
  const _hoisted_1$7 = { class: "flex items-center justify-between p-3.5 py-1" };
  const _hoisted_2$6 = { class: "ml-2 text-white" };
  const _hoisted_3$2 = { class: "relative w-2/5" };
  const _hoisted_4$2 = { class: "block truncate text-gray-200" };
  const _hoisted_5 = { class: "pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2" };
  const _hoisted_6 = {
    key: 0,
    class: "absolute inset-y-0 left-0 flex items-center pl-3 text-[#ff9000]"
  };
  const _sfc_main$8 = /* @__PURE__ */ e$1.defineComponent({
    __name: "ListComp",
    props: {
      type: {},
      id: {},
      name: {},
      description: {},
      defaultValue: {},
      disableValue: {},
      options: {},
      fn: { type: Function }
    },
    setup(__props) {
      const item = __props;
      const options = item.options;
      const currValue = PGStorage.get(item.id, item.defaultValue);
      const currOption = options.find((v2) => v2.id === currValue);
      const selectedOption = e$1.ref(currOption ?? options[0]);
      e$1.watch(selectedOption, (newSelected) => {
        var _a;
        try {
          for (const option of options) {
            if (option.id === newSelected.id && newSelected.id !== item.disableValue) {
              document.documentElement.setAttribute(option.id, "");
              if (item.fn) {
                (_a = item.fn(newSelected.id)) == null ? void 0 : _a.then().catch((err) => {
                  throw err;
                });
              }
            } else {
              document.documentElement.removeAttribute(option.id);
            }
          }
          PGStorage.set(item.id, newSelected.id);
        } catch (err) {
          error(`ListComp ${item.id} error`, err);
        }
      });
      return (_ctx, _cache) => {
        var _a;
        return e$1.openBlock(), e$1.createElementBlock(e$1.Fragment, null, [
          e$1.createElementVNode("div", _hoisted_1$7, [
            e$1.createElementVNode("div", _hoisted_2$6, e$1.toDisplayString(_ctx.name), 1),
            e$1.createVNode(e$1.unref(Ie), {
              modelValue: selectedOption.value,
              "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => selectedOption.value = $event)
            }, {
              default: e$1.withCtx(() => [
                e$1.createElementVNode("div", _hoisted_3$2, [
                  e$1.createVNode(e$1.unref(je), { class: "relative w-full cursor-pointer rounded-2xl border-2 border-[#212121] bg-[#151515] px-2.5 py-1.5 text-left focus:bg-[#212121] focus:outline-none sm:text-sm" }, {
                    default: e$1.withCtx(() => [
                      e$1.createElementVNode("span", _hoisted_4$2, e$1.toDisplayString(selectedOption.value.name), 1),
                      e$1.createElementVNode("span", _hoisted_5, [
                        e$1.createVNode(e$1.unref(render), {
                          class: "h-5 w-5 text-gray-600",
                          "aria-hidden": "true"
                        })
                      ])
                    ]),
                    _: 1
                  }),
                  e$1.createVNode(e$1.Transition, {
                    "leave-active-class": "transition duration-100 ease-in",
                    "leave-from-class": "opacity-100",
                    "leave-to-class": "opacity-0"
                  }, {
                    default: e$1.withCtx(() => [
                      e$1.createVNode(e$1.unref(Ae), { class: "absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl bg-black shadow-lg focus:outline-none sm:text-sm" }, {
                        default: e$1.withCtx(() => [
                          (e$1.openBlock(true), e$1.createElementBlock(e$1.Fragment, null, e$1.renderList(e$1.unref(options), (option, index) => {
                            return e$1.openBlock(), e$1.createBlock(e$1.unref(Fe), {
                              key: index,
                              value: option,
                              as: "template"
                            }, {
                              default: e$1.withCtx(({ active, selected }) => [
                                e$1.createElementVNode("li", {
                                  class: e$1.normalizeClass([
                                    active ? "bg-[#1b1b1b] text-white" : "text-[#c6c6c6]",
                                    "relative cursor-default rounded-xl py-2 pl-10 pr-4 transition-colors duration-200"
                                  ])
                                }, [
                                  e$1.createElementVNode("span", {
                                    class: e$1.normalizeClass([selected ? "font-medium" : "font-normal", "block truncate"])
                                  }, e$1.toDisplayString(option.name), 3),
                                  selected ? (e$1.openBlock(), e$1.createElementBlock("span", _hoisted_6, [
                                    e$1.createVNode(e$1.unref(render$2), {
                                      class: "h-5 w-5",
                                      "aria-hidden": "true"
                                    })
                                  ])) : e$1.createCommentVNode("", true)
                                ], 2)
                              ]),
                              _: 2
                            }, 1032, ["value"]);
                          }), 128))
                        ]),
                        _: 1
                      })
                    ]),
                    _: 1
                  })
                ])
              ]),
              _: 1
            }, 8, ["modelValue"])
          ]),
          ((_a = _ctx.description) == null ? undefined : _a.length) ? (e$1.openBlock(), e$1.createBlock(_sfc_main$a, {
            key: 0,
            class: "pl-9",
            description: _ctx.description
          }, null, 8, ["description"])) : e$1.createCommentVNode("", true)
        ], 64);
      };
    }
  });
  const _hoisted_1$6 = { class: "flex items-center p-3.5" };
  const _hoisted_2$5 = { class: "ml-2" };
  const _hoisted_3$1 = ["step"];
  const _hoisted_4$1 = {
    key: 0,
    class: "ml-2"
  };
  const _sfc_main$7 = /* @__PURE__ */ e$1.defineComponent({
    __name: "NumberComp",
    props: {
      type: {},
      id: {},
      name: {},
      description: {},
      minValue: {},
      maxValue: {},
      step: {},
      defaultValue: {},
      disableValue: {},
      addonText: {},
      noStyle: { type: Boolean },
      attrName: {},
      fn: { type: Function }
    },
    setup(__props) {
      const item = __props;
      const currValue = e$1.ref(PGStorage.get(item.id, item.defaultValue));
      watchThrottled(
        currValue,
        (newValue, oldValue) => {
          var _a;
          try {
            if (newValue > item.maxValue) {
              currValue.value = item.maxValue;
            }
            if (newValue < item.minValue) {
              currValue.value = item.minValue;
            }
            if (oldValue === item.disableValue) {
              if (!item.noStyle) {
                document.documentElement.setAttribute(item.attrName ?? item.id, "");
              }
            }
            if (newValue === item.disableValue) {
              if (!item.noStyle) {
                document.documentElement.removeAttribute(item.attrName ?? item.id);
              }
            } else if (currValue.value !== oldValue) {
              (_a = item.fn(currValue.value)) == null ? void 0 : _a.then().catch((err) => {
                throw err;
              });
            }
            PGStorage.set(item.id, currValue.value);
          } catch (err) {
            error(`NumberComp ${item.id} error`, err);
          }
        },
        { throttle: 50 }
      );
      return (_ctx, _cache) => {
        var _a;
        return e$1.openBlock(), e$1.createElementBlock(e$1.Fragment, null, [
          e$1.createElementVNode("div", _hoisted_1$6, [
            e$1.createElementVNode("div", _hoisted_2$5, e$1.toDisplayString(_ctx.name), 1),
            e$1.withDirectives(e$1.createElementVNode("input", {
              type: "number",
              step: _ctx.step,
              "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => currValue.value = $event),
              onKeydown: _cache[1] || (_cache[1] = e$1.withModifiers(() => {
              }, ["stop"])),
              class: "ml-4 block flex-1 w-1/5 rounded-2xl border-2 border-[#212121] bg-[#151515] px-2.5 py-1.5 text-sm outline-none invalid:border-red-500 focus:bg-[#212121] focus:invalid:border-red-500"
            }, null, 40, _hoisted_3$1), [
              [e$1.vModelText, currValue.value]
            ]),
            _ctx.addonText ? (e$1.openBlock(), e$1.createElementBlock("div", _hoisted_4$1, e$1.toDisplayString(_ctx.addonText), 1)) : e$1.createCommentVNode("", true)
          ]),
          ((_a = _ctx.description) == null ? undefined : _a.length) ? (e$1.openBlock(), e$1.createBlock(_sfc_main$a, {
            key: 0,
            class: "pl-9",
            description: _ctx.description
          }, null, 8, ["description"])) : e$1.createCommentVNode("", true)
        ], 64);
      };
    }
  });
  const _hoisted_1$5 = { class: "flex items-center p-3.5" };
  const _hoisted_2$4 = { class: "ml-2" };
  const _sfc_main$6 = /* @__PURE__ */ e$1.defineComponent({
    __name: "StringComp",
    props: {
      type: {},
      id: {},
      name: {},
      description: {},
      defaultValue: {},
      disableValue: {},
      noStyle: { type: Boolean },
      attrName: {},
      fn: { type: Function }
    },
    setup(__props) {
      const item = __props;
      const currValue = e$1.ref(PGStorage.get(item.id, item.defaultValue));
      watchThrottled(
        currValue,
        (newValue, oldValue) => {
          var _a;
          try {
            if (oldValue === item.disableValue) {
              if (!item.noStyle) {
                document.documentElement.setAttribute(item.attrName ?? item.id, "");
              }
            }
            if (newValue === item.disableValue) {
              if (!item.noStyle) {
                document.documentElement.removeAttribute(item.attrName ?? item.id);
              }
            } else if (currValue.value !== oldValue) {
              (_a = item.fn(currValue.value)) == null ? void 0 : _a.then().catch((err) => {
                throw err;
              });
            }
            PGStorage.set(item.id, currValue.value);
          } catch (err) {
            error(`StringComp ${item.id} error`, err);
          }
        },
        { throttle: 50 }
      );
      return (_ctx, _cache) => {
        var _a;
        return e$1.openBlock(), e$1.createElementBlock(e$1.Fragment, null, [
          e$1.createElementVNode("div", _hoisted_1$5, [
            e$1.createElementVNode("div", _hoisted_2$4, e$1.toDisplayString(_ctx.name), 1),
            e$1.withDirectives(e$1.createElementVNode("input", {
              type: "text",
              "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => currValue.value = $event),
              onKeydown: _cache[1] || (_cache[1] = e$1.withModifiers(() => {
              }, ["stop"])),
              class: "ml-4 block w-1/5 flex-1 rounded-2xl border-2 border-[#212121] bg-[#151515] px-2.5 py-1.5 text-sm outline-none invalid:border-red-500 focus:bg-[#212121] focus:invalid:border-red-500"
            }, null, 544), [
              [e$1.vModelText, currValue.value]
            ])
          ]),
          ((_a = _ctx.description) == null ? undefined : _a.length) ? (e$1.openBlock(), e$1.createBlock(_sfc_main$a, {
            key: 0,
            description: _ctx.description
          }, null, 8, ["description"])) : e$1.createCommentVNode("", true)
        ], 64);
      };
    }
  });
  const _hoisted_1$4 = { class: "flex items-center" };
  const _hoisted_2$3 = { class: "ml-2 flex-1" };
  const _sfc_main$5 = /* @__PURE__ */ e$1.defineComponent({
    __name: "SwitchComp",
    props: {
      type: {},
      id: {},
      name: {},
      description: {},
      defaultEnable: { type: Boolean },
      noStyle: { type: Boolean },
      attrName: {},
      enableFn: { type: Function },
      disableFn: { type: Function },
      enableFnRunAt: {}
    },
    setup(__props) {
      const item = __props;
      const enabled = e$1.ref(PGStorage.get(item.id, item.defaultEnable));
      e$1.watch(enabled, () => {
        var _a, _b;
        try {
          if (enabled.value) {
            if (!item.noStyle) {
              document.documentElement.setAttribute(item.attrName ?? item.id, "");
            }
            if (item.enableFn) {
              (_a = item.enableFn()) == null ? void 0 : _a.then().catch();
            }
            PGStorage.set(item.id, true);
          } else {
            if (!item.noStyle) {
              document.documentElement.removeAttribute(item.attrName ?? item.id);
            }
            if (item.disableFn) {
              (_b = item.disableFn()) == null ? void 0 : _b.then().catch((err) => {
                throw err;
              });
            }
            PGStorage.set(item.id, false);
          }
        } catch (err) {
          error(`SwitchComp ${item.id} error`, err);
        }
      });
      return (_ctx, _cache) => {
        var _a;
        return e$1.openBlock(), e$1.createElementBlock(e$1.Fragment, null, [
          e$1.createVNode(e$1.unref(oe), { class: "w-full rounded-xl p-3.5 hover:bg-[#212121]" }, {
            default: e$1.withCtx(() => [
              e$1.createElementVNode("div", _hoisted_1$4, [
                e$1.createVNode(e$1.unref(de), { class: "flex flex-1 flex-row" }, {
                  default: e$1.withCtx(() => [
                    e$1.createElementVNode("p", _hoisted_2$3, e$1.toDisplayString(_ctx.name), 1),
                    e$1.createVNode(e$1.unref(ue), {
                      modelValue: enabled.value,
                      "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => enabled.value = $event),
                      class: e$1.normalizeClass([enabled.value ? "bg-[#ff9000]" : "bg-[#2f2f2f]", "relative inline-flex h-6 w-11 items-center rounded-full outline-none transition-colors"])
                    }, {
                      default: e$1.withCtx(() => [
                        e$1.createElementVNode("span", {
                          class: e$1.normalizeClass([enabled.value ? "translate-x-6" : "translate-x-1", "inline-block h-4 w-4 transform rounded-full bg-white transition-transform"])
                        }, null, 2)
                      ]),
                      _: 1
                    }, 8, ["modelValue", "class"])
                  ]),
                  _: 1
                })
              ])
            ]),
            _: 1
          }),
          ((_a = _ctx.description) == null ? undefined : _a.length) ? (e$1.openBlock(), e$1.createBlock(_sfc_main$a, {
            key: 0,
            class: "pl-9",
            description: _ctx.description
          }, null, 8, ["description"])) : e$1.createCommentVNode("", true)
        ], 64);
      };
    }
  });
  const _hoisted_1$3 = { class: "mt-5 flex justify-center space-x-5" };
  const _hoisted_2$2 = ["href"];
  const _sfc_main$4 = /* @__PURE__ */ e$1.defineComponent({
    __name: "AboutMeComp",
    props: {
      github: {},
      greasyFork: {}
    },
    setup(__props) {
      return (_ctx, _cache) => {
        return e$1.openBlock(), e$1.createElementBlock("ul", _hoisted_1$3, [
          e$1.createElementVNode("li", null, [
            e$1.createElementVNode("a", {
              href: _ctx.github,
              target: "_blank",
              class: "text-gray-400 hover:text-white"
            }, _cache[0] || (_cache[0] = [
              e$1.createElementVNode("svg", {
                "aria-hidden": "true",
                viewBox: "0 0 24 24",
                fill: "currentColor",
                class: "h-10 w-10"
              }, [
                e$1.createElementVNode("path", {
                  "clip-rule": "evenodd",
                  d: "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z",
                  "fill-rule": "evenodd"
                })
              ], -1)
            ]), 8, _hoisted_2$2)
          ])
        ]);
      };
    }
  });
  const useRulePanelStore = /* @__PURE__ */ defineStore("RulePanel", () => {
    const isShow = e$1.ref(false);
    const show = () => {
      isShow.value = true;
    };
    const hide = () => {
      isShow.value = false;
    };
    return { isShow, show, hide };
  });
  const useSideBtnStore = /* @__PURE__ */ defineStore("SideBtn", () => {
    const isShow = useStorage("pg-side-btn-show", true, localStorage);
    const show = () => {
      isShow.value = true;
    };
    const hide = () => {
      isShow.value = false;
    };
    return { isShow, show, hide };
  });
  const _sfc_main$3 = /* @__PURE__ */ e$1.defineComponent({
    __name: "RulePanelView",
    props: {
      rules: {},
      title: {},
      github: {},
      greasyFork: {}
    },
    setup(__props) {
      const props = __props;
      const store = useRulePanelStore();
      const currRules = [];
      for (const rule of props.rules) {
        if (rule.checkFn()) {
          currRules.push(rule);
        }
      }
      return (_ctx, _cache) => {
        return e$1.withDirectives((e$1.openBlock(), e$1.createBlock(_sfc_main$b, e$1.mergeProps({ title: _ctx.title, widthPercent: 28, heightPercent: 85, minWidth: 360, minHeight: 600 }, {
          onClose: e$1.unref(store).hide
        }), {
          default: e$1.withCtx(() => [
            (e$1.openBlock(), e$1.createElementBlock(e$1.Fragment, null, e$1.renderList(currRules, (rule, i2) => {
              return e$1.createElementVNode("div", { key: i2 }, [
                (e$1.openBlock(true), e$1.createElementBlock(e$1.Fragment, null, e$1.renderList(rule.groups, (group, j2) => {
                  return e$1.openBlock(), e$1.createElementBlock("div", { key: j2 }, [
                    e$1.createVNode(_sfc_main$c, e$1.mergeProps({ ref_for: true }, { title: group.name, isFold: group.fold, isSpecial: rule.isSpecial, specialName: rule.specialName }), {
                      default: e$1.withCtx(() => [
                        (e$1.openBlock(true), e$1.createElementBlock(e$1.Fragment, null, e$1.renderList(group.items, (item, innerIndex) => {
                          return e$1.openBlock(), e$1.createElementBlock("div", { key: innerIndex }, [
                            item.type === "switch" ? (e$1.openBlock(), e$1.createBlock(_sfc_main$5, e$1.mergeProps({
                              key: 0,
                              ref_for: true
                            }, item), null, 16)) : item.type === "number" ? (e$1.openBlock(), e$1.createBlock(_sfc_main$7, e$1.mergeProps({
                              key: 1,
                              ref_for: true
                            }, item), null, 16)) : item.type === "string" ? (e$1.openBlock(), e$1.createBlock(_sfc_main$6, e$1.mergeProps({
                              key: 2,
                              ref_for: true
                            }, item), null, 16)) : item.type === "editor" ? (e$1.openBlock(), e$1.createBlock(_sfc_main$9, e$1.mergeProps({
                              key: 3,
                              ref_for: true
                            }, item), null, 16)) : item.type === "list" ? (e$1.openBlock(), e$1.createBlock(_sfc_main$8, e$1.mergeProps({
                              key: 4,
                              ref_for: true
                            }, item), null, 16)) : e$1.createCommentVNode("", true)
                          ]);
                        }), 128))
                      ]),
                      _: 2
                    }, 1040)
                  ]);
                }), 128))
              ]);
            }), 64)),
            e$1.createVNode(_sfc_main$4, e$1.normalizeProps(e$1.guardReactiveProps({ github: _ctx.github, greasyFork: _ctx.greasyFork })), null, 16)
          ]),
          _: 1
        }, 16, ["onClose"])), [
          [e$1.vShow, e$1.unref(store).isShow]
        ]);
      };
    }
  });
  const _hoisted_1$2 = { class: "select-none text-center text-[13px] leading-4" };
  const _hoisted_2$1 = { class: "select-none text-center text-[13px] leading-4" };
  const _sfc_main$2 = /* @__PURE__ */ e$1.defineComponent({
    __name: "SideBtnView",
    setup(__props) {
      const ruleStore = useRulePanelStore();
      const sideBtnStore = useSideBtnStore();
      const target = e$1.ref(null);
      const { width, height } = useElementBounding(target, { windowScroll: false });
      const btnPos = useStorage("pg-side-btn-pos", { right: 10, bottom: 180 }, localStorage);
      const isDragging = e$1.ref(false);
      const windowSize = useWindowSize({ includeScrollbar: false });
      const maxPos = e$1.computed(() => {
        return {
          x: windowSize.width.value - width.value,
          y: windowSize.height.value - height.value
        };
      });
      let rAF = 0;
      useDraggable(target, {
        initialValue: {
          x: windowSize.width.value - btnPos.value.right,
          y: windowSize.height.value - btnPos.value.bottom
        },
        preventDefault: true,
        handle: e$1.computed(() => target.value),
        onMove: (pos) => {
          isDragging.value = true;
          btnPos.value.right = maxPos.value.x - pos.x;
          btnPos.value.bottom = maxPos.value.y - pos.y;
          cancelAnimationFrame(rAF);
          rAF = requestAnimationFrame(() => {
            if (btnPos.value.right < 0) {
              btnPos.value.right = 0;
            }
            if (btnPos.value.bottom < 0) {
              btnPos.value.bottom = 0;
            }
            if (btnPos.value.bottom > maxPos.value.y) {
              btnPos.value.bottom = maxPos.value.y;
            }
            if (btnPos.value.right > maxPos.value.x) {
              btnPos.value.right = maxPos.value.x;
            }
          });
        },
        onEnd: () => {
          setTimeout(() => {
            isDragging.value = false;
          }, 50);
        }
      });
      return (_ctx, _cache) => {
        return e$1.unref(sideBtnStore).isShow ? (e$1.openBlock(), e$1.createElementBlock("div", {
          key: 0,
          style: e$1.normalizeStyle({ right: e$1.unref(btnPos).right + "px", bottom: e$1.unref(btnPos).bottom + "px" }),
          class: "group fixed z-[100] flex flex-col justify-end text-white will-change-[right,bottom] hover:text-opacity-100"
        }, [
          e$1.createElementVNode("div", {
            ref_key: "target",
            ref: target,
            class: "mt-1 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-[#212121] bg-[#151515] font-medium transition-colors hover:bg-[#212121]",
            onClick: _cache[0] || (_cache[0] = ($event) => !isDragging.value && (e$1.unref(ruleStore).isShow ? e$1.unref(ruleStore).hide() : e$1.unref(ruleStore).show()))
          }, [
            e$1.createElementVNode("div", null, [
              e$1.createElementVNode("p", _hoisted_1$2, e$1.toDisplayString(e$1.unref(i18n).language.menu.split("&")[0]), 1),
              e$1.createElementVNode("p", _hoisted_2$1, e$1.toDisplayString(e$1.unref(i18n).language.menu.split("&")[1]), 1)
            ])
          ], 512)
        ], 4)) : e$1.createCommentVNode("", true);
      };
    }
  });
  const originFetch = _unsafeWindow.fetch;
  const FetchInterceptor = (input, init) => {
    let requestInit = {
      url: input instanceof Request ? input.url : input.toString(),
      method: init == null ? undefined : init.method,
      credentials: init == null ? undefined : init.credentials,
      body: init == null ? undefined : init.body,
      type: "RequestInit",
      headers: parseHeaders(init == null ? undefined : init.headers)
    };
    let globalPromise = Promise.resolve(undefined);
    for (let i2 = 0; i2 < beforeRequestFuncs.length; i2++) {
      globalPromise = globalPromise.then((prev) => {
        if (isHTTPResponse(prev)) {
          throw prev;
        }
        requestInit = prev || requestInit;
        return beforeRequestFuncs[i2](requestInit);
      });
    }
    const getInitValue = (key) => {
      return key in requestInit ? requestInit[key] : init == null ? undefined : init[key];
    };
    globalPromise = globalPromise.then((prev) => {
      if (isHTTPResponse(prev)) {
        throw prev;
      }
      requestInit = prev || requestInit;
    }).catch((err) => {
      if (isHTTPResponse(err)) {
        return err;
      }
      console.error("Interceptor cause some err: ", err);
      return undefined;
    }).then((prevResponse) => {
      if (isHTTPResponse(prevResponse)) {
        return new Response(prevResponse.response, {
          headers: prevResponse.headers,
          status: prevResponse.status || 200,
          statusText: prevResponse.statusText
        });
      }
      return originFetch(requestInit.url, {
        ...init,
        method: getInitValue("method"),
        body: getInitValue("body"),
        credentials: getInitValue("credentials"),
        headers: getInitValue("headers")
      });
    }).then((res) => {
      if (!res.ok) {
        console.log("error: ", requestInit);
        throw new Error(`Unexpected status code: ${res.status}`);
      }
      const resClone = res.clone();
      return resClone.blob().then((data) => {
        let interceptorResponse = defineResponse({
          response: data,
          headers: parseHeaders(resClone.headers),
          status: resClone.status || 200,
          statusText: resClone.statusText
        });
        let globalPromise2 = Promise.resolve(undefined);
        for (let i2 = 0; i2 < afterResponseFuncs.length; i2++) {
          globalPromise2 = globalPromise2.then((prevResp) => {
            interceptorResponse = prevResp || interceptorResponse;
            return afterResponseFuncs[i2](
              interceptorResponse,
              requestInit
            );
          });
        }
        globalPromise2 = globalPromise2.then((prevResp) => {
          interceptorResponse = prevResp || interceptorResponse;
          return interceptorResponse;
        });
        return globalPromise2.then((prevResponse) => {
          return new Response(prevResponse.response, {
            headers: prevResponse.headers,
            status: prevResponse.status || 200,
            statusText: prevResponse.statusText
          });
        });
      });
    }).catch((err) => {
      let errorOrResponse = {
        type: "fetch",
        cause: err
      };
      let globalPromise2 = Promise.resolve(undefined);
      for (let i2 = 0; i2 < receiveErrorFuncs.length; i2++) {
        globalPromise2 = globalPromise2.then((prevResponse) => {
          errorOrResponse = prevResponse || errorOrResponse;
          if (isHTTPResponse(errorOrResponse)) {
            throw errorOrResponse;
          }
          return receiveErrorFuncs[i2](errorOrResponse, requestInit);
        });
      }
      globalPromise2.then((prevResponse) => {
        errorOrResponse = prevResponse || errorOrResponse;
        if (isHTTPResponse(errorOrResponse)) {
          return new Response(errorOrResponse.response || "", {
            headers: errorOrResponse.headers,
            status: errorOrResponse.status || 500,
            statusText: errorOrResponse.statusText
          });
        }
        throw errorOrResponse;
      });
      return globalPromise2;
    });
    return globalPromise;
  };
  const parseHeaders = (headers) => {
    if (headers === undefined || !("forEach" in headers) || typeof headers["forEach"] !== "function")
      return headers;
    const ans2 = {};
    headers.forEach((header) => {
      ans2[header[0]] = header[1];
    });
    return ans2;
  };
  const XHRResponseKeys = ["status", "statusText", "response"];
  class XHRInterceptor extends XMLHttpRequest {
    constructor() {
      super();
      __publicField(this, "openConfig", {
        type: "RequestInit",
        headers: {}
      });
      __publicField(this, "returnCustomResponse", false);
      __publicField(this, "customResponse", { type: "HTTPResponse" });
      __publicField(this, "globalPromise", Promise.resolve({}));
      __publicField(this, "customReadyState", 0);
      __publicField(this, "hasOpened", false);
      __publicField(this, "hasHandleAfterReponse", false);
      const xhr = this;
      let isIntercept = false;
      xhr.addEventListener("readystatechange", function(event) {
        if (xhr.readyState === 4) {
          if (isIntercept) return;
          isIntercept = !isIntercept;
          event.stopImmediatePropagation();
          xhr.handleAfterResponse();
          xhr.globalPromise = xhr.globalPromise.then(() => {
            xhr.dispatchEvent(
              new Event("readystatechange", { bubbles: false })
            );
          });
        }
      });
      let hasInterceptLoadend = false;
      xhr.addEventListener("loadend", function(event) {
        if (hasInterceptLoadend) return;
        hasInterceptLoadend = !hasInterceptLoadend;
        event.stopImmediatePropagation();
        xhr.handleAfterResponse();
        xhr.globalPromise = xhr.globalPromise.then(() => {
          xhr.dispatchEvent(new Event("loadend", { bubbles: false }));
        });
      });
      let onreadystatechangeFunc = () => {
      };
      Object.defineProperty(xhr, "onreadystatechange", {
        set: (newFunc) => {
          onreadystatechangeFunc = newFunc;
        },
        get: () => {
          return onreadystatechangeFunc;
        },
        configurable: true,
        enumerable: true
      });
      xhr.addEventListener("readystatechange", function(...args) {
        if (onreadystatechangeFunc)
          onreadystatechangeFunc.call(this, ...args);
      });
      let errHasCatched = false;
      xhr.addEventListener("error", function(event) {
        if (errHasCatched) return;
        errHasCatched = true;
        event.stopImmediatePropagation();
        let errorOrResponse = {
          type: event.type
        };
        xhr.globalPromise = xhr.globalPromise.then(() => undefined);
        for (let i2 = 0; i2 < receiveErrorFuncs.length; i2++) {
          xhr.globalPromise = xhr.globalPromise.then((prevResponse) => {
            errorOrResponse = prevResponse || errorOrResponse;
            if (isHTTPResponse(errorOrResponse)) {
              throw errorOrResponse;
            }
            return receiveErrorFuncs[i2](
              errorOrResponse,
              xhr.openConfig
            );
          });
        }
        xhr.globalPromise.then((prevResponse) => {
          errorOrResponse = prevResponse || errorOrResponse;
          if (isHTTPResponse(errorOrResponse)) {
            throw errorOrResponse;
          }
          xhr.dispatchEvent(
            new Event(errorOrResponse.type, { bubbles: false })
          );
        }).catch((response) => {
          xhr.customResponse = response;
          xhr.returnCustomResponse = true;
          xhr.dispatchEvent(
            new Event("readystatechange", { bubbles: false })
          );
        });
      });
      let onerrorFunc = () => {
      };
      Object.defineProperty(xhr, "onerror", {
        set: (newFunc) => {
          onerrorFunc = newFunc;
        },
        get: () => {
          return onerrorFunc;
        },
        configurable: true,
        enumerable: true
      });
      xhr.addEventListener("error", function(...args) {
        onerrorFunc.call(xhr, ...args);
      });
      let onloadendFunc = () => {
      };
      Object.defineProperty(xhr, "onloadend", {
        set: (newFunc) => {
          onloadendFunc = newFunc;
        },
        get: () => {
          return onloadendFunc;
        },
        configurable: true,
        enumerable: true
      });
      xhr.addEventListener("loadend", function(...args) {
        onloadendFunc.call(xhr, ...args);
      });
      XHRResponseKeys.forEach((key) => {
        const getOrigin = () => super[key];
        Object.defineProperty(xhr, key, {
          get: () => {
            if (xhr.returnCustomResponse && key in xhr.customResponse) {
              return xhr.customResponse[key];
            }
            return getOrigin();
          },
          configurable: true,
          enumerable: true
        });
      });
    }
    handleAfterResponse() {
      if (this.hasHandleAfterReponse) return;
      this.hasHandleAfterReponse = true;
      const xhr = this;
      let response = {
        response: xhr.response,
        headers: XHRInterceptor.parseAllHeaders(
          xhr.getAllResponseHeaders()
        ),
        status: xhr.status,
        statusText: xhr.statusText,
        type: "HTTPResponse"
      };
      xhr.globalPromise = xhr.globalPromise.then(
        () => undefined
      );
      for (let i2 = 0; i2 < afterResponseFuncs.length; i2++) {
        xhr.globalPromise = xhr.globalPromise.then((prevResponse) => {
          if (isHTTPResponse(prevResponse)) {
            xhr.returnCustomResponse = true;
          }
          response = prevResponse || response;
          return afterResponseFuncs[i2](response, xhr.openConfig);
        });
      }
      xhr.globalPromise = xhr.globalPromise.then((prevResponse) => {
        if (isHTTPResponse(prevResponse)) {
          xhr.returnCustomResponse = true;
        }
        response = prevResponse || response;
        if (xhr.returnCustomResponse) {
          xhr.customResponse = response;
        }
        if (xhr.status === 0) {
          return;
        }
      });
    }
    open(method, url, async, username, password) {
      this.openConfig = {
        ...this.openConfig,
        method,
        url: url.toString(),
        originConfig: {
          async,
          username,
          password
        }
      };
      this.hasOpened = true;
    }
    send(body) {
      this.globalPromise = this.globalPromise.then(() => this.openConfig);
      this.openConfig.body = body;
      const xhr = this;
      for (let i2 = 0; i2 < beforeRequestFuncs.length; i2++) {
        this.globalPromise = this.globalPromise.then((prevReturn) => {
          if (prevReturn && prevReturn["type"] === "HTTPResponse") {
            throw prevReturn;
          }
          if (prevReturn && (prevReturn == null ? undefined : prevReturn["type"]) === "RequestInit") {
            this.openConfig = prevReturn;
          }
          return beforeRequestFuncs[i2](this.openConfig, xhr);
        });
      }
      this.globalPromise.then((prevReturn) => {
        if (prevReturn && prevReturn["type"] === "RequestInit") {
          this.openConfig = prevReturn;
        }
        if (this.openConfig.credentials === "include") {
          super.withCredentials = true;
        } else {
          super.withCredentials = false;
        }
        if (this.openConfig.originConfig.async === undefined) {
          super.open(this.openConfig.method, this.openConfig.url);
        } else {
          super.open(
            this.openConfig.method,
            this.openConfig.url,
            this.openConfig.originConfig.async,
            this.openConfig.originConfig.username,
            this.openConfig.originConfig.password
          );
        }
        if (this.openConfig.headers) {
          for (const headerKey in this.openConfig.headers) {
            super.setRequestHeader(
              headerKey,
              this.openConfig.headers[headerKey]
            );
          }
        }
        if (prevReturn && prevReturn["type"] === "HTTPResponse") {
          throw prevReturn;
        }
        return prevReturn;
      }).then(() => {
        super.send(this.openConfig.body);
      }).catch((customRes) => {
        xhr.returnCustomResponse = true;
        xhr.customResponse = customRes;
        xhr.customReadyState = 4;
        Object.defineProperty(xhr, "readyState", {
          get: () => xhr.customReadyState,
          configurable: true,
          enumerable: true
        });
        xhr.dispatchEvent(
          new Event("readystatechange", { bubbles: false })
        );
      });
    }
    setRequestHeader(name, value) {
      if (!this.hasOpened) {
        super.setRequestHeader(name, value);
        return;
      }
      const headers = this.openConfig.headers || {};
      this.openConfig.headers = {
        ...headers
      };
      this.openConfig.headers[name] = value;
    }
    getAllResponseHeaders() {
      if (this.returnCustomResponse && "headers" in this.customResponse) {
        const headers = this.customResponse.headers;
        if (headers === undefined) {
          return "";
        }
        return Object.entries(headers).map((headerEntry) => `${headerEntry[0]}: ${headerEntry[1]}`).join("\n");
      }
      return super.getAllResponseHeaders();
    }
    getResponseHeader(name) {
      if (this.returnCustomResponse && "headers" in this.customResponse) {
        const headers = this.customResponse.headers;
        if (headers === undefined) {
          return null;
        }
        return headers[name] || null;
      }
      return super.getResponseHeader(name);
    }
    static parseAllHeaders(headers) {
      const record = {};
      headers.split("\n").forEach((header) => {
        const [key, value] = header.split(":");
        record[key] = value;
      });
      return record;
    }
  }
  const beforeRequestFuncs = [];
  const afterResponseFuncs = [];
  const receiveErrorFuncs = [];
  const defineResponse = (response) => {
    return {
      ...response,
      type: "HTTPResponse"
    };
  };
  const addAfterResponseInterceptor = (afterResponse) => {
    afterResponseFuncs.push(afterResponse);
  };
  const isHTTPResponse = (obj) => {
    return obj && obj.type === "HTTPResponse";
  };
  let originXHR = null;
  const intercept = (win) => {
    const global2 = win || window;
    if (!originXHR) {
      originXHR = global2.XMLHttpRequest;
    }
    global2.XMLHttpRequest = XHRInterceptor;
    global2.fetch = FetchInterceptor;
  };
  const commonBasicItems$6 = [
    {
      type: "switch",
      id: "jabletv-remove-ads",
      name: i18n.language.jabletv.common.basic.remove_ads,
      defaultEnable: true,
      enableFn: () => {
        _unsafeWindow.asgAdgptLoaded = true;
        addAfterResponseInterceptor(
          async (response, requestInit) => {
            var _a;
            if ((_a = requestInit.url) == null ? undefined : _a.includes(
              "https://s.magsrv.com/splash.php"
            )) {
              return defineResponse({
                ...response,
                response: '{"data":[],"ext":[],"layout":{}}'
              });
            }
            return defineResponse(response);
          }
        );
      }
    },
    {
      type: "switch",
      id: "jabletv-hide-footer",
      name: i18n.language.jabletv.common.basic.hide_footer,
      defaultEnable: true
    }
  ];
  const commonHeaderItems$5 = [
    {
      type: "switch",
      id: "jabletv-common-header-hide-logo",
      name: i18n.language.jabletv.common.header.hide_logo
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-new",
      name: i18n.language.jabletv.common.header.hide_new
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-blu-ray",
      name: i18n.language.jabletv.common.header.hide_blu_ray,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-live-sex",
      name: i18n.language.jabletv.common.header.hide_live_sex,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-best-porns",
      name: i18n.language.jabletv.common.header.hide_best_porns,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-more-sites",
      name: i18n.language.jabletv.common.header.hide_more_sites,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-sex-chat",
      name: i18n.language.jabletv.common.header.hide_sex_chat,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-javhd",
      name: i18n.language.jabletv.common.header.hide_javhd,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-search",
      name: i18n.language.jabletv.common.header.hide_search
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-lang",
      name: i18n.language.jabletv.common.header.hide_lang
    },
    {
      type: "switch",
      id: "jabletv-common-header-hide-settings",
      name: i18n.language.jabletv.common.header.hide_settings
    }
  ];
  const commonGroups$6 = [
    {
      name: i18n.language.jabletv.common.basic.name,
      fold: true,
      items: commonBasicItems$6
    },
    {
      name: i18n.language.jabletv.common.header.name,
      fold: true,
      items: commonHeaderItems$5
    }
  ];
  const homepageBasicItems = [
    {
      type: "switch",
      id: "jabletv-home-page-hide-video-carousel",
      name: i18n.language.jabletv.home.basic.hide_video_carousel,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-home-page-hide-section-sub-title",
      name: i18n.language.jabletv.home.basic.hide_section_sub_title,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-blur-video-image",
      name: i18n.language.jabletv.home.basic.blur_video_image,
      description: i18n.language.jabletv.home.basic.blur_video_image_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-blur-video-title",
      name: i18n.language.jabletv.home.basic.blur_video_title,
      description: i18n.language.jabletv.home.basic.blur_video_title_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-likes",
      name: i18n.language.jabletv.home.basic.hide_video_like,
      description: i18n.language.jabletv.home.basic.hide_video_like_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-duration",
      name: i18n.language.jabletv.home.basic.hide_video_duration,
      description: i18n.language.jabletv.home.basic.hide_video_duration_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-revert-full-title",
      name: i18n.language.jabletv.home.basic.revert_full_title,
      description: i18n.language.jabletv.home.basic.revert_full_title_description,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-data",
      name: i18n.language.jabletv.home.basic.hide_video_data,
      description: i18n.language.jabletv.home.basic.hide_video_data_description,
      defaultEnable: true
    }
  ];
  const homepageGroups = [
    {
      name: i18n.language.jabletv.home.basic.name,
      items: homepageBasicItems
    }
  ];
  const searchBasicItems$1 = [
    {
      type: "switch",
      id: "jabletv-home-page-basic-blur-video-image",
      name: i18n.language.jabletv.home.basic.blur_video_image,
      description: i18n.language.jabletv.home.basic.blur_video_image_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-blur-video-title",
      name: i18n.language.jabletv.home.basic.blur_video_title,
      description: i18n.language.jabletv.home.basic.blur_video_title_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-likes",
      name: i18n.language.jabletv.home.basic.hide_video_like,
      description: i18n.language.jabletv.home.basic.hide_video_like_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-duration",
      name: i18n.language.jabletv.home.basic.hide_video_duration,
      description: i18n.language.jabletv.home.basic.hide_video_duration_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-revert-full-title",
      name: i18n.language.jabletv.home.basic.revert_full_title,
      description: i18n.language.jabletv.home.basic.revert_full_title_description,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-data",
      name: i18n.language.jabletv.home.basic.hide_video_data,
      description: i18n.language.jabletv.home.basic.hide_video_data_description,
      defaultEnable: true
    }
  ];
  const searchGroups$1 = [
    {
      name: "搜索页-基本功能",
      items: searchBasicItems$1
    }
  ];
  const videoBasicItems$2 = [
    {
      type: "switch",
      id: "jabletv-home-page-basic-blur-video-image",
      name: i18n.language.jabletv.home.basic.blur_video_image,
      description: i18n.language.jabletv.home.basic.blur_video_image_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-blur-video-title",
      name: i18n.language.jabletv.home.basic.blur_video_title,
      description: i18n.language.jabletv.home.basic.blur_video_title_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-likes",
      name: i18n.language.jabletv.home.basic.hide_video_like,
      description: i18n.language.jabletv.home.basic.hide_video_like_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-duration",
      name: i18n.language.jabletv.home.basic.hide_video_duration,
      description: i18n.language.jabletv.home.basic.hide_video_duration_description
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-revert-full-title",
      name: i18n.language.jabletv.home.basic.revert_full_title,
      description: i18n.language.jabletv.home.basic.revert_full_title_description,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-home-page-basic-hide-video-data",
      name: i18n.language.jabletv.home.basic.hide_video_data,
      description: i18n.language.jabletv.home.basic.hide_video_data_description,
      defaultEnable: true
    }
  ];
  const videoPlayerItems$2 = [
    {
      type: "switch",
      id: "jabletv-video-page-auto-fix-player",
      name: "修补 播放器",
      description: ["去除播放广告、开启更多控制"],
      noStyle: true,
      defaultEnable: true,
      enableFn: () => {
        var _a;
        const video = document.querySelector("video");
        const hlsUrl = _unsafeWindow.hlsUrl;
        const hasVtt = _unsafeWindow.hasVtt;
        const vttUrl = _unsafeWindow.vttUrl;
        if ((_a = _unsafeWindow.Hls) == null ? undefined : _a.isSupported()) {
          const hls = new _unsafeWindow.Hls({
            autoStartLoad: true,
            maxBufferSize: 1 * 1e3 * 1e3
          });
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
        } else {
          video.src = hlsUrl;
        }
        const playerSettings = {
          ratio: "16:9",
          controls: [
            "play-large",
            "rewind",
            "play",
            "fast-forward",
            "progress",
            "current-time",
            "duration",
            "mute",
            "captions",
            "settings",
            "pip",
            "fullscreen",
            "volume",
            "quality"
          ],
          fullscreen: {
            enabled: true,
            fallback: true,
            iosNative: true,
            container: null
          },
          speed: {
            selected: 1,
            options: [
              0.25,
              0.5,
              1,
              1.25,
              1.5,
              2,
              2.5,
              3,
              3.5,
              4,
              4.5,
              5
            ]
          },
          i18n: {
            speed: "速度",
            normal: "普通",
            quality: "画质",
            qualityLabel: {
              0: "自动"
            }
          },
          previewThumbnails: { enabled: hasVtt, src: vttUrl },
          keyboard: {
            focused: true,
            global: true
          }
        };
        _unsafeWindow.player = new _unsafeWindow.Plyr(video, {
          quality: {
            forced: true
          },
          playerSettings
        });
      },
      enableFnRunAt: "document-end"
    },
    {
      type: "switch",
      id: "jabletv-video-page-auto-bpx-player-quality",
      name: "自动 最高画质",
      defaultEnable: true,
      enableFn: () => {
        var _a, _b;
        const player = _unsafeWindow.player;
        if (!player) return;
        if (!((_b = (_a = player.config) == null ? undefined : _a.quality) == null ? undefined : _b.options)) return;
        const maxQuality = Math.max.apply(
          null,
          player.config.quality.options
        );
        player.quality = maxQuality;
        player.config.quality.default = maxQuality;
        player.config.quality.selected = maxQuality;
        const plyr = localStorage.getItem("plyr");
        if (plyr) {
          const plyrData = JSON.parse(plyr);
          plyrData["quality"] = player.quality;
          localStorage.setItem("plyr", JSON.stringify(plyrData));
        }
      },
      enableFnRunAt: "document-end"
    },
    {
      type: "number",
      id: "jabletv-video-page-bpx-player-speed",
      name: "修改 播放速度(-1禁用)",
      description: ["上下方向键快速调整"],
      addonText: "倍",
      minValue: 0.5,
      maxValue: 10,
      step: 0.5,
      defaultValue: -1,
      disableValue: -1,
      fn: async (value) => {
        const player = _unsafeWindow.player;
        if (!player) return;
        player.speed = value;
        const plyr = localStorage.getItem("plyr");
        if (plyr) {
          const plyrData = JSON.parse(plyr);
          plyrData["speed"] = player.speed;
          localStorage.setItem("plyr", JSON.stringify(plyrData));
        }
      }
    },
    {
      type: "number",
      id: "jabletv-video-page-bpx-player-volume",
      name: "修改 播放音量(-1禁用)",
      description: ["上下方向键快速调整"],
      addonText: "%",
      minValue: 0,
      maxValue: 100,
      step: 5,
      defaultValue: -1,
      disableValue: -1,
      fn: (value) => {
        const player = _unsafeWindow.player;
        if (!player) return;
        player.volume = value / 100;
        const plyr = localStorage.getItem("plyr");
        if (plyr) {
          const plyrData = JSON.parse(plyr);
          plyrData["volume"] = player.volume;
          localStorage.setItem("plyr", JSON.stringify(plyrData));
        }
      }
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-state-wrap",
      name: "隐藏 视频暂停时大播放键"
    }
  ];
  const videoPlayerControlItems$1 = [
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-ctrl-play",
      name: "隐藏 播放/暂停按钮"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-ctrl-progress",
      name: "隐藏 进度条"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-ctrl-time",
      name: "隐藏 进度时间"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-ctrl-volume",
      name: "隐藏 音量按钮"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-ctrl-setting",
      name: "隐藏 视频设置按钮"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-ctrl-pip",
      name: "隐藏 画中画按钮"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-bpx-player-ctrl-full",
      name: "隐藏 全屏按钮"
    }
  ];
  const _hoisted_1$1 = { class: "m3u8-span" };
  const _hoisted_2 = ["onUpdate:modelValue"];
  const _hoisted_3 = ["onClick"];
  const _hoisted_4 = ["onClick"];
  const _sfc_main$1 = /* @__PURE__ */ e$1.defineComponent({
    __name: "M3U8Comp",
    props: {
      m3u8s: {}
    },
    setup(__props) {
      const openUrl = (url) => {
        window.open(url, "_blank");
      };
      const copyUrl = (url) => {
        navigator.clipboard.writeText(url || "").then().catch();
      };
      return (_ctx, _cache) => {
        return e$1.openBlock(true), e$1.createElementBlock(e$1.Fragment, null, e$1.renderList(_ctx.m3u8s, (m3u8, index) => {
          return e$1.openBlock(), e$1.createElementBlock("div", {
            class: "m3u8-input-group",
            key: index
          }, [
            e$1.createElementVNode("span", _hoisted_1$1, e$1.toDisplayString(_ctx.m3u8s[index].title), 1),
            e$1.withDirectives(e$1.createElementVNode("input", {
              "onUpdate:modelValue": ($event) => _ctx.m3u8s[index].url = $event,
              type: "text",
              class: "m3u8-input"
            }, null, 8, _hoisted_2), [
              [e$1.vModelText, _ctx.m3u8s[index].url]
            ]),
            e$1.createElementVNode("input", {
              class: "m3u8-button--open",
              onClick: ($event) => openUrl(_ctx.m3u8s[index].url),
              value: "Open",
              type: "submit"
            }, null, 8, _hoisted_3),
            e$1.createElementVNode("input", {
              class: "m3u8-button--copy",
              onClick: ($event) => copyUrl(_ctx.m3u8s[index].url),
              value: "Copy",
              type: "submit"
            }, null, 8, _hoisted_4)
          ]);
        }), 128);
      };
    }
  });
  const _export_sfc = (sfc, props) => {
    const target = sfc.__vccOpts || sfc;
    for (const [key, val] of props) {
      target[key] = val;
    }
    return target;
  };
  const M3U8Comp = /* @__PURE__ */ _export_sfc(_sfc_main$1, [["__scopeId", "data-v-70ae07f7"]]);
  const videoToolbarItems$2 = [
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-data",
      name: "隐藏 视频数据",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-tips",
      name: "隐藏 视频发布提醒"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-type-time",
      name: "隐藏 视频类型&发布时间",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-fav",
      name: "隐藏 视频点赞",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-mark",
      name: "隐藏 视频收藏",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-video-page-show-below-info-m3u8",
      name: "获取 M3U8",
      description: ["截取并显示m3u8, 可使用其他播放器播放"],
      noStyle: true,
      enableFnRunAt: "document-end",
      enableFn: () => {
        if (!_unsafeWindow.hlsUrl) return;
        const m3u8Panle = e$1.createApp(M3U8Comp, {
          m3u8s: [{ title: "m3u8", url: _unsafeWindow.hlsUrl }]
        });
        m3u8Panle.mount(
          (() => {
            var _a;
            const node = document.createElement("div");
            node.id = "div-m3u8s";
            (_a = document.querySelector("section.video-info > div.text-center")) == null ? undefined : _a.appendChild(node);
            return node;
          })()
        );
      },
      disableFn: () => {
        const node = document.querySelector("#div-m3u8s");
        if (node) node.remove();
      }
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-more",
      name: "隐藏 视频更多",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-tags",
      name: "隐藏 视频标签"
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-new-comment",
      name: "隐藏 发布新评论",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "jabletv-video-page-hide-below-info-comments",
      name: "隐藏 视频留言"
    }
  ];
  const videoGroups$3 = [
    {
      name: i18n.language.jabletv.video.basic.name,
      fold: true,
      items: videoBasicItems$2
    },
    {
      name: i18n.language.jabletv.video.player.name,
      fold: true,
      items: videoPlayerItems$2
    },
    {
      name: i18n.language.jabletv.video.playerContorl.name,
      fold: true,
      items: videoPlayerControlItems$1
    },
    {
      name: i18n.language.jabletv.video.toolbar.name,
      fold: true,
      items: videoToolbarItems$2
    }
  ];
  const commonStyle$6 = 'html[jabletv-remove-ads] div.plyr__ads,html[jabletv-remove-ads] div:has(>div>img[src="//cdn.tapioni.com/ab-banner.png"]),html[jabletv-remove-ads] div.asg-interstitial:has(>div>iframe),html[jabletv-remove-ads] section>div.row>div:has(>div>div.detail>h6>a[href^="https://go."]),html[jabletv-remove-ads] #site-content>div.container>section:has(>div>div>iframe),html[jabletv-remove-ads] #site-content>div.container>section:has(>div>div>img[src*=".afcdn.net"]),html[jabletv-remove-ads] div.row>div:has(div[id^=exo-native-widget-]),html[jabletv-remove-ads] section.video-info>div.text-center>ins,html[jabletv-remove-ads] section.video-info>div.text-center>div:has(>div>iframe),html[jabletv-remove-ads] div.text-center>a[href^="http://s."],html[jabletv-remove-ads] div.row>div:has(>div[id^=exoNativeWidget]),html[jabletv-remove-ads] div.row>div:has(h6>a[href^="https://r."]),html[jabletv-remove-ads] #site-content>div.container>section:has(>iframe),html[jabletv-remove-ads] section.video-info>div.text-center>iframe,html[jabletv-remove-ads] #site-content>div>div>div.col.right-sidebar>div.text-center>iframe,html[jabletv-remove-ads] body>div[class^=root--],html[jabletv-remove-ads] div[id^=asg-],html[jabletv-remove-ads] #site-content>div.container>section:has(>a[target=_blank]>img),html[jabletv-remove-ads] body>div.h5.text-center:has(>span):has(>a[target=_blank]){display:none!important}html[jabletv-hide-footer] #site-footer{display:none!important}html[jabletv-common-header-hide-logo] #site-header>div>div>div:has(>a.logo){visibility:hidden!important}html[jabletv-common-header-hide-new] #site-header>div>div>div>nav>div>ul>li:has(a[href="/new-release/"]){display:none!important}html[jabletv-common-header-hide-blu-ray] body>nav>div.container>div.row>div:has(a[href^="https://r."]),html[jabletv-common-header-hide-blu-ray] #site-header>div>div>div>nav>div>ul>li:has(a[href^="https://r."]){display:none!important}html[jabletv-common-header-hide-live-sex] body>nav>div.container>div.row>div:has(a[href^="https://go."]),html[jabletv-common-header-hide-live-sex] #site-header>div>div>div>nav>div>ul>li:has(a[href^="https://go."]){display:none!important}html[jabletv-common-header-hide-best-porns] body>nav>div.container>div.row>div:has(a[href="https://141jj.com"]),html[jabletv-common-header-hide-best-porns] #site-header>div>div>div>nav>div>ul>li:has(a[href="https://141jj.com"]){display:none!important}html[jabletv-common-header-hide-more-sites] body>nav>div.container>div.row>div:has(a[href^="https://theporndude.com"]),html[jabletv-common-header-hide-more-sites] #site-header>div>div>div>nav>div>ul>li:has(a[href^="https://theporndude.com"]){display:none!important}html[jabletv-common-header-hide-sex-chat] body>nav>div.container>div.row>div:has(a[href="https://uuw73.com"]),html[jabletv-common-header-hide-sex-chat] #site-header>div>div>div>nav>div>ul>li:has(a[href="https://uuw73.com"]){display:none!important}html[jabletv-common-header-hide-javhd] body>nav>div.container>div.row>div:has(a[href^="https://enter."]),html[jabletv-common-header-hide-javhd] #site-header>div>div>div>nav>div>ul>li:has(a[href^="https://enter."]){display:none!important}html[jabletv-common-header-hide-search] #site-header>div>div>div.col-auto.header-right>div.search{display:none!important}html[jabletv-common-header-hide-lang] #site-header>div>div>div.header-right>div.lang{display:none!important}html[jabletv-common-header-hide-settings] #site-header>div>div>div.header-right>div.settings{display:none!important}';
  const homepageStyle = "html[jabletv-home-page-basic-blur-video-image] div.video-img-box>div.img-box>a>img{filter:blur(5px)}html[jabletv-home-page-basic-blur-video-title] div.video-img-box>div.detail>h6.title>a{filter:blur(5px)}html[jabletv-home-page-basic-hide-video-likes] div.video-img-box>div.img-box>a>div.absolute-bottom-left{display:none!important}html[jabletv-home-page-basic-hide-video-duration] div.video-img-box>div.img-box>a>div.absolute-bottom-right{display:none!important}html[jabletv-home-page-basic-revert-full-title] div.video-img-box>div.detail>h6.title:has(>a){white-space:normal!important;max-height:none!important}html[jabletv-home-page-basic-hide-video-data] div.video-img-box>div.detail>p.sub-title{display:none!important}html[jabletv-home-page-hide-video-carousel] #site-content>div.jable-carousel.jable-animate{display:none!important}html[jabletv-home-page-hide-section-sub-title] #site-content>div.container>section>div>div>div.title-with-more>div.title-box>h6.sub-title.inactive-color,html[jabletv-home-page-hide-section-sub-title] #site-content>div.container>section>div.title-with-more>div.title-box>h6.sub-title.inactive-color{display:none!important}";
  const searchStyle$1 = "html[jabletv-home-page-basic-blur-video-image] div.video-img-box>div.img-box>a>img{filter:blur(5px)}html[jabletv-home-page-basic-blur-video-title] div.video-img-box>div.detail>h6.title>a{filter:blur(5px)}html[jabletv-home-page-basic-hide-video-likes] div.video-img-box>div.img-box>a>div.absolute-bottom-left{display:none!important}html[jabletv-home-page-basic-hide-video-duration] div.video-img-box>div.img-box>a>div.absolute-bottom-right{display:none!important}html[jabletv-home-page-basic-revert-full-title] div.video-img-box>div.detail>h6.title:has(>a){white-space:normal!important;max-height:none!important}html[jabletv-home-page-basic-hide-video-data] div.video-img-box>div.detail>p.sub-title{display:none!important}";
  const videoStyle$3 = "html[jabletv-home-page-basic-blur-video-image] div.video-img-box>div.img-box>a>img{filter:blur(5px)}html[jabletv-home-page-basic-blur-video-title] div.video-img-box>div.detail>h6.title>a{filter:blur(5px)}html[jabletv-home-page-basic-hide-video-likes] div.video-img-box>div.img-box>a>div.absolute-bottom-left{display:none!important}html[jabletv-home-page-basic-hide-video-duration] div.video-img-box>div.img-box>a>div.absolute-bottom-right{display:none!important}html[jabletv-home-page-basic-revert-full-title] div.video-img-box>div.detail>h6.title:has(>a){white-space:normal!important;max-height:none!important}html[jabletv-home-page-basic-hide-video-data] div.video-img-box>div.detail>p.sub-title{display:none!important}html[jabletv-video-page-hide-bpx-player-state-wrap] div.plyr button.plyr__control--overlaid[data-plyr=play]:has(span.plyr__sr-only){display:none!important}html[jabletv-video-page-hide-bpx-player-ctrl-play] div.plyr__controls button.plyr__controls__item[data-plyr=play],html[jabletv-video-page-hide-bpx-player-ctrl-progress] div.plyr__controls div.plyr__controls__item.plyr__progress__container,html[jabletv-video-page-hide-bpx-player-ctrl-time] div.plyr__controls div.plyr__controls__item.plyr__time--current.plyr__time{display:none!important}html[jabletv-video-page-hide-bpx-player-ctrl-volume] div.plyr__controls div.plyr__controls__item.plyr__volume:has(button[data-plyr=mute]){display:none!important}html[jabletv-video-page-hide-bpx-player-ctrl-setting] div.plyr__controls div.plyr__controls__item.plyr__menu:has(button[data-plyr=settings]){display:none!important}html[jabletv-video-page-hide-bpx-player-ctrl-pip] div.plyr__controls button.plyr__controls__item[data-plyr=pip],html[jabletv-video-page-hide-bpx-player-ctrl-full] div.plyr__controls button.plyr__controls__item[data-plyr=fullscreen]{display:none!important}html[jabletv-video-page-hide-below-info-data] section.video-info>div.info-header>div.header-left>h6{display:none!important}html[jabletv-video-page-hide-below-info-tips] section.video-info>h5.desc{display:none!important}html[jabletv-video-page-hide-below-info-type-time] section.video-info>div.info-header>div.header-right{display:none!important}html[jabletv-video-page-hide-below-info-fav] section.video-info>div.text-center>div>button:has(>span.count){display:none!important}html[jabletv-video-page-hide-below-info-mark] section.video-info>div.text-center>div>button:nth-child(2){display:none!important}html[jabletv-video-page-hide-below-info-more] section.video-info>div.text-center>div>button[data-toggle=dropdown]{display:none!important}html[jabletv-video-page-hide-below-info-tags] section.video-info>div.text-center>h5.tags{display:none!important}html[jabletv-video-page-hide-below-info-new-comment] section.comments>div.new-comment{display:none!important}html[jabletv-video-page-hide-below-info-comments] #video_comments_video_comments{display:none!important}";
  const rules$7 = [
    {
      name: "javletv-homepage",
      groups: homepageGroups,
      style: homepageStyle,
      checkFn: () => isPageJableTvHomepage()
    },
    {
      name: "javletv-video",
      groups: videoGroups$3,
      style: videoStyle$3,
      checkFn: () => isPageJableTvVideo()
    },
    {
      name: "javletv-search",
      groups: searchGroups$1,
      style: searchStyle$1,
      checkFn: () => isPageJableTvSearch()
    },
    {
      name: "javletv-common",
      groups: commonGroups$6,
      style: commonStyle$6,
      isSpecial: true,
      checkFn: () => isPageJableTv()
    }
  ];
  const commonBasicItems$5 = [
    {
      type: "switch",
      id: "missav-common-basic-remove-ads",
      name: i18n.language.missav.common.basic.remove_ads,
      defaultEnable: true,
      enableFn: () => {
        document.addEventListener("alpine:init", () => {
          log("alpine:init");
        });
        document.addEventListener("alpine:initializing", () => {
          log("alpine:initializing");
        });
        document.addEventListener("alpine:initialized", () => {
          var _a;
          log("alpine:initialized");
          const iframes = document.querySelectorAll("iframe[data-src]");
          for (const iframe of iframes) {
            iframe.remove();
            log("remove iframe");
          }
          (_a = document.querySelector("#html-ads")) == null ? undefined : _a.remove();
        });
      }
    },
    {
      type: "switch",
      id: "missav-common-basic-hide-footer",
      name: i18n.language.missav.common.basic.hide_footer,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-basic-hide-new-site-banner",
      name: i18n.language.missav.common.basic.hide_new_site_banner,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-basic-redirect-new-url",
      name: i18n.language.missav.common.basic.redirect_new_url,
      defaultEnable: true,
      noStyle: true,
      enableFn: () => {
        if (location.host === "missav.com") {
          const newHref = location.href.replace(
            "missav.com",
            "missav.ws"
          );
          location.href = newHref;
        }
      }
    },
    {
      type: "editor",
      id: "missav-common-basic-auto-login-email-password",
      name: i18n.language.missav.common.basic.auto_login_email_password,
      description: i18n.language.missav.common.basic.auto_login_email_password_description,
      editorTitle: i18n.language.missav.common.basic.auto_login_email_password_editorTitle,
      editorDescription: i18n.language.missav.common.basic.auto_login_email_password_editorDescription,
      saveFn: () => {
      }
    },
    {
      type: "switch",
      id: "missav-common-basic-auto-login",
      name: i18n.language.missav.common.basic.auto_login,
      noStyle: true,
      enableFn: () => {
        document.addEventListener("alpine:init", () => {
          const div = document.querySelector(
            `body > div > div[x-show="showModal.login"] > div[x-data]`
          );
          if (!div) return;
          const info = PGStorage.get(
            "missav-common-basic-auto-login-email-password",
            []
          );
          if (!info) return;
          const [email, password] = info;
          if (!email || !password) return;
          div.setAttribute(
            "x-init",
            `$nextTick(()=>{email=${email};password=${password};console.log('login',{email:email,password:password});login();});`
          );
        });
      }
    }
    // {
    //     type: 'list',
    //     id: 'missav-common-basic-web-locale',
    //     name: '网站地区',
    //     defaultValue: 'en',
    //     disableValue: '',
    //     options: [
    //         {
    //             id: 'cn',
    //             name: 'cn',
    //         },
    //         {
    //             id: 'en',
    //             name: 'en',
    //         },
    //         {
    //             id: 'ja',
    //             name: 'ja',
    //         },
    //         {
    //             id: 'ko',
    //             name: 'ko',
    //         },
    //         {
    //             id: 'ms',
    //             name: 'ms',
    //         },
    //         {
    //             id: 'th',
    //             name: 'th',
    //         },
    //         {
    //             id: 'de',
    //             name: 'de',
    //         },
    //         {
    //             id: 'fr',
    //             name: 'fr',
    //         },
    //         {
    //             id: 'vi',
    //             name: 'vi',
    //         },
    //         {
    //             id: 'id',
    //             name: 'id',
    //         },
    //         {
    //             id: 'fil',
    //             name: 'fil',
    //         },
    //         {
    //             id: 'pt',
    //             name: 'pt',
    //         },
    //     ],
    //     fn: (id:string) => {
    //         // const fallbackLocale = 'zh';
    //         function removeTrailingSlash(url: string) {
    //             if (url.substr(url.length - 1) === '/') {
    //                 return url.slice(0, -1);
    //             }
    //             return url.replace('/?', '?');
    //         }
    //         function localizedUrl(locale: string) {
    //             let path = window.location.pathname;
    //             if (!path.endsWith('/')) {
    //                 path = `${path}/`;
    //             }
    //             path = path + window.location.search;
    //             // if (locale === this.fallbackLocale) {
    //             //     return removeTrailingSlash(
    //             //         path
    //             //             .replace('/cn/', '/')
    //             //             .replace('/en/', '/')
    //             //             .replace('/ja/', '/')
    //             //             .replace('/ko/', '/')
    //             //             .replace('/ms/', '/')
    //             //             .replace('/th/', '/')
    //             //             .replace('/de/', '/')
    //             //             .replace('/fr/', '/')
    //             //             .replace('/vi/', '/')
    //             //             .replace('/id/', '/')
    //             //             .replace('/fil/', '/')
    //             //             .replace('/pt/', '/'),
    //             //     );
    //             // }
    //             if (
    //                 path.includes('/cn/') ||
    //                 path.includes('/en/') ||
    //                 path.includes('/ja/') ||
    //                 path.includes('/ko/') ||
    //                 path.includes('/ms/') ||
    //                 path.includes('/th/') ||
    //                 path.includes('/de/') ||
    //                 path.includes('/fr/') ||
    //                 path.includes('/vi/') ||
    //                 path.includes('/id/') ||
    //                 path.includes('/fil/') ||
    //                 path.includes('/pt/')
    //             ) {
    //                 return removeTrailingSlash(
    //                     path
    //                         .replace('/cn/', `/${locale}/`)
    //                         .replace('/en/', `/${locale}/`)
    //                         .replace('/ja/', `/${locale}/`)
    //                         .replace('/ko/', `/${locale}/`)
    //                         .replace('/ms/', `/${locale}/`)
    //                         .replace('/th/', `/${locale}/`)
    //                         .replace('/de/', `/${locale}/`)
    //                         .replace('/fr/', `/${locale}/`)
    //                         .replace('/vi/', `/${locale}/`)
    //                         .replace('/id/', `/${locale}/`)
    //                         .replace('/fil/', `/${locale}/`)
    //                         .replace('/pt/', `/${locale}/`),
    //                 );
    //             }
    //             return removeTrailingSlash(`/${locale}${path}`);
    //         }
    //         window.location.href = localizedUrl(id);
    //     },
    // },
    // {
    //     type:'switch',
    //     id:'missav-common-basic-auto-web-locale',
    //     name:'自动 切换地区',
    //     noStyle:true,
    //     enableFn:()=> {
    //         function removeTrailingSlash(url: string) {
    //             if (url.substr(url.length - 1) === '/') {
    //                 return url.slice(0, -1);
    //             }
    //             return url.replace('/?', '?');
    //         }
    //         function localizedUrl(locale: string) {
    //             let path = window.location.pathname;
    //             if (!path.endsWith('/')) {
    //                 path = `${path}/`;
    //             }
    //             path = path + window.location.search;
    //             // if (locale === this.fallbackLocale) {
    //             //     return removeTrailingSlash(
    //             //         path
    //             //             .replace('/cn/', '/')
    //             //             .replace('/en/', '/')
    //             //             .replace('/ja/', '/')
    //             //             .replace('/ko/', '/')
    //             //             .replace('/ms/', '/')
    //             //             .replace('/th/', '/')
    //             //             .replace('/de/', '/')
    //             //             .replace('/fr/', '/')
    //             //             .replace('/vi/', '/')
    //             //             .replace('/id/', '/')
    //             //             .replace('/fil/', '/')
    //             //             .replace('/pt/', '/'),
    //             //     );
    //             // }
    //             if (
    //                 path.includes('/cn/') ||
    //                 path.includes('/en/') ||
    //                 path.includes('/ja/') ||
    //                 path.includes('/ko/') ||
    //                 path.includes('/ms/') ||
    //                 path.includes('/th/') ||
    //                 path.includes('/de/') ||
    //                 path.includes('/fr/') ||
    //                 path.includes('/vi/') ||
    //                 path.includes('/id/') ||
    //                 path.includes('/fil/') ||
    //                 path.includes('/pt/')
    //             ) {
    //                 return removeTrailingSlash(
    //                     path
    //                         .replace('/cn/', `/${locale}/`)
    //                         .replace('/en/', `/${locale}/`)
    //                         .replace('/ja/', `/${locale}/`)
    //                         .replace('/ko/', `/${locale}/`)
    //                         .replace('/ms/', `/${locale}/`)
    //                         .replace('/th/', `/${locale}/`)
    //                         .replace('/de/', `/${locale}/`)
    //                         .replace('/fr/', `/${locale}/`)
    //                         .replace('/vi/', `/${locale}/`)
    //                         .replace('/id/', `/${locale}/`)
    //                         .replace('/fil/', `/${locale}/`)
    //                         .replace('/pt/', `/${locale}/`),
    //                 );
    //             }
    //             return removeTrailingSlash(`/${locale}${path}`);
    //         }
    //         window.location.href = localizedUrl(PGStorage.get('missav-common-basic-web-locale','zh'));
    //     },
    // }
  ];
  const commonHeaderRightItems = [
    {
      type: "switch",
      id: "missav-common-header-hide-logo",
      name: i18n.language.missav.common.header.hide_logo
    },
    {
      type: "switch",
      id: "missav-common-header-hide-live-cam-sex",
      name: i18n.language.missav.common.header.hide_live_cam_sex,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-header-hide-comic",
      name: i18n.language.missav.common.header.hide_comic,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-header-hide-subtitle",
      name: i18n.language.missav.common.header.hide_subtitle
    },
    {
      type: "switch",
      id: "missav-common-header-hide-watch-jav",
      name: i18n.language.missav.common.header.hide_watch_jav
    },
    {
      type: "switch",
      id: "missav-common-header-hide-amateur",
      name: i18n.language.missav.common.header.hide_amateur
    },
    {
      type: "switch",
      id: "missav-common-header-hide-uncensored",
      name: i18n.language.missav.common.header.hide_uncensored
    },
    {
      type: "switch",
      id: "missav-common-header-hide-asia-av",
      name: i18n.language.missav.common.header.hide_asia_av
    },
    {
      type: "switch",
      id: "missav-common-header-hide-my-collection",
      name: i18n.language.missav.common.header.hide_my_collection
    },
    {
      type: "switch",
      id: "missav-common-header-hide-upgrade-vip",
      name: i18n.language.missav.common.header.hide_upgrade_vip,
      description: i18n.language.missav.common.header.hide_upgrade_vip_description,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-header-hide-more-sites",
      name: i18n.language.missav.common.header.hide_more_sites,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-header-hide-tg",
      name: i18n.language.missav.common.header.hide_tg,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-header-hide-search",
      name: i18n.language.missav.common.header.hide_search
    },
    {
      type: "switch",
      id: "missav-common-header-hide-locale-switcher",
      name: i18n.language.missav.common.header.hide_locale_switcher
    },
    {
      type: "switch",
      id: "missav-common-header-hide-site-live",
      name: i18n.language.missav.common.header.hide_site_live,
      description: i18n.language.missav.common.header.hide_site_live_description,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-common-header-hide-mobile-right-menu",
      name: i18n.language.missav.common.header.hide_mobile_right_menu,
      description: i18n.language.missav.common.header.hide_mobile_right_menu_description
    }
  ];
  const commonGroups$5 = [
    {
      name: i18n.language.missav.common.basic.name,
      fold: true,
      items: commonBasicItems$5
    },
    {
      name: i18n.language.missav.common.header.name,
      fold: true,
      items: commonHeaderRightItems
    }
  ];
  const homeBasicItems = [
    {
      type: "switch",
      id: "missav-home-page-basic-hide-search-title",
      name: i18n.language.missav.home.basic.hide_search_title,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-search-box",
      name: i18n.language.missav.home.basic.hide_search_box
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-search-history",
      name: i18n.language.missav.home.basic.hide_search_history
    },
    {
      type: "switch",
      id: "missav-home-page-basic-blur-video-image",
      name: i18n.language.missav.home.basic.blur_video_image,
      description: i18n.language.missav.home.basic.blur_video_image_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-blur-video-title",
      name: i18n.language.missav.home.basic.blur_video_title,
      description: i18n.language.missav.home.basic.blur_video_title_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-video-genres",
      name: i18n.language.missav.home.basic.hide_video_genres,
      description: i18n.language.missav.home.basic.hide_video_genres_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-video-duration",
      name: i18n.language.missav.home.basic.hide_video_duration,
      description: i18n.language.missav.home.basic.hide_video_duration_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-revert-full-title",
      name: i18n.language.missav.home.basic.revert_full_title,
      description: i18n.language.missav.home.basic.revert_full_title_description,
      defaultEnable: true
    }
  ];
  const homeVideoItems = [
    {
      type: "switch",
      id: "missav-home-page-video-open-video-load-more",
      name: i18n.language.missav.home.video.recommended_video_load_more,
      noStyle: true,
      enableFn: () => {
        document.addEventListener("alpine:init", () => {
          const quantity = PGStorage.get(
            "missav-home-page-video-recommended-video-quantity-load-number"
          );
          _unsafeWindow.recommendedQuantity = parseInt(quantity) || 4;
        });
      }
    },
    {
      type: "list",
      id: "missav-home-page-video-recommended-video-quantity-load-number",
      name: i18n.language.missav.home.video.recommended_video_quantity_load_number,
      defaultValue: "4",
      disableValue: "4",
      options: [
        {
          id: "4",
          name: "x4"
        },
        {
          id: "8",
          name: "x8"
        },
        {
          id: "12",
          name: "x12"
        },
        {
          id: "16",
          name: "x16"
        }
      ]
    }
  ];
  const homeGroups = [
    {
      name: i18n.language.missav.home.basic.name,
      items: homeBasicItems
    },
    {
      name: i18n.language.missav.home.video.name,
      items: homeVideoItems
    }
  ];
  const searchBasicItems = [
    {
      type: "switch",
      id: "missav-home-page-basic-blur-video-image",
      name: i18n.language.missav.home.basic.blur_video_image,
      description: i18n.language.missav.home.basic.blur_video_image_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-blur-video-title",
      name: i18n.language.missav.home.basic.blur_video_title,
      description: i18n.language.missav.home.basic.blur_video_title_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-video-genres",
      name: i18n.language.missav.home.basic.hide_video_genres,
      description: i18n.language.missav.home.basic.hide_video_genres_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-video-duration",
      name: i18n.language.missav.home.basic.hide_video_duration,
      description: i18n.language.missav.home.basic.hide_video_duration_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-revert-full-title",
      name: i18n.language.missav.home.basic.revert_full_title,
      description: i18n.language.missav.home.basic.revert_full_title_description,
      defaultEnable: true
    }
  ];
  const searchGroups = [
    {
      name: i18n.language.missav.search.basic.name,
      items: searchBasicItems
    }
  ];
  const videoBasicItems$1 = [
    {
      type: "switch",
      id: "missav-video-page-basic-auto-switch-uncensored",
      name: i18n.language.missav.video.basic.auto_switch_uncensored,
      description: i18n.language.missav.video.basic.auto_switch_uncensored_description,
      noStyle: true,
      enableFn: () => {
        if (location.pathname.includes("chinese-subtitle") || location.pathname.includes("english-subtitle")) {
          log("跳过带字幕版本");
          return;
        }
        const optionMenuItems = document.querySelectorAll(
          "a[id^='option-menu-item'"
        );
        optionMenuItems.forEach((optionMenuItem) => {
          const url = optionMenuItem.getAttribute("href");
          if (url == null ? undefined : url.includes("uncensored")) {
            optionMenuItem.click();
          }
        });
      },
      enableFnRunAt: "document-end"
    },
    {
      type: "switch",
      id: "missav-home-page-basic-blur-video-image",
      name: i18n.language.missav.home.basic.blur_video_image,
      description: i18n.language.missav.home.basic.blur_video_image_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-blur-video-title",
      name: i18n.language.missav.home.basic.blur_video_title,
      description: i18n.language.missav.home.basic.blur_video_title_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-video-genres",
      name: i18n.language.missav.home.basic.hide_video_genres,
      description: i18n.language.missav.home.basic.hide_video_genres_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-hide-video-duration",
      name: i18n.language.missav.home.basic.hide_video_duration,
      description: i18n.language.missav.home.basic.hide_video_duration_description
    },
    {
      type: "switch",
      id: "missav-home-page-basic-revert-full-title",
      name: i18n.language.missav.home.basic.revert_full_title,
      description: i18n.language.missav.home.basic.revert_full_title_description,
      defaultEnable: true
    }
  ];
  const videoPlayerItems$1 = [
    {
      type: "switch",
      id: "missav-video-page-player-hide-new-site-banner",
      name: i18n.language.missav.video.player.hide_new_site_banner,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-video-page-player-auto-quality",
      name: i18n.language.missav.video.player.auto_quality,
      defaultEnable: true,
      enableFn: () => {
        var _a, _b;
        const player = _unsafeWindow.player;
        if (!player) return;
        if (!((_b = (_a = player.config) == null ? undefined : _a.quality) == null ? undefined : _b.options)) return;
        const maxQuality = Math.max.apply(
          null,
          player.config.quality.options
        );
        player.quality = maxQuality;
        player.config.quality.default = maxQuality;
        player.config.quality.selected = maxQuality;
        const plyr = localStorage.getItem("plyr");
        if (plyr) {
          const plyrData = JSON.parse(plyr);
          plyrData["quality"] = player.quality;
          localStorage.setItem("plyr", JSON.stringify(plyrData));
        }
      },
      enableFnRunAt: "document-end"
    },
    {
      type: "number",
      id: "missav-video-page-player-speed",
      name: i18n.language.missav.video.player.speed,
      minValue: 0.5,
      maxValue: 10,
      step: 0.5,
      defaultValue: 1,
      disableValue: -1,
      addonText: i18n.language.missav.video.player.speed_addonText,
      fn: (value) => {
        const player = _unsafeWindow.player;
        if (!player) return;
        player.speed = value;
        const plyr = localStorage.getItem("plyr");
        if (plyr) {
          const plyrData = JSON.parse(plyr);
          plyrData["speed"] = player.speed;
          localStorage.setItem("plyr", JSON.stringify(plyrData));
        }
      }
    },
    {
      type: "number",
      id: "missav-video-page-player-volume",
      name: i18n.language.missav.video.player.volume,
      minValue: 0,
      maxValue: 100,
      step: 5,
      defaultValue: 50,
      disableValue: -1,
      addonText: i18n.language.missav.video.player.volume_addonText,
      fn: (value) => {
        const player = _unsafeWindow.player;
        if (!player) return;
        player.volume = value / 100;
        const plyr = localStorage.getItem("plyr");
        if (plyr) {
          const plyrData = JSON.parse(plyr);
          plyrData["volume"] = player.volume;
          localStorage.setItem("plyr", JSON.stringify(plyrData));
        }
      }
    },
    {
      type: "switch",
      id: "missav-video-page-player-hide-play-btn",
      name: i18n.language.missav.video.player.hide_play_btn
    },
    {
      type: "switch",
      id: "missav-video-page-player-cancel-focus-stop",
      name: i18n.language.missav.video.player.cancel_focus_stop,
      defaultEnable: true,
      noStyle: true,
      enableFn: () => {
        document.addEventListener("ready", () => {
          if (!_unsafeWindow.player) return;
          const originPause = _unsafeWindow.player.pause;
          _unsafeWindow.player.pause = () => {
            if (document.hasFocus()) {
              return originPause();
            }
          };
        });
      }
    },
    {
      type: "switch",
      id: "missav-video-page-player-hook-open-window",
      name: i18n.language.missav.video.player.hook_open_window,
      defaultEnable: true,
      noStyle: true,
      enableFn: () => {
        document.addEventListener("alpine:init", () => {
          const div = document.querySelector(
            `div.content-without-search > div > div.order-first > div[x-init]`
          );
          if (!div) return;
          const x_init = div.getAttribute("x-init");
          div.setAttribute(
            "x-init",
            (x_init == null ? undefined : x_init.replace(
              "$nextTick(() => {",
              `$nextTick(() => {pop=()=>{console.log('hook pop');};popOnce=true;directUrls=[];directUrlsIphone=[];`
            )) || ""
          );
        });
        document.addEventListener("DOMContentLoaded", () => {
          const player = document.querySelector(
            `div.order-first > div > div.relative > div`
          );
          if (!player) return;
          player.removeAttribute("@click");
          player.removeAttribute("@keyup.space.window");
        });
      }
    }
  ];
  const videoPlayerControlItems = [
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-prev",
      name: i18n.language.missav.video.playerContorl.hide_prev
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-play",
      name: i18n.language.missav.video.playerContorl.hide_play
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-next",
      name: i18n.language.missav.video.playerContorl.hide_next
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-progress",
      name: i18n.language.missav.video.playerContorl.hide_progress
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-subtitle",
      name: i18n.language.missav.video.playerContorl.hide_subtitle
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-volume",
      name: i18n.language.missav.video.playerContorl.hide_volume
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-setting",
      name: i18n.language.missav.video.playerContorl.hide_setting
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-pip",
      name: i18n.language.missav.video.playerContorl.hide_pip
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-full",
      name: i18n.language.missav.video.playerContorl.hide_full
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-jump",
      name: i18n.language.missav.video.playerContorl.hide_jump,
      description: i18n.language.missav.video.playerContorl.hide_jump_description,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-video-page-player-ctrl-hide-loop",
      name: i18n.language.missav.video.playerContorl.hide_loop,
      defaultEnable: true
    }
  ];
  const videoToolbarItems$1 = [
    {
      type: "switch",
      id: "missav-video-page-toolbar-hide-save",
      name: i18n.language.missav.video.toolbar.hide_save,
      defaultEnable: true
    },
    {
      type: "switch",
      id: "missav-video-page-toolbar-hide-playlist",
      name: i18n.language.missav.video.toolbar.hide_playlist
    },
    {
      type: "switch",
      id: "missav-video-page-toolbar-hide-download",
      name: i18n.language.missav.video.toolbar.hide_download
    },
    {
      type: "switch",
      id: "missav-video-page-toolbar-hide-share",
      name: i18n.language.missav.video.toolbar.hide_share
    },
    {
      type: "switch",
      id: "missav-video-page-toolbar-show-m3u8",
      name: i18n.language.missav.video.toolbar.show_m3u8,
      description: i18n.language.missav.video.toolbar.show_m3u8_description,
      noStyle: true,
      enableFn: async () => {
        await new Promise((resolve) => {
          const timer = setInterval(() => {
            var _a, _b, _c, _d, _e, _f, _g;
            if ((_a = _unsafeWindow.hls) == null ? undefined : _a.url) {
              const m3u8s = [
                { title: "playlist", url: (_b = _unsafeWindow.hls) == null ? undefined : _b.url }
              ];
              const baseUrl = (_d = (_c = _unsafeWindow.hls) == null ? undefined : _c.url) == null ? undefined : _d.split("playlist")[0];
              const qualitys = (_g = (_f = (_e = _unsafeWindow.player) == null ? undefined : _e.config) == null ? undefined : _f.quality) == null ? undefined : _g.options;
              qualitys == null ? undefined : qualitys.forEach((quality) => {
                if (quality !== 0)
                  m3u8s.push({
                    title: `${quality}p`,
                    url: `${baseUrl}${quality}p/video.m3u8`
                  });
              });
              const m3u8Panle = e$1.createApp(M3U8Comp, {
                m3u8s
              });
              m3u8Panle.mount(
                (() => {
                  var _a2;
                  const node = document.createElement("div");
                  node.id = "div-m3u8s";
                  (_a2 = document.querySelector(
                    "div.flex-1.order-first div.mt-4:has(h1)"
                  )) == null ? undefined : _a2.appendChild(node);
                  return node;
                })()
              );
              clearInterval(timer);
              resolve(true);
            }
          }, 100);
        });
      },
      disableFn: () => {
        const node = document.querySelector("#div-m3u8s");
        if (node) node.remove();
      },
      enableFnRunAt: "document-end"
    },
    {
      type: "switch",
      id: "missav-video-page-toolbar-auto-show-more",
      name: i18n.language.missav.video.toolbar.auto_show_more
    }
  ];
  const videoGroups$2 = [
    {
      name: i18n.language.missav.video.basic.name,
      fold: true,
      items: videoBasicItems$1
    },
    {
      name: i18n.language.missav.video.player.name,
      fold: true,
      items: videoPlayerItems$1
    },
    {
      name: i18n.language.missav.video.playerContorl.name,
      fold: true,
      items: videoPlayerControlItems
    },
    {
      name: i18n.language.missav.video.toolbar.name,
      fold: true,
      items: videoToolbarItems$1
    }
  ];
  const commonStyle$5 = `@charset "UTF-8";html[missav-common-basic-remove-ads] #html-ads,html[missav-common-basic-remove-ads] #ts_ad_video_aes67,html[missav-common-basic-remove-ads] div.pt-16.pb-4.px-4:has(div.hidden),html[missav-common-basic-remove-ads] div[class|=root]:has(div[class|=rootContent]),html[missav-common-basic-remove-ads] div.space-y-6.mb-6:has(div.hidden),html[missav-common-basic-remove-ads] div[x-show^="currentTab === 'video_details'"] div ul,html[missav-common-basic-remove-ads] div.-m-5.mb-2:has(iframe),html[missav-common-basic-remove-ads] html iframe[id|=container],html[missav-common-basic-remove-ads] html iframe[class|=container],html[missav-common-basic-remove-ads] body div.fixed:has(>a[href^="https://bit.ly"][target=_blank]),html[missav-common-basic-remove-ads] body>div[class|=pl]:has(link),html[missav-common-basic-remove-ads] div.flex-1.order-first div.under_player{display:none!important}html[missav-common-basic-hide-footer] footer[aria-labelledby=footerHeading],html[missav-common-basic-hide-footer] #footerHeading,html[missav-common-basic-hide-footer] div.space-y-5.mb-5{display:none!important}html[missav-common-basic-hide-new-site-banner] div:has(>div>div>img[alt="MissAV takeover Fanza"]){display:none!important}html[missav-common-header-hide-logo] div a[href^="https://missav.com"] span.font-serif:has(span),html[missav-common-header-hide-logo] div a[href^="https://missav.ws"] span.font-serif:has(span){visibility:hidden!important}html[missav-common-header-hide-live-cam-sex] a[href*=myavlive],html[missav-common-header-hide-site-live] a[href^="https://missav.live"],html[missav-common-header-hide-upgrade-vip] div a[href$="/vip"],html[missav-common-header-hide-comic] a[href*=mycomic],html[missav-common-header-hide-subtitle] a[href$=-subtitle]{display:none!important}html[missav-common-header-hide-watch-jav] nav div.relative:has(>a[href="#"]):has(>div[x-show$="'jav'"]),html[missav-common-header-hide-watch-jav] div a[href="#"]:has(svg[x-show$="'jav'"]){display:none!important}html[missav-common-header-hide-amateur] nav div.relative:has(>a[href="#"]):has(>div[x-show$="'amateur'"]),html[missav-common-header-hide-amateur] div a[href="#"]:has(svg[x-show$="'amateur'"]){display:none!important}html[missav-common-header-hide-uncensored] nav div.relative:has(>a[href="#"]):has(>div[x-show$="'uncensored'"]),html[missav-common-header-hide-uncensored] div a[href="#"]:has(svg[x-show$="'uncensored'"]){display:none!important}html[missav-common-header-hide-asia-av] nav div.relative:has(>a[href="#"]):has(>div[x-show$="'madou'"]),html[missav-common-header-hide-asia-av] div a[href="#"]:has(svg[x-show$="'madou'"]){display:none!important}html[missav-common-header-hide-my-collection] nav div.relative:has(>a[href="#"]):has(>div[x-show$="'saved'"]),html[missav-common-header-hide-my-collection] div a[href="#"]:has(svg[x-show$="'saved'"]){display:none!important}html[missav-common-header-hide-tg] div.relative>div>div>div>a[href*="https://bit.ly/3uTvrRM"]{display:none!important}html[missav-common-header-hide-more-sites] nav div.relative:has(>a[href="#"]):has(>div[x-show$="'partners'"]),html[missav-common-header-hide-more-sites] div a[href="#"]:has(svg[x-show$="'partners'"]){display:none!important}html[missav-common-header-hide-search] a[alt=検索],html[missav-common-header-hide-search] a[alt=수색],html[missav-common-header-hide-search] a[alt=Cari],html[missav-common-header-hide-search] a[alt=搜寻],html[missav-common-header-hide-search] a[alt=Search]{display:none!important}html[missav-common-header-hide-locale-switcher] div.relative:has(>a[href="#"]):has(>div[x-show$=showLocaleSwitcher]){display:none!important}html[missav-common-header-hide-mobile-right-menu] div div.relative:has(>a[href="#"]):has(>div[x-show$="'mobile'"]){display:none!important}`;
  const homeStyle = 'html[missav-home-page-basic-hide-search-title] div.is-home.content-without-search div div h1:has(span.text-primary){display:none!important}html[missav-home-page-basic-hide-search-box] div.is-home.content-without-search div.flex.flex-col.justify-center.content-center.text-center,html[missav-home-page-basic-hide-search-history] div[x-show="searchHistory.length"],html[missav-home-page-basic-hide-video-genres] div a[x-show^="item.dvd_id &&"] span,html[missav-home-page-basic-hide-video-duration] div a[x-show="item.dvd_id"] span{display:none!important}html[missav-home-page-basic-revert-full-title] div.thumbnail.group div.truncate:has(a[x-text="item.full_title"]){white-space:normal!important}html[missav-home-page-basic-revert-full-title] div.flex-1 div div.max-h-14:has(a[x-text="item.full_title"]){max-height:none!important}html[missav-home-page-basic-blur-video-image] div.relative.rounded.overflow-hidden.shadow-lg,html[missav-home-page-basic-blur-video-title] div.text-sm a[x-text="item.full_title"]{filter:blur(5px)}';
  const searchStyle = 'html[missav-home-page-basic-hide-video-genres] div a[x-show^="item.dvd_id &&"] span,html[missav-home-page-basic-hide-video-duration] div a[x-show="item.dvd_id"] span{display:none!important}html[missav-home-page-basic-revert-full-title] div.thumbnail.group div.truncate:has(>a),html[missav-home-page-basic-revert-full-title] div.thumbnail.group div.truncate:has(a[x-text="item.full_title"]){white-space:normal!important}html[missav-home-page-basic-revert-full-title] div.flex-1 div div.max-h-14:has(a[x-text="item.full_title"]){max-height:none!important}html[missav-home-page-basic-blur-video-image] div.relative.rounded.overflow-hidden.shadow-lg,html[missav-home-page-basic-blur-video-title] div.text-sm a[x-text="item.full_title"]{filter:blur(5px)}';
  const videoStyle$2 = 'html[missav-home-page-basic-hide-video-genres] div a[x-show^="item.dvd_id &&"] span,html[missav-home-page-basic-hide-video-duration] div a[x-show="item.dvd_id"] span{display:none!important}html[missav-home-page-basic-revert-full-title] div.thumbnail.group div.truncate:has(a[x-text="item.full_title"]),html[missav-home-page-basic-revert-full-title] div.flex-1 div div.max-h-14:has(a[x-text="item.full_title"]){white-space:normal!important;max-height:none!important}html[missav-home-page-basic-blur-video-image] div.relative.rounded.overflow-hidden.shadow-lg,html[missav-home-page-basic-blur-video-title] div.text-sm a[x-text="item.full_title"]{filter:blur(5px)}html[missav-video-page-player-hide-new-site-banner] div>div[x-show=showNewDomainNotice]{display:none!important}html[missav-video-page-player-hide-play-btn] div.plyr button.plyr__control--overlaid[data-plyr=play]:has(span.plyr__sr-only){display:none!important}html[missav-video-page-player-ctrl-hide-prev] div.plyr__controls button.plyr__controls__item[data-plyr=rewind],html[missav-video-page-player-ctrl-hide-play] div.plyr__controls button.plyr__controls__item[data-plyr=play],html[missav-video-page-player-ctrl-hide-next] div.plyr__controls button.plyr__controls__item[data-plyr=fast-forward],html[missav-video-page-player-ctrl-hide-progress] div.plyr__controls div.plyr__controls__item.plyr__progress__container,html[missav-video-page-player-ctrl-hide-subtitle] div.plyr__controls button.plyr__controls__item[data-plyr=captions]{display:none!important}html[missav-video-page-player-ctrl-hide-volume] div.plyr__controls div.plyr__controls__item.plyr__volume:has(button[data-plyr=mute]){display:none!important}html[missav-video-page-player-ctrl-hide-setting] div.plyr__controls div.plyr__controls__item.plyr__menu:has(button[data-plyr=settings]){display:none!important}html[missav-video-page-player-ctrl-hide-pip] div.plyr__controls button.plyr__controls__item[data-plyr=pip],html[missav-video-page-player-ctrl-hide-full] div.plyr__controls button.plyr__controls__item[data-plyr=fullscreen]{display:none!important}html[missav-video-page-player-ctrl-hide-jump] div.content-without-search>div>div.order-first>div>div.justify-between.bg-black:has(>span.isolate){display:none!important}html[missav-video-page-player-ctrl-hide-loop] div.content-without-search>div>div.order-first>div>div.bg-black:has(>div.flex.items-center.flex-nowrap>div.grow){display:none!important}html[missav-video-page-toolbar-hide-save] div button:has(svg[x-show$=saved]){display:none!important}html[missav-video-page-toolbar-hide-playlist] div button.shadow-sm:has(svg[stroke-width]){display:none!important}html[missav-video-page-toolbar-hide-download] div a[href^="https://rapidgator.net"]:has(svg){display:none!important}html[missav-video-page-toolbar-hide-share] div button.shadow-sm:has(svg[aria-hidden]){display:none!important}html[missav-video-page-toolbar-auto-show-more] div[x-show^=currentTab] div div[x-data*=showMore] div.text-secondary.break-all{overflow:visible!important;display:block!important;-webkit-box-orient:horizontal!important;-webkit-line-clamp:none!important}html[missav-video-page-toolbar-auto-show-more] div[x-show^=currentTab] div div[x-data*=showMore] div:has(a[href="#"]){display:none!important}';
  const rules$6 = [
    {
      name: "missav-home",
      groups: homeGroups,
      style: homeStyle,
      checkFn: () => isPageMissAvHomepage()
    },
    {
      name: "missav-video",
      groups: videoGroups$2,
      style: videoStyle$2,
      checkFn: () => isPageMissAvVideo()
    },
    {
      name: "missav-search",
      groups: searchGroups,
      style: searchStyle,
      checkFn: () => isPageMissAvSearch()
    },
    {
      name: "missav-common",
      groups: commonGroups$5,
      style: commonStyle$5,
      isSpecial: true,
      checkFn: () => isPageMissAv()
    }
  ];
  const commonBasicItems$4 = [
    {
      type: "switch",
      id: "pornhub-remove-ads",
      name: "移除 广告",
      defaultEnable: true,
      enableFn: () => {
        addAfterResponseInterceptor(
          async (response, requestInit) => {
            var _a;
            const adsUrl = [
              ".pornhub.com/_xa/ads",
              "https://static.trafficjunky.com/ab/ads_test.js",
              ".pornhub.com/_xa/ads_batch",
              "https://video.ktkjmp.com/adsbygoogle.js",
              "https://static.trafficjunky.com/invocation/embeddedads/production/embeddedads.es6.min.js"
            ];
            for (const url of adsUrl) {
              if ((_a = requestInit.url) == null ? undefined : _a.includes(url)) {
                console.log("hook:", requestInit.url);
                return defineResponse({
                  ...response,
                  response: new Blob([""])
                });
              }
            }
            return defineResponse(response);
          }
        );
      }
    },
    {
      type: "switch",
      id: "pornhub-hide-footer",
      name: "隐藏 页底footer",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-hide-adblock",
      name: "隐藏 Adblock通知",
      defaultEnable: true
    }
  ];
  const commonHeaderItems$4 = [
    {
      type: "switch",
      id: "pornhub-common-hide-nav-network-bar",
      name: "隐藏 顶部横条",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop",
      name: "隐藏 左侧菜单"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-logo",
      name: "隐藏 Logo",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-search",
      name: "隐藏 搜索框"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-search-recent",
      name: "隐藏 搜索框-历史搜索"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-search-trending",
      name: "隐藏 搜索框-热门搜索"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-search-pornstar",
      name: "隐藏 搜索框-明星搜索"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-upload-btn-spicevids",
      name: "隐藏 AI JERK",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-upload-btn",
      name: "隐藏 上传图标",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-login",
      name: "隐藏 登录图标",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-home",
      name: "隐藏 首页"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-video",
      name: "隐藏 视频"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-categories",
      name: "隐藏 分类"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-live-cams",
      name: "隐藏 LIVE CAMS",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-pornstars",
      name: "隐藏 色情明星"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-fuck-now",
      name: "隐藏 FUCK NOW",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-community",
      name: "隐藏 社区"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-albums",
      name: "隐藏 照片及动图"
    }
  ];
  const commonDesktopItems = [
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-video",
      name: "隐藏 左侧菜单-精选色情片"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-shorties",
      name: "隐藏 左侧菜单-Shorties"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-recommended",
      name: "隐藏 左侧菜单-推荐视频"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-video-ht",
      name: "隐藏 左侧菜单-热门视频"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-pornstar",
      name: "隐藏 左侧菜单-色情明星和模特"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-active",
      name: "隐藏 左侧菜单-异性恋"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-gayporn",
      name: "隐藏 左侧菜单-男同"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-transgender",
      name: "隐藏 左侧菜单-变性"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-video-27",
      name: "隐藏 左侧菜单-女同"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-channels",
      name: "隐藏 左侧菜单-频道"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-categories",
      name: "隐藏 左侧菜单-热门类别"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-playlists",
      name: "隐藏 左侧菜单-片单"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-gifs",
      name: "隐藏 左侧菜单-色情片动图"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-albums",
      name: "隐藏 左侧菜单-照片"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-community",
      name: "隐藏 左侧菜单-社区"
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-Full-SPICEVIDS",
      name: "隐藏 左侧菜单-Full SPICEVIDS",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-help",
      name: "隐藏 左侧菜单-Trust & Safety",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-uviu",
      name: "隐藏 左侧菜单-UViU",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-blog",
      name: "隐藏 左侧菜单-博客",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-insights",
      name: "隐藏 左侧菜单-洞察",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-sex",
      name: "隐藏 左侧菜单-性健康",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-common-hide-nav-desktop-pornhubapparel",
      name: "隐藏 左侧菜单-商店",
      defaultEnable: true
    },
    {
      type: "switch",
      name: "隐藏 左侧菜单-Personalized Recommendations",
      id: "pornhub-common-hide-nav-desktop-recommend"
    }
  ];
  const commonGroups$4 = [
    {
      name: "全站通用 - 基本功能",
      fold: true,
      items: commonBasicItems$4
    },
    {
      name: "全站通用 - 顶栏",
      fold: true,
      items: commonHeaderItems$4
    },
    {
      name: "全站通用 - 左侧菜单",
      fold: true,
      items: commonDesktopItems
    }
  ];
  const videoPlayerItems = [
    {
      type: "switch",
      id: "pornhub-video-page-auto-fix-player",
      name: "修补 播放器",
      description: ["去除播放广告、开启更多控制"],
      defaultEnable: true,
      enableFnRunAt: "document-end",
      enableFn: async () => {
        var _a;
        const scripts = document.getElementsByTagName("script");
        for (const script of scripts) {
          if (script.src.indexOf("ads_batch") !== -1) {
            script.remove();
          }
          if (script.innerHTML.indexOf("ads_batch") !== -1) {
            script.remove();
          }
        }
        (_a = document.querySelector(`head > meta[name="adsbytrafficjunkycontext"]`)) == null ? undefined : _a.remove();
        _unsafeWindow.iframe_url = "";
        const video = document.getElementById("player");
        const videoId = video == null ? undefined : video.getAttribute("data-video-id");
        let flashvars = _unsafeWindow["flashvars_" + videoId];
        _unsafeWindow["VIDEO_SHOW"]["trafficJunkyurl"] = "";
        flashvars = {
          ...flashvars,
          embedCode: "",
          adRollGlobalConfig: []
        };
        _unsafeWindow["flashvars_" + videoId] = flashvars;
      }
    }
  ];
  const videoToolbarItems = [
    {
      type: "switch",
      id: "pornhub-video-page-hide-below-info-rating-info",
      name: "隐藏 视频数据",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-video-page-hide-below-info-actions-container",
      name: "隐藏 视频操作",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-video-page-hide-below-info-user-info",
      name: "隐藏 发布者信息"
    },
    {
      type: "switch",
      id: "pornhub-video-page-hide-below-info-action",
      name: "隐藏 订阅"
    },
    {
      type: "switch",
      id: "pornhub-video-page-show-below-info-m3u8",
      name: "获取 M3U8",
      description: ["截取并显示m3u8, 可使用其他播放器播放"],
      enableFnRunAt: "document-end",
      enableFn: async () => {
        const video = document.getElementById("player");
        const videoId = video == null ? undefined : video.getAttribute("data-video-id");
        if (!videoId) return;
        const flashvars = _unsafeWindow["flashvars_" + videoId];
        const mediaDefinitions = flashvars["mediaDefinitions"];
        const m3u8urls = [];
        mediaDefinitions.forEach((mediaDefinition) => {
          if (typeof mediaDefinition.quality !== "string") return;
          m3u8urls.push({
            title: mediaDefinition.quality + "p",
            url: mediaDefinition.videoUrl
          });
        });
        const m3u8Panle = e$1.createApp(M3U8Comp, {
          m3u8s: m3u8urls
        });
        m3u8Panle.mount(
          (() => {
            var _a;
            const node = document.createElement("div");
            node.id = "div-m3u8s";
            (_a = document.querySelector(
              "#hd-leftColVideoPage > div.topSectionGrid > div.videoWrapModelInfo.original > div > div.video-actions-menu"
            )) == null ? undefined : _a.appendChild(node);
            return node;
          })()
        );
      },
      disableFn: () => {
        const node = document.querySelector("#div-m3u8s");
        if (node) node.remove();
      }
    },
    {
      type: "switch",
      id: "pornhub-video-page-hide-below-info-comments",
      name: "隐藏 视频评论区",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "pornhub-video-page-hide-below-info-playlists",
      name: "隐藏 视频收录片单"
    }
  ];
  const videoGroups$1 = [
    {
      name: "播放页-播放器",
      fold: true,
      items: videoPlayerItems
    },
    {
      name: "播放页-视频下方信息",
      fold: true,
      items: videoToolbarItems
    }
  ];
  const commonStyle$4 = 'html[pornhub-remove-ads] #hd-leftColVideoPage>div.topSectionGrid>div.sideColumn.original>div.sideAds,html[pornhub-remove-ads] #relatedVideosListing>li.js-nativeTjVideoGrid.js_promoItem:has(>div>iframe),html[pornhub-remove-ads] #hd-leftColVideoPage>div.topSectionGrid>div.videoWrapModelInfo.original>div>div.hd.clear.original,html[pornhub-remove-ads] #videoSearchResult>li.sniperModeEngaged.alpha:has(>div),html[pornhub-remove-ads] #videoSearchResult>li.emptyBlockSpace,html[pornhub-remove-ads] #singleFeedSection>li.emptyBlockSpace,html[pornhub-remove-ads] #singleFeedSection>li.sniperModeEngaged.alpha:has(>div),html[pornhub-remove-ads] #pb_iframe,html[pornhub-remove-ads] #relatedVideosCenter>li.js_promoItem:has(>div>iframe),html[pornhub-remove-ads] #hd-leftColVideoPage>div>div.hd.clear.original:has(>div>iframe),html[pornhub-remove-ads] #hd-rightColVideoPage>div.clearfix:has(>div>div>iframe),html[pornhub-remove-ads] body>div:has(>iframe),html[pornhub-remove-ads] div:has(>ins[style="width:950px;height:250px;display:block;margin:0 auto;"]){display:none!important}html[pornhub-hide-footer] div.footerContentWrapper,html[pornhub-hide-footer] #footer,html[pornhub-hide-footer] div.logoFooterWrapper.homePageFooter,html[pornhub-hide-adblock] #js-abContainterMain{display:none!important}html[pornhub-common-hide-nav-network-bar] body>div.networkBarWrapper{display:none!important}html[pornhub-common-hide-nav-desktop] #desktopNavigation{display:none!important}html[pornhub-common-hide-nav-logo] #headerContainer>div>div>div.logoWrapper{visibility:hidden!important}html[pornhub-common-hide-nav-search] #headerSearchWrapperFree{display:none!important}html[pornhub-common-hide-nav-search-recent] #searchesWrapperScroll>search-list[type=recent]{display:none!important}html[pornhub-common-hide-nav-search-trending] #searchesWrapperScroll>search-list[type=trending]{display:none!important}html[pornhub-common-hide-nav-search-pornstar] #searchesWrapperScroll>search-list[type=pornstar]{display:none!important}html[pornhub-common-hide-nav-upload-btn-spicevids] #headerContainer>div.headerContainerColumn.withSearch.withCustomPromoBtn>div.uploadBtnContentSpicevids{display:none!important}html[pornhub-common-hide-nav-upload-btn] #headerContainer>div.headerContainerColumn.withSearch.withCustomPromoBtn>div.uploadBtnContent{display:none!important}html[pornhub-common-hide-nav-login] #headerLoginLink{display:none!important}html[pornhub-common-hide-nav-home] li[itemprop=name]:has(>a.js-topMenuLink[href="/"]){display:none!important}html[pornhub-common-hide-nav-video] li[itemprop=name]:has(>a.js-topMenuLink[href="/video"]){display:none!important}html[pornhub-common-hide-nav-categories] li[itemprop=name]:has(>a.js-topMenuLink[href="/categories"]){display:none!important}html[pornhub-common-hide-nav-live-cams] li[itemprop=name]:has(>a.js-topMenuLink[data-label2="Live Cams"]){display:none!important}html[pornhub-common-hide-nav-pornstars] li[itemprop=name]:has(>a.js-topMenuLink[href="/pornstars"]){display:none!important}html[pornhub-common-hide-nav-fuck-now] li:has(>a.js-topMenuLink[data-label2="Fuck Now"]){display:none!important}html[pornhub-common-hide-nav-community] li[itemprop=name]:has(>a.js-topMenuLink[href="/community"]){display:none!important}html[pornhub-common-hide-nav-albums] li[itemprop=name]:has(>a.js-topMenuLink[href="/albums"]){display:none!important}html[pornhub-common-hide-nav-desktop-video] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/video"]{display:none!important}html[pornhub-common-hide-nav-desktop-shorties] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/shorties"]{display:none!important}html[pornhub-common-hide-nav-desktop-recommended] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/recommended"]{display:none!important}html[pornhub-common-hide-nav-desktop-video-ht] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/video?o=ht"]{display:none!important}html[pornhub-common-hide-nav-desktop-pornstar] #leftMenuScroll>div.menuLink.subMenuTriggerwithLink.pornstarNavigation{display:none!important}html[pornhub-common-hide-nav-desktop-active] #leftMenuScroll>a.menuLink.js-menuAnalytics.active[href="/"]{display:none!important}html[pornhub-common-hide-nav-desktop-gayporn] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/gayporn"]{display:none!important}html[pornhub-common-hide-nav-desktop-transgender] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/transgender"]{display:none!important}html[pornhub-common-hide-nav-desktop-video-27] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/video?c=27"]{display:none!important}html[pornhub-common-hide-nav-desktop-channels] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/channels"]{display:none!important}html[pornhub-common-hide-nav-desktop-categories] #leftMenuScroll>div.menuLink.subMenuTriggerwithLink.categoriesNavigation{display:none!important}html[pornhub-common-hide-nav-desktop-playlists] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/playlists"]{display:none!important}html[pornhub-common-hide-nav-desktop-gifs] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/gifs"]{display:none!important}html[pornhub-common-hide-nav-desktop-albums] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/albums"]{display:none!important}html[pornhub-common-hide-nav-desktop-community] #leftMenuScroll>div.menuLink.subMenuTriggerwithLink.communityNavigation{display:none!important}html[pornhub-common-hide-nav-desktop-Full-SPICEVIDS] #leftMenuScroll>div.menuLinkDiv{display:none!important}html[pornhub-common-hide-nav-desktop-help] #leftMenuScroll>a[href^="https://help.pornhub.com/hc/en-us/categories/"]{display:none!important}html[pornhub-common-hide-nav-desktop-uviu] #leftMenuScroll>div:has(>a[data-menu-clog=ham-uviu]){display:none!important}html[pornhub-common-hide-nav-desktop-blog] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="/blog"]{display:none!important}html[pornhub-common-hide-nav-desktop-insights] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="https://www.pornhub.com/insights/"]{display:none!important}html[pornhub-common-hide-nav-desktop-sex] #leftMenuScroll>a.menuLink.js-menuAnalytics[href="https://www.pornhub.com/sex/"]{display:none!important}html[pornhub-common-hide-nav-desktop-pornhubapparel] #leftMenuScroll>div:has(>a[href="https://pornhubapparel.com/"]){display:none!important}html[pornhub-common-hide-nav-desktop-recommend] #leftMenuScroll>div.toggleSwitchWrapper:has(>div.toggleSwitch>#recommendSwitch){display:none!important}';
  const videoStyle$1 = "html[jabletv-video-page-hide-bpx-player-state-wrap] div.plyr button.plyr__control--overlaid[data-plyr=play]:has(span.plyr__sr-only){display:none!important}html[pornhub-video-page-hide-below-info-rating-info] #hd-leftColVideoPage>div.topSectionGrid>div.videoWrapModelInfo.original>div>div.video-actions-menu>div.ratingInfo,html[pornhub-video-page-hide-below-info-rating-info] #hd-leftColVideoPage>div>div.video-actions-menu>div.ratingInfo{display:none!important}html[pornhub-video-page-hide-below-info-actions-container] #hd-leftColVideoPage>div.topSectionGrid>div.videoWrapModelInfo.original>div>div.video-actions-menu>div.allActionsContainer.tooltipWrapper,html[pornhub-video-page-hide-below-info-actions-container] #hd-leftColVideoPage>div>div.video-actions-menu>div.allActionsContainer.tooltipWrapper{display:none!important}html[pornhub-video-page-hide-below-info-user-info] #hd-leftColVideoPage>div.topSectionGrid>div.videoWrapModelInfo.original>div>div.video-actions-container>div.video-actions-tabs>div.video-action-tab.about-tab.active>div.video-detailed-info,html[pornhub-video-page-hide-below-info-user-info] #hd-leftColVideoPage>div>div.video-actions-container>div.video-actions-tabs>div.video-action-tab.about-tab.active>div.video-detailed-info{display:none!important}html[pornhub-video-page-hide-below-info-action] #hd-leftColVideoPage>div>div.video-actions-container>div.video-actions-tabs>div.video-action-tab.about-tab.active>div.video-detailed-info>div.video-info-row.userRow>div.userActions{display:none!important}html[pornhub-video-page-hide-below-info-comments] #under-player-comments,html[pornhub-video-page-hide-below-info-playlists] #under-player-playlists{display:none!important}";
  const rules$5 = [
    {
      name: "pornhub-video",
      groups: videoGroups$1,
      style: videoStyle$1,
      checkFn: isPagePornHubVideo
    },
    {
      name: "pornhub-common",
      groups: commonGroups$4,
      style: commonStyle$4,
      isSpecial: true,
      checkFn: isPagePornHub
    }
  ];
  const commonBasicItems$3 = [
    {
      type: "switch",
      id: "91porn-remove-ads",
      name: "移除 广告",
      attrName: "remove-ads",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-footer",
      name: "隐藏 页底footer",
      attrName: "hide-footer",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-skip-adult-verify",
      name: "跳过 成年认证页",
      noStyle: true,
      defaultEnable: true,
      enableFn: () => {
        if (_unsafeWindow.location.pathname === "/") {
          _unsafeWindow.location.href += "index.php";
        }
      }
    },
    {
      type: "switch",
      id: "91porn-show-video-full-title",
      name: "显示 完整标题",
      attrName: "show-video-full-title",
      defaultEnable: true
    }
  ];
  const commonHeaderItems$3 = [
    {
      type: "switch",
      id: "91porn-hide-header-top-menu-language",
      name: "隐藏 语言",
      attrName: "hide-header-top-menu-language"
    },
    {
      type: "switch",
      id: "91porn-hide-header-top-menu-signup",
      name: "隐藏 注册",
      attrName: "hide-header-top-menu-signup"
    },
    {
      type: "switch",
      id: "91porn-hide-header-top-menu-login",
      name: "隐藏 登录",
      attrName: "hide-header-top-menu-login"
    },
    {
      type: "switch",
      id: "91porn-hide-header-navbar-header-logo",
      name: "隐藏 LOGO",
      attrName: "hide-header-navbar-header-logo"
    },
    {
      type: "switch",
      id: "91porn-hide-header-navbar-right-upload",
      name: "隐藏 上传",
      attrName: "hide-header-navbar-right-upload",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-header-navbar-right-watch",
      name: "隐藏 视频",
      attrName: "hide-header-navbar-right-watch"
    },
    {
      type: "switch",
      id: "91porn-hide-header-navbar-right-forum",
      name: "隐藏 自拍论坛",
      attrName: "hide-header-navbar-right-forum",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-header-navbar-right-webcam",
      name: "隐藏 美女视频",
      attrName: "hide-header-navbar-right-webcam",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-header-navbar-right-ugatube",
      name: "隐藏 电影中心",
      attrName: "hide-header-navbar-right-ugatube",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-header-navbar-right-pay",
      name: "隐藏 VIP会员",
      attrName: "hide-header-navbar-right-pay",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-my-video",
      name: "隐藏 我的视频",
      attrName: "hide-header-submenu-my-video"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-my-favour",
      name: "隐藏 我的收藏",
      attrName: "hide-header-submenu-my-favour"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-my-subs-users",
      name: "隐藏 我关注的用户",
      attrName: "hide-header-submenu-my-subs-users"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-my-subs",
      name: "隐藏 我关注用户的视频",
      attrName: "hide-header-submenu-my-subs"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-my-comment",
      name: "隐藏 我的留言",
      attrName: "hide-header-submenu-my-comment",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-yqm",
      name: "隐藏 论坛邀请码",
      attrName: "hide-header-submenu-yqm",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-ori",
      name: "隐藏 91原创",
      attrName: "hide-header-submenu-category-ori"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-hot",
      name: "隐藏 当前最热",
      attrName: "hide-header-submenu-category-hot"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-top",
      name: "隐藏 本月最热",
      attrName: "hide-header-submenu-category-top"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-long",
      name: "隐藏 10分钟以上 ",
      attrName: "hide-header-submenu-category-long"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-longer",
      name: "隐藏 20分钟以上 ",
      attrName: "hide-header-submenu-category-longer"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-tf",
      name: "隐藏 本月收藏",
      attrName: "hide-header-submenu-category-tf"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-rf",
      name: "隐藏 最近加精",
      attrName: "hide-header-submenu-category-rf"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-hd",
      name: "隐藏 高清",
      attrName: "hide-header-submenu-category-hd"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-top-1",
      name: "隐藏 每月最热",
      attrName: "hide-header-submenu-category-top-1"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-md",
      name: "隐藏 本月讨论",
      attrName: "hide-header-submenu-category-md"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-mf",
      name: "隐藏  收藏最多",
      attrName: "hide-header-submenu-category-mf"
    }
  ];
  const commonGroups$3 = [
    {
      name: "全站通用 - 基本功能",
      fold: true,
      items: commonBasicItems$3
    },
    {
      name: "全站通用 - Header",
      fold: true,
      items: commonHeaderItems$3
    }
  ];
  const vBasicItems = [];
  const vHeaderItems = [
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-ori",
      name: "隐藏 91原创",
      attrName: "hide-header-submenu-category-ori"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-hot",
      name: "隐藏 当前最热",
      attrName: "hide-header-submenu-category-hot"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-top",
      name: "隐藏 本月最热",
      attrName: "hide-header-submenu-category-top"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-long",
      name: "隐藏 10分钟以上 ",
      attrName: "hide-header-submenu-category-long"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-longer",
      name: "隐藏 20分钟以上 ",
      attrName: "hide-header-submenu-category-longer"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-tf",
      name: "隐藏 本月收藏",
      attrName: "hide-header-submenu-category-tf"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-rf",
      name: "隐藏 最近加精",
      attrName: "hide-header-submenu-category-rf"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-hd",
      name: "隐藏 高清",
      attrName: "hide-header-submenu-category-hd"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-top-1",
      name: "隐藏 每月最热",
      attrName: "hide-header-submenu-category-top-1"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-md",
      name: "隐藏 本月讨论",
      attrName: "hide-header-submenu-category-md"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-mf",
      name: "隐藏  收藏最多",
      attrName: "hide-header-submenu-category-mf"
    }
  ];
  const vGroups = [
    {
      name: "搜索页 - 基本功能",
      fold: true,
      items: vBasicItems
    },
    {
      name: "搜索页 - Header",
      fold: true,
      items: vHeaderItems
    }
  ];
  const videoBasicItems = [
    {
      type: "switch",
      id: "91porn-fix-player",
      name: "修补 播放器",
      noStyle: true,
      defaultEnable: true,
      enableFnRunAt: "document-start",
      enableFn: () => {
        waitForEle(
          document,
          "#videodetails > div.video-container",
          (node) => {
            if (!node) return false;
            if (node instanceof HTMLScriptElement) {
              if (node.tagName !== "SCRIPT") return false;
              if (!node.innerText.includes(`videojs`)) return false;
              node.parentNode.removeChild(node);
              if (!window.videojs) return false;
              window.player = window.videojs(
                "player_one"
              );
              window.player.nuevo({
                logotitle: "老司机修炼手册",
                logo: "images/logo1.png",
                logoposition: "RT",
                logourl: "https://www.91porn.com"
              });
              window.player.pip();
              window.player.seekButtons({
                forward: 10,
                back: 10
              });
              return true;
            }
            return false;
          }
        );
      }
    },
    {
      type: "switch",
      id: "91porn-hide-video-details-data",
      name: "移除 视频下方数据",
      attrName: "hide-video-details-data"
    },
    {
      type: "switch",
      id: "91porn-hide-video-details-option",
      name: "移除 视频下方操作栏",
      attrName: "hide-video-details-option",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-video-details-content",
      name: "移除 视频下方声明",
      attrName: "hide-video-details-content",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-video-details-info",
      name: "移除 视频信息",
      attrName: "hide-video-details-info",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porn-hide-video-details-comment",
      name: "移除 此视频留言",
      attrName: "hide-video-details-comment"
    }
  ];
  const videoHeaderItems = [
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-ori",
      name: "隐藏 91原创",
      attrName: "hide-header-submenu-category-ori"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-hot",
      name: "隐藏 当前最热",
      attrName: "hide-header-submenu-category-hot"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-top",
      name: "隐藏 本月最热",
      attrName: "hide-header-submenu-category-top"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-long",
      name: "隐藏 10分钟以上 ",
      attrName: "hide-header-submenu-category-long"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-longer",
      name: "隐藏 20分钟以上 ",
      attrName: "hide-header-submenu-category-longer"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-tf",
      name: "隐藏 本月收藏",
      attrName: "hide-header-submenu-category-tf"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-rf",
      name: "隐藏 最近加精",
      attrName: "hide-header-submenu-category-rf"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-hd",
      name: "隐藏 高清",
      attrName: "hide-header-submenu-category-hd"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-top-1",
      name: "隐藏 每月最热",
      attrName: "hide-header-submenu-category-top-1"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-md",
      name: "隐藏 本月讨论",
      attrName: "hide-header-submenu-category-md"
    },
    {
      type: "switch",
      id: "91porn-hide-header-submenu-category-mf",
      name: "隐藏  收藏最多",
      attrName: "hide-header-submenu-category-mf"
    }
  ];
  const videoGroups = [
    {
      name: "播放页 - 基本功能",
      fold: true,
      items: videoBasicItems
    },
    {
      name: "播放页 - Header",
      fold: true,
      items: videoHeaderItems
    }
  ];
  const commonStyle$3 = 'html[remove-ads] #row>iframe,html[remove-ads] #videodetails>div:has(>a>img.ad_img),html[remove-ads] #videodetails>iframe,html[remove-ads] body>div:has(>div[align=center]>div.cont6){display:none!important}html[hide-footer] #footer-container{display:none!important}html[show-video-full-title] #row>div.well>a>span.video-title,html[show-video-full-title] #wrapper>div.container.container-minheight>div.row>div>div.row>div>div.well>a>span.video-title{white-space:normal!important;max-height:none!important}html[hide-header-top-menu-language] div.top-nav>div>ul>div.pull-left>form[name=language_form]{display:none!important}html[hide-header-top-menu-signup] div.top-nav>div>ul>div.pull-right>li:has(>a[href="signup.php"]){display:none!important}html[hide-header-top-menu-login] div.top-nav>div>ul>div.pull-right>li:has(>a[href="login.php"]){display:none!important}html[hide-header-navbar-header-logo] div.navbar.navbar-inverse.navbar-fixed-top>div.container>div.navbar-header:has(>a>img[src="/images/logo.png"]){display:none!important}html[hide-header-navbar-right-upload] div.navbar.navbar-inverse.navbar-fixed-top>div.container>div.navbar-collapse.collapse.navbar-inverse-collapse>ul>li:has(>a[href^="https://up"]){display:none!important}html[hide-header-navbar-right-watch] div.navbar.navbar-inverse.navbar-fixed-top>div.container>div.navbar-collapse.collapse.navbar-inverse-collapse>ul>li:has(>a[href="https://91porn.com/v.php?next=watch"]){display:none!important}html[hide-header-navbar-right-forum] div.navbar.navbar-inverse.navbar-fixed-top>div.container>div.navbar-collapse.collapse.navbar-inverse-collapse>ul>li:has(>a[href="https://t1229.btc760.com"]){display:none!important}html[hide-header-navbar-right-webcam] div.navbar.navbar-inverse.navbar-fixed-top>div.container>div.navbar-collapse.collapse.navbar-inverse-collapse>ul>li:has(>a[href="webcam.php"]){display:none!important}html[hide-header-navbar-right-ugatube] div.navbar.navbar-inverse.navbar-fixed-top>div.container>div.navbar-collapse.collapse.navbar-inverse-collapse>ul>li:has(>a[href="https://www.ugatube.com"]){display:none!important}html[hide-header-navbar-right-pay] div.navbar.navbar-inverse.navbar-fixed-top>div.container>div.navbar-collapse.collapse.navbar-inverse-collapse>ul>li:has(>a[href="pay.php"]){display:none!important}html[hide-header-submenu-my-video] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/my_video.php"]){display:none!important}html[hide-header-submenu-my-favour] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/my_favour.php"]){display:none!important}html[hide-header-submenu-my-subs-users] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/my_subs_users.php"]){display:none!important}html[hide-header-submenu-my-subs] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/my_subs.php"]){display:none!important}html[hide-header-submenu-my-comment] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/my_comment.php"]){display:none!important}html[hide-header-submenu-yqm] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/yqm.php"]){display:none!important}html[hide-header-submenu-category-ori] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=ori&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-hot] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=hot&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-top] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=top&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-long] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=long&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-longer] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=longer&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-tf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=tf&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-rf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=rf&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-hd] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=hd&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-top-1] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=top&m=-1&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-md] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=md&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-mf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=mf&viewtype=basic"]){display:none!important}';
  const videoStyle = 'html[hide-video-details-data] #useraction>div.boxPart:has(>span.info){display:none!important}html[hide-video-details-option] #useraction>div.boxPart:has(>div.floatmenu){display:none!important}html[hide-video-details-content] #useraction>div:has(>a[href="speed.php"]){display:none!important}html[hide-video-details-info] div.videodetails-yakov:has(>form>#fm-video_link){display:none!important}html[hide-video-details-comment] div.videodetails-yakov:has(>div>div.main_comment){display:none!important}html[hide-header-submenu-category-ori] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=ori&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-hot] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=hot&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-top] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=top&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-long] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=long&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-longer] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=longer&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-tf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=tf&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-rf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=rf&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-hd] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=hd&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-top-1] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=top&m=-1&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-md] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=md&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-mf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=mf&viewtype=basic"]){display:none!important}';
  const vStyle = 'html[hide-header-submenu-category-ori] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=ori&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-hot] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=hot&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-top] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=top&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-long] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=long&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-longer] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=longer&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-tf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=tf&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-rf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=rf&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-hd] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=hd&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-top-1] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=top&m=-1&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-md] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=md&viewtype=basic"]){display:none!important}html[hide-header-submenu-category-mf] div.navbar.navbar-inverse.navbar-fixed-top>div.submenu>div>div>ul>li:has(>a[href="https://91porn.com/v.php?category=mf&viewtype=basic"]){display:none!important}';
  const rules$4 = [
    {
      name: "common",
      groups: commonGroups$3,
      style: commonStyle$3,
      isSpecial: true,
      checkFn: isPage91Porn
    },
    {
      name: "v",
      groups: vGroups,
      style: vStyle,
      checkFn: isPage91PornV
    },
    {
      name: "video",
      groups: videoGroups,
      style: videoStyle,
      checkFn: isPage91PornVideo
    }
  ];
  const commonBasicItems$2 = [
    {
      type: "switch",
      id: "91porna-remove-ads",
      name: "移除 广告",
      attrName: "remove-ads",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-hide-footer",
      name: "隐藏 页底footer",
      attrName: "hide-footer",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-hide-footer-more-site",
      name: "隐藏 精品推荐",
      attrName: "hide-footer-more-site",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-hide-footer-more-site-1",
      name: "友情链接",
      attrName: "hide-footer-more-site-1",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-show-video-full-title",
      name: "显示 完整标题",
      attrName: "show-video-full-title",
      defaultEnable: true
    }
  ];
  const commonHeaderItems$2 = [
    {
      type: "switch",
      id: "91porna-hide-header-logo",
      name: "隐藏 LOGO",
      attrName: "hide-header-logo"
    },
    {
      type: "switch",
      id: "91porna-hide-header-search",
      name: "隐藏 搜索框",
      attrName: "hide-header-search"
    },
    {
      type: "switch",
      id: "91porna-hide-header-login",
      name: "隐藏 登录/注册",
      attrName: "hide-header-login"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-home",
      name: "移除 首页",
      attrName: "hide-header-nav-home"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-video",
      name: "移除 视频",
      attrName: "hide-header-nav-video"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-info",
      name: "移除 黑料吃瓜",
      attrName: "hide-header-nav-info"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-av",
      name: "移除 日本AV",
      attrName: "hide-header-nav-av"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-novel",
      name: "移除 色情小说",
      attrName: "hide-header-nav-novel"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-g-video",
      name: "移除 搜同G片",
      attrName: "hide-header-nav-g-video"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-app",
      name: "移除 📱手机App",
      attrName: "hide-header-nav-app"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-more-site",
      name: "移除 💖更多色站💖",
      attrName: "hide-header-nav-more-site"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-info-1",
      name: "移除 黑料吃瓜网",
      attrName: "hide-header-nav-info-1"
    },
    {
      type: "switch",
      id: "91porna-hide-header-nav-new-url",
      name: "移除 最新地址",
      attrName: "hide-header-nav-new-url"
    }
  ];
  const commonVideoItems = [
    {
      type: "switch",
      id: "91porna-hide-video-data",
      name: "隐藏 视频数据",
      attrName: "hide-video-data",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-hide-video-keyword",
      name: "隐藏 视频关键词",
      attrName: "hide-video-keyword",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-hide-video-uploader",
      name: "隐藏 视频作者信息",
      attrName: "hide-video-uploader",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-hide-video-info",
      name: "隐藏 视频描述",
      attrName: "hide-video-info",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "91porna-hide-video-more-site",
      name: "隐藏 视频推广链接",
      attrName: "hide-video-more-site",
      defaultEnable: true
    }
  ];
  const commonGroups$2 = [
    {
      name: "全站通用 - 基本功能",
      fold: true,
      items: commonBasicItems$2
    },
    {
      name: "全站通用 - Header",
      fold: true,
      items: commonHeaderItems$2
    },
    {
      name: "全站通用 - Video",
      fold: true,
      items: commonVideoItems
    }
  ];
  const commonStyle$2 = '@charset "UTF-8";html[remove-ads] body>div.modal-backdrop.fade.in,html[remove-ads] body>main>div>div>div>ul>li:has(>a.checkNum[target=_blank]),html[remove-ads] body>main>div>div.flex-1>div:has(>div>div.swiper),html[remove-ads] #tip_modal,html[remove-ads] body>main>div:has(>div.grid>div.dx-banner-item),html[remove-ads] body>main>div.text-mini.mb-3:has(>ul.dx-recommend-icons){display:none!important}html[hide-footer] #app-footer{display:none!important}html[show-video-full-title] body>main.app-content>div.index-content>div>ul.video-items>li>div.video-item>div>a,html[show-video-full-title] body>main.app-content>div.grid>div>div>ul.video-items>li>div.video-item>div>a>div{white-space:normal!important;max-height:none!important;overflow:none!important;display:contents!important}html[hide-footer-more-site] body>main>div:has(>ul.grid>li:nth-child(1)>a[rel="external nofollow"]>img[_type=data-src]){display:none!important}html[hide-footer-more-site-1] body>main>div:has(>ul.flex>li:nth-child(1)>a[rel="external nofollow"]){display:none!important}html[hide-header-logo] #app-header>div>div>div.app-header>div:has(>a>picture>h1>img.app-logo){display:none!important}html[hide-header-search] #app-header>div>div>div.app-header>div.search-box{display:none!important}html[hide-header-login] #app-header>div>div>div.app-header>div>div.popover-container:has(>button.btn-login){display:none!important}html[hide-header-nav-home] #app-nav>ul.dx-container>li.flex:has(>a[href="/"]){display:none!important}html[hide-header-nav-video] #app-nav>ul.dx-container>li.flex:has(>a[href="https://91porna.com/comic/index/video?category=play"]){display:none!important}html[hide-header-nav-info] #app-nav>ul.dx-container>li.flex:has(>a[href="https://91porna.com/黑料吃瓜"]){display:none!important}html[hide-header-nav-av] #app-nav>ul.dx-container>li.flex:has(>a[href="https://91porna.com/comic/index/av"]){display:none!important}html[hide-header-nav-novel] #app-nav>ul.dx-container>li.flex:has(>a[href="https://91porna.com/comic/index/postNovel"]){display:none!important}html[hide-header-nav-g-video] #app-nav>ul.dx-container>li.flex:has(>a[href$=".tcuwpcyu.cc?ref=91porna"]){display:none!important}html[hide-header-nav-app] #app-nav>ul.dx-container>li.flex:has(>a[href="https://103.mrkcnifa.cc/chan-1907/aff-kz8RU"]),html[hide-header-nav-app] #app-nav>ul.dx-container>li.flex:has(>a[href="https://5cde2.josojuri.cc/?code=hFQ&c=2663"]){display:none!important}html[hide-header-nav-more-site] #app-nav>ul.dx-container>li.flex:has(>a[href$=".gjsvuqtp.cc?ref=91porna"]),html[hide-header-nav-more-site] #app-nav>ul.dx-container>li.flex:has(>a[href$=".qcmvoilg.cc?ref=91porna"]){display:none!important}html[hide-header-nav-info-1] #app-nav>ul.dx-container>li.flex:has(>a[href$=".fjobeijt.cc?ref=91porna"]){display:none!important}html[hide-header-nav-new-url] #app-nav>ul.dx-container>li.flex:has(>a[href="https://91porna.com/comic/index/links?key=home"]){display:none!important}html[hide-video-data] body>main>div>div>div>div:has(>div>svg>use[href="/static/web/icons/icons.svg#time"]){display:none!important}html[hide-video-keyword] body>main>div>div>div>div.dx-tabs>div.dx-tab-content.dx-tab-content--active>ul.text-default:has(>li.items-center>a.link[href^="https://91porna.com/comic/index/search?keyword="]){display:none!important}html[hide-video-uploader] body>main>div>div>div>div.dx-tabs>div.dx-tab-content.dx-tab-content--active>div.dx-hairline--bottom>div.items-center:has(>div>div>a[href^="https://91porna.com/comic/index/publicvideo?user_id="]){display:none!important}html[hide-video-info] body>main>div>div>div>div.dx-tabs>div.dx-tab-content.dx-tab-content--active>div.dx-hairline--bottom>h2{display:none!important}html[hide-video-more-site] body>main>div>div>div>div.dx-tabs>div.dx-tab-content.dx-tab-content--active>div.dx-hairline--bottom>div[style="color:#ccc;line-height:24px"],html[hide-video-more-site] body>main>div>div>div>div.dx-tabs>div.dx-tab-content.dx-tab-content--active>div:has(>strong.dx-subtitle),html[hide-video-more-site] body>main>div>div>div.mt-2.md\\:mt-3>div.dx-tabs.text-xl>div.dx-tab-content.dx-tab-content--active>ul.grid.items-center:has(>li.w-full>a.checkNum[target=_blank]){display:none!important}';
  const rules$3 = [
    {
      name: "common",
      groups: commonGroups$2,
      style: commonStyle$2,
      isSpecial: true,
      checkFn: isPage91Porna
    }
  ];
  const commonBasicItems$1 = [
    {
      type: "switch",
      id: "18comic-hide-top-menu-link",
      name: "移除 上方推广链接",
      attrName: "hide-top-menu-link",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-remove-ads",
      name: "移除 广告",
      attrName: "remove-ads",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-footer",
      name: "隐藏 页底footer",
      attrName: "hide-footer",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-adblock",
      name: "隐藏 Adblock通知",
      attrName: "hide-adblock",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-adult-verify",
      name: "隐藏 成年确认",
      attrName: "hide-adult-verify",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-float-right-daily",
      name: "隐藏 每日签到浮窗",
      attrName: "hide-float-right-daily",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-float-right-image",
      name: "隐藏 右下角浮窗",
      attrName: "hide-float-right-image",
      defaultEnable: true
    }
  ];
  const commonHeaderItems$1 = [
    {
      type: "switch",
      id: "18comic-hide-header-logo",
      name: "隐藏 LOGO",
      attrName: "hide-header-logo"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-adulta",
      name: "隐藏 成人A漫",
      attrName: "hide-header-btn-adulta"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-theme",
      name: "隐藏 分類",
      attrName: "hide-header-btn-theme"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-hmovies",
      name: "隐藏 H動漫",
      attrName: "hide-header-btn-hmovies",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-games",
      name: "隐藏 遊戲",
      attrName: "hide-header-btn-games",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-blogs",
      name: "隐藏 紳夜食堂",
      attrName: "hide-header-btn-blogs",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-forum",
      name: "隐藏 評論區",
      attrName: "hide-header-btn-forum",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-ai-chat",
      name: "隐藏 AI Chat",
      attrName: "hide-header-btn-ai-chat",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-veteran",
      name: "隐藏 好站推薦",
      attrName: "hide-header-btn-veteran",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-theme-toggle",
      name: "隐藏 夜间模式切换",
      attrName: "hide-header-btn-theme-toggle"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-bonus",
      name: "隐藏 禁漫一番賞",
      attrName: "hide-header-btn-bonus",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-week",
      name: "隐藏 每周必看",
      attrName: "hide-header-btn-week"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-phone",
      name: "隐藏 手机版安装",
      attrName: "hide-header-btn-phone",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-album",
      name: "隐藏 随机漫画",
      attrName: "hide-header-btn-album"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-user",
      name: "隐藏 登录注册",
      attrName: "hide-header-btn-user"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-search",
      name: "隐藏 搜索",
      attrName: "hide-header-btn-search"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-notice",
      name: "隐藏 JM公告",
      attrName: "hide-header-btn-notice"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-up-comic",
      name: "隐藏 上傳漫畫",
      attrName: "hide-header-btn-up-comic"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-ad-mail",
      name: "隐藏 廣告洽詢",
      attrName: "hide-header-btn-ad-mail",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-pay",
      name: "隐藏 打賞JM",
      attrName: "hide-header-btn-pay",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-shunt",
      name: "隐藏 分流",
      attrName: "hide-header-btn-shunt"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-language",
      name: "隐藏 选择语言",
      attrName: "hide-header-btn-language"
    },
    {
      type: "switch",
      id: "18comic-hide-header-btn-url-copy",
      name: "隐藏 收藏永久網域",
      attrName: "hide-header-btn-url-copy",
      defaultEnable: true
    }
  ];
  const commonAlbumItems = [
    {
      type: "switch",
      id: "18comic-hide-thumb-albums-latest",
      name: "隐藏 更新",
      attrName: "hide-thumb-albums-latest"
    },
    {
      type: "switch",
      id: "18comic-hide-thumb-albums-category",
      name: "隐藏 类型",
      attrName: "hide-thumb-albums-category"
    },
    {
      type: "switch",
      id: "18comic-hide-thumb-albums-likes",
      name: "隐藏 喜欢数",
      attrName: "hide-thumb-albums-likes",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-thumb-albums-bookmark",
      name: "隐藏 收藏",
      attrName: "hide-thumb-albums-bookmark",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-thumb-albums-title",
      name: "隐藏 标题",
      attrName: "hide-thumb-albums-title"
    },
    {
      type: "switch",
      id: "18comic-show-thumb-albums-full-title",
      name: "显示 完整标题",
      attrName: "show-thumb-albums-full-title",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-thumb-albums-author",
      name: "隐藏 作者",
      attrName: "hide-thumb-albums-author",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "18comic-hide-thumb-albums-tags",
      name: "隐藏 标签",
      attrName: "hide-thumb-albums-tags",
      defaultEnable: true
    }
  ];
  const commonGroups$1 = [
    {
      name: "全站通用 - 基本功能",
      fold: true,
      items: commonBasicItems$1
    },
    {
      name: "全站通用 - Header",
      fold: true,
      items: commonHeaderItems$1
    },
    {
      name: "全站通用 - Album",
      fold: true,
      items: commonAlbumItems
    }
  ];
  const commonStyle$1 = 'html[hide-top-menu-link] div.top-nav>div>ul>div.center>li.top-menu-m:has(>a[target=_blank]),html[hide-top-menu-link] div.top-nav>div>ul>div.pull-left>li.top-menu-link:has(>a[target=_blank]){display:none!important}html[remove-ads] #wrapper>div.hidden-lg:has(>div[class$=_sticky2]),html[remove-ads] div.panel-body>div>div.center.scramble-page.thewayhome>a[href="https://jmcomicgo.me"],html[remove-ads] #wrapper>div>div>div>div>div:has(>div.photo_center_div>div.e8c78e-4_b>div.group-notice),html[remove-ads] div.panel-body>div>div>div.e8c78e-4_b:has(>div.group-notice),html[remove-ads] #wrapper>div.container>div.row:has(>div>div.e8c78e-4_b>div.group-notice),html[remove-ads] #wrapper>div.container>div.row>div:has(>div.e8c78e-4_b>div.group-notice){display:none!important}html[hide-footer] #wrapper>div.footer-container{display:none!important}html[hide-adblock] #wrapper>div>div>div>div>div[style="font-size: 10px;text-align: center;margin: 5px;"]{display:none!important}html[hide-adult-verify] body>div.modal-backdrop.fade.in,html[hide-adult-verify] #billboard-modal{display:none!important}html[hide-float-right-daily] #wrapper>div.float-right-daily{display:none!important}html[hide-float-right-image] #wrapper>div.float-right-image{display:none!important}html[hide-header-logo] div.navbar-header>a[href="/"]>img[alt=logo]{display:none!important}html[hide-header-btn-adulta] #adulta{display:none!important}html[hide-header-btn-theme] #wrapper>div.ph-bottom>ul>li:has(>a[href="/theme"]),html[hide-header-btn-theme] ul.nav.navbar-nav.navbar-left>li:has(>a[href="/theme/"]){display:none!important}html[hide-header-btn-hmovies] #hmovies{display:none!important}html[hide-header-btn-games] #wrapper>div.ph-bottom>ul>li:has(>a[href="/games"]),html[hide-header-btn-games] ul.nav.navbar-nav.navbar-left>li:has(>a[href="/games"]){display:none!important}html[hide-header-btn-blogs] ul.nav.navbar-nav.navbar-left>li:has(>a[href="/blogs"]){display:none!important}html[hide-header-btn-forum] #wrapper>div.ph-bottom>ul>li:has(>a[href="/forum"]),html[hide-header-btn-forum] #sns,html[hide-header-btn-forum] ul.nav.navbar-nav.navbar-left>li:has(>a[href="/forum/"]){display:none!important}html[hide-header-btn-ai-chat] #wrapper>div.ph-bottom>ul>li:has(>a[href="https://s.zlinkp.com/d.php?z=5278412"]),html[hide-header-btn-ai-chat] ul.nav.navbar-nav.navbar-left>li:has(>a[href="https://s.zlinkp.com/d.php?z=5278412"]){display:none!important}html[hide-header-btn-veteran] #wrapper>div.ph-bottom>ul>li:has(>a[href="/veteran"]),html[hide-header-btn-veteran] ul.nav.navbar-nav.navbar-left>li:has(>a[href="/veteran"]){display:none!important}html[hide-header-btn-theme-toggle] div.navbar-header>div.head-right>label.switch:has(>#theme-toggle-m),html[hide-header-btn-theme-toggle] ul.nav.navbar-nav.navbar-right>li:has(>label.switch){display:none!important}html[hide-header-btn-bonus] ul.nav.navbar-nav.navbar-left>div.adult-class-main>div>a[href="/bonus"],html[hide-header-btn-bonus] ul.nav.navbar-nav.navbar-right>li:has(>a[href="/bonus"]){display:none!important}html[hide-header-btn-week] ul.nav.navbar-nav.navbar-left>div.adult-class-main>div>a[href="/week"],html[hide-header-btn-week] ul.nav.navbar-nav.navbar-right>li:has(>a[href="/week"]){display:none!important}html[hide-header-btn-phone] ul.nav.navbar-nav.navbar-right>li:has(>a[target=_blank]>i.fa-mobile-alt){display:none!important}html[hide-header-btn-album] ul.nav.navbar-nav.navbar-right>li:has(>a[href^="/album/"]){display:none!important}html[hide-header-btn-user] ul.nav.navbar-nav.navbar-right>li:has(>a[data-toggle=modal]>i.fa-user-circle),html[hide-header-btn-user] ul.nav.navbar-nav.navbar-right>li:has(>a[href="#login-modal"]){display:none!important}html[hide-header-btn-search] div.navbar-header>div.head-right>div.dropdown:has(>a>i.fa-search),html[hide-header-btn-search] ul.nav.navbar-nav.navbar-right>li:has(>a[href="#"]>i.fa-search){display:none!important}html[hide-header-btn-notice] div.navbar-collapse>div>ul>li:has(>a[href="https://jmc8763.one/mpSWW7"]){display:none!important}html[hide-header-btn-up-comic] div.navbar-collapse>div>ul>li:has(>a[href="/"]){display:none!important}html[hide-header-btn-ad-mail] ul.nav.navbar-nav.navbar-left>div.adult-class-main>div>li:has(>a[href="mailto:www18comic@gmail.com"]),html[hide-header-btn-ad-mail] div.navbar-collapse>div>ul>li:has(>a[href="mailto:www18comic@gmail.com"]){display:none!important}html[hide-header-btn-pay] div.navbar-collapse>div>ul>li:has(>a[href="https://jmc8763.one/dFTN82"]){display:none!important}html[hide-header-btn-shunt] #click_fl2,html[hide-header-btn-shunt] div.navbar-collapse>div>ul>li:has(>a[href="#shunt-modal"]){display:none!important}html[hide-header-btn-language] ul.nav.navbar-nav.navbar-left>div.adult-class-main>div>li:has(>span[href="#language-modal"]),html[hide-header-btn-language] div.navbar-collapse>div>ul>li:has(>a[href="#language-modal"]){display:none!important}html[hide-header-btn-url-copy] ul.nav.navbar-nav.navbar-left>li.copy-block:has(>#copy){display:none!important}html[hide-thumb-albums-latest] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>div.thumb-overlay-albums>div.label-latest,html[hide-thumb-albums-latest] #wrapper>div.container>div.row>div>div.row>div>div>div.thumb-overlay-albums>div.label-latest{display:none!important}html[hide-thumb-albums-category] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>div.thumb-overlay-albums>div.category-icon,html[hide-thumb-albums-category] #wrapper>div.container>div.row>div>div.row>div>div>div.thumb-overlay-albums>div.category-icon{display:none!important}html[hide-thumb-albums-likes] #related_comics>div.row>div>div.owl-stage-outer>div>div>div>div.gamelib_block_footer>span:has(>a.blog-like),html[hide-thumb-albums-likes] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>div.thumb-overlay-albums>div.label-loveicon,html[hide-thumb-albums-likes] #wrapper>div.container>div.row>div>div.row>div>div>div.thumb-overlay-albums>div.label-loveicon{display:none!important}html[hide-thumb-albums-bookmark] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>div.thumb-overlay-albums>div.label-star,html[hide-thumb-albums-bookmark] #wrapper>div.container>div.row>div>div.row>div>div>div.thumb-overlay-albums>div.label-star{display:none!important}html[hide-thumb-albums-title] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>span.video-title,html[hide-thumb-albums-title] #wrapper>div.container>div.row>div>div.row>div>div>span.video-title{display:none!important}html[show-thumb-albums-full-title] #related_comics>div.row>div>div.owl-stage-outer>div>div>div>a>div.title,html[show-thumb-albums-full-title] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>span.video-title,html[show-thumb-albums-full-title] #wrapper>div.container>div.row>div>div.row>div>div>span.video-title{white-space:normal!important;max-height:none!important}html[hide-thumb-albums-author] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>div:has(>a[href*="&main_tag"]),html[hide-thumb-albums-author] #wrapper>div.container>div.row>div>div.row>div>div>div:has(>a[href*="&main_tag"]){display:none!important}html[hide-thumb-albums-tags] #related_comics>div.row>ul>div.owl-stage-outer>div>div>div>div.title-truncate.tags,html[hide-thumb-albums-tags] #wrapper>div.container>div.row>div>div.row>div>div>div.title-truncate.tags{display:none!important}';
  const rules$2 = [
    {
      name: "common",
      groups: commonGroups$1,
      style: commonStyle$1,
      isSpecial: true,
      checkFn: isPage18Comic
    }
  ];
  const commonBasicItems = [
    {
      type: "switch",
      id: "xvideos-remove-ads",
      name: "移除 广告",
      attrName: "remove-ads",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "xvideos-hide-footer",
      name: "隐藏 页底footer",
      attrName: "hide-footer",
      defaultEnable: true
    }
  ];
  const commonHeaderItems = [
    {
      type: "switch",
      id: "xvideos-hide-header-logo",
      name: "隐藏 LOGO",
      attrName: "hide-header-logo"
    },
    {
      type: "switch",
      id: "xvideos-hide-header-btn-language",
      name: "隐藏 选择语言",
      attrName: "hide-header-btn-language"
    },
    {
      type: "switch",
      id: "xvideos-hide-header-btn-localisation",
      name: "隐藏 选择地区",
      attrName: "hide-header-btn-localisation"
    },
    {
      type: "switch",
      id: "xvideos-hide-header-btn-main-cat",
      name: "隐藏 性别喜好",
      attrName: "hide-header-btn-main-cat"
    },
    {
      type: "switch",
      id: "xvideos-hide-header-btn-search",
      name: "隐藏 搜索框",
      attrName: "hide-header-btn-search"
    },
    {
      type: "switch",
      id: "xvideos-hide-header-btn-user",
      name: "隐藏 user",
      attrName: "hide-header-btn-user"
    },
    {
      type: "switch",
      id: "xvideos-hide-header-btn-theme-switch",
      name: "隐藏 主题切换",
      attrName: "hide-header-btn-theme-switch"
    },
    {
      type: "switch",
      id: "xvideos-hide-header-btn-setting",
      name: "隐藏 设置",
      attrName: "hide-header-btn-setting"
    }
  ];
  const commonNavItems = [
    {
      type: "switch",
      id: "xvideos-hide-nav-best",
      name: "隐藏 最佳影片",
      attrName: "hide-nav-best"
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-tags",
      name: "隐藏 分类",
      attrName: "hide-nav-tags"
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-channels",
      name: "隐藏 頻道",
      attrName: "hide-nav-channels"
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-pornstars",
      name: "隐藏 色情明星",
      attrName: "hide-nav-pornstars"
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-red-ticket",
      name: "隐藏 RED视频",
      attrName: "hide-nav-red-ticket"
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-live-cams",
      name: "隐藏 现场直播摄影机(广告)",
      attrName: "hide-nav-live-cams",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-games",
      name: "隐藏 遊戲(广告)",
      attrName: "hide-nav-games",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-logo",
      name: "隐藏 约会(广告)",
      attrName: "hide-nav-logo",
      defaultEnable: true
    },
    {
      type: "switch",
      id: "xvideos-hide-nav-profileslist",
      name: "隐藏 簡介",
      attrName: "hide-nav-profileslist"
    }
  ];
  const commonGroups = [
    {
      name: "全站通用 - 基本功能",
      fold: true,
      items: commonBasicItems
    },
    {
      name: "全站通用 - Header",
      fold: true,
      items: commonHeaderItems
    },
    {
      name: "全站通用 - Nav",
      fold: true,
      items: commonNavItems
    }
  ];
  const commonStyle = 'html[remove-ads] #hlsplayer>div.videoad-base,html[remove-ads] #ad-header-mobile-contener,html[remove-ads] div.exo-ad-ins-div.exo-ad-playersiderectangle,html[remove-ads] div.exo-ad-ins-container.ad-support-desktop,html[remove-ads] #ad-footer,html[remove-ads] div.thumb-ad.thumb-nat-ad.thumb-nat-exo-ad{display:none!important}html[hide-footer] #page>div.remove-ads,html[hide-footer] #footer{display:none!important}html[hide-header-logo] #site-logo-link,html[hide-header-btn-language] #site-language,html[hide-header-btn-localisation] #site-localisation,html[hide-header-btn-main-cat] #site-main-cat{display:none!important}html[hide-header-btn-search] body>div.head__top.width-full-body>header>div.head__search{display:none!important}html[hide-header-btn-user] #header-mobile-right>button.head__btn:has(>span.icf-user-o){display:none!important}html[hide-header-btn-theme-switch] #site-theme-switch{display:none!important}html[hide-header-btn-setting] #header-mobile-right>button.head__btn:has(>span.icf-cog-o){display:none!important}html[hide-nav-best] #nav>nav>ul>li:has(>a[href="/best"]){display:none!important}html[hide-nav-tags] #nav>nav>ul>li:has(>#main-cats-sub-list-btn){display:none!important}html[hide-nav-channels] #nav>nav>ul>li:has(>a[href="/channels-index"]){display:none!important}html[hide-nav-pornstars] #nav>nav>ul>li:has(>a[href="/pornstars-index"]){display:none!important}html[hide-nav-red-ticket] #nav>nav>ul>li:has(>a[href="https://www.xvideos.red/red/videos"]){display:none!important}html[hide-nav-live-cams] #nav>nav>ul>li:has(>a[href="https://www.xvlivecams.com/female-cams/"]){display:none!important}html[hide-nav-games] #nav>nav>ul>li:has(>a[href="https://xvideos.nutaku.net/wl/gate/"]){display:none!important}html[hide-nav-logo] #nav>nav>ul>li:has(>a.ignore-popunder>span.icf-hearts-o),html[hide-nav-logo] #nav>nav>ul>li:has(>a[href="https://s.zlinkp.com/d.php?z=5421034"]){display:none!important}html[hide-nav-profileslist] #nav>nav>ul>li:has(>a[href="/profileslist"]){display:none!important}';
  const rules$1 = [
    {
      name: "common",
      groups: commonGroups,
      style: commonStyle,
      isSpecial: true,
      checkFn: isPageXVideos
    }
  ];
  const basicItems = [
    {
      type: "list",
      id: "language",
      name: i18n.language.language,
      description: i18n.language.language_description,
      defaultValue: "zh-CN",
      disableValue: "null",
      options: [
        {
          id: "zh-CN",
          name: "简体中文"
        },
        {
          id: "en-US",
          name: "English"
        }
      ],
      fn: (id) => {
        i18n.change(id);
      }
    }
  ];
  const basicRules = {
    name: "basic-rules",
    groups: [
      {
        name: i18n.language.basic_settings,
        items: basicItems
      }
    ],
    isSpecial: true,
    specialName: "SETTINGS",
    checkFn: isPageMissAv
  };
  const rules = [
    ...rules$7,
    ...rules$6,
    ...rules$5,
    ...rules$4,
    ...rules$3,
    ...rules$2,
    ...rules$1,
    // ...xHamsterRules,
    basicRules
  ];
  const _hoisted_1 = { class: "text-base" };
  const _sfc_main = /* @__PURE__ */ e$1.defineComponent({
    __name: "App",
    setup(__props) {
      return (_ctx, _cache) => {
        return e$1.openBlock(), e$1.createElementBlock("div", _hoisted_1, [
          e$1.createVNode(_sfc_main$3, e$1.normalizeProps(e$1.guardReactiveProps({
            rules: e$1.unref(rules),
            title: e$1.unref(i18n).language.title,
            github: "http://github.com/GangPeter",
            greasyFork: "https://greasyfork.org/users/105051"
          })), null, 16),
          e$1.createVNode(_sfc_main$2)
        ]);
      };
    }
  });
  const waitForHead = () => {
    return new Promise((resolve) => {
      if (document.head) {
        resolve();
      }
      const observer = new MutationObserver(() => {
        if (document.head) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
  };
  const waitForBody = () => {
    return new Promise((resolve) => {
      if (document.body) {
        resolve();
      }
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
  };
  const loadRules = (rules2) => {
    for (const rule of rules2) {
      if (!rule.checkFn()) continue;
      for (const group of rule.groups) {
        for (const item of group.items) {
          try {
            switch (item.type) {
              case "switch":
                loadSwitchItem(item);
                break;
              case "number":
                loadNumberItem(item);
                break;
              case "list":
                loadListItem(item);
                break;
              case "string":
                loadStringItem(item);
                break;
            }
          } catch (err) {
            error(
              `loadRules load item failed, id=${item.id}, name=${item.name}, type=${item.type}`,
              err
            );
          }
        }
      }
    }
  };
  const loadStyles = (rules2) => {
    var _a;
    for (const rule of rules2) {
      if (!rule.checkFn() || !rule.style) continue;
      try {
        const style = document.createElement("style");
        style.className = `pg-css ${rule.name}`;
        style.textContent = rule.style;
        (_a = document.documentElement) == null ? void 0 : _a.appendChild(style);
      } catch (err) {
        error(`loadStyles error, name=${rule.name}`, err);
      }
    }
  };
  const loadSwitchItem = (item) => {
    var _a;
    const enable = PGStorage.get(item.id, item.defaultEnable);
    if (!enable) return;
    if (!item.noStyle) {
      document.documentElement.setAttribute(item.attrName ?? item.id, "");
    }
    if (!item.enableFn) return;
    if (item.enableFnRunAt === "document-end" && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        var _a2;
        (_a2 = item.enableFn()) == null ? undefined : _a2.then().catch();
      });
    } else {
      (_a = item.enableFn()) == null ? undefined : _a.then().catch();
    }
  };
  const loadNumberItem = (item) => {
    var _a;
    const value = PGStorage.get(item.id, item.defaultValue);
    if (value === item.disableValue) return;
    if (!item.noStyle) {
      document.documentElement.setAttribute(item.attrName ?? item.id, "");
    }
    (_a = item.fn(value)) == null ? undefined : _a.then().catch();
  };
  const loadStringItem = (item) => {
    var _a;
    const value = PGStorage.get(item.id, item.defaultValue);
    if (value === item.disableValue) return;
    if (!item.noStyle) {
      document.documentElement.setAttribute(item.attrName ?? item.id, "");
    }
    (_a = item.fn(value)) == null ? undefined : _a.then().catch();
  };
  const loadListItem = (item) => {
    const value = PGStorage.get(item.id, item.defaultValue);
    if (value === item.disableValue) return;
    document.documentElement.setAttribute(value, "");
  };
  const loadModules = () => {
    waitForHead().then(() => {
      loadStyles(rules);
      log("loadStyles done");
    });
    loadRules(rules);
    log("loadRules done");
  };
  const css = '*,:before,:after{--tw-border-spacing-x: 0;--tw-border-spacing-y: 0;--tw-translate-x: 0;--tw-translate-y: 0;--tw-rotate: 0;--tw-skew-x: 0;--tw-skew-y: 0;--tw-scale-x: 1;--tw-scale-y: 1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness: proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width: 0px;--tw-ring-offset-color: #fff;--tw-ring-color: rgb(59 130 246 / .5);--tw-ring-offset-shadow: 0 0 #0000;--tw-ring-shadow: 0 0 #0000;--tw-shadow: 0 0 #0000;--tw-shadow-colored: 0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }::backdrop{--tw-border-spacing-x: 0;--tw-border-spacing-y: 0;--tw-translate-x: 0;--tw-translate-y: 0;--tw-rotate: 0;--tw-skew-x: 0;--tw-skew-y: 0;--tw-scale-x: 1;--tw-scale-y: 1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness: proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width: 0px;--tw-ring-offset-color: #fff;--tw-ring-color: rgb(59 130 246 / .5);--tw-ring-offset-shadow: 0 0 #0000;--tw-ring-shadow: 0 0 #0000;--tw-shadow: 0 0 #0000;--tw-shadow-colored: 0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }*,:before,:after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}:before,:after{--tw-content: ""}html,:host{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;-o-tab-size:4;tab-size:4;font-family:ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji",Segoe UI Symbol,"Noto Color Emoji";font-feature-settings:normal;font-variation-settings:normal;-webkit-tap-highlight-color:transparent}body{margin:0;line-height:inherit}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;font-feature-settings:normal;font-variation-settings:normal;font-size:1em}small{font-size:80%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;padding:0}button,select{text-transform:none}button,input:where([type=button]),input:where([type=reset]),input:where([type=submit]){-webkit-appearance:button;background-color:transparent;background-image:none}:-moz-focusring{outline:auto}:-moz-ui-invalid{box-shadow:none}progress{vertical-align:baseline}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[type=search]{-webkit-appearance:textfield;outline-offset:-2px}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}summary{display:list-item}blockquote,dl,dd,h1,h2,h3,h4,h5,h6,hr,figure,p,pre{margin:0}fieldset{margin:0;padding:0}legend{padding:0}ol,ul,menu{list-style:none;margin:0;padding:0}dialog{padding:0}textarea{resize:vertical}input::-moz-placeholder,textarea::-moz-placeholder{opacity:1;color:#9ca3af}input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}button,[role=button]{cursor:pointer}:disabled{cursor:default}img,svg,video,canvas,audio,iframe,embed,object{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}[hidden]:where(:not([hidden=until-found])){display:none}:host{font-family:Arial,Helvetica,sans-serif!important}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;-moz-appearance:none;appearance:none;margin:0}input[type=number]{-moz-appearance:textfield}.container{width:100%}@media (min-width: 640px){.container{max-width:640px}}@media (min-width: 768px){.container{max-width:768px}}@media (min-width: 1024px){.container{max-width:1024px}}@media (min-width: 1280px){.container{max-width:1280px}}@media (min-width: 1536px){.container{max-width:1536px}}.pointer-events-none{pointer-events:none}.static{position:static}.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.sticky{position:sticky}.inset-y-0{top:0;bottom:0}.left-0{left:0}.right-0{right:0}.right-20{right:80px}.top-0{top:0}.isolate{isolation:isolate}.z-10{z-index:10}.z-\\[10000000\\]{z-index:10000000}.z-\\[100\\]{z-index:100}.order-first{order:-9999}.m-1{margin:4px}.mx-2{margin-left:8px;margin-right:8px}.mb-1\\.5{margin-bottom:6px}.mb-2{margin-bottom:8px}.mb-3{margin-bottom:12px}.ml-2{margin-left:8px}.ml-4{margin-left:16px}.mr-1{margin-right:4px}.mt-1{margin-top:4px}.mt-2\\.5{margin-top:10px}.mt-4{margin-top:16px}.mt-5{margin-top:20px}.block{display:block}.inline-block{display:inline-block}.inline{display:inline}.flex{display:flex}.inline-flex{display:inline-flex}.hidden{display:none}.size-8{width:32px;height:32px}.h-10{height:40px}.h-4{height:16px}.h-5{height:20px}.h-6{height:24px}.h-auto{height:auto}.max-h-60{max-height:240px}.min-h-12{min-height:48px}.min-h-\\[calc\\(100\\%-2\\.5rem\\)\\]{min-height:calc(100% - 40px)}.w-1\\/5{width:20%}.w-10{width:40px}.w-11{width:44px}.w-2\\/5{width:40%}.w-24{width:96px}.w-4{width:16px}.w-5{width:20px}.w-6{width:24px}.w-full{width:100%}.flex-1{flex:1 1 0%}.flex-grow{flex-grow:1}.translate-x-1{--tw-translate-x: 4px;transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skew(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.translate-x-6{--tw-translate-x: 24px;transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skew(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.rotate-180{--tw-rotate: 180deg;transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skew(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.transform{transform:translate(var(--tw-translate-x),var(--tw-translate-y)) rotate(var(--tw-rotate)) skew(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y))}.cursor-default{cursor:default}.cursor-move{cursor:move}.cursor-pointer{cursor:pointer}.select-none{-webkit-user-select:none;-moz-user-select:none;user-select:none}.resize-none{resize:none}.flex-row{flex-direction:row}.flex-col{flex-direction:column}.items-center{align-items:center}.justify-end{justify-content:flex-end}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.justify-around{justify-content:space-around}.space-x-5>:not([hidden])~:not([hidden]){--tw-space-x-reverse: 0;margin-right:calc(20px * var(--tw-space-x-reverse));margin-left:calc(20px * calc(1 - var(--tw-space-x-reverse)))}.self-center{align-self:center}.overflow-auto{overflow:auto}.overscroll-none{overscroll-behavior:none}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rounded{border-radius:4px}.rounded-2xl{border-radius:16px}.rounded-full{border-radius:9999px}.rounded-lg{border-radius:8px}.rounded-md{border-radius:6px}.rounded-xl{border-radius:12px}.rounded-b-none{border-bottom-right-radius:0;border-bottom-left-radius:0}.rounded-b-xl{border-bottom-right-radius:12px;border-bottom-left-radius:12px}.border{border-width:1px}.border-2{border-width:2px}.border-\\[\\#212121\\]{--tw-border-opacity: 1;border-color:rgb(33 33 33 / var(--tw-border-opacity, 1))}.border-\\[\\#252525\\]{--tw-border-opacity: 1;border-color:rgb(37 37 37 / var(--tw-border-opacity, 1))}.border-green-600{--tw-border-opacity: 1;border-color:rgb(22 163 74 / var(--tw-border-opacity, 1))}.border-white{--tw-border-opacity: 1;border-color:rgb(255 255 255 / var(--tw-border-opacity, 1))}.bg-\\[\\#0e0e0e\\]{--tw-bg-opacity: 1;background-color:rgb(14 14 14 / var(--tw-bg-opacity, 1))}.bg-\\[\\#151515\\]{--tw-bg-opacity: 1;background-color:rgb(21 21 21 / var(--tw-bg-opacity, 1))}.bg-\\[\\#1b1b1b\\]{--tw-bg-opacity: 1;background-color:rgb(27 27 27 / var(--tw-bg-opacity, 1))}.bg-\\[\\#1e1e1e80\\]{background-color:#1e1e1e80}.bg-\\[\\#1f1f1f\\]{--tw-bg-opacity: 1;background-color:rgb(31 31 31 / var(--tw-bg-opacity, 1))}.bg-\\[\\#252525\\]{--tw-bg-opacity: 1;background-color:rgb(37 37 37 / var(--tw-bg-opacity, 1))}.bg-\\[\\#2f2f2f\\]{--tw-bg-opacity: 1;background-color:rgb(47 47 47 / var(--tw-bg-opacity, 1))}.bg-\\[\\#ff9000\\]{--tw-bg-opacity: 1;background-color:rgb(255 144 0 / var(--tw-bg-opacity, 1))}.bg-black{--tw-bg-opacity: 1;background-color:rgb(0 0 0 / var(--tw-bg-opacity, 1))}.bg-green-950{--tw-bg-opacity: 1;background-color:rgb(5 46 22 / var(--tw-bg-opacity, 1))}.bg-white{--tw-bg-opacity: 1;background-color:rgb(255 255 255 / var(--tw-bg-opacity, 1))}.p-1{padding:4px}.p-2{padding:8px}.p-3\\.5{padding:14px}.px-2{padding-left:8px;padding-right:8px}.px-2\\.5{padding-left:10px;padding-right:10px}.px-3\\.5{padding-left:14px;padding-right:14px}.py-0\\.5{padding-top:2px;padding-bottom:2px}.py-1{padding-top:4px;padding-bottom:4px}.py-1\\.5{padding-top:6px;padding-bottom:6px}.py-2{padding-top:8px;padding-bottom:8px}.pb-2{padding-bottom:8px}.pl-10{padding-left:40px}.pl-3{padding-left:12px}.pl-9{padding-left:36px}.pr-2{padding-right:8px}.pr-4{padding-right:16px}.pt-1{padding-top:4px}.text-left{text-align:left}.text-center{text-align:center}.font-serif{font-family:ui-serif,Georgia,Cambria,Times New Roman,Times,serif}.text-\\[13px\\]{font-size:13px}.text-\\[14px\\]{font-size:14px}.text-base{font-size:16px;line-height:24px}.text-sm{font-size:14px;line-height:20px}.text-xl{font-size:20px;line-height:28px}.font-bold{font-weight:700}.font-medium{font-weight:500}.font-normal{font-weight:400}.font-semibold{font-weight:600}.leading-4{line-height:16px}.leading-6{line-height:24px}.text-\\[\\#767676\\]{--tw-text-opacity: 1;color:rgb(118 118 118 / var(--tw-text-opacity, 1))}.text-\\[\\#c6c6c6\\]{--tw-text-opacity: 1;color:rgb(198 198 198 / var(--tw-text-opacity, 1))}.text-\\[\\#ff9000\\]{--tw-text-opacity: 1;color:rgb(255 144 0 / var(--tw-text-opacity, 1))}.text-black{--tw-text-opacity: 1;color:rgb(0 0 0 / var(--tw-text-opacity, 1))}.text-gray-200{--tw-text-opacity: 1;color:rgb(229 231 235 / var(--tw-text-opacity, 1))}.text-gray-400{--tw-text-opacity: 1;color:rgb(156 163 175 / var(--tw-text-opacity, 1))}.text-gray-600{--tw-text-opacity: 1;color:rgb(75 85 99 / var(--tw-text-opacity, 1))}.text-white{--tw-text-opacity: 1;color:rgb(255 255 255 / var(--tw-text-opacity, 1))}.opacity-0{opacity:0}.opacity-100{opacity:1}.shadow-lg{--tw-shadow: 0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1);--tw-shadow-colored: 0 10px 15px -3px var(--tw-shadow-color), 0 4px 6px -4px var(--tw-shadow-color);box-shadow:var(--tw-ring-offset-shadow, 0 0 #0000),var(--tw-ring-shadow, 0 0 #0000),var(--tw-shadow)}.outline-none{outline:2px solid transparent;outline-offset:2px}.filter{filter:var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow)}.transition{transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,-webkit-backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter,-webkit-backdrop-filter;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.transition-colors{transition-property:color,background-color,border-color,text-decoration-color,fill,stroke;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.transition-transform{transition-property:transform;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.duration-100{transition-duration:.1s}.duration-200{transition-duration:.2s}.ease-in{transition-timing-function:cubic-bezier(.4,0,1,1)}.will-change-\\[right\\,bottom\\]{will-change:right,bottom}.will-change-\\[top\\,left\\]{will-change:top,left}.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}.invalid\\:border-red-500:invalid{--tw-border-opacity: 1;border-color:rgb(239 68 68 / var(--tw-border-opacity, 1))}.hover\\:border-\\[\\#ff9000\\]:hover{--tw-border-opacity: 1;border-color:rgb(255 144 0 / var(--tw-border-opacity, 1))}.hover\\:border-green-600:hover{--tw-border-opacity: 1;border-color:rgb(22 163 74 / var(--tw-border-opacity, 1))}.hover\\:bg-\\[\\#212121\\]:hover{--tw-bg-opacity: 1;background-color:rgb(33 33 33 / var(--tw-bg-opacity, 1))}.hover\\:bg-\\[\\#292929\\]:hover{--tw-bg-opacity: 1;background-color:rgb(41 41 41 / var(--tw-bg-opacity, 1))}.hover\\:bg-\\[\\#2D2D2D\\]:hover{--tw-bg-opacity: 1;background-color:rgb(45 45 45 / var(--tw-bg-opacity, 1))}.hover\\:bg-\\[\\#2f2f2f\\]:hover{--tw-bg-opacity: 1;background-color:rgb(47 47 47 / var(--tw-bg-opacity, 1))}.hover\\:bg-green-950:hover{--tw-bg-opacity: 1;background-color:rgb(5 46 22 / var(--tw-bg-opacity, 1))}.hover\\:text-\\[\\#ff9000\\]:hover{--tw-text-opacity: 1;color:rgb(255 144 0 / var(--tw-text-opacity, 1))}.hover\\:text-white:hover{--tw-text-opacity: 1;color:rgb(255 255 255 / var(--tw-text-opacity, 1))}.hover\\:text-opacity-100:hover{--tw-text-opacity: 1}.focus\\:border-\\[\\#2f2f2f\\]:focus{--tw-border-opacity: 1;border-color:rgb(47 47 47 / var(--tw-border-opacity, 1))}.focus\\:bg-\\[\\#212121\\]:focus{--tw-bg-opacity: 1;background-color:rgb(33 33 33 / var(--tw-bg-opacity, 1))}.focus\\:outline-none:focus{outline:2px solid transparent;outline-offset:2px}.focus\\:invalid\\:border-red-500:invalid:focus{--tw-border-opacity: 1;border-color:rgb(239 68 68 / var(--tw-border-opacity, 1))}@media (min-width: 640px){.sm\\:text-sm{font-size:14px;line-height:20px}}';
  const main = () => {
    const wrap = document.createElement("div");
    wrap.id = "porn-enhance";
    const root = wrap.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    root.appendChild(style);
    waitForBody().then(() => document.body.appendChild(wrap));
    const app = e$1.createApp(_sfc_main);
    app.config.errorHandler = (err, vm, info) => {
      error("Vue:", err);
      error("Component:", vm);
      error("Info:", info);
    };
    const pinia = createPinia();
    app.use(pinia);
    app.mount(
      (() => {
        const node = document.createElement("div");
        root.appendChild(node);
        return node;
      })()
    );
  };
  const menu = () => {
    if (self !== top) {
      log("skip iframe");
      return;
    }
    const ruleStore = useRulePanelStore();
    const sideBtnStore = useSideBtnStore();
    _GM_registerMenuCommand(i18n.language.panel, () => {
      ruleStore.isShow ? ruleStore.hide() : ruleStore.show();
    });
    _GM_registerMenuCommand(i18n.language.side_btn, () => {
      sideBtnStore.isShow ? sideBtnStore.hide() : sideBtnStore.show();
    });
  };
  try {
    log(`script start, mode: ${"production"}, url: ${location.href}`);
    intercept(_unsafeWindow);
    log("intercept done");
    loadModules();
    main();
    menu();
    log(`script end`);
  } catch (err) {
    error("main.ts error", err);
  }

})(Vue);