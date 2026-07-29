// ==UserScript==
// @name         115网盘-cookie-扫码登录
// @namespace    115-qrcode-cookie-login
// @version      3.0
// @author       提取自 JAV-JHS (并做插入稳定性增强)
// @namespace    https://github.com/ZiPenOk
// @description  在115.com登录页面注入"JHS-扫码"面板，支持微信/支付宝小程序扫码登录，以及直接输入Cookie登录；登录后可在右下角悬浮面板复制Cookie
// @license      MIT
// @icon         https://115.com/favicon.ico
// @match        https://115.com/*
// @match        https://www.115.com/*
// @connect      qrcodeapi.115.com
// @connect      passportapi.115.com
// @connect      115.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js
// @require      https://cdn.jsdelivr.net/npm/toastify-js@1.12.0/src/toastify.min.js
// @require      https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js
// @run-at       document-start
// @downloadURL https://update.sleazyfork.org/scripts/576374/115%E7%BD%91%E7%9B%98-cookie-%E6%89%AB%E7%A0%81%E7%99%BB%E5%BD%95.user.js
// @updateURL https://update.sleazyfork.org/scripts/576374/115%E7%BD%91%E7%9B%98-cookie-%E6%89%AB%E7%A0%81%E7%99%BB%E5%BD%95.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const LOGIN_BOX_SELECTOR = '#js-login_box';

    let loginObserver = null;
    let loginHookTimer = null;
    let loginEventsBound = false;
    let qrEventsBound = false;
    let cookieInputEventsBound = false;
    let autoReLoginChecked = false;
    let qrLoginTimeout = null;

    function runWhenNodeReady(getNode, callback) {
        const node = getNode();
        if (node) {
            callback(node);
            return;
        }

        let observer = null;
        const run = () => {
            const readyNode = getNode();
            if (!readyNode) return;
            document.removeEventListener('DOMContentLoaded', run);
            if (observer) observer.disconnect();
            callback(readyNode);
        };

        document.addEventListener('DOMContentLoaded', run, { once: true });
        if (window.MutationObserver) {
            observer = new MutationObserver(run);
            observer.observe(document.documentElement || document, {
                childList: true,
                subtree: true
            });
        }
    }

    function appendToHead(node) {
        runWhenNodeReady(
            () => document.head,
            head => {
                if (!node.isConnected) head.appendChild(node);
            }
        );
    }

    function appendToBody(node) {
        runWhenNodeReady(
            () => document.body,
            body => {
                if (!node.isConnected) body.appendChild(node);
            }
        );
    }

    // ─────────────────────────────────────────────
    //  工具函数
    // ─────────────────────────────────────────────

    /** 简易 toast 消息 */
    const show = (() => {
        function importToastifyCss() {
            if (document.getElementById('jhs-toastify-css')) return;
            const link = document.createElement('link');
            link.id = 'jhs-toastify-css';
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/toastify-js@1.12.0/src/toastify.min.css';
            appendToHead(link);
        }
        importToastifyCss();

        const commonStyles = {
            borderRadius: '12px',
            color: 'white',
            padding: '12px 16px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            minWidth: '150px',
            textAlign: 'center',
            zIndex: 999999999
        };
        const colors = {
            info:    { start: '#60A5FA', end: '#93C5FD' },
            success: { start: '#10B981', end: '#6EE7B7' },
            error:   { start: '#EF4444', end: '#FCA5A5' }
        };
        function showMsg(msg, type, options = {}) {
            const c = colors[type];
            Toastify({
                text: msg,
                duration: options.duration ?? 2000,
                close: options.close ?? false,
                gravity: 'top',
                position: 'center',
                stopOnFocus: true,
                style: {
                    ...commonStyles,
                    background: `linear-gradient(to right, ${c.start}, ${c.end})`
                },
                ...options
            }).showToast();
        }
        return {
            ok:    (msg, opts) => showMsg(msg, 'success', opts),
            info:  (msg, opts) => showMsg(msg, 'info',    opts),
            error: (msg, opts) => showMsg(msg, 'error',   opts)
        };
    })();

    /**
     * 轮询检测条件满足后执行回调
     * @param {Function} condition  返回 true 则停止
     * @param {Function} after      条件满足（或超时）时执行
     * @param {number}   interval   检测间隔 ms
     * @param {number}   timeout    最大等待 ms
     * @param {boolean}  runOnTimeout 超时时是否也执行 after
     */
    function loopDetector(condition, after, interval = 20, timeout = 10000, runOnTimeout = true) {
        const start = Date.now();
        const timer = setInterval(() => {
            if (condition()) {
                clearInterval(timer);
                after && after();
            } else if (Date.now() - start >= timeout) {
                clearInterval(timer);
                runOnTimeout && after && after();
            }
        }, interval);
    }

    /**
     * 将 cookie 字符串写入浏览器
     * @param {string} cookieStr  格式: "KEY1=val1; KEY2=val2; ..."
     * @param {object} options    maxAge / path / domain / secure / sameSite
     */
    function addCookie(cookieStr, options = {}) {
        const {
            maxAge  = 604800,
            path    = '/',
            domain  = '',
            secure  = false,
            sameSite = 'Lax'
        } = options;

        cookieStr.split(';').forEach(cookie => {
            const trimmed = cookie.trim();
            if (!trimmed) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx <= 0) return;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1);
            let parts = [`${key}=${val}`];
            if (maxAge > 0) parts.push(`max-age=${maxAge}`);
            parts.push(`path=${path}`);
            if (domain) parts.push(`domain=${domain}`);
            if (secure)  parts.push('Secure');
            if (sameSite) parts.push(`SameSite=${sameSite}`);
            document.cookie = parts.join('; ');
        });
    }

    // ─────────────────────────────────────────────
    //  GM_xmlhttpRequest 封装
    // ─────────────────────────────────────────────
    const gmHttp = {
        get(url, params = {}, headers = {}) {
            if (params && Object.keys(params).length) {
                url += (url.includes('?') ? '&' : '?') + new URLSearchParams(params).toString();
            }
            return this._request('GET', url, null, headers);
        },
        postFileFormData(url, data = {}, headers = {}) {
            const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
            headers = { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` };
            let body = Object.entries(data)
                .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
                .join('');
            body += `--${boundary}--`;
            return this._request('POST', url, body, headers);
        },
        _request(method, url, data, headers = {}) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method,
                    url,
                    headers,
                    data,
                    timeout: 15000,
                    onload: res => {
                        if (res.status >= 200 && res.status < 300) {
                            try { resolve(JSON.parse(res.responseText)); }
                            catch { resolve(res.responseText); }
                        } else {
                            reject(new Error(`HTTP ${res.status}: ${url}`));
                        }
                    },
                    onerror:   () => reject(new Error(`网络错误: ${url}`)),
                    ontimeout: () => reject(new Error(`请求超时: ${url}`))
                });
            });
        }
    };

    // ─────────────────────────────────────────────
    //  常量
    // ─────────────────────────────────────────────
    const JHS_115_COOKIE  = 'jhs_115_cookie';
    const JHS_115_MAX_AGE = 'jhs_115_max_age';

    // ─────────────────────────────────────────────
    //  样式注入
    // ─────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('jhs-115-cookie-style')) return;

        const css = `
            /* 调整115登录框高度自适应 */
            .login-box .ltab-office {
                border: 1px solid #DEE4EE;
            }
            .change-bg::before {
                background-color: #F9FAFB !important;
            }
            .site-login-wrap {
                height: auto;
            }

            /* 右下角 Cookie 悬浮面板 */
            #jhs-cookie-panel {
                width: 200px;
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 10000;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                cursor: pointer;
                background-color: #FFFFFF;
                color: #333333;
                padding: 0;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transition: all 0.3s ease;
                border: 1px solid #E0E0E0;
            }
            #jhs-cookie-panel.expanded {
                border-radius: 8px;
                box-shadow: 0 8px 20px rgba(0,0,0,0.2);
            }
            #jhs-cookie-header {
                padding: 10px 15px;
                background-color: #0078D4;
                color: white;
                border-radius: 6px 6px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: 600;
            }
            #jhs-cookie-panel:not(.expanded) #jhs-cookie-header {
                border-radius: 6px;
                padding: 8px 15px;
            }
            #jhs-cookie-content {
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.3s ease-out;
                padding: 0 15px;
            }
            #jhs-cookie-panel.expanded #jhs-cookie-content {
                max-height: 250px;
                padding: 15px;
            }
            #jhs-cookie-value {
                max-height: 100px;
                overflow-y: auto;
                white-space: pre-wrap;
                word-break: break-all;
                margin-bottom: 15px;
                padding: 10px;
                border: 1px solid #CCC;
                background-color: #F8F8F8;
                font-size: 12px;
                border-radius: 4px;
                color: #555;
            }
            #jhs-copy-btn {
                background-color: #10B981;
                color: white;
                border: none;
                padding: 8px 15px;
                display: inline-block;
                font-size: 14px;
                cursor: pointer;
                border-radius: 4px;
                width: 100%;
                font-weight: 600;
                transition: background-color 0.2s ease;
            }
            #jhs-copy-btn:hover { background-color: #059669; }
        `;
        const style = document.createElement('style');
        style.id = 'jhs-115-cookie-style';
        style.textContent = css;
        appendToHead(style);
    }

    // ─────────────────────────────────────────────
    //  登录页面：注入 JHS-扫码 面板
    // ─────────────────────────────────────────────
    function hookLoginPage() {
        const $loginBox = $(LOGIN_BOX_SELECTOR);
        if ($loginBox.length === 0 || $loginBox.find('#js-login_way').length === 0) return false;

        // 添加 Tab 按钮
        if ($loginBox.find('#jhs-cookie').length === 0) {
            const $cookieTab = $('<a id="jhs-cookie"><s>🔰 JHS-扫码</s></a>');
            const $officeTab = $loginBox.find('.ltab-office').last();
            if ($officeTab.length) {
                $officeTab.after($cookieTab);
            } else {
                $loginBox.find('#js-login_way').append($cookieTab);
            }
        }

        if ($loginBox.find('#jhs_cookie_box').length > 0) return true;

        // 有效期选项
        const expiryOptions = [
            { label: '有效期: 会话 (关闭浏览器)', value: 0 },
            { label: '有效期: 1 天',   value: 86400 },
            { label: '有效期: 7 天',   value: 604800 },
            { label: '有效期: 30 天',  value: 2592000, default: true },
            { label: '有效期: 60 天',  value: 5184000 },
            { label: '有效期: 180 天', value: 15552000 }
        ];

        const $cookieScene = $(`
            <div id="jhs_cookie_box" style="display:none; padding:0 20px; max-width:300px; margin:auto;">
                <div style="margin-bottom:15px; text-align:center;">
                    <span style="font-size:18px; font-weight:bold; color:#333; display:block; margin-bottom:10px;">
                        使用115App扫码登录
                    </span>
                    <div style="text-align:left;">
                        <select id="login-115-type"
                            style="width:100%; padding:10px; border-radius:4px; border:1px solid #ddd;
                                   font-size:14px; box-sizing:border-box; background-color:white;">
                            <option value="" style="color:#999;">请选择登录方式</option>
                            <option value="wechatmini">微信小程序</option>
                            <option value="alipaymini">支付宝小程序</option>
                        </select>
                    </div>
                </div>

                <div style="text-align:left;">
                    <select id="cookie-expiry-select"
                        style="width:100%; padding:10px; border-radius:4px; border:1px solid #ddd;
                               font-size:14px; box-sizing:border-box; background-color:white;">
                        ${expiryOptions.map(c =>
                            `<option value="${c.value}" ${c.default ? 'selected' : ''}>${c.label}</option>`
                        ).join('')}
                    </select>
                </div>

                <div id="qrcode-box"
                    style="display:none; justify-content:center; min-height:100px;
                           border:1px dashed #aaa; padding:15px; text-align:center;
                           margin-top:15px; border-radius:4px; background-color:#fff;
                           line-height:70px; color:#666;">
                    二维码占位区域
                </div>

                <div style="margin-bottom:15px; text-align:center; margin-top:50px">
                    <span style="font-size:18px; font-weight:bold; color:#333; display:block; margin-bottom:10px;">
                        已有Cookie？在此输入并回车
                    </span>
                    <div style="text-align:left;">
                        <input type="text" id="cookie-str-input"
                            style="width:100%; padding:10px; border-radius:4px; border:1px solid #ddd;
                                   font-size:14px; box-sizing:border-box; background-color:white;">
                    </div>
                    <div style="text-align:center; margin-top:5px;">
                        <a class="a-primary" id="submit-cookie-btn"
                           style="cursor:pointer;">提交</a>
                    </div>
                </div>
            </div>
        `);

        const $footer = $loginBox.find('.login-footer').first();
        if ($footer.length) {
            $footer.before($cookieScene);
        } else {
            $loginBox.append($cookieScene);
        }

        return true;
    }

    // ─────────────────────────────────────────────
    //  Tab 切换点击事件绑定
    // ─────────────────────────────────────────────
    function bindTabClick() {
        if (loginEventsBound) return;
        loginEventsBound = true;

        // 点击 JHS-扫码 Tab
        $(document).on('click.jhs115', '#jhs-cookie', e => {
            e.preventDefault();
            const loginBox = e.currentTarget.closest(LOGIN_BOX_SELECTOR);
            if (!loginBox) return;

            const finishedEl = loginBox.querySelector('[lg_rel="finished"]');
            if (finishedEl) {
                finishedEl.style.display = 'none';
            } else {
                const qrcodeEl = loginBox.querySelector('[lg_rel="qrcode"]');
                if (qrcodeEl) qrcodeEl.style.display = 'none';
                const footerEl = loginBox.querySelector('.login-footer');
                if (footerEl) footerEl.style.display = 'none';
                const otherEl = loginBox.querySelector('.list-other-login');
                if (otherEl) otherEl.style.display = 'none';
            }
            // 取消其他 tab 的 current 状态
            loginBox.querySelectorAll('#js-login_way > *').forEach(tab => tab.classList.remove('current'));
            const cookieBox = loginBox.querySelector('#jhs_cookie_box');
            if (cookieBox) cookieBox.style.display = 'block';
            $(loginBox).find('#jhs-cookie').addClass('current').css('background', '#fff');
            $(loginBox).find('.ltab-cloud').addClass('change-bg');
        });

        // 点击其他 tab 时恢复
        $(document).on('click.jhs115', `${LOGIN_BOX_SELECTOR} #js-login_way > *:not(#jhs-cookie)`, function () {
            const loginBox = this.closest(LOGIN_BOX_SELECTOR);
            if (!loginBox) return;

            const cookieBox = loginBox.querySelector('#jhs_cookie_box');
            if (cookieBox) cookieBox.style.display = 'none';
            const finishedEl = loginBox.querySelector('[lg_rel="finished"]');
            if (finishedEl) {
                finishedEl.style.display = 'flex';
            } else {
                const qrcodeEl = loginBox.querySelector('[lg_rel="qrcode"]');
                if (qrcodeEl) qrcodeEl.style.display = 'block';
                const footerEl = loginBox.querySelector('.login-footer');
                if (footerEl) footerEl.style.display = 'block';
                const otherEl = loginBox.querySelector('.list-other-login');
                if (otherEl) otherEl.style.display = 'block';
            }
            $(loginBox).find('#jhs-cookie').removeClass('current').css('background', '#F9FAFB');
            $(loginBox).find('.ltab-cloud').removeClass('change-bg');
        });
    }

    // ─────────────────────────────────────────────
    //  扫码登录逻辑
    // ─────────────────────────────────────────────
    function bindQrCodeLogin() {
        if (qrEventsBound) return;
        qrEventsBound = true;

        $(document).on('change.jhs115', '#login-115-type', async event => {
            const login115Type = event.currentTarget.value;
            if (!login115Type) return;

            // 1. 获取二维码 token
            let loginInfo;
            try {
                const res = await gmHttp.get(
                    `https://qrcodeapi.115.com/api/1.0/${login115Type}/1.0/token/`
                );
                loginInfo = res.data;
            } catch (e) {
                show.error('获取二维码失败: ' + e.message);
                return;
            }

            const { qrcode, sign, time, uid } = loginInfo;
            console.log('[115-Login] 生成二维码:', loginInfo);

            // 2. 渲染二维码
            const $qrcodeBox = $('#qrcode-box');
            $qrcodeBox.css('display', 'flex').html('');
            new QRCode($qrcodeBox[0], {
                text: qrcode,
                width: 150,
                height: 150,
                correctLevel: QRCode.CorrectLevel.H
            });

            // 3. 轮询扫码结果
            if (qrLoginTimeout) clearTimeout(qrLoginTimeout);

            const checkLoginRecursive = async () => {
                try {
                    const res = await gmHttp.get(
                        `https://qrcodeapi.115.com/get/status/?uid=${uid}&time=${time}&sign=${sign}`
                    );
                    const { msg, status } = res.data;
                    if (msg) show.info(msg);

                    if (status === 2) {
                        // 扫码成功，获取 Cookie
                        show.ok('扫码登录成功');
                        try {
                            const checkResult = await gmHttp.postFileFormData(
                                `https://passportapi.115.com/app/1.0/${login115Type}/1.0/login/qrcode/`,
                                { app: login115Type, account: uid }
                            );
                            console.log('[115-Login] 登录结果:', checkResult);

                            if (checkResult.data && checkResult.data.cookie) {
                                const c = checkResult.data.cookie;
                                const cookieStr = `UID=${c.UID}; CID=${c.CID}; SEID=${c.SEID}; KID=${c.KID}`;
                                console.log('[115-Login] 解析出 cookie:', cookieStr);
                                localStorage.setItem(JHS_115_COOKIE, cookieStr);
                                localStorage.setItem(JHS_115_MAX_AGE, $('#cookie-expiry-select').val());
                                window.location.href = 'https://115.com/?cid=0&offset=0&mode=wangpan';
                            }
                        } catch (e) {
                            show.error('获取 Cookie 失败: ' + e.message);
                        }
                        return;
                    }

                    // 继续轮询
                    qrLoginTimeout = setTimeout(checkLoginRecursive, 500);
                } catch (e) {
                    console.error('[115-Login] 登录检查失败:', e);
                    qrLoginTimeout = setTimeout(checkLoginRecursive, 1000);
                }
            };

            await checkLoginRecursive();
        });
    }

    // ─────────────────────────────────────────────
    //  手动输入 Cookie 提交逻辑
    // ─────────────────────────────────────────────
    function bindCookieInput() {
        if (cookieInputEventsBound) return;
        cookieInputEventsBound = true;

        const handleCookie = () => {
            const cookieInput = document.getElementById('cookie-str-input');
            const expirySelect = document.getElementById('cookie-expiry-select');
            if (!cookieInput || !expirySelect) return;

            const cookieStr = cookieInput.value.trim();
            if (!cookieStr) { show.error('请输入 Cookie'); return; }
            const maxAge = parseInt(expirySelect.value);
            addCookie(cookieStr, { maxAge, domain: '.115.com' });
            window.location.href = 'https://115.com/?cid=0&offset=0&mode=wangpan';
        };

        $(document).on('keydown.jhs115', '#cookie-str-input', e => {
            if (e.key === 'Enter') { e.preventDefault(); handleCookie(); }
        });

        $(document).on('click.jhs115', '#submit-cookie-btn', e => {
            e.preventDefault();
            handleCookie();
        });
    }

    // ─────────────────────────────────────────────
    //  自动重登：检测到 localStorage 有缓存 Cookie 时提示
    // ─────────────────────────────────────────────
    function autoReLogin() {
        if (autoReLoginChecked) return;
        autoReLoginChecked = true;

        loopDetector(
            () => $(LOGIN_BOX_SELECTOR).length > 0,
            () => {
                if ($('.login-finished').length > 0 || $(LOGIN_BOX_SELECTOR).length === 0) return;
                const savedCookie = localStorage.getItem(JHS_115_COOKIE);
                const savedMaxAge = localStorage.getItem(JHS_115_MAX_AGE);
                if (savedCookie && !document.cookie.includes('SEID')) {
                    if (confirm('检测到上次登录已有缓存 Cookie，是否使用并登录？')) {
                        addCookie(savedCookie, {
                            maxAge: parseInt(savedMaxAge) || 2592000,
                            domain: '.115.com'
                        });
                        window.location.href = 'https://115.com/?cid=0&offset=0&mode=wangpan';
                    }
                }
            },
            20, 1500, true
        );
    }

    // ─────────────────────────────────────────────
    //  右下角 Cookie 悬浮面板（进入网盘后显示）
    // ─────────────────────────────────────────────
    function createCookiePanel() {
        const cookieValue = localStorage.getItem(JHS_115_COOKIE);
        if (!cookieValue) return;

        const oldPanel = document.getElementById('jhs-cookie-panel');
        if (oldPanel) oldPanel.remove();

        const panel = document.createElement('div');
        panel.id = 'jhs-cookie-panel';
        panel.innerHTML = `
            <div id="jhs-cookie-header">
                <span>JHS-115-Cookie</span>
                <span id="jhs-toggle-icon">▼</span>
            </div>
            <div id="jhs-cookie-content">
                <div id="jhs-cookie-value">${cookieValue}</div>
                <button id="jhs-copy-btn">复制 Cookie</button>
            </div>
        `;
        appendToBody(panel);

        runWhenNodeReady(() => document.body && document.getElementById('jhs-cookie-panel'), () => {
            const toggleIcon = document.getElementById('jhs-toggle-icon');
            const header = document.getElementById('jhs-cookie-header');
            const copyBtn = document.getElementById('jhs-copy-btn');
            if (!toggleIcon || !header || !copyBtn) return;

            header.addEventListener('click', () => {
                const expanded = panel.classList.toggle('expanded');
                toggleIcon.textContent = expanded ? '▲' : '▼';
            });

            copyBtn.addEventListener('click', async e => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(cookieValue);
                    show.ok('Cookie 已成功复制到剪贴板！');
                } catch {
                    // 降级方案
                    const ta = document.createElement('textarea');
                    ta.value = cookieValue;
                    appendToBody(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                    show.ok('Cookie 已复制！(回退方案)');
                }
            });
        });
    }

    function setupLoginHooks() {
        bindTabClick();
        bindQrCodeLogin();
        bindCookieInput();
        autoReLogin();
        hookLoginPage();
    }

    function scheduleLoginHooks() {
        if (loginHookTimer) clearTimeout(loginHookTimer);
        loginHookTimer = setTimeout(() => {
            loginHookTimer = null;
            setupLoginHooks();
        }, 80);
    }

    function observeLoginBox() {
        if (loginObserver || !window.MutationObserver) {
            scheduleLoginHooks();
            return;
        }

        runWhenNodeReady(
            () => document.body,
            body => {
                loginObserver = new MutationObserver(scheduleLoginHooks);
                loginObserver.observe(body, {
                    childList: true,
                    subtree: true
                });
                scheduleLoginHooks();
            }
        );
    }

    // ─────────────────────────────────────────────
    //  检测并拦截无限刷新循环
    // ─────────────────────────────────────────────
    function checkAndBreakLoop() {
        if (!window.location.href.includes('115') || window.self !== window.top) return;

        const LIMIT_COUNT  = 7;    // 触发拦截的刷新次数
        const TIME_WINDOW  = 5000; // 统计时间窗口 (ms)
        const loopData = JSON.parse(sessionStorage.getItem('jhs_loop_control') || '{"count":0,"time":0}');
        const now = Date.now();

        // 在时间窗口内累加，否则重置
        loopData.count = (now - loopData.time < TIME_WINDOW) ? loopData.count + 1 : 1;
        loopData.time  = now;
        sessionStorage.setItem('jhs_loop_control', JSON.stringify(loopData));

        if (loopData.count > LIMIT_COUNT) {
            // 强制中断页面加载
            window.stop();

            // 清理脚本缓存的 Cookie 数据
            localStorage.removeItem('jhs_115_cookie');
            localStorage.removeItem('jhs_115_max_age');
            sessionStorage.removeItem('jhs_loop_control');

            // 清除 115 域名下的全部 Cookie
            document.cookie.split(';').forEach(cookie => {
                const name = cookie.substring(0, cookie.indexOf('=')).trim();
                if (!name) return;
                document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.115.com`;
                document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
            });

            alert('\n⚠️ JHS-For-115 检测到页面正在异常刷新！\n\n已自动清空 115 缓存及浏览器 Cookie。\n页面将停止跳转，请手动刷新并重新登录。');
            throw new Error('JHS-For-115 拦截无限刷新');
        }
    }

    // ─────────────────────────────────────────────
    //  主入口
    // ─────────────────────────────────────────────
    function main() {
        const href = window.location.href;

        checkAndBreakLoop();
        injectStyles();

        // 115.com 登录页面（排除进入网盘的 userfile 页）
        if (!href.includes('&ac=userfile') && href.includes('115')) {
            observeLoginBox();

            // 进入网盘后也显示悬浮面板
            createCookiePanel();
        }
    }

    main();

})();
