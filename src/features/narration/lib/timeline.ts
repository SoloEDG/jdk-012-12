import type { Artwork } from "../../../shared/types";
export type Segment = {
  index: number;
  start: number;
  end: number;
  text: string;
};
// 设备只能按整句合成语音，因此时间轴以“段落”为单位：
// 每段占据与其文本长度成正比的时间槽，段首是唯一可以兑现的播放位置。
export function segmentsOf(a: Artwork): Segment[] {
  const weights = a.transcript.map((t) => Math.max(t.trim().length, 1));
  const totalWeight = weights.reduce((n, w) => n + w, 0) || 1;
  const segments: Segment[] = [];
  let start = 0;
  a.transcript.forEach((text, index) => {
    const end =
      index === a.transcript.length - 1
        ? a.duration
        : start + (weights[index] / totalWeight) * a.duration;
    segments.push({ index, start, end, text });
    start = end;
  });
  return segments;
}
export function segmentAt(a: Artwork, elapsed: number): Segment {
  const segments = segmentsOf(a);
  const clamped = Math.min(Math.max(elapsed, 0), a.duration);
  return (
    segments.find((s) => clamped < s.end) || segments[segments.length - 1]
  );
}
export function captionAt(a: Artwork, elapsed: number): string {
  return segmentAt(a, elapsed).text;
}
export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
