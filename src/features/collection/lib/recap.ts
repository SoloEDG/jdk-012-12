import type { GalleryDocument } from "../../../shared/types";
import { artworkById } from "../../../shared/catalog";
export function recapStats(d: GalleryDocument) {
  const finished = Object.values(d.finished);
  return {
    seen: d.visits.filter((v) => v.seconds >= 2).length,
    seconds: Math.round(d.visits.reduce((n, v) => n + v.seconds, 0)),
    saved: d.favorites.length,
    listened: finished.filter((m) => m === "listened").length,
    read: finished.filter((m) => m === "read").length,
  };
}
export function finishLabel(mode: "listened" | "read" | undefined): string {
  return mode === "listened" ? "已听完讲解" : mode === "read" ? "已阅读完成" : "";
}
export function createRecap(d: GalleryDocument): string {
  const stats = recapStats(d);
  return [
    "余境 · 我的参观回顾",
    `观看 ${stats.seen} 件作品 · 停留 ${stats.seconds} 秒`,
    `听完讲解 ${stats.listened} 件 · 阅读完成 ${stats.read} 件`,
    "",
    ...d.favorites.map((id) => {
      const a = artworkById(id);
      if (!a) return "";
      const mark = finishLabel(d.finished[id]);
      return `${a.title} / ${a.artist}
${d.notes[id] || "未添加感想"}
停留 ${Math.round(d.visits.find((v) => v.id === id)?.seconds || 0)} 秒${mark ? " · " + mark : ""}`;
    }),
  ].join("\n\n");
}
