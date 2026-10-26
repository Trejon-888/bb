import { ApplicationLinkApprovalsSettings } from "@/components/settings/ApplicationLinkApprovalsSettings";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { ApplicationUrlDialog } from "@/components/ApplicationUrlDialog";
import { AppToaster } from "@/components/AppToaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/app-query-client";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { initializePreferredTheme } from "@/hooks/useTheme";
import "../app.css";

initializePreferredTheme();

const examples = `[Open Linear issue](linear://issue/ABC-123)

[Review Reflect note](reflect://note/Project%20X)

[Open Things](things:///show?id=example)

[Open Messages](sms:)

[Try an uninstalled app](bb-link-test-uninstalled://example)

[Blocked JavaScript](javascript:alert(1)) · [Blocked file launch](file:///Applications/Calculator.app)`;

function ApplicationLinksPrototype() {
  const [content, setContent] = useState(examples);
  const config = useSystemConfig();
  return (
    <main className="min-h-dvh bg-background text-foreground p-6 sm:p-12">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">BB prototype</p>
          <h1 className="text-2xl font-semibold">Open links in your apps</h1>
          <p className="text-sm text-muted-foreground">
            Click a link to review its destination before opening it on this
            device. Replace the examples with links to your own notes or issues.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-6">
          <MarkdownPreview content={content} allowHtml />
        </div>
        <ApplicationLinkApprovalsSettings />
        <label className="block space-y-2 text-sm">
          <span>Message</span>
          <textarea
            aria-label="Message"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-64 w-full rounded-lg border bg-background p-3 font-mono text-sm"
          />
        </label>
        <p className="text-sm text-muted-foreground">
          Application links are{" "}
          {config.data?.experiments.applicationLinks ? "enabled" : "disabled"}.
          Enable Application links in Settings → Experiments to try this page.
          You can remember approvals and revoke them below.
        </p>
        <p className="text-sm text-muted-foreground">
          In a web browser, the browser controls app handoff and may show its
          own prompt. Native BB clients require this prototype’s desktop or
          mobile build.
        </p>
      </div>
      <ApplicationUrlDialog />
      <AppToaster />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={appQueryClient}>
    <ApplicationLinksPrototype />
  </QueryClientProvider>,
);
