// Ported from cuga-agent/src/frontend_workspaces/frontend/src/manage/hooks/useKnowledgeDraftSave.ts (Copyright IBM Corp., Apache-2.0). Logic unchanged.
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import i18n from "@/i18n";
import * as api from "@/lib/manage/api";
import { isAbortError, type AddToast } from "./saveHelpers";

export type DraftSaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saving-slow" }
  | { kind: "saved" }
  | { kind: "failed"; error: string };

export interface AdaptationServerErrorShape {
  error:
    | "length_exceeded"
    | "bidi_override"
    | "control_char"
    | "contract_override_phrase"
    | "type_error"
    | "null_byte";
  message: string;
  phrase?: string;
  pattern?: string;
  codepoint?: string;
  length?: number;
  max?: number;
}

export function useKnowledgeDraftSave(opts: {
  knowledgeConfig: unknown;
  effectiveAgentId: string | undefined;
  addToast: AddToast;
  skipDraftSaveRef: MutableRefObject<boolean>;
  forceImmediateSaveRef: MutableRefObject<boolean>;
  knowledgeReindexing: boolean;
  knowledgeSaveRetryRef: MutableRefObject<number>;
  knowledgeSaveRetryTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  knowledgeSaveRetryNonce: number;
  setKnowledgeSaveRetryNonce: (updater: (n: number) => number) => void;
  setCurrentVersion: (v: number | "draft" | null) => void;
  setAdaptationServerError: (v: AdaptationServerErrorShape | null) => void;
  setAutoReindexTrigger: (
    updater:
      | { taskIds: string[]; total: number; triggerKey: string }
      | null
      | ((
          prev: { taskIds: string[]; total: number; triggerKey: string } | null,
        ) => { taskIds: string[]; total: number; triggerKey: string } | null),
  ) => void;
  setKnowledgeSavedSnapshot: (v: unknown) => void;
  setKnowledgeDocCount: (v: number) => void;
}) {
  const {
    knowledgeConfig,
    effectiveAgentId,
    addToast,
    skipDraftSaveRef,
    forceImmediateSaveRef,
    knowledgeReindexing,
    knowledgeSaveRetryRef,
    knowledgeSaveRetryTimerRef,
    knowledgeSaveRetryNonce,
    setKnowledgeSaveRetryNonce,
    setCurrentVersion,
    setAdaptationServerError,
    setAutoReindexTrigger,
    setKnowledgeSavedSnapshot,
    setKnowledgeDocCount,
  } = opts;

  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>({ kind: "idle" });
  const [saveAttempt, setSaveAttempt] = useState(0);
  const knowledgeAbortRef = useRef<AbortController | null>(null);

  const isSavingFamily =
    draftSaveStatus.kind === "saving" || draftSaveStatus.kind === "saving-slow";

  useEffect(() => {
    setDraftSaveStatus({ kind: "idle" });
  }, [effectiveAgentId]);

  useEffect(() => {
    return () => {
      knowledgeAbortRef.current?.abort();
      if (knowledgeSaveRetryTimerRef.current) clearTimeout(knowledgeSaveRetryTimerRef.current);
    };
  }, [knowledgeSaveRetryTimerRef]);

  useEffect(() => {
    if (!isSavingFamily) return;
    const slow = setTimeout(() => {
      setDraftSaveStatus((prev) =>
        prev.kind === "saving" ? { kind: "saving-slow" } : prev,
      );
    }, 25_000);
    const fail = setTimeout(() => {
      knowledgeAbortRef.current?.abort();
      setDraftSaveStatus((prev) =>
        prev.kind === "saving" || prev.kind === "saving-slow"
          ? {
              kind: "failed",
              error: i18n.t("knowledge:draftSave.tooLong"),
            }
          : prev,
      );
    }, 90_000);
    return () => {
      clearTimeout(slow);
      clearTimeout(fail);
    };
  }, [isSavingFamily, saveAttempt]);

  useEffect(() => {
    if (skipDraftSaveRef.current) return;

    if (knowledgeReindexing) {
      knowledgeAbortRef.current?.abort();
      return;
    }

    knowledgeAbortRef.current?.abort();
    const ac = new AbortController();
    knowledgeAbortRef.current = ac;

    const debounceMs = forceImmediateSaveRef.current ? 0 : 800;
    forceImmediateSaveRef.current = false;

    const t = setTimeout(async () => {
      if (knowledgeAbortRef.current !== ac) return;
      setDraftSaveStatus({ kind: "saving" });
      setSaveAttempt((n) => n + 1);
      try {
        const res = await api.patchManageConfigDraftKnowledge(
          knowledgeConfig,
          effectiveAgentId,
          ac.signal,
        );
        if (ac.signal.aborted) return;
        if (res.ok) {
          setCurrentVersion("draft");
          setAdaptationServerError(null);
          knowledgeSaveRetryRef.current = 0;
          try {
            const body = await res.clone().json();
            if (ac.signal.aborted) return;
            setDraftSaveStatus({ kind: "saved" });
            // Adopt-existing-collection (backend): the applied embedder maps to
            // an already-built collection, so the engine points at it and it has
            // documents — show that count immediately (badge). But do NOT advance
            // the reindex snapshot here. Adopting a PREVIOUSLY-built collection
            // does not mean the user's CURRENT document set is indexed with this
            // embedder, so a draft autosave must NOT clear the "Re-index to apply
            // your changes" banner (it did, which is why it flashed then vanished
            // on an embedder change). The banner persists until an actual
            // Publish / Re-index rebuilds the current documents with the embedder.
            const _lc = body?.live_changes;
            if (_lc?.adopted_existing_collection && typeof _lc.active_document_count === "number") {
              setKnowledgeDocCount(_lc.active_document_count);
            }
            const collections = body?.auto_reindex?.collections ?? [];
            const taskIds: string[] = collections
              .flatMap((c: { result?: { task_ids?: string[] } }) => c?.result?.task_ids ?? [])
              .filter((id: string) => typeof id === "string" && id.length > 0);
            if (taskIds.length > 0) {
              const total = collections.reduce(
                (sum: number, c: { result?: { count?: number } }) => sum + (c?.result?.count ?? 0),
                0,
              );
              const triggerKey = taskIds.slice().sort().join("|");
              setAutoReindexTrigger((prev) =>
                prev?.triggerKey === triggerKey
                  ? prev
                  : { taskIds, total: total || taskIds.length, triggerKey },
              );
            }
          } catch {
            setDraftSaveStatus({ kind: "saved" });
          }
        } else if (res.status === 422) {
          if (ac.signal.aborted) return;
          try {
            const body = await res.json();
            if (ac.signal.aborted) return;
            const err = (body && (body.detail ?? body)) as Partial<AdaptationServerErrorShape> | null;
            if (err && typeof err.error === "string" && typeof err.message === "string") {
              setAdaptationServerError(err as AdaptationServerErrorShape);
            }
            setDraftSaveStatus({
              kind: "failed",
              error: (err && err.message) || i18n.t("knowledge:draftSave.couldntApply"),
            });
          } catch {
            setDraftSaveStatus({ kind: "failed", error: i18n.t("knowledge:draftSave.rejected") });
          }
        } else if (res.status === 409) {
          if (ac.signal.aborted) return;
          let detail: { error?: string; message?: string } | null = null;
          try {
            const body = await res.json();
            detail = (body && (body.detail ?? body)) as { error?: string; message?: string } | null;
          } catch {
            // 409 without a JSON body
          }
          if (ac.signal.aborted) return;

          if (detail?.error === "reindex_in_progress") {
            setDraftSaveStatus({ kind: "saving" });
            const MAX_REINDEX_SAVE_RETRIES = 20;
            if (knowledgeSaveRetryRef.current < MAX_REINDEX_SAVE_RETRIES) {
              knowledgeSaveRetryRef.current += 1;
              if (knowledgeSaveRetryTimerRef.current) clearTimeout(knowledgeSaveRetryTimerRef.current);
              knowledgeSaveRetryTimerRef.current = setTimeout(
                () => setKnowledgeSaveRetryNonce((n) => n + 1),
                3000,
              );
            } else {
              setDraftSaveStatus({
                kind: "failed",
                error: i18n.t("knowledge:draftSave.reindexRunning"),
              });
            }
            return;
          }

          setDraftSaveStatus({
            kind: "failed",
            error: i18n.t("knowledge:draftSave.conflict"),
          });
          addToast(
            "warning",
            i18n.t("knowledge:draftSave.conflictToastTitle"),
            i18n.t("knowledge:draftSave.conflictToastBody"),
          );
        } else {
          if (ac.signal.aborted) return;
          let detail = "";
          try {
            const body = await res.clone().text();
            detail = body ? body.slice(0, 200) : "";
          } catch {
            // ignore
          }
          console.error(`[useKnowledgeDraftSave] knowledge PATCH failed: ${res.status}`, detail);
          setDraftSaveStatus({
            kind: "failed",
            error: detail
              ? i18n.t("knowledge:draftSave.failedStatusDetail", { status: res.status, detail })
              : i18n.t("knowledge:draftSave.failedStatus", { status: res.status }),
          });
        }
      } catch (err) {
        if (isAbortError(err)) return;
        console.error("[useKnowledgeDraftSave] knowledge PATCH threw:", err);
        setDraftSaveStatus({
          kind: "failed",
          error: err instanceof Error ? err.message : i18n.t("knowledge:draftSave.checkConnection"),
        });
      }
    }, debounceMs);
    return () => {
      clearTimeout(t);
    };
  }, [
    knowledgeConfig,
    effectiveAgentId,
    knowledgeReindexing,
    knowledgeSaveRetryNonce,
    addToast,
    skipDraftSaveRef,
    forceImmediateSaveRef,
    knowledgeSaveRetryRef,
    knowledgeSaveRetryTimerRef,
    setKnowledgeSaveRetryNonce,
    setCurrentVersion,
    setAdaptationServerError,
    setAutoReindexTrigger,
    setKnowledgeSavedSnapshot,
    setKnowledgeDocCount,
  ]);

  return { draftSaveStatus, setDraftSaveStatus };
}
