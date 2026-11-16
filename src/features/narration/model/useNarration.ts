import { useState, useEffect, useRef } from "react";
import type { AudioState } from "../../../shared/types";
import { artworkById } from "../../../shared/catalog";
import { segmentsOf, segmentAt } from "../lib/timeline";
import { speak, stopSpeech, speechSupported } from "../lib/speech";
export type NarrationEndMode = "listened" | "read";
type InnerState = {
  artworkId: string | null;
  segIndex: number;
  offset: number; // 当前段落内的已播放秒数（展示用估计值，始终被钳制在段内）
  playing: boolean;
  rate: number;
  done: NarrationEndMode | null; // 完成方式：收听 / 阅读 / 未完成
  take: number; // 每次定位自增，强制重新合成同一段落
};
const initial: InnerState = {
  artworkId: null,
  segIndex: 0,
  offset: 0,
  playing: false,
  rate: 1,
  done: null,
  take: 0,
};
// 连续拖动进度条时，等手势稳定后再重新合成，避免频繁重启语音
const SPEAK_DEBOUNCE_MS = 180;
// 结束回调迟迟不来时的兜底：按段落预计时长的 1.8 倍 + 2 秒推进
const WATCHDOG_RATIO = 1.8;
const WATCHDOG_EXTRA_MS = 2000;
export function useNarration(
  onEnd: (id: string, mode: NarrationEndMode) => void,
) {
  const [inner, setInner] = useState<InnerState>(initial);
  const [supported] = useState(speechSupported);
  const callback = useRef(onEnd);
  callback.current = onEnd;
  const session = useRef({ token: 0 });
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 正在发声的语音所属的上下文；只有与最新状态完全一致时时钟才走字，
  // 定位/倍速变化后、新语音实际开始前，时钟不会空走
  const speakingCtx = useRef<{
    artworkId: string;
    segIndex: number;
    take: number;
    rate: number;
  } | null>(null);
  const artwork = artworkById(inner.artworkId);
  const segments = artwork ? segmentsOf(artwork) : [];
  const segment =
    segments[Math.min(inner.segIndex, Math.max(segments.length - 1, 0))] ??
    null;
  // 完成上报统一由状态驱动：只有真实播完（listened）或逐段读完（read）
  // 才会进入 done 状态，空白等待不会触发完成
  const reported = useRef(false);
  useEffect(() => {
    if (inner.done && inner.artworkId) {
      if (!reported.current) {
        reported.current = true;
        callback.current(inner.artworkId, inner.done);
      }
    } else {
      reported.current = false;
    }
  }, [inner.done, inner.artworkId]);
  // 语音合成由状态驱动：段落序号是唯一事实来源。
  // 设备只能整句合成，因此所有定位（拖动/暂停/倍速）都吸附到段首后重念整段，
  // 展示的时间、字幕与实际听到的内容始终对应。
  useEffect(() => {
    if (!inner.playing || !supported || inner.done) return;
    const a = artworkById(inner.artworkId);
    if (!a) return;
    const segs = segmentsOf(a);
    const seg = segs[Math.min(inner.segIndex, segs.length - 1)];
    if (!seg) return;
    const rate = inner.rate;
    const token = ++session.current.token;
    const finishSegment = () => {
      // 令牌校验：连续拖动、切换作品、暂停后迟到的旧回调一律忽略
      if (session.current.token !== token) return;
      if (seg.index + 1 < segs.length) {
        setInner((s) =>
          s.artworkId === a.id && s.playing && s.segIndex === seg.index
            ? { ...s, segIndex: seg.index + 1, offset: 0 }
            : s,
        );
      } else {
        setInner((s) =>
          s.artworkId === a.id && s.playing
            ? { ...s, playing: false, done: "listened" as const, offset: 0 }
            : s,
        );
      }
    };
    const timer = setTimeout(() => {
      let ok = false;
      try {
        ok = speak(seg.text, rate, {
          onEnd: finishSegment,
          onError: () => {
            if (session.current.token !== token) return;
            setInner((s) =>
              s.artworkId === a.id ? { ...s, playing: false, offset: 0 } : s,
            );
          },
        });
      } catch {
        ok = false;
      }
      if (!ok) {
        if (session.current.token === token)
          setInner((s) =>
            s.artworkId === a.id ? { ...s, playing: false, offset: 0 } : s,
          );
        return;
      }
      speakingCtx.current = {
        artworkId: a.id,
        segIndex: seg.index,
        take: inner.take,
        rate,
      };
      const expectedMs = ((seg.end - seg.start) / Math.max(rate, 0.1)) * 1000;
      watchdog.current = setTimeout(
        finishSegment,
        expectedMs * WATCHDOG_RATIO + WATCHDOG_EXTRA_MS,
      );
    }, SPEAK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      if (watchdog.current) {
        clearTimeout(watchdog.current);
        watchdog.current = null;
      }
      speakingCtx.current = null;
      // 先自增令牌使旧语音的迟到回调失效，再停止旧语音
      session.current.token += 1;
      stopSpeech();
    };
  }, [
    inner.playing,
    inner.artworkId,
    inner.segIndex,
    inner.rate,
    inner.take,
    inner.done,
    supported,
  ]);
  // 展示用时钟：仅在语音实际发声时推进，且钳制在当前段落内。
  // 合成启动延迟或回调延迟时进度停在原处/段尾等待，不会把空白等待走成已播放。
  useEffect(() => {
    if (!inner.playing || !supported) return;
    let previous = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const delta = (now - previous) / 1000;
      previous = now;
      if (!speakingCtx.current) return;
      setInner((s) => {
        const ctx = speakingCtx.current;
        if (
          !ctx ||
          !s.playing ||
          s.done ||
          ctx.artworkId !== s.artworkId ||
          ctx.segIndex !== s.segIndex ||
          ctx.take !== s.take ||
          ctx.rate !== s.rate
        )
          return s;
        const a = artworkById(s.artworkId);
        if (!a) return s;
        const segs = segmentsOf(a);
        const seg = segs[Math.min(s.segIndex, segs.length - 1)];
        if (!seg) return s;
        const max = seg.end - seg.start;
        const offset = Math.min(max, s.offset + delta * s.rate);
        return offset === s.offset ? s : { ...s, offset };
      });
    }, 150);
    return () => clearInterval(t);
  }, [inner.playing, supported]);
  const play = (id: string) => {
    if (!artworkById(id)) return;
    setInner((s) => {
      if (s.artworkId === id && s.playing && !s.done) return s;
      const resume = s.artworkId === id && !s.done;
      return {
        ...s,
        artworkId: id,
        segIndex: resume ? s.segIndex : 0,
        offset: 0,
        playing: supported,
        done: null,
      };
    });
  };
  const pause = () =>
    setInner((s) =>
      // 继续时只能从段首重念，暂停位置同步吸附到段首
      s.playing ? { ...s, playing: false, offset: 0 } : s,
    );
  const toggle = () => {
    if (!supported) return;
    setInner((s) => {
      if (!s.artworkId) return s;
      if (s.playing) return { ...s, playing: false, offset: 0 };
      return s.done
        ? { ...s, segIndex: 0, offset: 0, playing: true, done: null }
        : { ...s, playing: true, offset: 0 };
    });
  };
  const seek = (elapsed: number) =>
    setInner((s) => {
      const a = artworkById(s.artworkId);
      if (!a) return s;
      const seg = segmentAt(a, elapsed);
      // 吸附到段首：只展示设备真正能兑现的位置
      return {
        ...s,
        segIndex: seg.index,
        offset: 0,
        done: null,
        take: s.take + 1,
      };
    });
  const rate = (next: number) =>
    setInner((s) =>
      // 倍速变化后从段首按新速度重念，位置同步吸附
      s.rate === next ? s : { ...s, rate: next, offset: 0 },
    );
  // 无语音设备上的阅读模式：逐段阅读，读完全部段落记为“阅读完成”
  const readNext = () => {
    if (supported) return;
    setInner((s) => {
      const a = artworkById(s.artworkId);
      if (!a || s.done) return s;
      const segs = segmentsOf(a);
      return s.segIndex + 1 >= segs.length
        ? { ...s, done: "read" as const, playing: false, offset: 0 }
        : { ...s, segIndex: s.segIndex + 1, offset: 0 };
    });
  };
  const readPrev = () => {
    if (supported) return;
    setInner((s) =>
      s.segIndex > 0
        ? { ...s, segIndex: s.segIndex - 1, offset: 0, done: null }
        : s,
    );
  };
  const elapsed = artwork
    ? inner.done
      ? artwork.duration
      : segment
        ? segment.start + Math.min(inner.offset, segment.end - segment.start)
        : 0
    : 0;
  const state: AudioState = {
    artworkId: inner.artworkId,
    elapsed,
    playing: inner.playing,
    rate: inner.rate,
  };
  return {
    state,
    caption: segment ? segment.text : "",
    supported,
    done: inner.done !== null,
    segmentIndex: segment ? segment.index : 0,
    segmentCount: segments.length,
    play,
    pause,
    toggle,
    seek,
    rate,
    readNext,
    readPrev,
  };
}
