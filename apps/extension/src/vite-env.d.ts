/// <reference types="vite/client" />

declare interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_BUILD_ID?: string;
  readonly VITE_APP_BUILD_NUMBER?: string;
  readonly VITE_APP_GIT_HASH?: string;
  readonly VITE_APP_VERSION_STATE?: 'clean' | 'staged' | 'dirty' | 'unknown';
  readonly VITE_APP_BUILD_TIME?: string;
  /** 仅用于隔离性能实验；生产构建不设置。 */
  readonly VITE_JAVDB_PERF_BOOTSTRAP_SKIP?: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
