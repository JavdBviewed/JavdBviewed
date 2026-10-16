/**
 * @file embyMediaServerSync.test.ts
 * @description X2 云 settings 同步模型（10-13 线）：emby 会话剥离 / 按源 id 并集合并 / 墓碑前移 / 条目级 updatedAt 戳。
 *
 * 用户 10-15 裁决：115 会话（settings.drive115 v2* 键）= 保留并跨设备云同步；
 * emby.mediaServers 4 会话字段（accessToken/userId/userDisplayName/tokenObtainedAt）= 剥离不上云。
 * 两者方向相反，本模块只动 emby 面，drive115 零触碰（红线：115 代码零改）。
 */
import { describe, expect, it } from 'vitest';
import {
  EMBY_SESSION_FIELDS,
  mergeEmbyMediaServersForPull,
  stampEmbyMediaServerUpdateTimes,
  stripEmbySessionFieldsFromValue,
} from './embyMediaServerSync';

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    type: 'emby',
    name: 'S1',
    url: 'http://127.0.0.1:38098',
    apiKey: 'ak-readonly',
    enabled: true,
    username: 'MyEmbyUser',
    password: 'pw-local',
    ...over,
  };
}

const SESSION = {
  accessToken: 'AT',
  userId: 'UID',
  userDisplayName: 'UDN',
  tokenObtainedAt: 123,
};

function withSession(e: Record<string, unknown>): Record<string, unknown> {
  return { ...e, ...SESSION };
}

function settings(emby: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { theme: 'light', ...extra, emby };
}

function pull(local: unknown, remote: unknown): Record<string, any> {
  return mergeEmbyMediaServersForPull(local, remote) as Record<string, any>;
}

function serverIds(v: Record<string, any>): string[] {
  return (v?.emby?.mediaServers || []).map((s: any) => s.id ?? '(no-id)');
}

describe('EMBY_SESSION_FIELDS', () => {
  it('exactly the four session fields (PRD §二.1)', () => {
    expect([...EMBY_SESSION_FIELDS].sort()).toEqual(
      ['accessToken', 'tokenObtainedAt', 'userDisplayName', 'userId'],  // 注意 userD* < userI*（'D'<'I'）
    );
  });
});

describe('stripEmbySessionFieldsFromValue', () => {
  it('removes the four session fields from every mediaServers entry, keeps credentials and all other keys', () => {
    const s = settings({
      enabled: true,
      mediaServers: [withSession(entry()), withSession(entry({ id: 's2', name: 'S2' }))],
      deletedServerIds: ['gone-1'],
    });
    const out = stripEmbySessionFieldsFromValue(s) as any;
    expect(out.emby.mediaServers[0]).toEqual(entry());
    expect(out.emby.mediaServers[1]).toEqual(entry({ id: 's2', name: 'S2' }));
    expect(out.emby.deletedServerIds).toEqual(['gone-1']);
    expect(out.theme).toBe('light');
  });

  it('never touches settings.drive115 (115 会话 = 保留跨设备云同步，用户 10-15 定案)', () => {
    const s = {
      drive115: { v2AccessToken: 'v2-at', v2RefreshToken: 'v2-rt', v2TokenExpiresAt: 999, v2ClientId: 'c' },
      emby: { mediaServers: [withSession(entry())] },
    };
    const out = stripEmbySessionFieldsFromValue(s) as any;
    expect(out.drive115).toEqual({ v2AccessToken: 'v2-at', v2RefreshToken: 'v2-rt', v2TokenExpiresAt: 999, v2ClientId: 'c' });
    expect(out.emby.mediaServers[0]).toEqual(entry());
  });

  it('passes through malformed shapes unchanged (same reference, no crash)', () => {
    for (const v of [null, undefined, 'x', 42, [], {}, { emby: null }, { emby: {} }, { emby: { mediaServers: 'nope' } }]) {
      expect(stripEmbySessionFieldsFromValue(v)).toBe(v as any);
    }
  });

  it('is pure: input is not mutated', () => {
    const s = settings({ mediaServers: [withSession(entry())] });
    const snapshot = structuredClone(s);
    stripEmbySessionFieldsFromValue(s);
    expect(s).toStrictEqual(snapshot);
  });
});

describe('mergeEmbyMediaServersForPull', () => {
  it('union by source id: local-only source survives pull, remote-only source lands (验收 2)', () => {
    const local = settings({ mediaServers: [entry({ id: 'lx', name: 'LocalX' })] });
    const remote = settings(
      { mediaServers: [entry({ id: 'ry', name: 'RemoteY' })], libraryEnabled: false },
      { theme: 'dark' },
    );
    const out = pull(local, remote);
    expect(serverIds(out)).toEqual(['ry', 'lx']); // 远端序在前，local-only 追加
    expect(out.emby.mediaServers.find((s: any) => s.id === 'lx').name).toBe('LocalX');
    expect(out.emby.mediaServers.find((s: any) => s.id === 'ry').name).toBe('RemoteY');
    expect(out.emby.libraryEnabled).toBe(false); // 远端 emby 子设置 LWW
    expect(out.theme).toBe('dark'); // 远端顶层 LWW
  });

  it('pull 会话隔离：同 id 远端更新 → 非会话字段取远端，会话字段保留本地已有（验收 1：本地已有会话保留）', () => {
    const local = settings({
      mediaServers: [{ ...entry({ id: 's1', name: 'L' }), ...SESSION, updatedAt: 100 }],
    });
    const remote = settings({
      mediaServers: [{ ...entry({ id: 's1', name: 'R' }), ...SESSION, accessToken: 'AT-remote', updatedAt: 200 }],
    });
    const out = pull(local, remote).emby.mediaServers[0];
    expect(out.name).toBe('R');
    expect(out.accessToken).toBe('AT'); // 本地会话保留，不是远端的 AT-remote
    expect(out.userId).toBe('UID');
    expect(out.userDisplayName).toBe('UDN');
  });

  it('pull 会话隔离：本地有会话、远端同 id 无会话 → 合并结果保留本地会话', () => {
    const local = settings({ mediaServers: [{ ...entry({ id: 's1', name: 'L' }), ...SESSION, updatedAt: 100 }] });
    const remote = settings({ mediaServers: [{ ...entry({ id: 's1', name: 'R' }), updatedAt: 300 }] });
    const out = pull(local, remote).emby.mediaServers[0];
    expect(out.name).toBe('R');
    expect(out.accessToken).toBe('AT');
    expect(out.tokenObtainedAt).toBe(123);
  });

  it('pull 会话隔离：本地无会话、远端带会话 → 不接收（session 永不跨设备）', () => {
    const local = settings({ mediaServers: [{ ...entry({ id: 's1', name: 'L' }), updatedAt: 100 }] });
    const remote = settings({ mediaServers: [withSession({ ...entry({ id: 's1', name: 'R' }) }), { ...withSession(entry({ id: 'ry' })), updatedAt: 50 }] });
    const out = pull(local, remote);
    for (const s of out.emby.mediaServers) {
      for (const f of EMBY_SESSION_FIELDS) expect(s[f]).toBeUndefined();
    }
    expect(serverIds(out)).toEqual(['s1', 'ry']);
  });

  it('墓碑前移：远端 blob 同时带活体 X 与墓碑 X（陈旧推回）→ 落盘剔除 X（验收 3 不回灌）', () => {
    const local = settings({ mediaServers: [entry({ id: 'x', name: 'Xlocal' })] });
    const remote = settings({ mediaServers: [entry({ id: 'x', name: 'X2' })], deletedServerIds: ['x'] }, { theme: 'dark' });
    const out = pull(local, remote);
    expect(out.emby.mediaServers).toEqual([]);
    expect(out.emby.deletedServerIds).toEqual(['x']);
    expect(out.theme).toBe('dark'); // 其余整 blob LWW 不受影响
  });

  it('墓碑前移：本地墓碑过滤远端活体条目（本地陈旧活体+墓碑同 blob 场景自愈）', () => {
    const local = settings({ mediaServers: [entry({ id: 'x' })], deletedServerIds: ['x'] });
    const remote = settings({ mediaServers: [entry({ id: 'x' }), entry({ id: 'y' })] });
    const out = pull(local, remote);
    expect(serverIds(out)).toEqual(['y']);
    expect(out.emby.deletedServerIds).toEqual(['x']);
  });

  it('墓碑 union 保留在结果 blob（双端各自墓碑不丢）', () => {
    const local = settings({ mediaServers: [entry({ id: 'a' })], deletedServerIds: ['t1'] });
    const remote = settings({ mediaServers: [entry({ id: 'b' })], deletedServerIds: ['t2'] });
    const out = pull(local, remote);
    expect(out.emby.deletedServerIds).toEqual(['t1', 't2']);
    expect(serverIds(out)).toEqual(['b', 'a']);
  });

  it('同 id 冲突按条目 updatedAt last-write（验收 4）', () => {
    // 本地更新 → 本地胜（整条取本地，不混字段）
    let out = pull(
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'L' }), updatedAt: 200 }] }),
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'R' }), url: 'http://remote:9', updatedAt: 100 }] }),
    ).emby.mediaServers[0];
    expect(out).toEqual({ ...entry({ id: 's1', name: 'L' }), updatedAt: 200 });

    // 远端更新 → 远端胜
    out = pull(
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'L' }), updatedAt: 100 }] }),
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'R' }), url: 'http://remote:9', updatedAt: 200 }] }),
    ).emby.mediaServers[0];
    expect(out.name).toBe('R');
    expect(out.url).toBe('http://remote:9');
  });

  it('无 updatedAt（旧 blob）→ 远端胜（实体级 LWW 权威）；单端有时间戳 → 有戳端胜', () => {
    let out = pull(
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'L' }) }] }),
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'R' }) }] }),
    ).emby.mediaServers[0];
    expect(out.name).toBe('R');

    out = pull(
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'L' }), updatedAt: 200 }] }),
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'R' }) }] }),
    ).emby.mediaServers[0];
    expect(out.name).toBe('L');

    out = pull(
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'L' }) }] }),
      settings({ mediaServers: [{ ...entry({ id: 's1', name: 'R' }), updatedAt: 200 }] }),
    ).emby.mediaServers[0];
    expect(out.name).toBe('R');
  });

  it('兼容：远端 blob 无 emby 对象 → 本地 emby 配置保留（不被整 blob 冲掉）', () => {
    const local = settings({ mediaServers: [entry({ id: 'lx' })], highlightStyle: { color: '#123456' } });
    const remote = { theme: 'dark' } as Record<string, unknown>;
    const out = pull(local, remote);
    expect(out.theme).toBe('dark');
    expect(serverIds(out)).toEqual(['lx']);
    expect(out.emby.highlightStyle).toEqual({ color: '#123456' });
  });

  it('兼容：双端均无 emby → 远端原样返回（维持整替语义，无脏键）', () => {
    const remote = { theme: 'dark' } as Record<string, unknown>;
    expect(pull({ theme: 'light' }, remote)).toBe(remote);
    expect(pull(undefined, remote)).toBe(remote);
  });

  it('兼容：畸形远端（非对象）→ 原样返回不崩溃', () => {
    const remoteA = 'weird' as unknown;
    const remoteB = 42 as unknown;
    expect(pull(settings({ mediaServers: [entry()] }), remoteA)).toBe(remoteA);
    expect(pull(settings({ mediaServers: [entry()] }), remoteB)).toBe(remoteB);
  });

  it('兼容：旧 blob（含会话字段、无合并元数据）pull = 剥离会话 + 按现有 id 落（验收 5）', () => {
    const remote = settings({
      mediaServers: [withSession(entry({ id: 'old-1', name: 'OldSrc' })), withSession(entry({ id: 'old-2', name: 'OldSrc2' }))],
      deletedServerIds: ['old-3'],
    });
    const out = pull(undefined, remote);
    expect(serverIds(out)).toEqual(['old-1', 'old-2']);
    for (const s of out.emby.mediaServers) {
      for (const f of EMBY_SESSION_FIELDS) expect(s[f]).toBeUndefined();
    }
    expect(out.emby.mediaServers[0]).toEqual(entry({ id: 'old-1', name: 'OldSrc' }));
    expect(out.emby.deletedServerIds).toEqual(['old-3']);
  });

  it('无 id 条目：远端保留、本地丢弃（对齐既有整替语义，防重复）', () => {
    const local = settings({ mediaServers: [entry({ id: 'lx', name: 'LocalX' }), { name: 'NoIdLocal', url: 'http://x' }] });
    const remote = settings({ mediaServers: [{ name: 'NoIdRemote', url: 'http://y' }, entry({ id: 'ry' })] });
    const out = pull(local, remote);
    expect(out.emby.mediaServers.map((s: any) => s.name)).toEqual(['NoIdRemote', 'S1', 'LocalX']);
    expect(out.emby.mediaServers.map((s: any) => s.id ?? '(no-id)')).toEqual(['(no-id)', 'ry', 'lx']);
  });

  it('deletedServerIds 非空才写键（空 union 不留脏键）', () => {
    const out = pull(
      settings({ mediaServers: [entry({ id: 'a' })] }),
      settings({ mediaServers: [entry({ id: 'b' })] }),
    );
    expect('deletedServerIds' in out.emby).toBe(false);
  });

  it('是纯函数：local/remote 输入均不被修改', () => {
    const local = settings({ mediaServers: [withSession(entry({ id: 'a' }))] });
    const remote = settings({ mediaServers: [withSession(entry({ id: 'b' }))] });
    const l = structuredClone(local);
    const r = structuredClone(remote);
    mergeEmbyMediaServersForPull(local, remote);
    expect(local).toStrictEqual(l);
    expect(remote).toStrictEqual(r);
  });
});

describe('stampEmbyMediaServerUpdateTimes', () => {
  it('新增条目打戳（now 注入）', () => {
    const next = { emby: { mediaServers: [entry({ id: 'a' }), entry({ id: 'b' })] } };
    const out = stampEmbyMediaServerUpdateTimes({ emby: { mediaServers: [] } }, next, 1000) as any;
    expect(out.emby.mediaServers[0].updatedAt).toBe(1000);
    expect(out.emby.mediaServers[1].updatedAt).toBe(1000);
  });

  it('字段变更条目打戳（未变更条目零漂移：无戳不加键，与接线测试同口径）', () => {
    const next = { emby: { mediaServers: [entry({ id: 'a', name: 'A2' }), entry({ id: 'b', name: 'B' })] } };
    const out = stampEmbyMediaServerUpdateTimes({ emby: { mediaServers: [entry({ id: 'a', name: 'A' }), entry({ id: 'b', name: 'B' })] } }, next, 2000) as any;
    expect(out.emby.mediaServers[0].updatedAt).toBe(2000);
    expect('updatedAt' in out.emby.mediaServers[1]).toBe(false);
  });

  it('未变更条目保留原 updatedAt；未变更且无戳 → 不加键（零漂移）', () => {
    const next = {
      emby: {
        mediaServers: [entry({ id: 'a', name: 'A', updatedAt: 777 }), entry({ id: 'b', name: 'B' })],
      },
    };
    const out = stampEmbyMediaServerUpdateTimes(
      { emby: { mediaServers: [entry({ id: 'a', name: 'A', updatedAt: 777 }), entry({ id: 'b', name: 'B' })] } },
      next,
      3000,
    ) as any;
    expect(out.emby.mediaServers[0].updatedAt).toBe(777);
    expect('updatedAt' in out.emby.mediaServers[1]).toBe(false);
  });

  it('prev 无 emby → 全部视为新增打戳', () => {
    const next = { emby: { mediaServers: [entry({ id: 'a' })] } };
    const out = stampEmbyMediaServerUpdateTimes({ theme: 'light' }, next, 5) as any;
    expect(out.emby.mediaServers[0].updatedAt).toBe(5);
  });

  it('next 无 emby → no-op 且不创建 emby 键；prev 不被修改', () => {
    const prev = { emby: { mediaServers: [entry({ id: 'a' })] } };
    const prevSnap = structuredClone(prev);
    const next = { theme: 'dark' } as Record<string, unknown>;
    const out = stampEmbyMediaServerUpdateTimes(prev, next, 5) as any;
    expect(out.emby).toBeUndefined();
    expect(prev).toStrictEqual(prevSnap);
  });

  it('缺省 now = Date.now() 有限时间戳', () => {
    const before = Date.now();
    const next = { emby: { mediaServers: [entry({ id: 'a' })] } };
    const out = stampEmbyMediaServerUpdateTimes({}, next) as any;
    const ts = out.emby.mediaServers[0].updatedAt;
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('无 id 条目不打戳（不可按 id 追踪）', () => {
    const next = { emby: { mediaServers: [{ name: 'NoId' }] } };
    const out = stampEmbyMediaServerUpdateTimes({}, next, 9) as any;
    expect('updatedAt' in out.emby.mediaServers[0]).toBe(false);
  });

  it('R2 表单保存形态：normalize 重建条目丢 updatedAt 键 → 未变更者从 prev 补拷原戳（已有戳保留契约落地）', () => {
    const prev = {
      emby: { mediaServers: [entry({ id: 'a', name: 'A', updatedAt: 111 }), entry({ id: 'b', name: 'B' })] },
    };
    // next = normalizeMediaServer 重建形态：固定字段集，无 updatedAt 键
    const next = {
      emby: { mediaServers: [entry({ id: 'a', name: 'A' }), entry({ id: 'b', name: 'B' })] },
    };
    const out = stampEmbyMediaServerUpdateTimes(prev, next, 999) as any;
    expect(out.emby.mediaServers[0].updatedAt).toBe(111); // 补拷原戳，而非 999
    expect('updatedAt' in out.emby.mediaServers[1]).toBe(false); // 无戳仍零漂移
  });

  it('R2 混合场景：补拷条目 + 变更打戳条目 + 新增条目同一次调用各自正确', () => {
    const prev = {
      emby: { mediaServers: [entry({ id: 'a', name: 'A', updatedAt: 111 }), entry({ id: 'b', name: 'B' })] },
    };
    const next = {
      emby: {
        mediaServers: [entry({ id: 'a', name: 'A' }), entry({ id: 'b', name: 'B2' }), entry({ id: 'c', name: 'C' })],
      },
    };
    const out = stampEmbyMediaServerUpdateTimes(prev, next, 999) as any;
    expect(out.emby.mediaServers[0].updatedAt).toBe(111); // 未变更（normalize 丢键）→ 补拷
    expect(out.emby.mediaServers[1].updatedAt).toBe(999); // 字段变更 → 新戳
    expect(out.emby.mediaServers[2].updatedAt).toBe(999); // 新增 → 新戳
  });

  it('R2 边界：next 条目自带戳且其余未变更 → 保留 rec 自身戳（不用 prev 戳覆盖）', () => {
    const prev = { emby: { mediaServers: [entry({ id: 'a', name: 'A', updatedAt: 111 })] } };
    const next = { emby: { mediaServers: [entry({ id: 'a', name: 'A', updatedAt: 555 })] } };
    const out = stampEmbyMediaServerUpdateTimes(prev, next, 999) as any;
    expect(out.emby.mediaServers[0].updatedAt).toBe(555);
  });
});
