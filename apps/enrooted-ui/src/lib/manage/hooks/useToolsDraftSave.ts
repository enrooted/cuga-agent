// Ported from cuga-agent/src/frontend_workspaces/frontend/src/manage/hooks/useToolsDraftSave.ts (Copyright IBM Corp., Apache-2.0). Logic unchanged.
import { useEffect, useRef, type MutableRefObject } from "react";
import i18n from "@/i18n";
import * as api from "@/lib/manage/api";
import { isAbortError, type AddToast } from "./saveHelpers";
import type { ToolEntry } from "@/lib/manage/tools-types";

export function useToolsDraftSave(opts: {
  tools: ToolEntry[];
  effectiveAgentId: string | undefined;
  addToast: AddToast;
  skipDraftSaveRef: MutableRefObject<boolean>;
  setDraftSaving: (v: boolean) => void;
  setCurrentVersion: (v: number | "draft" | null) => void;
}) {
  const { tools, effectiveAgentId, addToast, skipDraftSaveRef, setDraftSaving, setCurrentVersion } = opts;
  const toolsAbortRef = useRef<AbortController | null>(null);
  const toolsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      toolsAbortRef.current?.abort();
      if (toolsSaveTimeoutRef.current) clearTimeout(toolsSaveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (skipDraftSaveRef.current) return;
    toolsAbortRef.current?.abort();
    const ac = new AbortController();
    toolsAbortRef.current = ac;
    const t = setTimeout(() => {
      toolsSaveTimeoutRef.current = null;
      if (toolsAbortRef.current !== ac) return;
      (async () => {
        setDraftSaving(true);
        try {
          const res = await api.patchManageConfigDraftTools(tools, effectiveAgentId, ac.signal);
          if (ac.signal.aborted) return;
          setDraftSaving(false);
          if (res.ok) {
            setCurrentVersion("draft");
            const data = await res.json().catch(() => ({}));
            if (ac.signal.aborted) return;
            if (data.status === "partial" && data.tool_errors) {
              Object.entries(data.tool_errors as Record<string, { error?: string; message?: string }>).forEach(
                ([toolName, err]) => addToast(
                  "warning",
                  i18n.t("manage:draft.toolTitle", { name: toolName }),
                  err?.error || err?.message || i18n.t("manage:generic.unknownError"),
                ),
              );
              addToast("info", i18n.t("manage:draft.savedWithWarningsTitle"), i18n.t("manage:draft.toolsFailedToLoad"));
            } else {
              addToast("success", i18n.t("manage:draft.savedTitle"), i18n.t("manage:draft.toolsSaved"));
            }
          } else {
            addToast("error", i18n.t("manage:draft.saveFailedTitle"), i18n.t("manage:draft.toolsFailed", { status: res.status, statusText: res.statusText }));
          }
        } catch (error) {
          if (isAbortError(error)) return;
          setDraftSaving(false);
          addToast("error", i18n.t("manage:draft.saveFailedTitle"), error instanceof Error ? error.message : i18n.t("manage:generic.networkError"));
        }
      })();
    }, 500);
    toolsSaveTimeoutRef.current = t;
    return () => {
      if (toolsSaveTimeoutRef.current) clearTimeout(toolsSaveTimeoutRef.current);
    };
  }, [tools, effectiveAgentId, addToast, skipDraftSaveRef, setCurrentVersion, setDraftSaving]);
}
