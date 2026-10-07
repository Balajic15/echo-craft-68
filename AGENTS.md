<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Assistant AI calls go through the server route `/api/chat`, which holds the provider key and streams back plain text only. Why: keeps credentials and provider/model branding out of the browser.
- Voice in/out uses the browser's built-in speech recognition and synthesis; history and settings live in localStorage. Why: real-time with no extra services or accounts.
