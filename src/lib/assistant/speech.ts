/* Browser speech helpers: live transcription + spoken replies. */

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onspeechstart?: (() => void) | null;
};

export function getRecognition(): SR | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const C = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!C) return null;
  const r = new C();
  r.lang = navigator.language || "en-US";
  r.continuous = false;
  r.interimResults = true;
  return r;
}

export function speechSupported() {
  return !!getRecognition();
}

/** Speaks text sentence-by-sentence as it streams in. */
export class Speaker {
  private pending = "";
  voiceURI = "";
  rate = 1;
  onStart?: () => void;
  onIdle?: () => void;

  get speaking() {
    return typeof speechSynthesis !== "undefined" && (speechSynthesis.speaking || speechSynthesis.pending);
  }

  push(chunk: string) {
    this.pending += chunk;
    const m = this.pending.match(/^([\s\S]*?[.!?…])(\s+|$)([\s\S]*)$/);
    const sentence = m?.[1];
    const remainder = m?.[3];
    if (sentence && sentence.trim().length > 1 && m?.[2] && remainder !== undefined) {
      this.say(sentence);
      this.pending = remainder;
      this.push("");
    }
  }

  flush() {
    if (this.pending.trim()) this.say(this.pending);
    this.pending = "";
  }

  private say(text: string) {
    if (typeof speechSynthesis === "undefined") return;
    const u = new SpeechSynthesisUtterance(text.trim());
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === this.voiceURI);
    if (v) u.voice = v;
    u.rate = this.rate;
    u.onstart = () => this.onStart?.();
    u.onend = () => {
      if (!speechSynthesis.speaking && !speechSynthesis.pending) this.onIdle?.();
    };
    speechSynthesis.speak(u);
  }

  stop() {
    this.pending = "";
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.onIdle?.();
  }
}
