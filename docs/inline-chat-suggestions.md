# Inline chat suggestions

Idle thread composers show follow-up suggestions generated from the conversation. Selecting one fills an editable draft and focuses the composer; sending remains a separate action. Native and embedded chats use the shared follow-up composer. No fixed prompts substitute for unavailable suggestions.

Suggestions are requested only for ready composers with no text (including whitespace), mentions, attachments, uploads, or pending interactions. Query results are isolated by thread and conversation update version, so old requests cannot populate a different thread. Generation uses the selected Chat suggestions AI service; turning that task off hides suggestions. Failed or unavailable generation leaves the composer usable.

SDK callers use `threads.chatSuggestions({ threadId })` to retrieve the same generated suggestions. Plugins prepare an editable draft through `PluginComposerApi.replace({ text, mentions: [] })` and focus the composer. CLI callers retrieve suggestions with `bb thread suggestions <thread-id>` and may send one with `bb thread tell <thread-id> '<prompt>'`; tell sends immediately rather than preparing a UI draft.
