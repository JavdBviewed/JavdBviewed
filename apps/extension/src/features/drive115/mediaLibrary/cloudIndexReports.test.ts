import { describe, expect, it, vi } from 'vitest';
import { drive115IndexSourceId, queueDrive115SourceReports, reconcileDrive115IndexSources } from './cloudIndexReports';

const settings = { drive115: { v2UserInfo: { user_id: '12345' } } };
const entry = { code: 'ABC-123', rootCid: '9', folderCid: '10', videoFileId: '11' };

describe('115 source report boundary', () => {
  it('uses stable account/root identity and never access tokens', () => {
    expect(drive115IndexSourceId(settings, '9')).toBe('uid:12345:root:9');
    expect(drive115IndexSourceId({ drive115: { v2AccessToken: 'secret' } }, '9')).toBeNull();
  });
  it('queues observed files only and skips empty partial observations', async () => {
    const queue = vi.fn(async () => {});
    await queueDrive115SourceReports(settings, [
      { rootCid: '9', entries: [entry as never], complete: false },
      { rootCid: '8', entries: [], complete: false },
      { rootCid: '7', entries: [], complete: true },
    ], queue);
    expect(queue).toHaveBeenCalledTimes(2);
    expect(queue).toHaveBeenCalledWith({ kind: 'drive115', sourceId: 'uid:12345:root:9', entries: [{ code: 'ABC-123', data: entry }], complete: false });
    expect(queue).toHaveBeenCalledWith({ kind: 'drive115', sourceId: 'uid:12345:root:7', entries: [], complete: true });
  });
  it('keeps enabled roots active even if their server fails; excludes explicitly disabled roots', async () => {
    const reconcile = vi.fn(async () => {});
    await reconcileDrive115IndexSources(settings, [{ cid: '9', enabled: true }, { cid: '8', enabled: false }], reconcile);
    expect(reconcile).toHaveBeenCalledWith('drive115', ['uid:12345:root:9']);
  });
  it('does not retire an account whose identity is unknown', async () => {
    const reconcile = vi.fn(async () => {});
    await reconcileDrive115IndexSources({}, [], reconcile);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
