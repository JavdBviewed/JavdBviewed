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
