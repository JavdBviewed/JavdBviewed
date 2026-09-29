import { STATE } from '../../../../state';
import { showMessage } from '../../../../ui/toast';
import type { KeywordFilterRule } from '../../../../../types';

export type EnhancementFiltersHost = any;

export function renderFilterRules(host: EnhancementFiltersHost): void {
  if (!host.filterRulesList) return;

  host.filterRulesList.innerHTML = '';

  if (host.currentFilterRules.length === 0) {
    host.filterRulesList.innerHTML = `
      <div class="empty-state">
        <p>暂无过滤规则</p>
        <p class="text-muted">点击"添加规则"按钮创建第一个过滤规则</p>
      </div>
    `;
    return;
  }

  host.currentFilterRules.forEach((rule: KeywordFilterRule, index: number) => {
    const ruleElement = createFilterRuleElement(host, rule, index);
    host.filterRulesList.appendChild(ruleElement);
  });
}

export function createFilterRuleElement(host: EnhancementFiltersHost, rule: KeywordFilterRule, index: number): HTMLElement {
  const ruleDiv = document.createElement('div');
  ruleDiv.className = 'filter-rule-item';

  let keywordDisplay = '';
  if (rule.keyword) {
    keywordDisplay = `<div class="rule-keywords"><strong>关键词:</strong> ${rule.keyword}</div>`;
  }

  if (rule.releaseDateRange && rule.fields.includes('release-date')) {
    const dateRange = rule.releaseDateRange;
    let dateText = '';

    switch (dateRange.comparison) {
      case 'between':
        dateText = `${dateRange.startDate || '?'} 至 ${dateRange.endDate || '?'}`;
        break;
      case 'before':
        dateText = `早于 ${dateRange.exactDate || '?'}`;
        break;
      case 'after':
        dateText = `晚于 ${dateRange.exactDate || '?'}`;
        break;
      case 'exact':
        dateText = `精确匹配 ${dateRange.exactDate || '?'}`;
        break;
    }

    keywordDisplay += `<div class="rule-keywords"><strong>发行日期:</strong> ${dateText}</div>`;
  }

  ruleDiv.innerHTML = `
    <div class="rule-header">
      <span class="rule-name">${rule.name}</span>
      <div class="rule-actions">
        <div class="enhancement-toggle-wrapper">
          <button class="enhancement-toggle ${rule.enabled ? 'active' : ''}" data-index="${index}" data-enabled="${rule.enabled !== false}" title="${rule.enabled ? '点击禁用' : '点击启用'}"></button>
        </div>
        <button type="button" class="btn btn-sm btn-outline-primary edit-rule" data-index="${index}">编辑</button>
        <button type="button" class="btn btn-sm btn-outline-danger delete-rule" data-index="${index}">删除</button>
      </div>
    </div>
    <div class="rule-details">
      <div class="rule-info">
        <span class="rule-type">字段: ${getFilterFieldsText(rule.fields)}</span>
        <span class="rule-action">动作: ${getFilterActionText(rule.action)}</span>
      </div>
      ${keywordDisplay}
      ${rule.message ? `<div class="rule-description">${rule.message}</div>` : ''}
    </div>
  `;

  const toggleBtn = ruleDiv.querySelector('.enhancement-toggle') as HTMLButtonElement;
  const editBtn = ruleDiv.querySelector('.edit-rule') as HTMLButtonElement;
  const deleteBtn = ruleDiv.querySelector('.delete-rule') as HTMLButtonElement;

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      host.toggleFilterRuleEnabled(index);
    });
  }

  if (editBtn) {
    if (STATE.settings?.logging?.verboseMode) {
      console.log(`[Enhancement] 绑定编辑按钮事件，规则索引: ${index}`);
    }
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (STATE.settings?.logging?.verboseMode) {
        console.log(`[Enhancement] 编辑按钮被点击，规则索引: ${index}`);
      }
      host.editFilterRule(index);
    });
  }

  if (deleteBtn) {
    if (STATE.settings?.logging?.verboseMode) {
      console.log(`[Enhancement] 绑定删除按钮事件，规则索引: ${index}`);
    }
    deleteBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (STATE.settings?.logging?.verboseMode) {
        console.log(`[Enhancement] 删除按钮被点击，规则索引: ${index}`);
      }
      await host.deleteFilterRule(index);
    });
  }

  return ruleDiv;
}

export function getFilterFieldsText(fields: string[]): string {
  const fieldMap: Record<string, string> = {
    title: '标题',
    description: '简介',
    tags: '标签',
    actors: '演员',
    releaseDate: '发行日期',
    'release-date': '发行日期',
    'video-code': '番号',
    'video-id': '视频ID',
  };
  return fields.map(field => fieldMap[field] || field).join('、');
}

export function getFilterActionText(action: string): string {
  const actionMap: Record<string, string> = {
    hide: '隐藏',
    blur: '模糊',
    mark: '标记',
    warn: '警告',
  };
  return actionMap[action] || action;
}

export function addFilterRule(host: EnhancementFiltersHost): void {
  host.openFilterRuleModal();
}

export function editFilterRule(host: EnhancementFiltersHost, index: number): void {
  const rule = host.currentFilterRules[index];
  if (!rule) return;
  host.openFilterRuleModal(rule, index);
}

export async function deleteFilterRule(host: EnhancementFiltersHost, index: number): Promise<void> {
  console.log(`[Enhancement] deleteFilterRule 被调用，索引: ${index}`);

  const rule = host.currentFilterRules[index];
  if (!rule) {
    console.error(`[Enhancement] 未找到索引为 ${index} 的规则`);
    showMessage('未找到要删除的规则', 'error');
    return;
  }

  let confirmed = false;
  try {
    const { showDanger } = await import('../../../../components/confirmModal');
    confirmed = await showDanger(
      `确定要删除过滤规则 "${rule.name}" 吗？\n\n关键词: ${rule.keyword}\n动作: ${getFilterActionText(rule.action)}\n\n此操作不可撤销！`,
      '删除过滤规则'
    );
  } catch (error) {
    console.warn('[Enhancement] showDanger 失败，使用原生确认对话框', error);
    confirmed = confirm(
      `确定要删除过滤规则 "${rule.name}" 吗？\n\n关键词: ${rule.keyword}\n动作: ${getFilterActionText(rule.action)}\n\n此操作不可撤销！`
    );
  }

  if (!confirmed) return;

  host.currentFilterRules.splice(index, 1);
  renderFilterRules(host);
  host.handleSettingChange();
  showMessage(`过滤规则 "${rule.name}" 已删除`, 'success');
}

export function toggleFilterRuleEnabled(host: EnhancementFiltersHost, index: number): void {
  const rule = host.currentFilterRules[index];
  if (!rule) {
    console.error(`[Enhancement] 未找到索引为 ${index} 的规则`);
    return;
  }

  rule.enabled = !rule.enabled;

  const toggleBtn = host.filterRulesList?.querySelector(`.enhancement-toggle[data-index="${index}"]`) as HTMLButtonElement;
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', rule.enabled);
    toggleBtn.setAttribute('data-enabled', rule.enabled.toString());
    toggleBtn.title = rule.enabled ? '点击禁用' : '点击启用';
  }

  host.handleSettingChange();
  showMessage(`规则 "${rule.name}" 已${rule.enabled ? '启用' : '禁用'}`, 'success');
}

export function openFilterRuleModal(host: EnhancementFiltersHost, rule?: KeywordFilterRule, index?: number): void {
  const modal = document.getElementById('filterRuleModal');
  if (!modal) {
    console.warn('[Enhancement] 未找到过滤规则弹窗节点');
    return;
  }

  const title = document.getElementById('filterRuleModalTitle');
  if (title) title.textContent = rule ? '编辑过滤规则' : '添加过滤规则';

  (document.getElementById('modalInlineRuleName') as HTMLInputElement).value = rule?.name || '';
  (document.getElementById('modalInlineRuleKeyword') as HTMLInputElement).value = rule?.keyword || '';
  (document.getElementById('modalInlineRuleAction') as HTMLSelectElement).value = rule?.action || 'hide';

  const fieldsSel = document.getElementById('modalInlineRuleFields') as HTMLSelectElement;
  if (fieldsSel) {
    Array.from(fieldsSel.options).forEach(opt => {
      opt.selected = !!rule?.fields?.includes(opt.value as any);
    });
  }

  (document.getElementById('modalInlineRuleIsRegex') as HTMLInputElement).checked = !!rule?.isRegex;
  (document.getElementById('modalInlineRuleCaseSensitive') as HTMLInputElement).checked = !!rule?.caseSensitive;

  const enableToggle = document.getElementById('modalInlineRuleEnabled') as HTMLButtonElement;
  const isEnabled = rule?.enabled !== false;
  if (enableToggle) {
    enableToggle.classList.toggle('active', isEnabled);
    enableToggle.setAttribute('data-enabled', isEnabled.toString());
  }

  (document.getElementById('modalInlineRuleMessage') as HTMLTextAreaElement).value = rule?.message || '';

  const keywordSettings = document.getElementById('keywordSettings') as HTMLElement;
  const releaseDateSettings = document.getElementById('releaseDateSettings') as HTMLElement;
  const dateComparison = document.getElementById('modalInlineRuleDateComparison') as HTMLSelectElement;
  const dateRangeInputs = document.getElementById('dateRangeInputs') as HTMLElement;
  const singleDateInput = document.getElementById('singleDateInput') as HTMLElement;
  const startDateInput = document.getElementById('modalInlineRuleStartDate') as HTMLInputElement;
  const endDateInput = document.getElementById('modalInlineRuleEndDate') as HTMLInputElement;
  const singleDate = document.getElementById('modalInlineRuleSingleDate') as HTMLInputElement;

  const updateFieldSettings = () => {
    const selectedFields = Array.from(fieldsSel.selectedOptions).map(opt => opt.value);
    const hasReleaseDate = selectedFields.includes('release-date');
    const hasOtherFields = selectedFields.some(f => f !== 'release-date');

    if (hasReleaseDate && !hasOtherFields) {
      keywordSettings.style.display = 'none';
      releaseDateSettings.style.display = 'block';
    } else if (hasOtherFields) {
      keywordSettings.style.display = 'block';
      releaseDateSettings.style.display = hasReleaseDate ? 'block' : 'none';
    } else {
      keywordSettings.style.display = 'block';
      releaseDateSettings.style.display = 'none';
    }
  };

  if (rule?.releaseDateRange) {
    const dateRange = rule.releaseDateRange;
    dateComparison.value = dateRange.comparison || 'between';
    startDateInput.value = dateRange.startDate || '';
    endDateInput.value = dateRange.endDate || '';
    singleDate.value = dateRange.exactDate || '';
  }

  const updateDateInputs = () => {
    const comparison = dateComparison.value;
    if (comparison === 'between') {
      dateRangeInputs.style.display = 'flex';
      singleDateInput.style.display = 'none';
    } else {
      dateRangeInputs.style.display = 'none';
      singleDateInput.style.display = 'block';
    }
  };

  updateFieldSettings();
  updateDateInputs();
  fieldsSel.addEventListener('change', updateFieldSettings);
  dateComparison?.addEventListener('change', updateDateInputs);

  enableToggle?.addEventListener('click', () => {
    const enabled = enableToggle.classList.contains('active');
    enableToggle.classList.toggle('active', !enabled);
    enableToggle.setAttribute('data-enabled', (!enabled).toString());
  });

  const closeBtn = document.getElementById('closeFilterRuleBtn');
  const cancelBtn = document.getElementById('cancelFilterRuleBtn');
  const saveBtn = document.getElementById('saveFilterRuleBtn');

  const hide = () => { modal.classList.remove('visible'); modal.classList.add('hidden'); };
  closeBtn?.addEventListener('click', hide, { once: true });
  cancelBtn?.addEventListener('click', hide, { once: true });
  saveBtn?.addEventListener('click', () => {
    host.saveFilterRuleFromModal(index);
    hide();
  }, { once: true });

  modal.classList.remove('hidden');
  modal.classList.add('visible');
}

export function saveFilterRuleFromModal(host: EnhancementFiltersHost, index?: number): void {
  const name = (document.getElementById('modalInlineRuleName') as HTMLInputElement).value.trim();
  const fieldsSelect = document.getElementById('modalInlineRuleFields') as HTMLSelectElement;
  const action = (document.getElementById('modalInlineRuleAction') as HTMLSelectElement).value;
  const keyword = (document.getElementById('modalInlineRuleKeyword') as HTMLInputElement).value.trim();
  const isRegex = (document.getElementById('modalInlineRuleIsRegex') as HTMLInputElement).checked;
  const caseSensitive = (document.getElementById('modalInlineRuleCaseSensitive') as HTMLInputElement).checked;
  const enableToggle = document.getElementById('modalInlineRuleEnabled') as HTMLButtonElement;
  const enabled = enableToggle?.classList.contains('active') ?? true;
  const message = (document.getElementById('modalInlineRuleMessage') as HTMLTextAreaElement).value.trim();

  if (!name) { showMessage('请输入规则名称', 'error'); return; }
  if (!action) { showMessage('请选择过滤动作', 'error'); return; }

  const selectedFields = Array.from(fieldsSelect.selectedOptions).map(option => option.value) as ('title' | 'actor' | 'studio' | 'genre' | 'tag' | 'video-id' | 'video-code' | 'release-date')[];
  if (selectedFields.length === 0) { showMessage('请至少选择一个过滤字段', 'error'); return; }

  const hasReleaseDate = selectedFields.includes('release-date');
  const hasOtherFields = selectedFields.some(f => f !== 'release-date');
  if (hasOtherFields && !keyword) {
    showMessage('请输入关键词', 'error');
    return;
  }

  const rule: KeywordFilterRule = {
    id: typeof index === 'number' ? host.currentFilterRules[index].id : Date.now().toString(),
    name,
    keyword: keyword || '',
    fields: selectedFields,
    action: action as 'hide' | 'highlight' | 'blur' | 'mark',
    isRegex,
    caseSensitive,
    enabled,
    message: message || undefined,
  };

  if (hasReleaseDate) {
    const dateComparison = (document.getElementById('modalInlineRuleDateComparison') as HTMLSelectElement).value;
    const startDate = (document.getElementById('modalInlineRuleStartDate') as HTMLInputElement).value;
    const endDate = (document.getElementById('modalInlineRuleEndDate') as HTMLInputElement).value;
    const singleDate = (document.getElementById('modalInlineRuleSingleDate') as HTMLInputElement).value;

    rule.releaseDateRange = {
      enabled: true,
      comparison: dateComparison as 'between' | 'before' | 'after' | 'exact',
    };

    if (dateComparison === 'between') {
      rule.releaseDateRange.startDate = startDate || undefined;
      rule.releaseDateRange.endDate = endDate || undefined;
    } else {
      rule.releaseDateRange.exactDate = singleDate || undefined;
    }
  }

  if (typeof index === 'number') {
    host.currentFilterRules[index] = rule;
    showMessage(`过滤规则 "${rule.name}" 已更新`, 'success');
  } else {
    host.currentFilterRules.push(rule);
    showMessage(`过滤规则 "${rule.name}" 已添加`, 'success');
  }

  renderFilterRules(host);
  host.handleSettingChange();
}
