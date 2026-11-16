export type SpeechHandlers = {
  onEnd: () => void;
  onError: () => void;
};
export function speechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}
export function stopSpeech() {
  if (speechSupported()) window.speechSynthesis.cancel();
}
// 合成指定段落；开始/结束事件由调用方用令牌校验，
// 被取消或已过期的语音回调不得影响当前播放状态。
export function speak(
  text: string,
  rate: number,
  handlers: SpeechHandlers,
): boolean {
  stopSpeech();
  if (!speechSupported()) return false;
  const u = new window.SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = rate;
  u.onend = handlers.onEnd;
  u.onerror = (e) => {
    // 主动 cancel 会触发 canceled/interrupted，属于正常流程而非故障
    if (e.error === "canceled" || e.error === "interrupted") return;
    handlers.onError();
  };
  window.speechSynthesis.speak(u);
  return true;
}
