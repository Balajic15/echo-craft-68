export type Msg = { id: string; role: "user" | "assistant"; text: string; image?: string; source?: "camera" | "screen" };
export type Conversation = { id: string; title: string; updatedAt: number; messages: Msg[] };
export type Settings = {
  name: string;
  speak: boolean;
  autoVision: boolean;
  voiceURI: string;
  rate: number;
  handsFree: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  name: "Echo",
  speak: true,
  autoVision: true,
  voiceURI: "",
  rate: 1,
  handsFree: false,
};

const CK = "echo.conversations.v1";
const SK = "echo.settings.v1";

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function loadConversations(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(CK) || "[]");
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  // Strip images to keep storage small.
  const slim = list
    .slice(0, 50)
    .map((c) => ({ ...c, messages: c.messages.map(({ image: _i, ...m }) => m) }));
  try {
    localStorage.setItem(CK, JSON.stringify(slim));
  } catch {
    /* quota */
  }
}

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SK) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SK, JSON.stringify(s));
}
