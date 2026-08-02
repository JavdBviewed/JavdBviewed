import type { VideoRecord, VideoStatus } from '../../../types';

type MessageType = 'info' | 'warn' | 'warning' | 'error' | 'success';

export interface RecordsEditModalSaveResult {
  message?: string;
  type?: MessageType;
}

export interface OpenRecordsEditModalOptions {
  record: VideoRecord;
  videoStatus: {
    UNTRACKED: VideoStatus;
    VIEWED: VideoStatus;
    BROWSED: VideoStatus;
    WANT: VideoStatus;
  };
  showMessage: (message: string, type: MessageType) => void;
  onSave: (
    updatedRecord: VideoRecord,
    originalRecord: VideoRecord,
  ) => Promise<RecordsEditModalSaveResult | void> | RecordsEditModalSaveResult | void;
}

function generateStarRating(fieldId: string, currentRating: number | undefined, label: string, color: string): string {
  const rating = currentRating || 0;
  let starsHtml = '';

  for (let i = 1; i <= 5; i++) {
    const fullValue = i;
    const halfValue = i - 0.5;
    const isFull = rating >= fullValue;
    const isHalf = !isFull && rating >= halfValue;

    starsHtml += `
      <span class="star-wrapper" data-star="${i}">
        <i class="star-half-left ${isHalf || isFull ? 'fas' : 'far'} fa-star"
           data-value="${halfValue}"
           style="color: ${isHalf || isFull ? color : '#ddd'}"></i>
        <i class="star-half-right ${isFull ? 'fas' : 'far'} fa-star"
           data-value="${fullValue}"
           style="color: ${isFull ? color : '#ddd'}"></i>
      </span>
    `;
  }

  return `
    <div class="form-group star-rating-group">
      <div class="star-rating-input" data-field="${fieldId}" data-rating="${rating}">
        <span class="rating-label">${label}:</span>
        <span class="rating-value">${rating > 0 ? rating + ' 星' : '未评分'}</span>
        <div class="stars-container">
          ${starsHtml}
        </div>
      </div>
    </div>
  `;
}

function generateFormGroupWithLock(record: VideoRecord, fieldName: string, label: string, inputHtml: string, isRequired = false): string {
  const isLocked = record.manuallyEditedFields?.includes(fieldName) || false;
  const lockIcon = isLocked
    ? '<i class="fas fa-lock field-lock locked" title="此字段已锁定，不会被自动同步覆盖。点击解锁"></i>'
    : '<i class="fas fa-lock-open field-lock unlocked" title="此字段会自动同步。编辑后将自动锁定"></i>';

  return `
    <div class="form-group" data-field-name="${fieldName}">
      <label>
        ${label}${isRequired ? ': <span class="required">*</span>' : ':'}
        ${lockIcon}
      </label>
      ${inputHtml}
    </div>
  `;
}

function updateStarDisplay(container: HTMLElement, rating: number, color: string): void {
  const valueSpan = container.querySelector('.rating-value') as HTMLElement;
  const starWrappers = container.querySelectorAll('.star-wrapper');

  starWrappers.forEach((wrapper, index) => {
    const starNum = index + 1;
    const leftHalf = wrapper.querySelector('.star-half-left') as HTMLElement;
    const rightHalf = wrapper.querySelector('.star-half-right') as HTMLElement;
    const fullValue = starNum;
    const halfValue = starNum - 0.5;
    const isFull = rating >= fullValue;
    const isHalf = !isFull && rating >= halfValue;

    if (isHalf || isFull) {
      leftHalf.classList.remove('far');
      leftHalf.classList.add('fas');
      leftHalf.style.color = color;
    } else {
      leftHalf.classList.remove('fas');
      leftHalf.classList.add('far');
      leftHalf.style.color = '#ddd';
    }

    if (isFull) {
      rightHalf.classList.remove('far');
      rightHalf.classList.add('fas');
      rightHalf.style.color = color;
    } else {
      rightHalf.classList.remove('fas');
      rightHalf.classList.add('far');
      rightHalf.style.color = '#ddd';
    }
  });

  valueSpan.textContent = rating > 0 ? rating + ' 星' : '未评分';
  container.setAttribute('data-rating', String(rating));
}

function setLockIconState(lockIcon: Element, locked: boolean): void {
  if (locked) {
    lockIcon.classList.remove('fas', 'fa-lock-open', 'unlocked');
    lockIcon.classList.add('fas', 'fa-lock', 'locked');
    lockIcon.setAttribute('title', '此字段已锁定，不会被自动同步覆盖。点击解锁');
    return;
  }

  lockIcon.classList.remove('fas', 'fa-lock', 'locked');
  lockIcon.classList.add('fas', 'fa-lock-open', 'unlocked');
  lockIcon.setAttribute('title', '此字段会自动同步。编辑后将自动锁定');
}

function splitCommaList(value: string): string[] {
  return value ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
}

export function openRecordsEditModal(options: OpenRecordsEditModalOptions): void {
  const { record, videoStatus } = options;
  const modal = document.createElement('div');
  modal.className = 'edit-record-modal';

  modal.innerHTML = `
    <div class="edit-modal-content">
      <div class="edit-modal-header">
        <h3>编辑记录: ${record.id}</h3>
        <button class="edit-modal-close">&times;</button>
      </div>
      <div class="edit-modal-body">
        <div class="edit-form-container">
          <div class="json-editor-container">
            <div class="json-editor">
              <label for="edit-json">原始JSON数据 <small style="color: #888;">(自动同步)</small>:</label>
              <textarea id="edit-json" rows="30">${JSON.stringify(record, null, 2)}</textarea>
            </div>
          </div>
          <div class="edit-form">
            <h4>基础信息</h4>
            <div class="form-row">
              <div class="form-group">
                <label for="edit-id">视频ID: <span class="required">*</span></label>
                <input type="text" id="edit-id" value="${record.id}" />
                <small class="form-hint">修改ID后会创建新记录，原记录将被删除</small>
              </div>
              <div class="form-group">
                <label for="edit-status">状态:</label>
                <select id="edit-status">
                  <option value="${videoStatus.UNTRACKED}" ${record.status === videoStatus.UNTRACKED ? 'selected' : ''}>未标记</option>
                  <option value="${videoStatus.VIEWED}" ${record.status === videoStatus.VIEWED ? 'selected' : ''}>已观看</option>
                  <option value="${videoStatus.BROWSED}" ${record.status === videoStatus.BROWSED ? 'selected' : ''}>已浏览</option>
                  <option value="${videoStatus.WANT}" ${record.status === videoStatus.WANT ? 'selected' : ''}>想看</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label for="edit-title">标题: <span class="required">*</span></label>
              <input type="text" id="edit-title" value="${record.title}" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="edit-release-date">发布日期:</label>
                <input type="date" id="edit-release-date" value="${record.releaseDate || ''}" />
              </div>
              <div class="form-group">
                <label for="edit-duration">时长 (分钟):</label>
                <input type="number" id="edit-duration" value="${record.duration || ''}" placeholder="120" min="0" />
              </div>
            </div>

            <h4>评分与收藏</h4>
            ${generateStarRating('userRating', record.userRating, '我的评分', '#ff4444')}
            <div class="form-group checkbox-group">
              <label>
                <input type="checkbox" id="edit-is-favorite" ${record.isFavorite ? 'checked' : ''} />
                <i class="fas fa-heart" style="color: #ff4444;"></i> 收藏此影片
              </label>
            </div>
            <div class="form-group">
              <label for="edit-user-notes">我的备注:</label>
              <textarea id="edit-user-notes" rows="3" placeholder="写下你对这部影片的想法...">${record.userNotes || ''}</textarea>
            </div>

            <h4>制作信息</h4>
            <div class="form-row">
              ${generateFormGroupWithLock(record, 'director', '导演', `<input type="text" id="edit-director" value="${record.director || ''}" placeholder="导演名称" />`)}
              ${generateFormGroupWithLock(record, 'maker', '片商', `<input type="text" id="edit-maker" value="${record.maker || ''}" placeholder="片商名称" />`)}
            </div>
            ${generateFormGroupWithLock(record, 'series', '系列', `<input type="text" id="edit-series" value="${record.series || ''}" placeholder="系列名称" />`)}

            <h4>链接与图片</h4>
            <div class="form-group">
              <label for="edit-javdb-url">JavDB链接:</label>
              <input type="url" id="edit-javdb-url" value="${record.javdbUrl || ''}" placeholder="https://javdb.com/v/..." />
            </div>
            <div class="form-group">
              <label for="edit-javdb-image">封面图片链接:</label>
              <input type="url" id="edit-javdb-image" value="${record.javdbImage || ''}" placeholder="https://..." />
            </div>

            <h4>标签与分类</h4>
            ${generateFormGroupWithLock(record, 'tags', '标签 (用逗号分隔)', `<textarea id="edit-tags" rows="2" placeholder="中出, 巨乳, 单体作品">${record.tags ? record.tags.join(', ') : ''}</textarea>`)}
            <div class="form-group">
              <label for="edit-user-tags">我的标签 (用逗号分隔):</label>
              <textarea id="edit-user-tags" rows="2" placeholder="精选, 待整理">${record.userTags ? record.userTags.join(', ') : ''}</textarea>
              <small class="form-hint">仅保存在扩展中，不会修改 JavDB 的影片标签。</small>
            </div>
            ${generateFormGroupWithLock(record, 'categories', '类别 (用逗号分隔)', `<textarea id="edit-categories" rows="2" placeholder="已婚婦女, 出軌, 巨乳">${record.categories ? record.categories.join(', ') : ''}</textarea>`)}
            ${generateFormGroupWithLock(record, 'actors', '演员 (用逗号分隔)', `<textarea id="edit-actors" rows="2" placeholder="演员1, 演员2">${record.actors ? record.actors.join(', ') : ''}</textarea>`)}
          </div>
        </div>
      </div>
      <div class="edit-modal-footer">
        <button id="save-record" class="btn-primary"><i class="fas fa-save"></i> 保存</button>
        <button id="cancel-edit" class="btn-secondary"><i class="fas fa-times"></i> 取消</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const idInput = modal.querySelector('#edit-id') as HTMLInputElement;
  const titleInput = modal.querySelector('#edit-title') as HTMLInputElement;
  const statusSelect = modal.querySelector('#edit-status') as HTMLSelectElement;
  const releaseDateInput = modal.querySelector('#edit-release-date') as HTMLInputElement;
  const javdbUrlInput = modal.querySelector('#edit-javdb-url') as HTMLInputElement;
  const javdbImageInput = modal.querySelector('#edit-javdb-image') as HTMLInputElement;
  const tagsInput = modal.querySelector('#edit-tags') as HTMLTextAreaElement;
  const userTagsInput = modal.querySelector('#edit-user-tags') as HTMLTextAreaElement;
  const categoriesInput = modal.querySelector('#edit-categories') as HTMLTextAreaElement;
  const actorsInput = modal.querySelector('#edit-actors') as HTMLTextAreaElement;
  const directorInput = modal.querySelector('#edit-director') as HTMLInputElement;
  const makerInput = modal.querySelector('#edit-maker') as HTMLInputElement;
  const seriesInput = modal.querySelector('#edit-series') as HTMLInputElement;
  const durationInput = modal.querySelector('#edit-duration') as HTMLInputElement;
  const userNotesInput = modal.querySelector('#edit-user-notes') as HTMLTextAreaElement;
  const isFavoriteInput = modal.querySelector('#edit-is-favorite') as HTMLInputElement;
  const jsonTextarea = modal.querySelector('#edit-json') as HTMLTextAreaElement;
  const userRatingContainer = modal.querySelector('[data-field="userRating"]') as HTMLElement;
  const lockedFields = new Set<string>(record.manuallyEditedFields || []);
  let currentUserRating = record.userRating || 0;
  let isUpdatingFromForm = false;
  let isUpdatingFromJson = false;

  const formToJson = () => {
    if (isUpdatingFromJson) return;
    isUpdatingFromForm = true;

    const formData: VideoRecord = {
      ...record,
      id: idInput.value.trim(),
      title: titleInput.value,
      status: statusSelect.value as VideoStatus,
      releaseDate: releaseDateInput.value || undefined,
      javdbUrl: javdbUrlInput.value || undefined,
      javdbImage: javdbImageInput.value || undefined,
      tags: splitCommaList(tagsInput.value),
      userTags: splitCommaList(userTagsInput.value),
      categories: categoriesInput.value ? splitCommaList(categoriesInput.value) : undefined,
      actors: actorsInput.value ? splitCommaList(actorsInput.value) : undefined,
      director: directorInput.value.trim() || undefined,
      maker: makerInput.value.trim() || undefined,
      series: seriesInput.value.trim() || undefined,
      duration: durationInput.value ? parseInt(durationInput.value, 10) : undefined,
      userRating: currentUserRating > 0 ? currentUserRating : undefined,
      userNotes: userNotesInput.value.trim() || undefined,
      isFavorite: isFavoriteInput.checked || undefined,
      favoritedAt: isFavoriteInput.checked && !record.isFavorite ? Date.now() : record.favoritedAt,
      manuallyEditedFields: Array.from(lockedFields),
      updatedAt: Date.now(),
    };

    jsonTextarea.value = JSON.stringify(formData, null, 2);
    isUpdatingFromForm = false;
  };

  const jsonToForm = () => {
    if (isUpdatingFromForm) return;
    isUpdatingFromJson = true;

    try {
      const jsonData = JSON.parse(jsonTextarea.value);
      idInput.value = jsonData.id || '';
      titleInput.value = jsonData.title || '';
      statusSelect.value = jsonData.status || videoStatus.UNTRACKED;
      releaseDateInput.value = jsonData.releaseDate || '';
      javdbUrlInput.value = jsonData.javdbUrl || '';
      javdbImageInput.value = jsonData.javdbImage || '';
      tagsInput.value = jsonData.tags ? jsonData.tags.join(', ') : '';
      userTagsInput.value = jsonData.userTags ? jsonData.userTags.join(', ') : '';
      categoriesInput.value = jsonData.categories ? jsonData.categories.join(', ') : '';
      actorsInput.value = jsonData.actors ? jsonData.actors.join(', ') : '';
      directorInput.value = jsonData.director || '';
      makerInput.value = jsonData.maker || '';
      seriesInput.value = jsonData.series || '';
      durationInput.value = jsonData.duration || '';
      userNotesInput.value = jsonData.userNotes || '';
      isFavoriteInput.checked = jsonData.isFavorite || false;

      currentUserRating = jsonData.userRating || 0;
      updateStarDisplay(userRatingContainer, currentUserRating, '#ff4444');

      lockedFields.clear();
      if (jsonData.manuallyEditedFields) {
        jsonData.manuallyEditedFields.forEach((field: string) => lockedFields.add(field));
      }

      modal.querySelectorAll('.form-group[data-field-name]').forEach((formGroup) => {
        const fieldName = formGroup.getAttribute('data-field-name');
        const lockIcon = formGroup.querySelector('.field-lock');
        if (fieldName && lockIcon) {
          setLockIconState(lockIcon, lockedFields.has(fieldName));
        }
      });

      jsonTextarea.style.borderColor = '';
      jsonTextarea.title = '';
    } catch {
      jsonTextarea.style.borderColor = '#ff4444';
      jsonTextarea.title = 'JSON格式错误';
    }

    isUpdatingFromJson = false;
  };

  userRatingContainer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains('star-half-left') || target.classList.contains('star-half-right')) {
      const value = parseFloat(target.getAttribute('data-value') || '0');
      currentUserRating = value;
      updateStarDisplay(userRatingContainer, value, '#ff4444');
      formToJson();
    }
  });

  modal.querySelectorAll('.field-lock').forEach((lockIcon) => {
    lockIcon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const formGroup = (event.target as HTMLElement).closest('.form-group') as HTMLElement;
      const fieldName = formGroup?.getAttribute('data-field-name');
      if (!fieldName) return;

      if (lockedFields.has(fieldName)) {
        lockedFields.delete(fieldName);
        setLockIconState(lockIcon, false);
      } else {
        lockedFields.add(fieldName);
        setLockIconState(lockIcon, true);
      }

      formToJson();
    });
  });

  const trackableFields: Record<string, HTMLInputElement | HTMLTextAreaElement> = {
    title: titleInput,
    director: directorInput,
    maker: makerInput,
    series: seriesInput,
    tags: tagsInput,
    categories: categoriesInput,
    actors: actorsInput,
  };

  Object.entries(trackableFields).forEach(([fieldName, input]) => {
    input.addEventListener('change', () => {
      const originalValue = (record as any)[fieldName];
      const currentValue = input instanceof HTMLTextAreaElement && ['tags', 'categories', 'actors'].includes(fieldName)
        ? splitCommaList(input.value)
        : input.value.trim() || undefined;
      const hasChanged = JSON.stringify(originalValue) !== JSON.stringify(currentValue);

      if (hasChanged && !lockedFields.has(fieldName)) {
        lockedFields.add(fieldName);
        const lockIcon = modal.querySelector(`[data-field-name="${fieldName}"] .field-lock`);
        if (lockIcon) setLockIconState(lockIcon, true);
      }
    });
  });

  [
    idInput,
    titleInput,
    statusSelect,
    releaseDateInput,
    javdbUrlInput,
    javdbImageInput,
    tagsInput,
    userTagsInput,
    categoriesInput,
    actorsInput,
    directorInput,
    makerInput,
    seriesInput,
    durationInput,
    userNotesInput,
    isFavoriteInput,
  ].forEach((element) => {
    element.addEventListener('input', formToJson);
    element.addEventListener('change', formToJson);
  });

  jsonTextarea.addEventListener('input', jsonToForm);

  const closeModal = () => {
    if (modal.parentElement) {
      document.body.removeChild(modal);
    }
    document.removeEventListener('keydown', handleEscape);
  };

  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeModal();
  };

  modal.querySelector('.edit-modal-close')?.addEventListener('click', closeModal);
  modal.querySelector('#cancel-edit')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  modal.querySelector('#save-record')?.addEventListener('click', async () => {
    try {
      const updatedRecord = JSON.parse(jsonTextarea.value) as VideoRecord;
      if (!updatedRecord.id || !updatedRecord.title) {
        options.showMessage('ID和标题是必填字段', 'error');
        return;
      }

      updatedRecord.id = updatedRecord.id.trim();
      updatedRecord.updatedAt = Date.now();
      const result = await options.onSave(updatedRecord, record);
      if (result?.message) {
        options.showMessage(result.message, result.type || 'success');
      }
      closeModal();
    } catch (error: any) {
      console.error('[Records] 保存记录时出错:', error);
      options.showMessage(`保存失败: ${error.message}`, 'error');
    }
  });

  document.addEventListener('keydown', handleEscape);
}
