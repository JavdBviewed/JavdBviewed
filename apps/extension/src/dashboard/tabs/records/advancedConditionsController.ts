import type {
  RecordsAdvancedComparator,
  RecordsAdvancedCondition,
  RecordsAdvancedFieldKey,
} from './advancedConditionModel';

type MessageType = 'info' | 'warn' | 'warning' | 'error' | 'success';

export interface CreateRecordsAdvancedConditionsControllerOptions {
  container: HTMLDivElement;
  quickTimeField: HTMLSelectElement | null;
  quickTimeValue: HTMLInputElement | null;
  quickTimeUnit: HTMLSelectElement | null;
  quickTimePreview: HTMLSpanElement | null;
  getConditions: () => RecordsAdvancedCondition[];
  setConditions: (conditions: RecordsAdvancedCondition[]) => void;
  onConditionsChange: () => void;
  showMessage: (message: string, type: MessageType) => void;
  now?: () => number;
}

export interface RecordsAdvancedConditionsController {
  addCondition: (condition?: RecordsAdvancedCondition) => RecordsAdvancedCondition;
  parseFromUI: () => RecordsAdvancedCondition[];
  renderConditions: () => void;
  clear: () => void;
  updateQuickTimePreview: () => void;
  addQuickTimeCondition: () => void;
  bindQuickTimeControls: () => void;
}

const FIELD_OPTIONS: Array<{ key: RecordsAdvancedFieldKey; label: string }> = [
  { key: 'id', label: '番号(id)' },
  { key: 'title', label: '标题(title)' },
  { key: 'status', label: '状态(status)' },
  { key: 'tags', label: '标签(tags)' },
  { key: 'releaseDate', label: '发行日期(releaseDate)' },
  { key: 'createdAt', label: '创建时间(createdAt)' },
  { key: 'updatedAt', label: '更新时间(updatedAt)' },
  { key: 'rating', label: '官方评分(rating)' },
  { key: 'userRating', label: '我的评分(userRating)' },
  { key: 'javdbUrl', label: 'JavDB链接(javdbUrl)' },
  { key: 'javdbImage', label: '封面链接(javdbImage)' },
];

function formatLocal(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createConditionId(): string {
  return `cond_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function addOptions(select: HTMLSelectElement, ops: Array<{ value: RecordsAdvancedComparator; label: string }>): void {
  ops.forEach((op) => {
    const option = document.createElement('option');
    option.value = op.value;
    option.textContent = op.label;
    select.appendChild(option);
  });
}

function setOperatorsForField(
  field: RecordsAdvancedFieldKey,
  opSelect: HTMLSelectElement,
  valueInput: HTMLInputElement,
): void {
  opSelect.innerHTML = '';
  valueInput.placeholder = '比较值';

  if (field === 'id' || field === 'title' || field === 'status' || field === 'releaseDate' || field === 'javdbUrl' || field === 'javdbImage') {
    addOptions(opSelect, [
      { value: 'contains', label: '包含' },
      { value: 'equals', label: '等于' },
      { value: 'starts_with', label: '开头是' },
      { value: 'ends_with', label: '结尾是' },
      { value: 'empty', label: '为空' },
      { value: 'not_empty', label: '非空' },
    ]);
  } else if (field === 'createdAt' || field === 'updatedAt') {
    addOptions(opSelect, [
      { value: 'eq', label: '等于(时间戳/毫秒)' },
      { value: 'gt', label: '大于' },
      { value: 'gte', label: '大于等于' },
      { value: 'lt', label: '小于' },
      { value: 'lte', label: '小于等于' },
      { value: 'empty', label: '为空' },
      { value: 'not_empty', label: '非空' },
    ]);
  } else if (field === 'rating' || field === 'userRating') {
    addOptions(opSelect, [
      { value: 'eq', label: '等于' },
      { value: 'gt', label: '大于' },
      { value: 'gte', label: '大于等于' },
      { value: 'lt', label: '小于' },
      { value: 'lte', label: '小于等于' },
      { value: 'empty', label: '未评分' },
      { value: 'not_empty', label: '已评分' },
    ]);
    valueInput.type = 'number';
    valueInput.min = '0';
    valueInput.max = '5';
    valueInput.step = '0.1';
    valueInput.placeholder = '0-5 分';
  } else if (field === 'tags') {
    addOptions(opSelect, [
      { value: 'includes_all', label: '包含全部标签(子串, AND)' },
      { value: 'includes_any', label: '包含任一标签(子串, OR)' },
      { value: 'includes', label: '包含某标签(精确)' },
      { value: 'length_eq', label: '标签数量 = ' },
      { value: 'length_gt', label: '标签数量 > ' },
      { value: 'length_gte', label: '标签数量 ≥ ' },
      { value: 'length_lt', label: '标签数量 < ' },
      { value: 'empty', label: '为空' },
      { value: 'not_empty', label: '非空' },
    ]);
    valueInput.placeholder = '多个值用 空格/逗号/分号 分隔 (子串匹配, 忽略大小写)';
  }

  if (field !== 'rating' && field !== 'userRating') {
    valueInput.type = 'text';
    valueInput.removeAttribute('min');
    valueInput.removeAttribute('max');
    valueInput.removeAttribute('step');
  }
}

function updateValueVisibility(opSelect: HTMLSelectElement, valueInput: HTMLInputElement): void {
  const op = opSelect.value as RecordsAdvancedComparator;
  valueInput.style.display = op === 'empty' || op === 'not_empty' ? 'none' : '';
}

function updateHumanHint(
  fieldSelect: HTMLSelectElement,
  opSelect: HTMLSelectElement,
  valueInput: HTMLInputElement,
  hint: HTMLSpanElement,
): void {
  try {
    const field = fieldSelect.value as RecordsAdvancedFieldKey;
    const op = opSelect.value as RecordsAdvancedComparator;
    const numeric = Number(valueInput.value.trim());
    const needsHint = (field === 'createdAt' || field === 'updatedAt') && ['eq', 'gt', 'gte', 'lt', 'lte'].includes(op);
    if (needsHint && Number.isFinite(numeric) && numeric > 0) {
      hint.textContent = `${field} ${op} ${formatLocal(numeric)}`;
      hint.style.display = '';
    } else {
      hint.textContent = '';
      hint.style.display = 'none';
    }
  } catch {
    hint.textContent = '';
    hint.style.display = 'none';
  }
}

export function createRecordsAdvancedConditionsController(
  options: CreateRecordsAdvancedConditionsControllerOptions,
): RecordsAdvancedConditionsController {
  const now = options.now || Date.now;

  const parseFromUI = (): RecordsAdvancedCondition[] => {
    const rows = Array.from(options.container.querySelectorAll('.adv-condition-row')) as HTMLDivElement[];
    return rows.map((row) => {
      const id = row.dataset.id || `cond_${Math.random()}`;
      const field = (row.querySelector('.adv-field') as HTMLSelectElement).value as RecordsAdvancedFieldKey;
      const op = (row.querySelector('.adv-operator') as HTMLSelectElement).value as RecordsAdvancedComparator;
      const valueEl = row.querySelector('.adv-value') as HTMLInputElement;
      const value = op === 'empty' || op === 'not_empty' ? undefined : (valueEl?.value ?? '');
      return { id, field, op, value };
    });
  };

  const addCondition = (condition?: RecordsAdvancedCondition): RecordsAdvancedCondition => {
    const nextCondition: RecordsAdvancedCondition = condition || { id: createConditionId(), field: 'id', op: 'contains', value: '' };
    const row = document.createElement('div');
    row.className = 'adv-condition-row';
    row.dataset.id = nextCondition.id;

    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'adv-field';
    FIELD_OPTIONS.forEach((fieldOption) => {
      const option = document.createElement('option');
      option.value = fieldOption.key;
      option.textContent = fieldOption.label;
      fieldSelect.appendChild(option);
    });

    const opSelect = document.createElement('select');
    opSelect.className = 'adv-operator';

    const valueInput = document.createElement('input');
    valueInput.className = 'adv-value';
    valueInput.type = 'text';
    valueInput.placeholder = '比较值';

    const hint = document.createElement('span');
    hint.className = 'adv-value-hint';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'button-like adv-remove';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.title = '移除此条件';

    fieldSelect.addEventListener('change', () => {
      setOperatorsForField(fieldSelect.value as RecordsAdvancedFieldKey, opSelect, valueInput);
      updateValueVisibility(opSelect, valueInput);
      updateHumanHint(fieldSelect, opSelect, valueInput, hint);
    });
    opSelect.addEventListener('change', () => {
      updateValueVisibility(opSelect, valueInput);
      updateHumanHint(fieldSelect, opSelect, valueInput, hint);
    });
    valueInput.addEventListener('input', () => updateHumanHint(fieldSelect, opSelect, valueInput, hint));
    removeBtn.addEventListener('click', () => {
      const id = row.dataset.id || '';
      options.setConditions(options.getConditions().filter(conditionItem => conditionItem.id !== id));
      row.remove();
      options.onConditionsChange();
    });

    fieldSelect.value = nextCondition.field || 'id';
    setOperatorsForField(fieldSelect.value as RecordsAdvancedFieldKey, opSelect, valueInput);
    if (nextCondition.op) opSelect.value = nextCondition.op;
    else if (fieldSelect.value === 'tags') opSelect.value = 'includes_all';
    if (nextCondition.value !== undefined) valueInput.value = nextCondition.value;
    updateValueVisibility(opSelect, valueInput);
    updateHumanHint(fieldSelect, opSelect, valueInput, hint);

    row.appendChild(fieldSelect);
    row.appendChild(opSelect);
    row.appendChild(valueInput);
    row.appendChild(hint);
    row.appendChild(removeBtn);
    options.container.appendChild(row);

    return nextCondition;
  };

  const renderConditions = () => {
    options.container.innerHTML = '';
    options.getConditions().forEach(condition => addCondition(condition));
  };

  const clear = () => {
    options.setConditions([]);
    options.container.innerHTML = '';
    options.onConditionsChange();
  };

  const updateQuickTimePreview = () => {
    try {
      const field = (options.quickTimeField?.value || 'createdAt') as RecordsAdvancedFieldKey;
      const value = parseInt(options.quickTimeValue?.value || '0', 10);
      const unit = options.quickTimeUnit?.value || 'days';
      if (!Number.isNaN(value) && value > 0) {
        const delta = unit === 'hours' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
        const since = now() - delta;
        if (options.quickTimePreview) options.quickTimePreview.textContent = `将添加：${field} ≥ ${formatLocal(since)}`;
      } else if (options.quickTimePreview) {
        options.quickTimePreview.textContent = '';
      }
    } catch {
      if (options.quickTimePreview) options.quickTimePreview.textContent = '';
    }
  };

  const addQuickTimeCondition = () => {
    const field = (options.quickTimeField?.value || 'createdAt') as RecordsAdvancedFieldKey;
    const value = parseInt(options.quickTimeValue?.value || '0', 10);
    const unit = options.quickTimeUnit?.value || 'days';
    if (Number.isNaN(value) || value <= 0) {
      options.showMessage('请输入有效的数字 N', 'warn');
      return;
    }

    const delta = unit === 'hours' ? value * 60 * 60 * 1000 : value * 24 * 60 * 60 * 1000;
    const condition: RecordsAdvancedCondition = {
      id: `cond_${Date.now()}`,
      field,
      op: 'gte',
      value: String(now() - delta),
    };
    options.setConditions([...options.getConditions(), condition]);
    addCondition(condition);
    options.onConditionsChange();
  };

  const bindQuickTimeControls = () => {
    options.quickTimeField?.addEventListener('change', updateQuickTimePreview);
    options.quickTimeValue?.addEventListener('input', updateQuickTimePreview);
    options.quickTimeUnit?.addEventListener('change', updateQuickTimePreview);
    updateQuickTimePreview();
  };

  return {
    addCondition,
    parseFromUI,
    renderConditions,
    clear,
    updateQuickTimePreview,
    addQuickTimeCondition,
    bindQuickTimeControls,
  };
}
