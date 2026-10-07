import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(20000),
  image: z.string().max(8_000_000).optional(), // data URL (jpeg)
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(60),
  name: z.string().max(40).optional(),
});

const SYSTEM = (name: string) =>
  `You are ${name}, a calm, concise voice assistant. Your replies are usually spoken aloud, so:
- Answer in 1-4 short sentences unless the user asks for detail.
- Never use markdown, bullet symbols, tables, code fences or emojis.
- Never mention which company, provider or model powers you. If asked, say you are ${name}.
- When an image is attached, it is a live frame from the user's camera or screen. Describe what is relevant to their question directly, as if you can see it.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env["GOOGLE_API_KEY"];
        if (!key) return Response.json({ error: "Assistant is not configured." }, { status: 500 });

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request." }, { status: 400 });
        }

        const contents = body.messages.map((m) => {
          const parts: Array<Record<string, unknown>> = [];
          if (m.image) {
            const match = m.image.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
          }
          parts.push({ text: m.text || " " });
          return { role: m.role === "assistant" ? "model" : "user", parts };
        });

        const upstream = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
          {
            method: "POST",
            signal: request.signal,
            headers: { "content-type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: SYSTEM(body.name || "Assistant") }] },
              contents,
              generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
            }),
          },
        ).catch((e) => {
          if ((e as Error).name === "AbortError") return null;
          throw e;
        });

        if (!upstream) return new Response(null, { status: 499 });
        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          console.error("chat upstream error", upstream.status, detail.slice(0, 500));
          const msg =
            upstream.status === 429
              ? "I'm getting too many requests right now. Try again in a moment."
              : upstream.status === 403 || upstream.status === 401
                ? "The assistant's access key was rejected."
                : "Something went wrong. Please try again.";
          return Response.json({ error: msg }, { status: upstream.status });
        }

        // Re-emit only plain text chunks so no provider details reach the client.
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buf = "";
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              try {
                const json = JSON.parse(line.slice(5));
                const text = (json.candidates?.[0]?.content?.parts ?? [])
                  .map((p: { text?: string }) => p.text ?? "")
                  .join("");
                if (text) controller.enqueue(encoder.encode(text));
              } catch {
                /* ignore partial */
              }
            }
          },
          cancel() {
            reader.cancel();
          },
        });

        return new Response(stream, {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
