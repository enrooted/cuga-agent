// Ported from cuga-agent/src/frontend_workspaces/frontend/src/manage/hooks/useAgentDraftSave.ts (Copyright IBM Corp., Apache-2.0). Logic unchanged.
import { useCallback, useEffect, useRef } from "react";
import i18n from "@/i18n";
import * as api from "@/lib/manage/api";
import { isAbortError, type AddToast } from "./saveHelpers";

export function useAgentDraftSave(opts: {
  agentName: string;
  agentDescription: string;
  agentKind?: "single" | "supervisor";
  effectiveAgentId: string | undefined;
  addToast: AddToast;
  setDraftSaving: (v: boolean) => void;
  setCurrentVersion: (v: number | "draft" | null) => void;
}) {
  const {
    agentName,
    agentDescription,
    agentKind,
    effectiveAgentId,
    addToast,
    setDraftSaving,
    setCurrentVersion,
  } = opts;
  const agentAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      agentAbortRef.current?.abort();
    };
  }, []);

  const saveAgentDraft = useCallback(async () => {
    setDraftSaving(true);
    agentAbortRef.current?.abort();
    const ac = new AbortController();
    agentAbortRef.current = ac;
    try {
      const res = await api.patchManageConfigDraftAgent(
        {
          name: agentName.trim(),
          description: agentDescription.trim() || undefined,
          ...(agentKind ? { kind: agentKind } : {}),
        },
        effectiveAgentId,
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setDraftSaving(false);
      if (res.ok) {
        setCurrentVersion("draft");
        addToast("success", i18n.t("manage:draft.savedTitle"), i18n.t("manage:draft.agentSaved"));
      } else {
        addToast("error", i18n.t("manage:draft.saveFailedTitle"), i18n.t("manage:draft.agentFailed", { status: res.status, statusText: res.statusText }));
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setDraftSaving(false);
      addToast("error", i18n.t("manage:draft.saveFailedTitle"), error instanceof Error ? error.message : i18n.t("manage:generic.networkError"));
    }
  }, [
    agentName,
    agentDescription,
    agentKind,
    addToast,
    effectiveAgentId,
    setCurrentVersion,
    setDraftSaving,
  ]);

  return { saveAgentDraft };
}
