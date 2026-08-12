import type { GlobalTaskDescriptor } from './taskCenterTypes';

export const TASK_CENTER_MESSAGE = {
  REGISTER: 'task-center:register',
  REGISTER_BATCH: 'task-center:register-batch',
  REQUEST_LEASE: 'task-center:request-lease',
  HEARTBEAT: 'task-center:heartbeat',
  PROGRESS: 'task-center:progress',
  PAUSE: 'task-center:pause',
  RESUME: 'task-center:resume',
  COMPLETE: 'task-center:complete',
  FAIL: 'task-center:fail',
  CANCEL: 'task-center:cancel',
  VISIBILITY: 'task-center:visibility',
  QUERY: 'task-center:query',
  CLEAR: 'task-center:clear',
  PAGE_LIFECYCLE: 'task-center:page-lifecycle',
  CANCEL_PAGE_INSTANCE: 'task-center:cancel-page-instance',
} as const;

export interface RegisterTaskMessage {
  type: typeof TASK_CENTER_MESSAGE.REGISTER;
  payload: GlobalTaskDescriptor;
}

export interface RegisterTaskBatchMessage {
  type: typeof TASK_CENTER_MESSAGE.REGISTER_BATCH;
  payload: { descriptors: GlobalTaskDescriptor[] };
}

export interface RequestLeaseMessage {
  type: typeof TASK_CENTER_MESSAGE.REQUEST_LEASE;
  payload: { taskId: string };
}
