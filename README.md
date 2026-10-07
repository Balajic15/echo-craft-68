# Aura Assistant

@secret:GOOGLE_API_KEY

Build a production-quality voice-first AI assistant as a React-based PWA following the attached specification, keeping the Google API key securely in backend edge functions and hiding any provider/model branding from the client UI.

Key requirements:
- Voice-first real-time conversational interface with live transcription, voice response, and interruption handling
- Minimalist monochrome UI (black, white, soft gray, subtle borders, no glowing orbs or gradients)
- Intent-driven automatic camera/vision activation and screen-share when visual context is requested
- Single minimal input bar with text and voice controls
- Conversation history and settings
- Backend edge function proxying requests to Gemini with GOOGLE_API_KEY so credentials stay private

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://echo-craft-68.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/81e88dac-8d7f-4a68-8c25-b21b7b1e8697).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
