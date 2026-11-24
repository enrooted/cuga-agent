// Ported from cuga-agent/src/frontend_workspaces/frontend/src/manage/hooks/useFullDraftSave.ts (Copyright IBM Corp., Apache-2.0). Logic unchanged.
import { useCallback, useEffect, useRef } from "react";
import i18n from "@/i18n";
import * as api from "@/lib/manage/api";
import { isAbortError, type AddToast } from "./saveHelpers";

export function useFullDraftSave(opts: {
  assembleConfig: (overrides?: object) => object;
  effectiveAgentId: string | undefined;
  addToast: AddToast;
  setDraftSaving: (v: boolean) => void;
  setCurrentVersion: (v: number | "draft" | null) => void;
  importStatus: "idle" | "ok" | "error";
  refreshKnowledgeHealth: () => void | Promise<void>;
}) {
  const {
    assembleConfig,
    effectiveAgentId,
    addToast,
    setDraftSaving,
    setCurrentVersion,
    importStatus,
    refreshKnowledgeHealth,
  } = opts;

  const fullSaveAbortRef = useRef<AbortController | null>(null);
  const agentIdRef = useRef(effectiveAgentId);
  agentIdRef.current = effectiveAgentId;

  useEffect(() => {
    fullSaveAbortRef.current?.abort();
    return () => {
      fullSaveAbortRef.current?.abort();
    };
  }, [effectiveAgentId]);

  const performDraftSave = useCallback(
    async (partial?: object) => {
      const agentId = effectiveAgentId;
      const toSave = partial ? { ...assembleConfig(), ...partial } : assembleConfig();
      setDraftSaving(true);
      fullSaveAbortRef.current?.abort();
      const ac = new AbortController();
      fullSaveAbortRef.current = ac;
      try {
        const res = await api.postManageConfigDraft(toSave, agentId, ac.signal);
        if (ac.signal.aborted || ac !== fullSaveAbortRef.current || agentId !== agentIdRef.current) return;
        setDraftSaving(false);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (ac.signal.aborted || ac !== fullSaveAbortRef.current || agentId !== agentIdRef.current) return;
          setCurrentVersion("draft");
          const hasPartialErrors = data.status === "partial" && (data.tool_errors || data.policy_errors);
          if (hasPartialErrors) {
            if (data.tool_errors) {
              Object.entries(data.tool_errors as Record<string, { error?: string; message?: string; type?: string }>).forEach(
                ([toolName, err]) => {
                  const msg = err?.error || err?.message || i18n.t("manage:generic.unknownError");
                  const type = err?.type ? ` (${err.type})` : "";
                  addToast("warning", i18n.t("manage:draft.toolFailedTitle", { name: toolName }), `${msg}${type}`);
                },
              );
            }
            if (data.policy_errors) {
              const errs = Array.isArray(data.policy_errors) ? data.policy_errors : [data.policy_errors];
              errs.forEach((e: unknown) => addToast("warning", i18n.t("manage:draft.policyErrorTitle"), typeof e === "string" ? e : String(e)));
            }
            addToast(
              "info",
              i18n.t("manage:draft.savedWithWarningsTitle"),
              data.message || i18n.t("manage:draft.toolsOrPoliciesFailedToLoad"),
            );
          } else {
            addToast("success", i18n.t("manage:draft.savedTitle"), i18n.t("manage:draft.savedBody"));
          }
        } else {
          const errorMsg = i18n.t("manage:draft.draftFailed", { status: res.status, statusText: res.statusText });
          addToast("error", i18n.t("manage:draft.saveFailedTitle"), errorMsg);
        }
      } catch (error) {
        if (isAbortError(error) || agentId !== agentIdRef.current) return;
        if (ac !== fullSaveAbortRef.current) return;
        setDraftSaving(false);
        const errorMsg = error instanceof Error ? error.message : i18n.t("manage:draft.networkErrorSaving");
        addToast("error", i18n.t("manage:draft.saveFailedTitle"), errorMsg);
      }
    },
    [addToast, assembleConfig, effectiveAgentId, setCurrentVersion, setDraftSaving],
  );

  useEffect(() => {
    if (importStatus !== "ok") return;
    let cancelled = false;
    (async () => {
      await performDraftSave();
      if (!cancelled) void refreshKnowledgeHealth();
    })();
    return () => {
      cancelled = true;
    };
  }, [importStatus, performDraftSave, refreshKnowledgeHealth]);

  return { performDraftSave };
}
