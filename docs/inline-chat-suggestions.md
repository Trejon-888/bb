# Inline chat suggestions

Thread composers show reusable Summarize, Next steps, and Check work prompts when the draft is empty. Selecting a prompt fills the editable composer and focuses it; sending remains a separate action. The shared follow-up composer supplies the same behavior to native and embedded chat panels. These are fixed quick prompts, not model-generated suggestions based on conversation content.

Suggestions hide for text (including whitespace), mentions, attachments, uploads, pending interactions, submission, stopping, and unavailable submission modes. Running threads may prepare a follow-up using their usual queue or steer behavior.

The buttons use the existing draft-change path. SDK plugins can prepare equivalent drafts through `PluginComposerApi.replace({ text, mentions: [] })` and focus the composer; no suggestion-specific API is required. CLI callers can send the same prompt with `bb thread tell <thread-id> '<prompt>'`; that command sends immediately rather than preparing a UI draft.
