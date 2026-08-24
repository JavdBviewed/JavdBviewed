/**
 * @file SearchEngineSettingsPage.tsx
 * @description 搜索引擎设置 React 全页（列表 CRUD）
 * @module apps/dashboard/pages/settings/searchEngine
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../../../ui/primitives/Button/Button';
import { Input } from '../../../../../ui/primitives/Input/Input';
import { Modal } from '../../../../../ui/primitives/Modal/Modal';
import { Toggle } from '../../../../../ui/primitives/Toggle/Toggle';
import { SettingSection } from '../../../../../ui/patterns/SettingSection/SettingSection';
import { SettingField } from '../../../../../ui/patterns/SettingField/SettingField';
import { SettingSelect } from '../../../../../ui/patterns/SettingSelect/SettingSelect';
import { SettingsPageFrame } from '../shared/settingsPageFrame';
import {
  getSettings,
  saveSettings,
  syncDashboardState,
  useDebouncedSettingsSave,
} from '../shared/settingsPersist';
import {
  addSearchEngine,
  applySearchEngineFormToSettings,
  DEFAULT_SEARCH_ENGINE_FORM,
  dedupeEngineList,
  getVisibleEngines,
  isBundledSearchEngine,
  mapSettingsToSearchEngineForm,
  removeEngineAt,
  resolveSearchEngineIcon,
  SEARCH_ENGINE_CATEGORY_OPTIONS,
  SEARCH_ENGINE_FILTER_OPTIONS,
  updateEngineAt,
  validateNewSearchEngine,
  validateSearchEngines,
  type SearchEngineFormState,
  type SearchEngineRow,
} from './searchEngineSettingsModel';

const AUTO_SAVE_MS = 1000;

async function toast(
  message: string,
  type: 'success' | 'info' | 'error' | 'warning' = 'info',
): Promise<void> {
  try {
    const { showMessage } = await import('../../../../../dashboard/ui/toast');
    showMessage(message, type as any);
  } catch {
    /* ignore */
  }
}

type AddForm = {
  name: string;
  urlTemplate: string;
  icon: string;
  category: string;
};

const EMPTY_ADD: AddForm = {
  name: '',
  urlTemplate: '',
  icon: 'assets/alternate-search.png',
  category: 'search',
};

/**
 * 搜索引擎完整页面
 */
export function SearchEngineSettingsPage() {
  const [form, setForm] = useState<SearchEngineFormState>(DEFAULT_SEARCH_ENGINE_FORM);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const [modalOpen, setModalOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD);

  const persist = useCallback(async (nextForm: SearchEngineFormState) => {
    const validation = validateSearchEngines(nextForm.engines);
    if (!validation.isValid) {
      setSaveError(validation.errors[0] || '校验失败');
      return;
    }
    try {
      const deduped = dedupeEngineList(nextForm.engines);
      const toSave: SearchEngineFormState = {
        ...nextForm,
        engines: deduped.engines,
      };
      if (deduped.duplicates.length > 0) {
        const names = deduped.duplicates
          .map((item) => `${item.duplicateName} → ${item.keptName}`)
          .join('，');
        await toast(`已移除重复搜索引擎：${names}`, 'warning');
        formRef.current = toSave;
        setForm(toSave);
      }
      const current = await getSettings();
      const next = applySearchEngineFormToSettings(current, toSave);
      await saveSettings(next);
      await syncDashboardState(next);
      setSaveError(null);
    } catch (err) {
      console.error('[SearchEngineSettingsPage] save failed', err);
      setSaveError(err instanceof Error ? err.message : '保存失败');
    }
  }, []);

  const { scheduleSave, flush } = useDebouncedSettingsSave({
    delayMs: AUTO_SAVE_MS,
    persist,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (cancelled) return;
        const next = mapSettingsToSearchEngineForm(settings);
        formRef.current = next;
        setForm(next);
      } catch (err) {
        console.error('[SearchEngineSettingsPage] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => getVisibleEngines(form), [form]);

  const patchEngines = useCallback(
    (engines: SearchEngineRow[], immediate = false) => {
      const next = { ...formRef.current, engines };
      formRef.current = next;
      setForm(next);
      if (immediate) void flush(next);
      else scheduleSave(next);
    },
    [flush, scheduleSave],
  );

  const onCategoryFilter = (value: string) => {
    const next = { ...formRef.current, categoryFilter: value };
    formRef.current = next;
    setForm(next);
  };

  const onFieldChange = (
    index: number,
    patch: Partial<SearchEngineRow>,
  ) => {
    patchEngines(updateEngineAt(form.engines, index, patch));
  };

  const onDelete = (index: number) => {
    const result = removeEngineAt(form.engines, index);
    if (result.blocked) {
      void toast('内置搜索引擎暂不支持删除', 'warning');
      return;
    }
    patchEngines(result.engines, true);
  };

  const openAddModal = () => {
    const defaultCategory =
      form.categoryFilter && form.categoryFilter !== 'all' ? form.categoryFilter : 'search';
    setAddForm({ ...EMPTY_ADD, category: defaultCategory });
    setModalOpen(true);
  };

  const confirmAdd = async () => {
    const v = validateNewSearchEngine(addForm);
    if (!v.ok) {
      await toast(v.message || '输入无效', 'warning');
      return;
    }
    const result = addSearchEngine(form.engines, addForm);
    if (result.duplicate) {
      await toast(`已存在相同搜索引擎：${result.duplicate.keptName}`, 'warning');
      return;
    }
    setModalOpen(false);
    patchEngines(result.engines, true);
  };

  return (
    <SettingsPageFrame
      title="搜索引擎设置"
      description="自定义点击番号后跳转的搜索网站。使用 {{ID}} 作为番号占位符。"
      rootDataAttrs={{ 'data-search-engine-settings-react': '1' }}
    >
      {loading ? (
        <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">加载中…</p>
      ) : (
        <div className="flex flex-col gap-4" id="search-engine-settings">
          <SettingSection title="搜索引擎列表" description="启用开关控制详情页/番号库显示；内置引擎名称与 URL 只读。">
            <div className="flex flex-wrap items-end justify-between gap-3 px-2 py-2">
              <SettingField id="search-engine-category-filter" label="分类">
                <SettingSelect
                  id="search-engine-category-filter"
                  value={form.categoryFilter}
                  options={[...SEARCH_ENGINE_FILTER_OPTIONS]}
                  onChange={onCategoryFilter}
                />
              </SettingField>
              <Button id="add-search-engine" variant="primary" onClick={openAddModal}>
                <i className="fas fa-plus" aria-hidden="true" /> 添加新的搜索引擎
              </Button>
            </div>

            <div
              className="grid grid-cols-[40px_56px_minmax(0,1fr)] items-center gap-2 rounded-[var(--radius-2)] bg-[var(--color-surface-2)] px-3 py-2 text-[12px] font-semibold text-[var(--color-fg-muted)] md:grid-cols-[40px_56px_minmax(150px,1fr)_120px_minmax(220px,1.4fr)_minmax(160px,1fr)_auto]"
              role="row"
              aria-label="搜索引擎列表列标题"
            >
              <div role="columnheader">图标</div>
              <div
                id="search-engine-enabled-column"
                data-settings-search-target
                data-settings-search-keywords="搜索引擎是否启用 是否启用 启用开关 显示开关"
                role="columnheader"
              >
                是否启用
              </div>
              <div role="columnheader">搜索引擎名称</div>
              <div className="hidden md:block" role="columnheader">分类</div>
              <div className="hidden md:block" role="columnheader">URL 模板</div>
              <div className="hidden md:block" role="columnheader">图标地址</div>
              <div className="hidden md:block" role="columnheader">操作</div>
            </div>

            <div
              id="search-engine-list"
              className="flex flex-col gap-2 px-2 py-2"
              data-settings-search-keywords="搜索引擎列表"
            >
              {visible.length === 0 ? (
                <p className="m-0 text-[13px] text-[var(--color-fg-muted)]">当前分类下没有搜索引擎</p>
              ) : (
                visible.map((engine) => {
                  const index = form.engines.indexOf(engine);
                  const bundled = isBundledSearchEngine(engine);
                  const iconSrc = resolveSearchEngineIcon(engine);
                  const searchTarget = String(engine.id || '').trim().toLowerCase();
                  return (
                    <div
                      key={`${engine.id}-${index}`}
                      className="grid gap-2 rounded-[var(--radius-2)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-[var(--color-surface)] hover:shadow-[var(--shadow-1)] md:grid-cols-[40px_auto_1fr_120px_1.4fr_1fr_auto] md:items-center"
                      data-engine-id={engine.id}
                      data-index={String(index)}
                      data-settings-search-target={
                        searchTarget ? `search-engine:${searchTarget}` : undefined
                      }
                    >
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[var(--radius-2)] bg-[var(--color-surface)]">
                        <img
                          src={iconSrc}
                          alt=""
                          className="h-5 w-5 object-contain"
                          onError={(e) => {
                            try {
                              e.currentTarget.src = chrome.runtime.getURL('assets/alternate-search.png');
                            } catch {
                              /* ignore */
                            }
                          }}
                        />
                      </div>

                      <Toggle
                        checked={engine.enabled !== false}
                        onChange={(e) =>
                          onFieldChange(index, { enabled: e.currentTarget.checked })
                        }
                        aria-label={`${engine.name || '搜索引擎'} 启用`}
                      />

                      <div className="min-w-0">
                        <Input
                          className="name-input"
                          value={engine.name}
                          disabled={bundled}
                          placeholder="名称"
                          onChange={(e) => onFieldChange(index, { name: e.currentTarget.value })}
                        />
                        {bundled ? (
                          <span className="mt-1 inline-block text-[11px] text-[var(--color-fg-muted)]">
                            内置
                          </span>
                        ) : null}
                      </div>

                      <SettingSelect
                        className="category-select"
                        value={String(engine.category || 'search')}
                        disabled={bundled}
                        options={[...SEARCH_ENGINE_CATEGORY_OPTIONS]}
                        onChange={(v) => onFieldChange(index, { category: v })}
                      />

                      <Input
                        className="url-template-input"
                        value={engine.urlTemplate}
                        disabled={bundled}
                        placeholder="URL 模板"
                        onChange={(e) =>
                          onFieldChange(index, { urlTemplate: e.currentTarget.value })
                        }
                      />

                      <Input
                        className="icon-url-input"
                        value={engine.icon}
                        disabled={bundled}
                        placeholder="Icon URL"
                        onChange={(e) => onFieldChange(index, { icon: e.currentTarget.value })}
                      />

                      <Button
                        className="delete-engine"
                        variant="danger"
                        size="sm"
                        disabled={bundled}
                        title={bundled ? '内置搜索引擎暂不支持删除' : '删除'}
                        onClick={() => onDelete(index)}
                      >
                        <i className="fas fa-trash" aria-hidden="true" /> 删除
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </SettingSection>

          {saveError ? (
            <p className="m-0 text-[12.5px] text-[var(--color-danger,#c0392b)]" role="alert">
              保存失败：{saveError}
            </p>
          ) : null}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="新增搜索引擎"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              <i className="fas fa-times" aria-hidden="true" /> 取消
            </Button>
            <Button variant="primary" onClick={() => void confirmAdd()}>
              <i className="fas fa-plus" aria-hidden="true" /> 确认新增
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[var(--color-fg)]">
          <p className="m-0 text-[12.5px] text-[var(--color-fg-muted)]">
            填写后点击确认写入设置列表
          </p>
          <SettingField id="search-engine-modal-name" label="名称">
            <Input
              id="search-engine-modal-name"
              value={addForm.name}
              placeholder="例如：字幕站"
              onChange={(e) => {
                const value = e.currentTarget.value;
                setAddForm((f) => ({ ...f, name: value }));
              }}
            />
          </SettingField>
          <SettingField id="search-engine-modal-category" label="分类">
            <SettingSelect
              id="search-engine-modal-category"
              value={addForm.category}
              options={[...SEARCH_ENGINE_CATEGORY_OPTIONS]}
              onChange={(v) => setAddForm((f) => ({ ...f, category: v }))}
            />
          </SettingField>
          <SettingField id="search-engine-modal-url" label="URL 模板">
            <Input
              id="search-engine-modal-url"
              value={addForm.urlTemplate}
              placeholder="https://example.com/search?q={{ID}}"
              onChange={(e) => {
                const value = e.currentTarget.value;
                setAddForm((f) => ({ ...f, urlTemplate: value }));
              }}
            />
          </SettingField>
          <SettingField id="search-engine-modal-icon" label="图标地址">
            <Input
              id="search-engine-modal-icon"
              value={addForm.icon}
              placeholder="assets/alternate-search.png"
              onChange={(e) => {
                const value = e.currentTarget.value;
                setAddForm((f) => ({ ...f, icon: value }));
              }}
            />
          </SettingField>
        </div>
      </Modal>
    </SettingsPageFrame>
  );
}
