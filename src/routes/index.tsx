import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, MoreVertical, Square, X, Plus, History, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { detectVisualIntent, isVisualFollowUp, type VisualSource } from "@/lib/assistant/intent";
import { getRecognition, Speaker } from "@/lib/assistant/speech";
import {
  type Conversation,
  type Msg,
  type Settings,
  DEFAULT_SETTINGS,
  loadConversations,
  loadSettings,
  persistConversationHistory,
  saveConversations,
  saveSettings,
  uid,
} from "@/lib/assistant/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Echo — Voice assistant" },
      { name: "description", content: "Talk naturally. Echo listens, sees when needed, and answers out loud." },
      { property: "og:title", content: "Echo — Voice assistant" },
      { property: "og:description", content: "Talk naturally. Echo listens, sees when needed, and answers out loud." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Assistant,
});

type Phase = "idle" | "listening" | "thinking" | "speaking";

function Assistant() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<Conversation>(() => ({ id: uid(), title: "", updatedAt: 0, messages: [] }));
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [vision, setVision] = useState<VisualSource>(null);
  const [pendingScreen, setPendingScreen] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<ReturnType<typeof getRecognition>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ current, settings, vision, phase });
  stateRef.current = { current, settings, vision, phase };

  // Load persisted data after hydration.
  useEffect(() => {
    setSettings(loadSettings());
    setConvos(loadConversations());
    const sp = new Speaker();
    sp.onStart = () => setPhase("speaking");
    sp.onIdle = () => {
      setPhase((p) => (p === "speaking" ? "idle" : p));
      if (stateRef.current.settings.handsFree && !abortRef.current) setTimeout(() => startListening(), 250);
    };
    speakerRef.current = sp;
    const loadVoices = () => setVoices(speechSynthesis.getVoices());
    if (typeof speechSynthesis !== "undefined") {
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    return () => {
      sp.stop();
      stopVision();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (speakerRef.current) {
      speakerRef.current.voiceURI = settings.voiceURI;
      speakerRef.current.rate = settings.rate;
    }
  }, [settings]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [current.messages, interim]);

  useEffect(() => {
    const stopOnHide = () => {
      if (document.visibilityState !== "visible") {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setVision(null);
      }
    };
    document.addEventListener("visibilitychange", stopOnHide);
    return () => document.removeEventListener("visibilitychange", stopOnHide);
  }, []);

  // ---------- Vision ----------
  const stopVision = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setVision(null);
  }, []);

  const startVision = useCallback(
    async (source: "camera" | "screen") => {
      if (stateRef.current.vision === source && streamRef.current) return true;
      stopVision();
      try {
        const stream =
          source === "camera"
            ? await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } })
            : await navigator.mediaDevices.getDisplayMedia({ video: true });
        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        videoTrack.onended = () => stopVision();
        setVision(source);
        await new Promise((r) => setTimeout(r, 50));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          await new Promise<void>((resolve) => {
            const v = videoRef.current;
            if (!v) return resolve();
            if (v.videoWidth) return resolve();
            v.onloadeddata = () => resolve();
            setTimeout(resolve, 1500);
          });
          await new Promise((r) => setTimeout(r, source === "camera" ? 400 : 150)); // let exposure settle
        }
        return true;
      } catch {
        toast(source === "camera" ? "Camera access was not allowed." : "Screen sharing was cancelled.");
        stopVision();
        return false;
      }
    },
    [stopVision],
  );

  const captureFrame = (): string | undefined => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const context = c.getContext("2d");
    if (!context) return;
    context.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  };

  // ---------- Conversation ----------
  const persist = (conv: Conversation) => {
    setConvos((prev) => {
      const next = [conv, ...prev.filter((c) => c.id !== conv.id)].sort((a, b) => b.updatedAt - a.updatedAt);
      persistConversationHistory(next, settings.saveHistory);
      return next;
    });
  };

  const interrupt = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    speakerRef.current?.stop();
    setPhase("idle");
  };

  const send = async (raw: string, forcedSource?: VisualSource) => {
    const text = raw.trim();
    if (!text) return;
    interrupt();
    setInput("");
    setInterim("");
    const { settings: s, vision: v } = stateRef.current;

    let image: string | undefined;
    let source: VisualSource = null;
    if (s.autoVision) {
      const intent = forcedSource ?? detectVisualIntent(text, v);
      if (intent === "screen" && !streamRef.current) {
        if (!isVisualFollowUp(text)) stopVision();
        setPendingScreen(text);
        setInterim("");
        return;
      }
      setPendingScreen("");
      if (intent === "stop" || intent === null) {
        if (v && !isVisualFollowUp(text)) stopVision();
      } else if (await startVision(intent)) {
        image = captureFrame();
        source = intent;
      }
    }

    const userMsg: Msg = {
      id: uid(),
      role: "user",
      text,
      ...(image ? { image } : {}),
      ...(source ? { source } : {}),
    };
    const asstMsg: Msg = { id: uid(), role: "assistant", text: "" };
    const base = stateRef.current.current;
    let conv: Conversation = {
      ...base,
      title: base.title || text.slice(0, 60),
      updatedAt: Date.now(),
      messages: [...base.messages, userMsg, asstMsg],
    };
    setCurrent(conv);
    setPhase("thinking");

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const speaker = speakerRef.current;
    if (!speaker) {
      setPhase("idle");
      return;
    }
    let full = "";
    try {
      const history = conv.messages.slice(0, -1).slice(-20);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          name: s.name,
          // Only the newest image is sent; earlier frames are dropped to keep requests light.
          messages: history.map((m, i) => ({
            role: m.role,
            text: m.text,
            ...(i === history.length - 1 && m.image ? { image: m.image } : {}),
          })),
        }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Something went wrong. Please try again.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        full += chunk;
        if (s.speak) speaker.push(chunk);
        setCurrent((c) => (c.id === conv.id ? { ...c, messages: c.messages.map((m) => (m.id === asstMsg.id ? { ...m, text: full } : m)) } : c));
      }
      if (s.speak) speaker.flush();
      if (!s.speak || !speaker.speaking) setPhase("idle");
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        if (!full) full = "…";
      } else {
        full = (e as Error).message;
        setPhase("idle");
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      conv = { ...conv, messages: conv.messages.map((m) => (m.id === asstMsg.id ? { ...m, text: full } : m)) };
      setCurrent((c) => (c.id === conv.id ? conv : c));
      persist(conv);
    }
  };

  // ---------- Listening ----------
  const startListening = () => {
    interrupt();
    const rec = getRecognition();
    if (!rec) {
      toast("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    recRef.current = rec;
    let finalText = "";
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setInterim(finalText + interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") toast("Microphone access was not allowed.");
    };
    rec.onend = () => {
      recRef.current = null;
      setPhase((p) => (p === "listening" ? "idle" : p));
      if (finalText.trim()) send(finalText);
      else setInterim("");
    };
    setPhase("listening");
    setInterim("");
    rec.start();
  };

  const stopListening = () => recRef.current?.stop();

  const onMic = () => {
    if (phase === "listening") stopListening();
    else startListening();
  };

  const newChat = () => {
    interrupt();
    stopVision();
    setPendingScreen("");
    setCurrent({ id: uid(), title: "", updatedAt: 0, messages: [] });
  };

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const n = { ...s, ...patch };
      saveSettings(n);
      if (patch.saveHistory === false) {
        setConvos([]);
        saveConversations([]);
      }
      return n;
    });
  };

  const status =
    phase === "listening" ? "Listening" : phase === "thinking" ? "Thinking" : phase === "speaking" ? "Speaking — tap to interrupt" : "";
  const empty = current.messages.length === 0;

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between px-5">
        <span className="text-[15px] font-semibold tracking-tight">{settings.name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Menu" className="-mr-2 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreVertical className="h-5 w-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={newChat}><Plus className="mr-2 h-4 w-4" />New conversation</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHistoryOpen(true)}><History className="mr-2 h-4 w-4" />History</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}><SettingsIcon className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Visual context */}
      {vision && (
        <div className="relative mx-5 mb-2 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted">
          <video ref={videoRef} muted playsInline className="aspect-[4/3] max-h-[38vh] w-full object-cover" />
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            {vision === "camera" ? "Camera" : "Screen"}
          </div>
          <Button type="button" variant="secondary" size="icon" aria-label="Stop visual sharing" title="Stop visual sharing" onClick={stopVision} className="absolute right-3 top-3 h-8 w-8 rounded-full bg-background/90">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {pendingScreen && (
        <div className="mx-auto mb-2 flex w-[calc(100%-2.5rem)] max-w-2xl items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">Share your screen to continue</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              const question = pendingScreen;
              const opened = await startVision("screen");
              if (opened) await send(question, "screen");
              else setPendingScreen("");
            }}
          >
            Share
          </Button>
        </div>
      )}

      {/* Conversation */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto px-5">
        {empty && !interim ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-2xl font-medium tracking-tight">How can I help?</p>
            <p className="mt-2 text-sm text-muted-foreground">Tap the mic and just talk.</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-5 py-4">
            {current.messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex flex-col items-end gap-1.5">
                  {m.image && <img src={m.image} alt="" className="w-28 rounded-lg border border-border" />}
                  <div className="max-w-[92%] text-right text-[15px] leading-relaxed">{m.text}</div>
                </div>
              ) : (
                <div key={m.id} className="max-w-[92%] whitespace-pre-wrap text-[15px] leading-relaxed">
                  {m.text || <span className="text-muted-foreground">Thinking</span>}
                </div>
              ),
            )}
            {interim && (
              <div className="flex justify-end">
                <div className="max-w-[92%] text-right text-[15px] text-muted-foreground">{interim}</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Input bar */}
      <footer className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mx-auto max-w-2xl">
          <div className="mb-2 h-4 text-center text-xs text-muted-foreground">
            {status && (
              <button onClick={phase === "speaking" || phase === "thinking" ? interrupt : undefined}>{status}</button>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 rounded-full border border-border bg-background py-1.5 pl-5 pr-1.5 shadow-sm"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={phase === "listening" ? "Listening…" : "Ask anything"}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            {input.trim() ? (
              <Button type="submit" aria-label="Send" size="icon" className="h-10 w-10 rounded-full">
                <ArrowUp className="h-5 w-5" />
              </Button>
            ) : phase === "thinking" || phase === "speaking" ? (
              <Button type="button" onClick={interrupt} aria-label="Stop" size="icon" className="h-10 w-10 rounded-full">
                <Square className="h-4 w-4 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onMic}
                aria-label={phase === "listening" ? "Stop listening" : "Speak"}
                variant={phase === "listening" ? "default" : "secondary"}
                size="icon"
                className={`h-10 w-10 rounded-full ${phase === "listening" ? "animate-pulse" : ""}`}
              >
                <Mic className="h-5 w-5" />
              </Button>
            )}
          </form>
        </div>
      </footer>

      {/* History */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader className="px-5 pt-5"><SheetTitle>History</SheetTitle></SheetHeader>
          <div className="mt-2 flex flex-col overflow-y-auto px-2">
            {convos.length === 0 && <p className="px-3 py-6 text-sm text-muted-foreground">No conversations yet.</p>}
            {convos.map((c) => (
              <div key={c.id} className={`group flex items-center rounded-lg ${c.id === current.id ? "bg-muted" : "hover:bg-muted"}`}>
                <button
                  className="flex-1 truncate px-3 py-2.5 text-left text-sm"
                  onClick={() => {
                    interrupt();
                    stopVision();
                    setCurrent(c);
                    setHistoryOpen(false);
                  }}
                >
                  {c.title || "Untitled"}
                  <span className="block text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleString()}</span>
                </button>
                <button
                  aria-label="Delete"
                  className="mr-2 rounded p-1.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                  onClick={() => {
                    const next = convos.filter((x) => x.id !== c.id);
                    setConvos(next);
                    saveConversations(next);
                    if (c.id === current.id) newChat();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Settings */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-80">
          <SheetHeader><SheetTitle>Settings</SheetTitle></SheetHeader>
          <div className="mt-6 flex flex-col gap-6 text-sm">
            <label className="flex flex-col gap-2">
              <span className="text-muted-foreground">Assistant name</span>
              <input
                value={settings.name}
                maxLength={40}
                onChange={(e) => updateSettings({ name: e.target.value || "Echo" })}
                className="rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground"
              />
            </label>
            <Row label="Speak replies" hint="Read answers out loud">
              <Switch checked={settings.speak} onCheckedChange={(v) => updateSettings({ speak: v })} />
            </Row>
            <Row label="Hands-free" hint="Listen again after each reply">
              <Switch checked={settings.handsFree} onCheckedChange={(v) => updateSettings({ handsFree: v })} />
            </Row>
            <Row label="Automatic camera" hint="Open camera or screen when you ask about something visual">
              <Switch checked={settings.autoVision} onCheckedChange={(v) => updateSettings({ autoVision: v })} />
            </Row>
            <Row label="Save history" hint="Keep conversations on this device">
              <Switch checked={settings.saveHistory} onCheckedChange={(v) => updateSettings({ saveHistory: v })} />
            </Row>
            <label className="flex flex-col gap-2">
              <span className="text-muted-foreground">Voice</span>
              <select
                value={settings.voiceURI}
                onChange={(e) => updateSettings({ voiceURI: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 outline-none"
              >
                <option value="">Default</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-3">
              <span className="text-muted-foreground">Speaking speed · {settings.rate.toFixed(1)}×</span>
              <Slider min={0.6} max={1.6} step={0.1} value={[settings.rate]} onValueChange={([v]) => updateSettings({ rate: v ?? 1 })} />
            </div>
              <Button
              type="button"
              variant="outline"
              className="mt-2 justify-start"
              onClick={() => {
                setConvos([]);
                saveConversations([]);
                newChat();
                toast("History cleared");
              }}
            >
              Clear history
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div>{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Dot({ d = 0 }: { d?: number }) {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${d}ms` }} />;
}
