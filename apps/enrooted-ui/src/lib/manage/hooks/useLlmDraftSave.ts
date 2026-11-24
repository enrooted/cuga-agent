// Ported from cuga-agent/src/frontend_workspaces/frontend/src/manage/hooks/useLlmDraftSave.ts (Copyright IBM Corp., Apache-2.0). Logic unchanged.
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import i18n from "@/i18n";
import * as api from "@/lib/manage/api";
import { isAbortError, type AddToast } from "./saveHelpers";

export function useLlmDraftSave(opts: {
  llmConfigRef: MutableRefObject<unknown>;
  effectiveAgentId: string | undefined;
  addToast: AddToast;
  setDraftSaving: (v: boolean) => void;
  setCurrentVersion: (v: number | "draft" | null) => void;
}) {
  const { llmConfigRef, effectiveAgentId, addToast, setDraftSaving, setCurrentVersion } = opts;
  const llmAbortRef = useRef<AbortController | null>(null);
  const llmBlurSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      llmAbortRef.current?.abort();
      if (llmBlurSaveRef.current) clearTimeout(llmBlurSaveRef.current);
    };
  }, []);

  const saveLlmDraft = useCallback(async () => {
    setDraftSaving(true);
    llmAbortRef.current?.abort();
    const ac = new AbortController();
    llmAbortRef.current = ac;
    try {
      const res = await api.patchManageConfigDraftLlm(llmConfigRef.current, effectiveAgentId, ac.signal);
      if (ac.signal.aborted) return;
      setDraftSaving(false);
      if (res.ok) {
        setCurrentVersion("draft");
        addToast("success", i18n.t("manage:draft.savedTitle"), i18n.t("manage:draft.llmSaved"));
      } else {
        addToast("error", i18n.t("manage:draft.saveFailedTitle"), i18n.t("manage:draft.llmFailed", { status: res.status, statusText: res.statusText }));
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setDraftSaving(false);
      addToast("error", i18n.t("manage:draft.saveFailedTitle"), error instanceof Error ? error.message : i18n.t("manage:generic.networkError"));
    }
  }, [addToast, effectiveAgentId, llmConfigRef, setCurrentVersion, setDraftSaving]);

  const scheduleLlmDraftSave = useCallback(() => {
    if (llmBlurSaveRef.current) clearTimeout(llmBlurSaveRef.current);
    llmBlurSaveRef.current = setTimeout(() => {
      llmBlurSaveRef.current = null;
      saveLlmDraft();
    }, 100);
  }, [saveLlmDraft]);

  return { saveLlmDraft, scheduleLlmDraftSave };
}
