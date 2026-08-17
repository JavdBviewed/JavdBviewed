/**
 * @file config.ts
 * @description 扩展全局配置中心 —— 存储键、默认设置、业务常量
 * @module utils（旧路径保留，当前实际实现在 platform/storage/settings）
 *
 * 包含：STORAGE_KEYS、DEFAULT_SETTINGS、各功能模块默认配置
 * 被 background/content/UI 全层引用，修改默认值需谨慎评估影响
 */
import { ExtensionSettings, KeywordFilterRule, ActorSyncConfig, NewWorksGlobalConfig } from '../types';
import { PrivacyConfig } from '../types/privacy';
import { normalizeDrive115Settings } from '../features/drive115/app';
import { DEFAULT_AI_SETTINGS } from '../types/ai';
import { DEFAULT_SERVER_API_BASE_URL } from '../platform/network/serverEndpointResolver';
import { createDefaultRouteSettings } from '../features/routeManagement/defaultRoutes';

export const SERVER_API_BASE_URL = DEFAULT_SERVER_API_BASE_URL;
export const TELEMETRY_REPORT_ENDPOINT = `${SERVER_API_BASE_URL}/v1/telemetry/report`;

export const STORAGE_KEYS = {
    // A single key for all viewed records, which is an object
    // where keys are video IDs and values are objects with { title, status, timestamp }.
    VIEWED_RECORDS: 'viewed',

    // Stores all settings, including display and WebDAV configurations.
    SETTINGS: 'settings',

    // Key for storing persistent logs.
    LOGS: 'persistent_logs',

    // Key for storing last import statistics.
    LAST_IMPORT_STATS: 'last_import_stats',

    // Key for storing user profile information.
    USER_PROFILE: 'user_profile',

    // Key for storing actor records.
    ACTOR_RECORDS: 'actor_records',

    // Key for storing restore backups.
    RESTORE_BACKUP: 'restore_backup',

    // WebDAV 恢复：记忆上次选择的备份文件（完整路径或 URL）
    WEBDAV_LAST_SELECTED_BACKUP: 'webdav_last_selected_backup',

    // 隐私保护相关存储键
    PRIVACY_STATE: 'privacy_state',
    PRIVACY_SESSION: 'privacy_session',

    // 新作品功能相关存储键
    NEW_WORKS_SUBSCRIPTIONS: 'new_works_subscriptions',
    NEW_WORKS_RECORDS: 'new_works_records',
    NEW_WORKS_CONFIG: 'new_works_config',
    
    // 高级搜索方案存储键
    ADV_SEARCH_PRESETS: 'adv_search_presets',

    // IndexedDB 迁移状态标记
    IDB_MIGRATED: 'idb_migrated',
    // IndexedDB 日志迁移状态标记（将旧的 STORAGE_KEYS.LOGS 迁移到 IDB logs 表）
    IDB_LOGS_MIGRATED: 'idb_logs_migrated',
    // IndexedDB 演员数据迁移状态标记（将旧的 STORAGE_KEYS.ACTOR_RECORDS 迁移到 IDB actors 表）
    IDB_ACTORS_MIGRATED: 'idb_actors_migrated',

    // Emby/Jellyfin 媒体库入库索引
    EMBY_LIBRARY_STATE: 'emby_library_state',

    // 115 片库浅层索引（与 settings.drive115 分离）
    DRIVE115_LIBRARY_STATE: 'drive115_library_state',
    // 115 片库索引进行中进度快照（dashboard 实时展示）
    DRIVE115_LIBRARY_INDEX_PROGRESS: 'drive115_library_index_progress',
    // 115 片库扫描恢复点（不含授权信息）
    DRIVE115_LIBRARY_INDEX_CHECKPOINT: 'drive115_library_index_checkpoint',
    // 115 片库上一轮索引结果明细报告（入库/跳过明细，供详情窗口下钻）
    DRIVE115_LIBRARY_INDEX_REPORT: 'drive115_library_index_report',
    // 115 片库最近索引记录（仅本机诊断，用于回看暂停、失败和完成结果）
    DRIVE115_LIBRARY_INDEX_HISTORY: 'drive115_library_index_history',

    // 媒体库：真实已看 → 115 待清理清单
    MEDIA_115_CLEANUP_LIST: 'media_115_cleanup_list',

    // 媒体库：跨来源待清理队列与删除历史账本
    MEDIA_CLEANUP_STATE: 'media_cleanup_state',
    MEDIA_DELETION_HISTORY: 'media_deletion_history',

    // 本地真实观看证据（115 播放进度等，与原站 status 分离）
    MEDIA_WATCH_EVIDENCE: 'media_watch_evidence',

    // Dashboard 上次关闭页面（完整 hash 恢复提示）
    DASHBOARD_LAST_PAGE: 'dashboard_last_page',
} as const;

export const VIDEO_STATUS = {
    VIEWED: 'viewed', // 已观看
    WANT: 'want',     // 我想看
    BROWSED: 'browsed', // 已浏览
    UNTRACKED: 'untracked' // 未标记（仅入库/清单归属等）
} as const;

// 演员同步默认配置
export const DEFAULT_ACTOR_SYNC_CONFIG: ActorSyncConfig = {
    enabled: true, // 默认启用演员同步
    autoSync: false, // 默认不自动同步
    syncInterval: 1440, // 24小时同步一次
    batchSize: 20, // 每批处理20个演员
    maxRetries: 3, // 最大重试3次
    requestInterval: 3, // 请求间隔3秒
    urls: {
        collectionActors: 'https://javdb.com/users/collection_actors', // 收藏演员列表URL
        actorDetail: 'https://javdb.com/actors/{{ACTOR_ID}}', // 演员详情页URL模板
    },
};

// 新作品功能默认配置
export const DEFAULT_NEW_WORKS_CONFIG: NewWorksGlobalConfig = {
    checkInterval: 24, // 24小时检查一次
    requestInterval: 3, // 请求间隔3秒
    autoCheckEnabled: false, // 默认不开启自动检查
    concurrency: 1, // 默认并发数为1
    showActorPageScanButton: false, // 默认不在演员页显示快捷扫描入口
    filters: {
        excludeViewed: true, // 默认排除已看
        excludeBrowsed: true, // 默认排除已浏览
        excludeWant: false, // 默认不排除想看
        dateRange: 3, // 默认近3个月
        categoryFilters: [], // 默认不限制类别（空数组表示全选）
        excludeAR: false, // 默认不排除AR影片
        applyContentFilter: false, // 默认不应用智能内容过滤
    },
    maxWorksPerCheck: 100, // 固定值100，不再通过UI配置
    autoCleanup: true, // 默认启用自动清理
    cleanupDays: 30, // 30天后清理
};

// 隐私保护默认配置
export const DEFAULT_PRIVACY_CONFIG: PrivacyConfig = {
    screenshotMode: {
        enabled: false,
        contentPages: {
            enabled: false,
            sites: { javdb: true, javbus: true },
        },
        autoBlurTrigger: 'manual',
        blurIntensity: 5,
        blurAreas: ['account-menu', 'navigation', 'video-library', 'actor-library', 'playlist-page', 'lists-page', 'home-page'], // 默认启用所有区域
        protectedElements: [
            // Dashboard 布局级保护 - 只模糊最外层容器，避免嵌套模糊
            '.video-list-container',          // 番号库整个容器
            '.actor-list-container',          // 演员库整个容器
            '.new-works-list-section',        // 新作品显示容器

            // JavDB网站内容 - 视频相关
            '.video-cover',
            '.movie-list .item',
            '.movie-list .cover',
            '.movie-list .title',
            '.movie-list .meta',
            '.video-meta-panel',
            '.video-detail',
            '.preview-images',
            '.sample-waterfall',

            // JavDB网站内容 - 演员相关
            '.actor-name',
            '.actor-list .item',
            '.actor-list .avatar',
            '.actor-list .name',
            '.actor-section',
            '.performer-list',
            '.performer-avatar',

            // 页面背景和封面
            '.hero-banner',
            '.cover-container',
            '.backdrop',
            '.poster',
            '.thumbnail',

            // 用户相关
            '.user-profile',
            '.user-avatar',
            '.viewed-records',
            '.collection-list',
            '.watch-history',
            '.favorite-list',

            // 搜索和标签
            '.search-result',
            '.tag-list',
            '.genre-list',
            '.category-list',

            // 通用敏感内容
            '[data-sensitive]',
            '[data-private]',
            '.sensitive-content'
        ],
        showEyeIcon: true,
        eyeIconPosition: 'top-right',
        temporaryViewDuration: 10
    },
    privateMode: {
        enabled: false,
        requirePassword: false,
        passwordHash: '',
        passwordSalt: '',
        sessionTimeout: 30,
        lastVerified: 0,
        lockOnTabLeave: false,
        lockOnExtensionClose: false,
        restrictedFeatures: [
            'data-sync',
            'data-export',
            'data-import',
            'webdav-sync',
            'actor-sync',
            'advanced-settings'
        ]
    },
    passwordRecovery: {
        securityQuestions: [],
        recoveryEmail: '',
        backupCode: '',
        backupCodeUsed: false,
        lastRecoveryAttempt: 0,
        recoveryAttemptCount: 0
    }
};

// 状态优先级定义：数字越大优先级越高
// 已看 > 想看 > 已浏览
export const STATUS_PRIORITY = {
    [VIDEO_STATUS.UNTRACKED]: 0,
    [VIDEO_STATUS.BROWSED]: 1, // 已浏览 - 最低优先级
    [VIDEO_STATUS.WANT]: 2,    // 我想看 - 中等优先级
    [VIDEO_STATUS.VIEWED]: 3   // 已观看 - 最高优先级
} as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
    libraryMatchStatus: { enabled: false, sources: { drive115: true, emby: true } },
    // 主题设置
    theme: 'light',
    autoUpdateCheck: true,
    updateCheckInterval: '24',
    includePrerelease: false,
    
    display: {
        hideViewed: false, // Corresponds to VIEWED status
        hideBrowsed: false, // Corresponds to BROWSED status
        hideVR: false,
        hideWant: false,
    },
    // 演员库配置默认值
    actorLibrary: {
        blacklist: {
            hideInList: true,
            showBadge: true,
        },
        viewMode: 'list' as 'list' | 'card',
    },
    webdav: {
        enabled: true,
        url: '',
        username: '',
        password: '',
        clientId: '',
        deviceLabel: '',
        browserName: '',
        clientInstalledAt: '',
        clientLastSeenAt: '',
        clientLastSyncAt: '',
        clientLastSyncStatus: '',
        clientLastUploadId: '',
        knownDevices: [],
        uploadIndexLimit: 50,
        autoSync: false,
        syncInterval: 1440, // 24 hours in minutes
        // 默认保留天数：7 天
        retentionDays: 10,
        warningDays: 7,
        lastSync: ''
    },
    dataSync: {
        requestInterval: 3, // 请求间隔3秒，缓解服务器压力
        batchSize: 20, // 每批处理20个视频
        maxRetries: 3, // 最大重试3次
        urls: {
            wantWatch: 'https://javdb.com/users/want_watch_videos', // 想看视频列表URL
            watchedVideos: 'https://javdb.com/users/watched_videos', // 已看视频列表URL
            collectionActors: 'https://javdb.com/users/collection_actors', // 收藏演员列表URL
        },
    },
    searchEngines: [
        {
            id: 'javdb',
            icon: 'assets/javdb.ico',
            name: 'JavDB',
            urlTemplate: 'https://javdb.com/search?q={{ID}}&f=all',
            category: 'search'
        },
        {
            id: 'javbus',
            icon: 'assets/javbus.ico',
            name: 'Javbus',
            urlTemplate: 'https://www.javbus.com/search/{{ID}}&type=&parent=ce',
            category: 'search'
        },
        {
            id: 'sehuatang',
            icon: 'assets/sehuatang.ico',
            name: '98堂',
            urlTemplate: 'https://sehuatang.net/search.php?mod=forum&srchtxt={{ID}}',
            category: 'search'
        },
        {
            id: 'btsow',
            icon: 'assets/btsow.png',
            name: 'BTSOW',
            urlTemplate: 'https://btsow.com/search/{{ID}}',
            category: 'search'
        },
        {
            id: 'javlib',
            icon: 'assets/javlibrary.ico',
            name: 'JAVLib',
            urlTemplate: 'https://www.javlibrary.com/cn/vl_searchbyid.php?keyword={{ID}}',
            category: 'search'
        },
        {
            id: 'jable',
            icon: 'assets/jable.ico',
            name: 'Jable',
            urlTemplate: 'https://jable.tv/search/{{ID}}/',
            category: 'resource'
        },
        {
            id: 'missav',
            icon: 'assets/missav.ico',
            name: 'MISSAV',
            urlTemplate: 'https://missav.ws/search/{{ID}}',
            category: 'resource'
        },
        {
            id: '123av',
            icon: 'assets/123av.png',
            name: '123AV',
            urlTemplate: 'https://123av.com/zh/search?keyword={{ID}}',
            category: 'resource'
        },
        {
            id: 'google',
            icon: 'assets/google.ico',
            name: 'Google',
            urlTemplate: 'https://www.google.com/search?q={{ID}}',
            category: 'search'
        },
        {
            id: 'dmm',
            icon: 'assets/dmm.ico',
            name: 'FANZA/DMM',
            urlTemplate: 'https://www.dmm.co.jp/search/=/searchstr={{ID}}',
            category: 'resource',
            contexts: ['detail']
        },
        {
            id: 'sukebei',
            icon: 'assets/sukebei.png',
            name: 'Sukebei',
            urlTemplate: 'https://sukebei.nyaa.si/?f=0&c=0_0&q={{ID}}',
            category: 'resource',
            contexts: ['detail']
        },
        {
            id: 'subtitlecat',
            icon: 'assets/subtitlecat.ico',
            name: 'SubTitleCat',
            urlTemplate: 'https://subtitlecat.com/index.php?search={{ID}}',
            category: 'subtitle',
            contexts: ['detail']
        },
        {
            id: 'xunlei-subtitle',
            icon: 'assets/xunlei.png',
            name: '迅雷字幕',
            urlTemplate: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?gcid=&cid=&name={{ID}}',
            category: 'subtitle',
            contexts: ['detail']
        },
        {
            id: 'fc2ppvdb',
            icon: 'assets/fc2ppvdb.ico',
            name: 'FC2PPVDB',
            urlTemplate: 'https://fc2ppvdb.com/articles/{{FC2_ID}}',
            category: 'resource',
            match: 'fc2',
            contexts: ['detail']
        },
        {
            id: 'fc2db',
            icon: 'assets/fc2db.png',
            name: 'FC2DB',
            urlTemplate: 'https://fc2db.net/work/{{FC2_ID}}/',
            category: 'resource',
            match: 'fc2',
            contexts: ['detail']
        }
    ],
    logging: {
        maxLogEntries: 5000,
        maxMagnetPushEntries: 10000,
        verboseMode: false, // 详细日志模式（默认关闭以减少噪音）
        showPrivacyLogs: false, // 显示隐私相关日志（默认关闭）
        showStorageLogs: false, // 显示存储相关日志（默认关闭）
        // 统一控制台代理默认配置
        // 默认只输出信息及以上；DEBUG 需要用户在日志设置中主动开启，避免媒体库/115运行时放大控制台与日志写入。
        consoleLevel: 'INFO',
        consoleFormat: {
            showTimestamp: true,
            showSource: true,
            color: true,
            timeZone: 'Asia/Shanghai',
        },
        consoleCategories: {
            core: true,
            orchestrator: true,
            drive115: true,
            privacy: true,
            enhancement: true,
            magnet: true,
            actor: true,
            storage: true,
            general: true,
        },
    },

    telemetry: {
        enabled: true,
        endpoint: TELEMETRY_REPORT_ENDPOINT,
        channel: 'stable',
    },

    drive115: normalizeDrive115Settings({}),

    // 新增：数据增强默认配置
    dataEnhancement: {
        enableMultiSource: false, // 仍未启用
        enableVideoPreview: true, // 启用：视频预览增强
        enableTranslation: false,
    },

    // 新增：翻译服务默认配置
    translation: {
        provider: 'traditional' as const, // 默认使用传统翻译服务
        displayMode: 'append' as const,
        targets: {
            currentTitle: true,
        },
        traditional: {
            service: 'google' as const, // 默认使用Google翻译
            sourceLanguage: 'ja', // 日语
            targetLanguage: 'zh-CN', // 简体中文
        },
        ai: {
            useGlobalModel: true, // 默认使用全局AI模型
        },
    },

    // 新增：用户体验默认配置
    userExperience: {
        enableContentFilter: false,
        enableKeyboardShortcuts: false, // 开发中，暂时关闭
        enableMagnetSearch: false,
        enableAnchorOptimization: false,
        enableListEnhancement: true, // 默认启用列表增强
        enableActorEnhancement: false,
        enableSuperRanking: true,
        showEnhancedTooltips: false, // 开发中，暂时关闭
        enablePasswordHelper: false, // 密码显示助手，默认关闭
    },

    // 新增：网络加速默认配置
    networkAcceleration: {
        github: {
            enabled: true, // 默认启用 GitHub 加速
            proxyService: 'ghproxy', // 默认使用 ghproxy.com
            customProxyUrl: '',
        },
    },

    // 新增：线路默认配置
    routes: createDefaultRouteSettings(),

    // 磁力资源搜索默认配置
    magnetSearch: {
        sources: {
            sukebei: true,
            btdig: true,
            btsow: true,
            torrentz2: false,
            javbus: false,
            custom: [],
        },
        autoSearch: false,
        blockMojContent: true,
        sortMode: 'default',
        maxResults: 15,
        timeoutMs: 6000,
        concurrency: {
            pageMaxConcurrentRequests: 2,
            bgGlobalMaxConcurrent: 4,
            bgPerHostMaxConcurrent: 1,
            bgPerHostRateLimitPerMin: 12,
        },
    },

    // 新增：影片页增强默认配置
    videoEnhancement: {
        enabled: false,
        schedulingMode: 'smart' as const,
        enableCoverImage: true,
        enableTranslation: true,
        showLoadingIndicator: true,
        enableReviewBreaker: true,
        enableFC2Breaker: true,
        // 新增：默认开启”想看同步”和”115推送后自动已看”（保持旧行为）
        enableWantSync: true,
        autoMarkWatchedAfter115: true,
        autoMarkWatchedStars: 4, // 默认4星
        // 新增：演员备注（Wiki/xslist）
        enableActorRemarks: false,
        actorRemarksMode: 'panel' as const,
        actorRemarksTTLDays: 0,
        actorRemarksTaskTimeoutSeconds: 10,
        // 新增：影片页收藏与评分
        enableVideoFavoriteRating: true, // 默认启用
        enableRelatedLists: true,
        enableLocalListInSourceModal: true, // 源站存入清单 modal 内展示拓展本地清单
        enableExternalEntryPanel: true,
        enableExternalSearch: true,
        enableOnlineAvailability: true,
        showOnlineAvailabilityFailures: false,
        onlineAvailabilitySites: {},
        enableSubtitleSearch: true,
    },

    // 新增：内容过滤默认配置
    contentFilter: {
        enabled: false,
        keywordRules: [] as KeywordFilterRule[],
    },

    // 新增：锚点优化默认配置（仅在详情页生效）
    anchorOptimization: {
        enabled: false,
        showPreviewButton: true,
        buttonPosition: 'right-center' as const,
    },

    // 新增：列表增强默认配置
    listEnhancement: {
        enabled: true, // 默认启用
        enableClickEnhancement: true,
        enableClickEnhancementList: true,
        enableClickEnhancementDetail: true,
        enableVideoPreview: true,
        enableScrollPaging: false, // 默认关闭滚动翻页
        enableListOptimization: true,
        previewDelay: 1000,
        previewVolume: 0.2,
        enableRightClickBackground: true,
        // 新增：演员水印默认配置
        enableActorWatermark: false,
        actorWatermarkPosition: 'top-right',
        actorWatermarkOpacity: 0.4,
        // 新增：基于演员偏好的过滤默认配置
        hideBlacklistedActorsInList: false,
        hideNonFavoritedActorsInList: false,
        hideUnrecognizedActorsInList: true, // 默认隐藏无法识别演员的作品
        treatSubscribedAsFavorited: true,
        // 新增：列表页显示控制默认配置
        listDisplayControl: {
            enabled: true,
            columnCount: 4,
            containerWidth: 100,
            enableContainerExpansion: false,
        },
        showStatusBadge: true,
        enableStatusQuickAction: false,
        enableListFavoriteQuickAction: false,
        resourceTags: false,
        sorting: {
            enabled: false,
            appendStrategy: 'prompt',
            autoResortPosition: 'preserve',
        },
    },

    // 新增：Emby/Jellyfin 增强默认配置
    emby: {
        enabled: false, // 默认关闭，需要用户手动配置
        matchUrls: [], // 额外匹配地址；媒体服务器 URL 会自动参与匹配
        videoCodePatterns: [
            '[A-Z]{2,6}-\\d{2,6}', // 标准格式: ABC-123, ABCD-123
            'FC2-PPV-\\d+', // FC2格式
            '\\d{4,8}_\\d{1,3}', // 数字格式: 123456_01
            '\\d{6,12}', // 纯数字格式
            '[a-z0-9]+-\\d+_\\d+' // 带字母的数字格式
        ],
        linkBehavior: 'javdb-search' as const, // 默认使用搜索
        enableAutoDetection: true, // 默认启用自动检测
        highlightStyle: {
            backgroundColor: '#e3f2fd',
            color: '#1976d2',
            borderRadius: '4px',
            padding: '2px 4px'
        },
        // 新增：右侧悬浮快捷按钮默认显示
        showQuickSearchCode: true,
        showQuickSearchActor: true,
        mediaServers: [],
        syncIntervalMinutes: 60,
        libraryStatus: {
            enabled: false,
            showOnList: true,
            showOnDetail: true,
        },
        realtimeCheck: {
            enabled: false,
            concurrency: 1,
            batchSize: 20,
            cacheTtlMinutes: 10,
        },
    },

    // 新增：演员同步配置
    actorSync: DEFAULT_ACTOR_SYNC_CONFIG,

    // 新增：演员页增强默认配置
    actorEnhancement: {
        enabled: false,
        autoApplyTags: false,
        defaultTags: [],
        defaultSortType: 0,
        // 新增：演员页“影片分段显示”默认配置
        enableTimeSegmentationDivider: false,
        // 默认以 6 个月为阈值
        timeSegmentationMonths: 6,
    },

    // 新增：隐私保护配置
    privacy: DEFAULT_PRIVACY_CONFIG,

    // 新增：AI功能配置
    ai: DEFAULT_AI_SETTINGS,

    // 新增：报告（Insights）默认配置
    insights: {
        topN: 10,
        changeThresholdRatio: 0.08,
        minTagCount: 3,
        risingLimit: 5,
        fallingLimit: 5,
        statusScope: 'viewed',
        source: 'auto',
        minMonthlySamples: 10,
        // 自动月报：默认关闭，仅用户开启时才注册闹钟与补偿
        autoMonthlyEnabled: false,
        autoCompensateOnStartupEnabled: false,
        autoMonthlyMinuteOfDay: 10,
        prompts: {
            persona: 'doctor',
            enableCustom: false,
            systemOverride: '',
            rulesOverride: '',
        },
    },

    version: '0.0.0',
    // Dashboard 番号库：是否在列表中显示封面
    showCoversInRecords: false,
    // Dashboard 番号库：视图模式（列表/卡片）
    recordsViewMode: 'list' as 'list' | 'card'
};

// WebDAV恢复配置
export const RESTORE_CONFIG = {
    // 数据加载策略
    loading: {
        enableProgressiveLoading: true,
        chunkSize: 1000,
        maxConcurrentAnalysis: 3,
        timeoutMs: 60000
    },

    // 用户界面配置
    ui: {
        defaultMode: 'quick' as 'quick' | 'wizard' | 'expert',
        showAdvancedByDefault: false,
        enableAnimations: true,
        stepTransitionMs: 300
    },

    // 错误处理配置
    errorHandling: {
        maxRetries: 3,
        enableFallback: true,
        logLevel: 'info' as 'debug' | 'info' | 'warn' | 'error',
        showDetailedErrors: false
    },

    // 默认策略配置
    defaults: {
        strategy: 'smart' as 'smart' | 'local' | 'cloud' | 'manual',
        autoSelectContent: true,
        enableConflictResolution: true
    }
};
