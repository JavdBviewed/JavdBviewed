/**
 * @file taskHeartbeatReporter.ts
 * @description 任务心跳上报器 —— 定期向 background 发送心跳，防止运行中的任务被误判为卡死
 * @module platform/tasks
 */
import { TASK_CENTER_MESSAGE } from '../../shared/taskCenterProtocol';
import { countContentPerformanceEvent } from './contentPerformanceDiagnostics';

/** 安装心跳上报器，每 5 秒向 background 发送活跃任务的心跳 */
export function installTaskHeartbeatReporter(taskIds: () => string[]): () => void {
  const tick = () => {
    countContentPerformanceEvent('interval.taskHeartbeat');
    try {
      for (const taskId of taskIds()) {
        countContentPerformanceEvent('runtime.taskHeartbeatMessage');
        chrome.runtime.sendMessage({ type: TASK_CENTER_MESSAGE.HEARTBEAT, payload: { taskId } });
      }
    } catch {}
  };
  const timerId = window.setInterval(tick, 5000);
  tick();
  return () => window.clearInterval(timerId);
}
