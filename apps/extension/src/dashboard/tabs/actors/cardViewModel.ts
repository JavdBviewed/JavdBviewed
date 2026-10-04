import type { ActorRecord } from '../../../types';

export interface BuildActorCardHtmlOptions {
  viewMode: 'list' | 'card';
  isSubscribed?: boolean;
  showBlacklistBadge?: boolean;
}

export function buildActorCardHtml(actor: ActorRecord, options: BuildActorCardHtmlOptions): string {
  if (options.viewMode === 'list') {
    return buildActorListViewHtml(actor, options);
  }
  return buildActorCardViewHtml(actor, options);
}

function buildActorCardViewHtml(actor: ActorRecord, options: BuildActorCardHtmlOptions): string {
  const worksCount = actor.details?.worksCount || 0;
  const lastSync = actor.syncInfo?.lastSyncAt
    ? new Date(actor.syncInfo.lastSyncAt).toLocaleDateString()
    : '未同步';

  const isSubscribed = !!options.isSubscribed;
  const isBlacklisted = !!actor.blacklisted;
  // 收藏判定与全局口径一致：favorited 缺省 = 已收藏，显式 false = 未收藏
  const isFavorited = actor.favorited !== false;
  const blacklistBadge = isBlacklisted && options.showBlacklistBadge
    ? '<span class="actor-badge actor-badge-blacklisted" title="已拉黑">黑名单</span>'
    : '';
  const subscribedBadge = isSubscribed ? '<i class="fas fa-bell actor-subscribed-icon" title="已订阅新作品"></i>' : '';
  const cardStyle = isBlacklisted ? 'style="opacity:0.5;"' : '';

  return `
            <div class="actor-card batch-mode" data-actor-id="${actor.id}" data-blacklisted="${isBlacklisted}" data-fav="${isFavorited ? '1' : '0'}" data-gender="${actor.gender}" ${cardStyle}>
                <button class="actor-action-btn actor-delete-btn actor-card-top-delete"
                        data-actor-id="${actor.id}"
                        title="删除">
                    <i class="fas fa-trash"></i>
                </button>
                <div class="actor-card-avatar-container">
                    <div class="actor-card-avatar" id="actor-avatar-${actor.id}">
                        <!-- 头像将通过JS添加 -->
                    </div>
                </div>
                <div class="actor-card-info">
                    <div class="actor-card-name"
                         title="点击复制：${escapeName(actor.name)}"
                         data-actor-id="${actor.id}"
                         data-actor-name="${escapeForJs(actor.name)}">
                        <span class="actor-name-text">${escapeName(actor.name)}</span>
                        ${subscribedBadge}
                        <i class="fas fa-copy actor-name-copy-icon"></i>
                    </div>
                    ${buildActorAliasesHtml(actor)}
                    <div class="actor-card-meta">
                        <span class="actor-gender actor-gender-${actor.gender}">
                            ${getActorGenderText(actor.gender)}
                        </span>
                        <span class="actor-category actor-category-${actor.category}">
                            ${getActorCategoryText(actor.category)}
                        </span>
                        ${worksCount > 0 ? `<span class="actor-works-count">${worksCount} 作品</span>` : ''}
                        ${blacklistBadge}
                        ${actor.wikiData?.age ? `<span class="actor-wiki-age" title="年龄">🎂 ${actor.wikiData.age}岁</span>` : ''}
                        ${actor.wikiData?.heightCm ? `<span class="actor-wiki-height" title="身高">📏 ${actor.wikiData.heightCm}cm</span>` : ''}
                        ${actor.wikiData?.cup ? `<span class="actor-wiki-cup" title="罩杯">👙 ${actor.wikiData.cup}</span>` : ''}
                        ${actor.wikiData?.retired ? '<span class="actor-wiki-retired" title="已引退">🚪 引退</span>' : ''}
                        ${buildActorSocialLinksHtml(actor)}
                    </div>
                    <div class="actor-card-sync">
                        <span class="sync-status sync-status-${actor.syncInfo?.syncStatus || 'unknown'}">
                            ${getActorSyncStatusText(actor.syncInfo?.syncStatus)}
                        </span>
                        <span class="sync-time">${lastSync}</span>
                    </div>
                </div>
                <div class="actor-card-actions">
                    <button class="actor-action-btn actor-works-btn"
                            data-actor-id="${actor.id}"
                            title="查看作品">
                        <i class="fas fa-film"></i>
                    </button>
                    <button class="actor-action-btn actor-edit-btn"
                            data-actor-id="${actor.id}"
                            title="编辑源数据">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="actor-action-btn actor-refresh-btn"
                            data-actor-id="${actor.id}"
                            title="刷新元数据">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button class="actor-action-btn actor-blacklist-toggle-btn"
                            data-actor-id="${actor.id}"
                            title="${isBlacklisted ? '取消拉黑' : '拉黑'}">
                        <i class="fas fa-ban"></i>
                    </button>
                    <button class="actor-action-btn actor-favorite-toggle-btn"
                            data-actor-id="${actor.id}"
                            title="${isFavorited ? '取消收藏' : '收藏'}">
                        <i class="${isFavorited ? 'fas' : 'far'} fa-star"></i>
                    </button>
                    <button class="actor-action-btn actor-subscribe-toggle-btn"
                            data-actor-id="${actor.id}"
                            data-sub="${isSubscribed ? '1' : '0'}"
                            title="${isSubscribed ? '取消订阅' : '订阅'}">
                        <i class="fas ${isSubscribed ? 'fa-bell-slash' : 'fa-bell'}"></i>
                    </button>
                </div>
            </div>
        `;
}

export function getActorCategoryText(category: string): string {
  switch (category) {
    case 'censored':
      return '有码';
    case 'uncensored':
      return '无码';
    case 'western':
      return '欧美';
    default:
      return '未知';
  }
}

export function getActorSyncStatusText(status?: string): string {
  switch (status) {
    case 'success':
      return '已同步';
    case 'failed':
      return '同步失败';
    case 'pending':
      return '同步中';
    default:
      return '未同步';
  }
}

function getActorGenderText(gender: ActorRecord['gender']): string {
  if (gender === 'female') return '女';
  if (gender === 'male') return '男';
  return '未知';
}

function buildActorAliasesHtml(actor: ActorRecord): string {
  if (!actor.aliases || actor.aliases.length === 0) {
    return '';
  }

  return `
                        <div class="actor-card-aliases" data-actor-id="${actor.id}">
                            <div class="actor-aliases-list">
                                ${(actor.aliases || []).map(alias => `
                                    <div class="actor-alias"
                                         title="点击复制：${escapeName(alias)}"
                                         data-actor-id="${actor.id}"
                                         data-actor-name="${escapeForJs(alias)}">
                                        <span class="actor-alias-text">${escapeName(alias)}</span>
                                        <i class="fas fa-copy actor-alias-copy-icon"></i>
                                    </div>
                                `).join('')}
                            </div>
                            <button class="aliases-toggle-btn"
                                    data-actor-id="${actor.id}"
                                    title="展开/收起别名">
                                <i class="fas fa-chevron-down"></i>
                            </button>
                        </div>
                    `;
}

function buildActorSocialLinksHtml(actor: ActorRecord): string {
  if (!actor.wikiData?.ig && !actor.wikiData?.tw && !actor.wikiData?.wikiUrl) {
    return '';
  }

  return `
                            <div class="actor-social-links">
                                ${actor.wikiData?.ig ? `<a href="${actor.wikiData.ig}" target="_blank" class="actor-social-link" title="Instagram"><i class="fab fa-instagram"></i></a>` : ''}
                                ${actor.wikiData?.tw ? `<a href="${actor.wikiData.tw}" target="_blank" class="actor-social-link" title="Twitter/X"><i class="fab fa-twitter"></i></a>` : ''}
                                ${actor.wikiData?.wikiUrl ? `<a href="${actor.wikiData.wikiUrl}" target="_blank" class="actor-social-link" title="Wikipedia"><i class="fab fa-wikipedia-w"></i></a>` : ''}
                            </div>
                        `;
}

function escapeName(name: string): string {
  return name.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function escapeForJs(name: string): string {
  return name.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function buildActorListViewHtml(actor: ActorRecord, options: BuildActorCardHtmlOptions): string {
  const worksCount = actor.details?.worksCount || 0;
  const lastSync = actor.syncInfo?.lastSyncAt
    ? new Date(actor.syncInfo.lastSyncAt).toLocaleDateString()
    : '未同步';

  const isSubscribed = !!options.isSubscribed;
  const isBlacklisted = !!actor.blacklisted;
  // 收藏判定与全局口径一致：favorited 缺省 = 已收藏，显式 false = 未收藏
  const isFavorited = actor.favorited !== false;
  const blacklistBadge = isBlacklisted && options.showBlacklistBadge
    ? '<span class="actor-badge actor-badge-blacklisted" title="已拉黑">黑名单</span>'
    : '';
  const subscribedBadge = isSubscribed ? '<i class="fas fa-bell actor-subscribed-icon" title="已订阅新作品"></i>' : '';
  const cardStyle = isBlacklisted ? 'style="opacity:0.5;"' : '';

  // 列表视图：紧凑布局，横向排列
  return `
    <div class="actor-card batch-mode" data-actor-id="${actor.id}" data-blacklisted="${isBlacklisted}" data-fav="${isFavorited ? '1' : '0'}" ${cardStyle}>
      <div class="actor-card-avatar" id="actor-avatar-${actor.id}">
        <!-- 头像将通过JS添加 -->
      </div>
      <div class="actor-card-info">
        <div class="actor-card-name"
             title="点击复制：${escapeName(actor.name)}"
             data-actor-id="${actor.id}"
             data-actor-name="${escapeForJs(actor.name)}">
          <span class="actor-name-text">${escapeName(actor.name)}</span>
          ${subscribedBadge}
          <i class="fas fa-copy actor-name-copy-icon"></i>
        </div>
        ${buildActorAliasesHtml(actor)}
        <div class="actor-card-meta">
          <span class="actor-gender actor-gender-${actor.gender}">
            ${getActorGenderText(actor.gender)}
          </span>
          <span class="actor-category actor-category-${actor.category}">
            ${getActorCategoryText(actor.category)}
          </span>
          ${worksCount > 0 ? `<span class="actor-works-count">${worksCount} 作品</span>` : ''}
          ${blacklistBadge}
          ${actor.wikiData?.age ? `<span class="actor-wiki-age" title="年龄">🎂 ${actor.wikiData.age}岁</span>` : ''}
          ${actor.wikiData?.heightCm ? `<span class="actor-wiki-height" title="身高">📏 ${actor.wikiData.heightCm}cm</span>` : ''}
          ${actor.wikiData?.cup ? `<span class="actor-wiki-cup" title="罩杯">👙 ${actor.wikiData.cup}</span>` : ''}
          ${actor.wikiData?.retired ? '<span class="actor-wiki-retired" title="已引退">🚪 引退</span>' : ''}
          ${buildActorSocialLinksHtml(actor)}
        </div>
        <div class="actor-card-sync">
          <span class="sync-status sync-status-${actor.syncInfo?.syncStatus || 'unknown'}">
            ${getActorSyncStatusText(actor.syncInfo?.syncStatus)}
          </span>
          <span class="sync-time">${lastSync}</span>
        </div>
      </div>
      <div class="actor-card-actions">
        <button class="actor-action-btn actor-works-btn"
                data-actor-id="${actor.id}"
                title="查看作品">
          <i class="fas fa-film"></i>
        </button>
        <button class="actor-action-btn actor-edit-btn"
                data-actor-id="${actor.id}"
                title="编辑源数据">
          <i class="fas fa-edit"></i>
        </button>
        <button class="actor-action-btn actor-refresh-btn"
                data-actor-id="${actor.id}"
                title="刷新元数据">
          <i class="fas fa-sync-alt"></i>
        </button>
        <button class="actor-action-btn actor-delete-btn"
                data-actor-id="${actor.id}"
                title="删除">
          <i class="fas fa-trash"></i>
        </button>
        <button class="actor-action-btn actor-blacklist-toggle-btn"
                data-actor-id="${actor.id}"
                title="${isBlacklisted ? '取消拉黑' : '拉黑'}">
          <i class="fas fa-ban"></i>
        </button>
        <button class="actor-action-btn actor-favorite-toggle-btn"
                data-actor-id="${actor.id}"
                title="${isFavorited ? '取消收藏' : '收藏'}">
          <i class="${isFavorited ? 'fas' : 'far'} fa-star"></i>
        </button>
        <button class="actor-action-btn actor-subscribe-toggle-btn"
                data-actor-id="${actor.id}"
                data-sub="${isSubscribed ? '1' : '0'}"
                title="${isSubscribed ? '取消订阅' : '订阅'}">
          <i class="fas ${isSubscribed ? 'fa-bell-slash' : 'fa-bell'}"></i>
        </button>
      </div>
    </div>
  `;
}
