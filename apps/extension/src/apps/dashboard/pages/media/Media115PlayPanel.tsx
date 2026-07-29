/**
 * @file Media115PlayPanel.tsx
 * @description 媒体库内 115 播放入口：搜索候选 + 取流后交给通用 MediaPlayer 弹窗播放
 * @module apps/dashboard/pages/media
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../ui/primitives/Button/Button';
import { Input } from '../../../../ui/primitives/Input/Input';
import {
  resolveDrive115PlayTarget,
  tryResolveDrive115StreamUrl,
  buildDrive115WebPlayUrl,
} from '../../../../features/drive115/v2/drive115PlaybackActions';
import type { Drive115PlayCandidate } from '../../../../features/drive115/v2/drive115PlaybackModel';
import type { Drive115StreamType } from '../../../../features/drive115/v2/streamResponse';

export type Media115ResolvedStream = {
  query: string;
  streamUrl: string;
  streamType?: Drive115StreamType;
  candidate: Drive115PlayCandidate;
  webPlayUrl: string | null;
  message?: string;
};

export type Media115PlayPanelProps = {
  initialQuery?: string;
  /** 索引已有 pick_code 时优先直通取流，避免全站搜索 */
  initialPickCode?: string;
  onStreamReady?: (stream: Media115ResolvedStream) => void;
  onClose?: () => void;
};

function emitResolvedStream(params: {
  query: string;
  streamUrl: string;
  candidate: Drive115PlayCandidate;
  webPlayUrl: string | null;
  message: string;
  streamType?: Drive115StreamType;
  onStreamReady?: (stream: Media115ResolvedStream) => void;
}): void {
  params.onStreamReady?.({
    query: params.query,
    streamUrl: params.streamUrl,
    streamType: params.streamType || 'auto',
    candidate: params.candidate,
    webPlayUrl: params.webPlayUrl,
    message: params.message,
  });
}

/**
 * 115 播放入口：面板只负责搜索/取流，实际视频统一交给 MediaPlayer 弹窗。
 */
export function Media115PlayPanel({
  initialQuery = '',
  initialPickCode = '',
  onStreamReady,
  onClose,
}: Media115PlayPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<Drive115PlayCandidate[]>([]);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [active, setActive] = useState<Drive115PlayCandidate | null>(null);
  const autoPickRef = useRef('');

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const playByPickCode = async (pickCode: string, label?: string) => {
    const code = String(pickCode || '').trim();
    if (!code) return;
    const candidate: Drive115PlayCandidate = {
      fileId: '',
      fileName: label || query.trim() || code,
      fileSize: 0,
      pickCode: code,
      parentId: '',
      sha1: '',
    };
    const nextWebUrl = buildDrive115WebPlayUrl(candidate);
    setActive(candidate);
    setCandidates([candidate]);
    setWebUrl(nextWebUrl);
    setLoading(true);
    setMessage('索引命中 pick_code，正在取流…');
    try {
      const stream = await tryResolveDrive115StreamUrl(code);
      if (stream.success && stream.streamUrl) {
        const okMessage = '已通过索引 pick_code 获取播放地址，正在打开播放器…';
        setMessage(okMessage);
        emitResolvedStream({
          query: query.trim() || candidate.fileName || code,
          streamUrl: stream.streamUrl,
          streamType: stream.streamType,
          candidate,
          webPlayUrl: nextWebUrl,
          message: okMessage,
          onStreamReady,
        });
      } else {
        setMessage(stream.message || '取流失败，可改用搜索或网页播放');
      }
    } finally {
      setLoading(false);
    }
  };

  // 有 pickCode 时自动直通取流（每个 pickCode 只自动一次）
  useEffect(() => {
    const pick = String(initialPickCode || '').trim();
    if (!pick || autoPickRef.current === pick) return;
    autoPickRef.current = pick;
    void playByPickCode(pick, initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPickCode, initialQuery]);

  const runSearch = async () => {
    setLoading(true);
    setMessage('正在 115 搜索…');
    setWebUrl(null);
    setActive(null);
    try {
      const ret = await resolveDrive115PlayTarget(query.trim());
      setCandidates(ret.session.candidates);
      setWebUrl(ret.webPlayUrl);
      if (ret.defaultCandidate) setActive(ret.defaultCandidate);
      if (ret.streamUrl && ret.defaultCandidate) {
        const okMessage = '已获取播放地址，正在打开播放器…';
        setMessage(okMessage);
        emitResolvedStream({
          query: query.trim(),
          streamUrl: ret.streamUrl,
          streamType: ret.streamType,
          candidate: ret.defaultCandidate,
          webPlayUrl: ret.webPlayUrl,
          message: okMessage,
          onStreamReady,
        });
        return;
      }
      setMessage(ret.message || ret.session.message || (ret.success ? '完成（可网页播放）' : '失败'));
    } catch (e) {
      setCandidates([]);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const playCandidate = async (c: Drive115PlayCandidate) => {
    const nextWebUrl = buildDrive115WebPlayUrl(c);
    setActive(c);
    setWebUrl(nextWebUrl);
    setLoading(true);
    setMessage('正在解析播放地址…');
    try {
      const stream = await tryResolveDrive115StreamUrl(c.pickCode);
      if (stream.success && stream.streamUrl) {
        const okMessage = '已获取播放地址，正在打开播放器…';
        setMessage(okMessage);
        emitResolvedStream({
          query: query.trim() || c.fileName || c.pickCode,
          streamUrl: stream.streamUrl,
          streamType: stream.streamType,
          candidate: c,
          webPlayUrl: nextWebUrl,
          message: okMessage,
          onStreamReady,
        });
      } else {
        setMessage(stream.message || '取流失败，请用网页播放');
      }
    } finally {
      setLoading(false);
    }
  };

  const openWeb = (url: string | null) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="ml-115-panel" data-media-115-play-panel="1">
      <div className="ml-115-panel-head">
        <strong>115 播放</strong>
        {onClose ? (
          <button type="button" className="ml-115-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        ) : null}
      </div>
      <p className="ml-115-hint">
        优先使用片库索引的 pick_code 直通取流；无索引时再搜索。取流成功后使用媒体库通用播放器弹窗播放，进度写入本地「真实观看」证据（≠ 原站已看）。
      </p>
      <div className="ml-115-row">
        <Input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="番号 / 文件名关键字"
          aria-label="115 搜索"
        />
        <Button size="sm" disabled={loading || !query.trim()} onClick={() => void runSearch()}>
          {loading ? '处理中…' : '搜索'}
        </Button>
        {webUrl ? (
          <Button size="sm" variant="secondary" onClick={() => openWeb(webUrl)}>
            网页播放
          </Button>
        ) : null}
      </div>
      {message ? <p className="ml-115-msg">{message}</p> : null}

      {candidates.length > 0 ? (
        <ul className="ml-115-list">
          {candidates.map((c) => (
            <li key={c.fileId || c.pickCode}>
              <button type="button" className="ml-115-file" onClick={() => void playCandidate(c)}>
                <span className="ml-115-fname">{c.fileName || c.pickCode}</span>
                <span className="ml-115-fmeta">
                  {c.fileSize ? `${Math.round(c.fileSize / 1024 / 1024)} MB` : ''}
                  {active?.pickCode === c.pickCode ? ' · 当前候选' : ''} · 取流 / 网页
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
