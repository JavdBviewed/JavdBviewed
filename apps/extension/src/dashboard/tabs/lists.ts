import type { ListRecord } from '../../types';
import { dbListsPut, dbListsDelete, dbListsGetAllNormalized } from '../dbClient';
import { STATE } from '../state';
import { showMessage } from '../ui/toast';
import { showConfirm } from '../components/confirmModal';
import {
    getCollectionExternalId,
    matchesLabelRecord,
    matchesSeriesRecord,
} from '../../shared/utils/listRecordHelpers';
import { renderListSourceLinkButton } from './listsSourceLinks';
import { dashboardTabLifecycle } from './tabLifecycle';
import { clearTabWorkset } from './tabWorkset';

type SubTab = 'lists' | 'series' | 'labels';

export class ListsTab {
    public isInitialized: boolean = false;
    private lists: ListRecord[] = [];
    private renamingId: string | null = null;
    private isCreating: boolean = false;
    private activeSubTab: SubTab = 'lists';
    private active = false;
    private renderGeneration = 0;
    private lifecycleUnregister: (() => void) | null = null;

    async initialize(): Promise<void> {
        if (this.isInitialized) return;
        try {
            this.ensureLifecycle();
            this.bindEvents();
            await this.loadAndRender();
            this.isInitialized = true;
        } catch (e: any) {
            console.error('[ListsTab] initialize failed', e);
            showMessage('初始化收藏中心失败', 'error');
        }
    }

    private ensureLifecycle(): void {
        if (this.lifecycleUnregister) return;
        this.lifecycleUnregister = dashboardTabLifecycle.register('tab-lists', {
            onActive: () => { this.active = true; },
            onRestore: () => {
                this.active = true;
                void this.loadAndRender();
            },
            onHidden: () => {
                this.active = false;
                this.renderGeneration += 1;
                clearTabWorkset(document.getElementById('tab-lists'), [
                    '#listsLocalContainer',
                    '#listsMineContainer',
                    '#listsFavContainer',
                    '#listsSeriesContainer',
                    '#listsLabelsContainer',
                ]);
            },
            onDispose: () => {
                this.active = false;
                this.renderGeneration += 1;
                clearTabWorkset(document.getElementById('tab-lists'), [
                    '#listsLocalContainer',
                    '#listsMineContainer',
                    '#listsFavContainer',
                    '#listsSeriesContainer',
                    '#listsLabelsContainer',
                ]);
                this.lifecycleUnregister?.();
                this.lifecycleUnregister = null;
            },
        });
    }

    private bindEvents(): void {
        const refreshBtn = document.getElementById('listsRefreshBtn') as HTMLButtonElement | null;
        const goSyncBtn = document.getElementById('listsGoSyncBtn') as HTMLButtonElement | null;
        const searchInput = document.getElementById('listsSearchInput') as HTMLInputElement | null;
        const createBtn = document.getElementById('listsCreateBtn') as HTMLButtonElement | null;

        refreshBtn?.addEventListener('click', async () => { await this.loadAndRender(); });
        goSyncBtn?.addEventListener('click', () => { location.hash = '#tab-sync'; });
        searchInput?.addEventListener('input', () => { this.render(); });

        // 新建清单：展开内嵌输入行
        createBtn?.addEventListener('click', () => {
            if (this.isCreating) return;
            this.isCreating = true;
            this.renamingId = null;
            this.render();
            setTimeout(() => {
                const input = document.getElementById('listsInlineCreateInput') as HTMLInputElement | null;
                input?.focus();
            }, 30);
        });

        // Sub-tab 切换
        document.querySelectorAll('.lists-subtab').forEach(btn => {
            btn.addEventListener('click', () => {
                const subtab = (btn as HTMLElement).getAttribute('data-subtab') as SubTab | null;
                if (subtab) this.switchSubTab(subtab);
            });
        });

        // 我的清单 / 收藏清单 点击跳转
        const mine = document.getElementById('listsMineContainer');
        const fav = document.getElementById('listsFavContainer');
        const onClickNav = (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (this.handleSourceLinkClick(e, target)) return;
            const item = target?.closest('.lists-item') as HTMLElement | null;
            if (!item) return;
            const id = item.getAttribute('data-list-id') || '';
            if (!id) return;
            this.navigateToRecordsWithList(id);
        };
        mine?.addEventListener('click', onClickNav);
        fav?.addEventListener('click', onClickNav);

        // 本地清单：事件委托
        const localContainer = document.getElementById('listsLocalContainer');
        localContainer?.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (this.handleSourceLinkClick(e, target)) return;

            const renameConfirmBtn = target?.closest('.list-rename-confirm-btn') as HTMLElement | null;
            if (renameConfirmBtn) {
                this.commitRename(renameConfirmBtn.getAttribute('data-list-id') || '');
                return;
            }
            const renameCancelBtn = target?.closest('.list-rename-cancel-btn') as HTMLElement | null;
            if (renameCancelBtn) { this.renamingId = null; this.render(); return; }

            const renameBtn = target?.closest('.list-rename-btn') as HTMLElement | null;
            if (renameBtn) {
                const listId = renameBtn.getAttribute('data-list-id') || '';
                this.renamingId = listId;
                this.isCreating = false;
                this.render();
                setTimeout(() => {
                    const input = document.getElementById(`listsRenameInput_${listId}`) as HTMLInputElement | null;
                    input?.focus(); input?.select();
                }, 30);
                return;
            }

            const deleteBtn = target?.closest('.list-delete-btn') as HTMLElement | null;
            if (deleteBtn) {
                const list = this.lists.find(l => String(l.id) === deleteBtn.getAttribute('data-list-id'));
                if (list) this.deleteLocalList(list);
                return;
            }

            const createConfirmBtn = target?.closest('.list-create-confirm-btn') as HTMLElement | null;
            if (createConfirmBtn) { this.commitCreate(); return; }

            const createCancelBtn = target?.closest('.list-create-cancel-btn') as HTMLElement | null;
            if (createCancelBtn) { this.isCreating = false; this.render(); return; }

            const item = target?.closest('.lists-item') as HTMLElement | null;
            if (!item || item.classList.contains('lists-item-editing')) return;
            const id = item.getAttribute('data-list-id') || '';
            if (id) this.navigateToRecordsWithList(id);
        });

        // 键盘：Enter/Escape
        localContainer?.addEventListener('keydown', (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.id === 'listsInlineCreateInput') {
                if (e.key === 'Enter') { e.preventDefault(); this.commitCreate(); }
                if (e.key === 'Escape') { this.isCreating = false; this.render(); }
            }
            if (target?.id?.startsWith('listsRenameInput_')) {
                const listId = target.id.replace('listsRenameInput_', '');
                if (e.key === 'Enter') { e.preventDefault(); this.commitRename(listId); }
                if (e.key === 'Escape') { this.renamingId = null; this.render(); }
            }
        });

        // 系列 panel 点击跳转
        document.getElementById('listsSeriesContainer')?.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (this.handleSourceLinkClick(e, target)) return;
            const item = target?.closest('.lists-item') as HTMLElement | null;
            if (!item) return;
            const id = item.getAttribute('data-filter-id') || '';
            if (id) this.navigateToRecordsWithFilter(`series:${id}`);
        });

        // 番号 panel 点击跳转
        document.getElementById('listsLabelsContainer')?.addEventListener('click', (e: Event) => {
            const target = e.target as HTMLElement | null;
            if (this.handleSourceLinkClick(e, target)) return;
            const item = target?.closest('.lists-item') as HTMLElement | null;
            if (!item) return;
            const id = item.getAttribute('data-filter-id') || '';
            if (id) this.navigateToRecordsWithFilter(`label:${id}`);
        });
    }

    private handleSourceLinkClick(e: Event, target: HTMLElement | null): boolean {
        const button = target?.closest('.list-source-link-btn') as HTMLButtonElement | null;
        if (!button) return false;

        e.preventDefault();
        e.stopPropagation();
        const sourceUrl = String(button.getAttribute('data-source-url') || '').trim();
        if (!sourceUrl) return true;
        try {
            window.open(sourceUrl, '_blank', 'noopener,noreferrer');
        } catch (error) {
            console.error('[ListsTab] open source url failed', error);
            showMessage('打开源站页面失败', 'error');
        }
        return true;
    }

    private switchSubTab(tab: SubTab): void {
        this.activeSubTab = tab;

        // 更新 pill 激活态
        document.querySelectorAll('.lists-subtab').forEach(btn => {
            const t = (btn as HTMLElement).getAttribute('data-subtab');
            btn.classList.toggle('active', t === tab);
        });

        // 显示/隐藏 panel
        const panels: Record<SubTab, string> = {
            lists: 'lists-panel-lists',
            series: 'lists-panel-series',
            labels: 'lists-panel-labels',
        };
        Object.entries(panels).forEach(([key, id]) => {
            document.getElementById(id)?.classList.toggle('lists-panel--hidden', key !== tab);
        });

        // 新建按钮只在清单 tab 可见
        const createBtn = document.getElementById('listsCreateBtn') as HTMLElement | null;
        if (createBtn) createBtn.style.display = tab === 'lists' ? '' : 'none';

        // 搜索框 placeholder
        const searchInput = document.getElementById('listsSearchInput') as HTMLInputElement | null;
        if (searchInput) {
            const placeholders: Record<SubTab, string> = {
                lists: '搜索清单名称 / ID…',
                series: '搜索系列名称…',
                labels: '搜索番号前缀…',
            };
            searchInput.placeholder = placeholders[tab];
        }

        this.render();
    }

    private async loadAndRender(): Promise<void> {
        const generation = ++this.renderGeneration;
        try {
            this.lists = await dbListsGetAllNormalized();
        } catch (e) {
            this.lists = [];
        }
        if (!this.active || generation !== this.renderGeneration) return;
        this.render();
    }

    private render(): void {
        switch (this.activeSubTab) {
            case 'lists':   this.renderListsPanel(); break;
            case 'series':  this.renderSeriesPanel(); break;
            case 'labels':  this.renderLabelsPanel(); break;
        }
    }

    private renderListsPanel(): void {
        const localEl = document.getElementById('listsLocalContainer') as HTMLElement | null;
        const mineEl = document.getElementById('listsMineContainer') as HTMLElement | null;
        const favEl = document.getElementById('listsFavContainer') as HTMLElement | null;
        const localCountEl = document.getElementById('listsLocalCount') as HTMLElement | null;
        const mineCountEl = document.getElementById('listsMineCount') as HTMLElement | null;
        const favCountEl = document.getElementById('listsFavCount') as HTMLElement | null;
        const emptyTip = document.getElementById('listsEmptyTip') as HTMLElement | null;
        const searchInput = document.getElementById('listsSearchInput') as HTMLInputElement | null;
        if (!mineEl || !favEl) return;

        const q = String(searchInput?.value || '').trim().toLowerCase();
        const match = (l: ListRecord) => !q ||
            String(l.name || '').toLowerCase().includes(q) ||
            String(l.id || '').toLowerCase().includes(q) ||
            String(l.externalId || '').toLowerCase().includes(q);

        const local = this.lists.filter(l => l?.source === 'local' && match(l)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const mine  = this.lists.filter(l => l?.source !== 'local' && l?.type === 'mine' && match(l)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const fav   = this.lists.filter(l => l?.source !== 'local' && l?.type === 'favorite' && match(l)).sort((a, b) => String(a.name).localeCompare(String(b.name)));

        if (localEl) {
            const items = local.map(l => this.renderItem(l)).join('');
            const createRow = this.isCreating ? this.renderCreateRow() : '';
            localEl.innerHTML = items + createRow || '<div class="lists-empty">暂无本地清单</div>';
        }
        mineEl.innerHTML = mine.map(l => this.renderItem(l)).join('') || '<div class="lists-empty">暂无</div>';
        favEl.innerHTML  = fav.map(l => this.renderItem(l)).join('') || '<div class="lists-empty">暂无</div>';

        if (localCountEl) localCountEl.textContent = String(local.length);
        if (mineCountEl)  mineCountEl.textContent  = String(mine.length);
        if (favCountEl)   favCountEl.textContent   = String(fav.length);

        const listTotal = local.length + mine.length + fav.length;
        if (emptyTip) {
            emptyTip.style.display = listTotal === 0 && !this.isCreating ? '' : 'none';
            if (listTotal === 0 && !this.isCreating)
                emptyTip.textContent = '暂无清单数据，请先到"数据同步"里执行"同步清单"。';
        }
    }

    private renderSeriesPanel(): void {
        const el = document.getElementById('listsSeriesContainer') as HTMLElement | null;
        const countEl = document.getElementById('listsSeriesCount') as HTMLElement | null;
        const emptyTip = document.getElementById('listsEmptyTip') as HTMLElement | null;
        const searchInput = document.getElementById('listsSearchInput') as HTMLInputElement | null;
        if (!el) return;

        const q = String(searchInput?.value || '').trim().toLowerCase();
        const items = this.lists
            .filter(l => l?.type === 'series' && (!q ||
                String(l.name || '').toLowerCase().includes(q) ||
                String(l.id || '').toLowerCase().includes(q) ||
                String(getCollectionExternalId(l)).toLowerCase().includes(q)))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));

        el.innerHTML = items.map(l => this.renderCollectionItem(l, 'series', this.computeSeriesLocalCount(l))).join('') ||
            '<div class="lists-empty">暂无收藏系列，请先到"数据同步"里执行"同步系列"。</div>';
        if (countEl) countEl.textContent = String(items.length);
        if (emptyTip) emptyTip.style.display = 'none';
    }

    private renderLabelsPanel(): void {
        const el = document.getElementById('listsLabelsContainer') as HTMLElement | null;
        const countEl = document.getElementById('listsLabelsCount') as HTMLElement | null;
        const emptyTip = document.getElementById('listsEmptyTip') as HTMLElement | null;
        const searchInput = document.getElementById('listsSearchInput') as HTMLInputElement | null;
        if (!el) return;

        const q = String(searchInput?.value || '').trim().toLowerCase();
        const items = this.lists
            .filter(l => l?.type === 'label' && (!q ||
                String(l.name || '').toLowerCase().includes(q) ||
                String(l.id || '').toLowerCase().includes(q) ||
                String(getCollectionExternalId(l)).toLowerCase().includes(q)))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));

        el.innerHTML = items.map(l => this.renderCollectionItem(l, 'label', this.computeLabelLocalCount(l))).join('') ||
            '<div class="lists-empty">暂无收藏番号，请先到"数据同步"里执行"同步番号"。</div>';
        if (countEl) countEl.textContent = String(items.length);
        if (emptyTip) emptyTip.style.display = 'none';
    }

    /** 渲染系列 / 番号条目（只读，无编辑操作） */
    private renderCollectionItem(l: ListRecord, variant: 'series' | 'label', localCount?: number): string {
        const safeName = this.escapeHtml(String(l.name || l.id));
        const safeId   = this.escapeHtml(String(l.id));
        const safeFilterId = this.escapeHtml(getCollectionExternalId(l));
        const javdbCount = typeof l.moviesCount === 'number' ? l.moviesCount : undefined;
        const sourceLinkButton = renderListSourceLinkButton(l);

        const parts: string[] = [];
        if (typeof localCount === 'number') parts.push(`已入库 <b>${localCount}</b> 部`);
        if (javdbCount !== undefined) parts.push(`共 ${javdbCount} 部`);
        const metaHtml = parts.join(' / ');

        const tip = variant === 'series' ? `点击筛选系列：${safeName}` : `点击筛选番号：${safeName}`;
        return `
            <div class="lists-item lists-item--${variant}" data-list-id="${safeId}" data-filter-id="${safeFilterId}" title="${tip}">
                <div class="lists-item-title"><span class="lists-item-name">${safeName}</span></div>
                <div class="lists-item-meta">${metaHtml}</div>
                ${sourceLinkButton}
            </div>
        `;
    }

    private computeSeriesLocalCount(series: ListRecord): number {
        const records = Array.isArray(STATE.records) ? STATE.records : [];
        return records.filter(r => matchesSeriesRecord(r, series)).length;
    }

    private computeLabelLocalCount(label: ListRecord): number {
        const records = Array.isArray(STATE.records) ? STATE.records : [];
        return records.filter(r => matchesLabelRecord(r, label)).length;
    }

    /** 渲染内嵌新建输入行 */
    private renderCreateRow(): string {
        return `
            <div class="lists-item lists-item-inline-edit">
                <input id="listsInlineCreateInput" class="lists-inline-input" type="text" placeholder="输入清单名称" maxlength="50" />
                <div class="list-inline-actions">
                    <button class="list-create-confirm-btn list-inline-btn list-inline-confirm" title="确认"><i class="fas fa-check"></i></button>
                    <button class="list-create-cancel-btn list-inline-btn list-inline-cancel" title="取消"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `;
    }

    private renderItem(l: ListRecord): string {
        const count = typeof l.moviesCount === 'number' ? l.moviesCount : undefined;
        const meta = count !== undefined ? `${count} 部` : '';
        const safeName = this.escapeHtml(String(l.name || l.id));
        const safeMeta = this.escapeHtml(meta);
        const safeId   = this.escapeHtml(String(l.id));

        let sourceBadge = '';
        if (l.source === 'javdb') {
            sourceBadge = `<span class="list-source-badge list-source-javdb">JavDB</span>`;
        } else if (l.source === 'local') {
            sourceBadge = `<span class="list-source-badge list-source-local">本地</span>`;
        }

        if (l.source === 'local' && this.renamingId === String(l.id)) {
            return `
                <div class="lists-item lists-item-inline-edit lists-item-editing" data-list-id="${safeId}">
                    <input id="listsRenameInput_${safeId}" class="lists-inline-input" type="text" value="${safeName}" maxlength="50" />
                    <div class="list-inline-actions">
                        <button class="list-rename-confirm-btn list-inline-btn list-inline-confirm" data-list-id="${safeId}" title="确认"><i class="fas fa-check"></i></button>
                        <button class="list-rename-cancel-btn list-inline-btn list-inline-cancel" title="取消"><i class="fas fa-times"></i></button>
                    </div>
                </div>
            `;
        }

        let actionBtns = renderListSourceLinkButton(l);
        if (l.source === 'local') {
            actionBtns = `
                <div class="list-item-actions">
                    <button class="list-rename-btn" data-list-id="${safeId}" title="重命名"><i class="fas fa-pen"></i></button>
                    <button class="list-delete-btn" data-list-id="${safeId}" title="删除"><i class="fas fa-trash"></i></button>
                </div>`;
        }

        return `
            <div class="lists-item" data-list-id="${safeId}" title="点击筛选番号库：${safeName}">
                <div class="lists-item-title"><span class="lists-item-name">${safeName}</span>${sourceBadge}</div>
                <div class="lists-item-meta">${safeMeta}</div>
                ${actionBtns}
            </div>
        `;
    }

    private escapeHtml(s: string): string {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    validateName(name: string, excludeId?: string): string | null {
        if (name.trim() === '') return '清单名称不能为空';
        const duplicate = this.lists.some(l => {
            if (excludeId && String(l.id) === String(excludeId)) return false;
            return String(l.name) === name.trim();
        });
        if (duplicate) return '清单名称已存在';
        return null;
    }

    private async commitCreate(): Promise<void> {
        const input = document.getElementById('listsInlineCreateInput') as HTMLInputElement | null;
        const name = (input?.value || '').trim();
        const error = this.validateName(name);
        if (error) { showMessage(error, 'warning'); input?.focus(); return; }
        const record: ListRecord = {
            id: 'local_' + Date.now(),
            name,
            type: 'mine',
            source: 'local',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        try {
            await dbListsPut(record);
            this.isCreating = false;
            await this.loadAndRender();
            showMessage(`清单"${name}"创建成功`, 'success');
        } catch (e) {
            console.error('[ListsTab] commitCreate failed', e);
            showMessage('创建清单失败', 'error');
        }
    }

    private async commitRename(id: string): Promise<void> {
        const input = document.getElementById(`listsRenameInput_${id}`) as HTMLInputElement | null;
        const name = (input?.value || '').trim();
        const error = this.validateName(name, id);
        if (error) { showMessage(error, 'warning'); input?.focus(); return; }
        const list = this.lists.find(l => String(l.id) === id);
        if (!list) return;
        try {
            await dbListsPut({ ...list, name, updatedAt: Date.now() });
            this.renamingId = null;
            await this.loadAndRender();
        } catch (e) {
            console.error('[ListsTab] commitRename failed', e);
            showMessage('重命名失败', 'error');
        }
    }

    private async deleteLocalList(list: ListRecord): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除清单',
            message: `确定要删除清单"${list.name}"吗？删除清单不会删除番号库中的视频。`,
            confirmText: '删除',
            cancelText: '取消',
            type: 'danger',
        });
        if (!confirmed) return;
        try {
            await dbListsDelete(String(list.id));
            await this.loadAndRender();
            showMessage(`清单"${list.name}"已删除`, 'success');
        } catch (e) {
            console.error('[ListsTab] deleteLocalList failed', e);
            showMessage('删除清单失败', 'error');
        }
    }

    private async navigateToRecordsWithList(listId: string): Promise<void> {
        const list = this.lists.find(l => String(l.id) === String(listId));
        if (list && typeof list.moviesCount === 'number' && list.moviesCount === 0) {
            showMessage('该清单为空，无需跳转', 'info');
            return;
        }
        await this.navigateToRecordsWithFilter(`listid:${listId}`);
    }

    private async navigateToRecordsWithFilter(filterString: string): Promise<void> {
        location.hash = '#tab-records';
        for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 80));
            const tab   = document.getElementById('tab-records') as HTMLElement | null;
            const input = document.getElementById('searchInput') as HTMLInputElement | null;
            if (!tab || !tab.classList.contains('active') || !input) continue;
            input.value = filterString;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            try { input.focus(); } catch {}
            break;
        }
    }
}

export const listsTab = new ListsTab();
