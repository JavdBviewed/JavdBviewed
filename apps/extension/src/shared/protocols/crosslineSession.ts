/** 跨线路会话诊断协议：只传状态，不携带 cookie 值或账号信息。 */
export type CrosslineRouteStatus = 'disabled' | 'unsupported' | 'missing' | 'present' | 'synced' | 'conflict' | 'error';
export type CrosslineErrorStage = 'settings-read' | 'settings-write' | 'cookie-read' | 'cookie-write' | 'selection' | 'unknown';
export type CrosslineDiagnosticError = { stage: CrosslineErrorStage; message: string };
export type CrosslineSessionStatus = {
  enabled: boolean;
  checkedAt: number;
  routes: { host: string; status: CrosslineRouteStatus }[];
  reason: 'ready' | 'no-session' | 'different-sessions' | 'multiple-stores';
  error?: CrosslineDiagnosticError;
};
export type CrosslineSessionRequest =
  | { type: 'JAVDB_CROSSLINE:STATUS' }
  | { type: 'JAVDB_CROSSLINE:REFRESH' }
  | { type: 'JAVDB_CROSSLINE:COPY'; sourceHost: string; targetHost: string }
  | { type: 'JAVDB_CROSSLINE:SET_ENABLED'; enabled: boolean };
export type CrosslineSessionResponse =
  | { success: true; status: CrosslineSessionStatus }
  | { success: false; error: string; stage?: CrosslineErrorStage };

/** Page operations never accept a caller-supplied target or cookie store. */
export type CrosslinePageContext = {
  tabId: number; documentId?: string; origin: string; targetHost: string; storeId: string; incognito: boolean;
};
export type CrosslineLoginState = 'authenticated' | 'anonymous' | 'unknown';
export type CrosslineCopyOutcome = 'authenticated' | 'already-authenticated' | 'not-accepted' | 'unconfirmed' | 'stale';
export type CrosslinePromptStatus = {
  enabled: boolean; targetHost: string; targetState: CrosslineLoginState;
  sources: { host: string }[]; offerId?: string;
};
export type CrosslinePageRequest =
  | { type: 'JAVDB_CROSSLINE_PAGE:STATUS' | 'JAVDB_CROSSLINE_PAGE:LOGOUT' }
  | { type: 'JAVDB_CROSSLINE_PAGE:CLAIM' | 'JAVDB_CROSSLINE_PAGE:DISMISS'; offerId: string }
  | { type: 'JAVDB_CROSSLINE_PAGE:COPY'; offerId: string; sourceHost: string };
export type CrosslinePageResponse =
  | { success: true; status?: CrosslinePromptStatus; show?: boolean; outcome?: CrosslineCopyOutcome }
  | { success: false; error: string };
