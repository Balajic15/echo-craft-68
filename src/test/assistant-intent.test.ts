import { describe, expect, it } from "vitest";

import { detectVisualIntent, isVisualFollowUp } from "@/lib/assistant/intent";

describe("visual context intent", () => {
  it("requests screen sharing when the user asks about their screen", () => {
    expect(detectVisualIntent("Can you look at my screen?", null)).toBe("screen");
  });

  it("requests camera context for a visual identification question", () => {
    expect(detectVisualIntent("What object am I holding?", null)).toBe("camera");
  });

  it("keeps the current visual source for a short follow-up", () => {
    expect(detectVisualIntent("What about that one?", "camera")).toBe("camera");
  });

  it("does not request camera access for a conceptual question", () => {
    expect(detectVisualIntent("What is inheritance?", null)).toBeNull();
  });
});