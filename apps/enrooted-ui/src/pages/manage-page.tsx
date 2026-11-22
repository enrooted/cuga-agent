/*
 * /manage/:agentId: configure one agent and try the draft. Ported from
 * cuga-agent/src/frontend_workspaces/frontend/src/ManagePage.tsx
 * (Copyright IBM Corp., Apache-2.0). The state, loading, autosave and publish
 * logic is the original's, unchanged; only the view is new (shadcn/ui in the
 * enrooted glass design instead of Carbon).
 */
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/immutability, no-empty --
   ported logic kept verbatim so it stays comparable with upstream */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileJsonIcon,
  FileTextIcon,
  KeyRoundIcon,
  MessageSquareIcon,
  PackageIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  VariableIcon,
} from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatView } from "@/components/chat/chat-view";
import { Markdown } from "@/components/markdown";
import { CheckField, Hint, Notice, NumberField, Section, TextAreaField, TextField } from "@/components/manage/form";
import { ManageShell } from "@/components/manage/manage-shell";
import { PoliciesConfig } from "@/components/manage/policies/policies-config";
import { KnowledgePanel } from "@/components/manage/knowledge/knowledge-config";
import { ToolsConfig, type ConnectedApp, type ConnectedTool } from "@/components/manage/tools/tools-config";
import { SecretsManager } from "@/components/manage/tools/secrets-manager";
import { SandboxSettings } from "@/components/manage/tools/sandbox-settings";
import { VariablesSidebar } from "@/components/manage/tools/variables-sidebar";
import * as api from "@/lib/manage/api";
import { uuid, type AttachmentSnapshot } from "@/lib/chat-model";
import { normalizeTools as normalizeToolEntries, type ToolEntry } from "@/lib/manage/tools-types";
import type { KnowledgeConfigValues } from "@/lib/manage/knowledge-types";
import type { AgentItem } from "@/pages/manage-dashboard";
import { useLlmDraftSave } from "@/lib/manage/hooks/useLlmDraftSave";
import { useAgentDraftSave } from "@/lib/manage/hooks/useAgentDraftSave";
import { useSpecialInstructionsDraftSave } from "@/lib/manage/hooks/useSpecialInstructionsDraftSave";
import { useToolsDraftSave } from "@/lib/manage/hooks/useToolsDraftSave";
import { useKnowledgeDraftSave, type AdaptationServerErrorShape } from "@/lib/manage/hooks/useKnowledgeDraftSave";
import { useFullDraftSave } from "@/lib/manage/hooks/useFullDraftSave";
import { usePublishConfig } from "@/lib/manage/hooks/usePublishConfig";
import { isSecretRef, matchSecretRef, secretIdFromRef, storedRefMissingFromList } from "@/lib/manage/secret-ref-utils";
import { parseImportedSupervisorFields } from "@/lib/manage/parseImportedConfig";
import { isAbortError } from "@/lib/manage/hooks/saveHelpers";
import { cn } from "@/lib/utils";

export type { ToolEntry } from "@/lib/manage/tools-types";


export interface HomescreenConfig {
  isOn?: boolean;
  greeting?: string;
  starters?: string[];
}

export type SubAgentRef =
  | { kind: "internal"; ref: string }
  | {
      kind: "a2a";
      name: string;
      endpoint: string;
      auth?: { type: "bearer"; tokenEnvVar?: string };
      timeout?: number;
    };

function supervisorSaveSeqFromConfig(supervisor: unknown): number {
  if (!supervisor || typeof supervisor !== "object") return 0;
  const seq = (supervisor as { _saveSeq?: unknown })._saveSeq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
}

export type LlmJsonValue =
  | string
  | number
  | boolean
  | null
  | LlmJsonValue[]
  | { [key: string]: LlmJsonValue };

export interface AgentConfig {
  agent?: { name?: string; description?: string; kind?: "single" | "supervisor" };
  supervisor?: { subAgents?: SubAgentRef[]; planApproval?: boolean; _saveSeq?: number };
  llm?: {
    provider?: "groq" | "openai" | "litellm";
    api_key?: string;
    auth_type?: "api_key" | "auth_header";
    auth_header_name?: string;
    base_url?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    extra_params?: Record<string, LlmJsonValue>;
    disable_ssl?: boolean;
  };
  tools?: ToolEntry[];
  feature_flags?: {
    enable_todos?: boolean;
    reflection?: boolean;
    enable_filesystem_tools?: boolean;
    max_steps?: number;
    shortlisting_tool_threshold?: number;
    builtin_tools?: string[];
  };
  special_instructions?: string;
  policies?: { enablePolicies: boolean; policies: unknown[] };
  homescreen?: HomescreenConfig;
  // Knowledge config shape MUST stay in sync with ``KnowledgeConfigValues``
  // in agentic_chat/src/KnowledgeConfig.tsx — they describe the same wire
  // payload (the PATCH /api/manage/config/draft/knowledge body).
  // Drifts have caused silent field-drop bugs on version-load + profile-
  // pick (Sami C3): if a field is in KnowledgeConfigValues but missing
  // here, the version-history hydrator drops it on the floor and the
  // profile-onClick writes-without-type-error escape ``tsc -b``.
  knowledge?: KnowledgeConfigValues;
}

// Mirrors the dataclass defaults in src/cuga/backend/knowledge/config.py
// — SDK users constructing a bare ``KnowledgeConfig()`` get the same
// shape. Profile overrides (standard / balanced / max_quality) layer on
// top via the profile loader.
const DEFAULT_KNOWLEDGE_CONFIG: NonNullable<AgentConfig["knowledge"]> = {
  enabled: false,
  agent_level_enabled: true,
  session_level_enabled: true,
  citations_enabled: true,
  rag_profile: "standard",
  embedding_provider: "huggingface",
  embedding_model: "",
  embedding_api_key: "",
  embedding_base_url: "",
  embedding_extra_params: {},
  embedding_batch_size: 64,
  embedding_concurrency: 4,
  use_gpu: true,
  chunk_size: 1000,
  chunk_overlap: 200,
  metric_type: "COSINE",
  max_pending_tasks: 10,
  max_upload_size_mb: 100,
  max_url_download_size_mb: 50,
  max_files_per_request: 10,
  max_chunks_per_document: 10000,
  vector_insert_batch_size: 200,
  max_ingest_workers: 2,
  docling_pdf_mode: "accurate",
  docling_layout_engine: "auto",
  docling_drop_page_chrome: "dry_run",
  rerank_enabled: false,
  rerank_top_k_in: 20,
  rerank_model: "BAAI/bge-reranker-base",
  search_hybrid_mode: "auto",
  search_junk_filter: "enforce",
  search_query_transform: "off",
  max_search_attempts: 3,
  default_limit: 10,
  default_score_threshold: 0.0,
  client_adaptation_text: "",
  client_adaptation_glossary: [],
};

// "Effective index equivalence" for the Re-index banner. Two configs are
// equivalent for the vector index when every field contributing to the
// engine's ``vector_config_hash`` resolves to the same effective value:
//
//   - embedding_provider, embedding_model, chunk_size, chunk_overlap, metric_type
//
// Special case: ``embedding_model = ""`` is the Provider Select's reset
// value, meaning "use this provider's default". On the SAME provider the
// engine resolves it to the same default the saved snapshot already
// captured — so empty current model = match. Without this normalisation,
// reverting via the Select keeps the Re-index banner stuck up forever.
//
// Other fields (numeric chunking, enum metric_type) never produce empty
// values via the UI today; if a future UI surface introduces one, add
// the same empty-means-default branch here. One place to extend.
function isIndexConfigEquivalent(
  current: NonNullable<AgentConfig["knowledge"]>,
  saved: NonNullable<AgentConfig["knowledge"]>,
): boolean {
  if (current.embedding_provider !== saved.embedding_provider) return false;
  // Empty current model = "use provider default". Treat as a match ONLY when
  // saved is also empty; if saved pinned a specific model, clearing it IS a
  // change (review) — the prior rule returned equivalent for empty-vs-anything
  // and silently hid the re-index banner + Live divergence.
  if (current.embedding_model) {
    if (current.embedding_model !== saved.embedding_model) return false;
  } else if (saved.embedding_model) {
    return false;
  }
  if (current.chunk_size !== saved.chunk_size) return false;
  if (current.chunk_overlap !== saved.chunk_overlap) return false;
  if (current.metric_type !== saved.metric_type) return false;
  return true;
}

// True when the draft's index config differs from the PUBLISHED (live) config.
// Reuses isIndexConfigEquivalent so the "Live" pill and the profile "Modified"
// tag share ONE definition of a meaningful change (they must never disagree).
// null live = baseline not loaded yet = not diverged (don't flag before we
// know what's actually serving).
function isDivergedFromLive(
  current: NonNullable<AgentConfig["knowledge"]>,
  live: { provider: string; model: string; chunk_size?: number; chunk_overlap?: number; metric_type?: string } | null,
): boolean {
  if (!live) return false;
  return !isIndexConfigEquivalent(current, {
    ...DEFAULT_KNOWLEDGE_CONFIG,
    embedding_provider: live.provider,
    embedding_model: live.model,
    chunk_size: live.chunk_size ?? DEFAULT_KNOWLEDGE_CONFIG.chunk_size,
    chunk_overlap: live.chunk_overlap ?? DEFAULT_KNOWLEDGE_CONFIG.chunk_overlap,
    metric_type: live.metric_type ?? DEFAULT_KNOWLEDGE_CONFIG.metric_type,
  });
}

// Providers whose model runs from local files (ONNX / torch weights on disk).
// They have no API key and no endpoint, so "check its API key / connection"
// is advice the user literally cannot act on — the real cause is missing or
// half-downloaded model files, which CUGA now re-fetches by itself.
const LOCAL_EMBEDDING_PROVIDERS = new Set(["fastembed", "huggingface"]);

// ``embedder_model`` arrives as "<provider>/<model>" (e.g.
// "fastembed/BAAI/bge-small-en-v1.5"), so the provider is the first segment.
function isLocalEmbeddingProvider(embedderModel: string): boolean {
  return LOCAL_EMBEDDING_PROVIDERS.has((embedderModel || "").split("/")[0].trim().toLowerCase());
}

const DEFAULT_HOMESCREEN: HomescreenConfig = {
  isOn: true,
  greeting: "Hello, how can I help you today?",
  starters: ["Hi, what can you do for me?"],
};

export interface ConfigVersion {
  version: number;
  created_at: string;
}

const LLM_PROVIDERS = [
  { id: "groq", label: "Groq", defaultModel: "llama-3.3-70b-versatile", defaultBase: "" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o", defaultBase: "" },
  { id: "litellm", label: "LiteLLM", defaultModel: "", defaultBase: "http://localhost:4000" },
] as const;

const DEFAULT_CONFIG: AgentConfig = {
  llm: {
    provider: "openai",
    api_key: "",
    auth_type: "api_key",
    auth_header_name: "Authorization",
    base_url: "",
    model: "",
    temperature: 0.1,
    disable_ssl: false,
  },
  tools: [],
  feature_flags: { enable_todos: false, reflection: false, max_steps: 70, shortlisting_tool_threshold: 35 },
  homescreen: { ...DEFAULT_HOMESCREEN },
};

const TEXT_EXTENSIONS = [".txt", ".md", ".json", ".csv", ".html", ".xml", ".yaml", ".yml", ".py"];

const POLICY_TYPE_LABELS: Record<string, string> = {
  intent_guard: "Intent guards",
  playbook: "Playbooks",
  tool_guide: "Tool guides",
  tool_approval: "Tool approval",
  output_formatter: "Output formatters",
};

function policiesSummary(policies: unknown[]): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  for (const p of policies) {
    const t = (p as { policy_type?: string }).policy_type ?? "other";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return { total: policies.length, byType };
}

function maskSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(maskSecrets);
  if (typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    const isAuth = "type" in o && typeof o.type === "string";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lower = k.toLowerCase();
      const isSensitiveField =
        lower === "api_key" ||
        (isAuth && (lower === "value" || lower === "key"));
      const shouldMask = isSensitiveField && typeof v === "string" && v.length > 0 && !isSecretRef(v);
      out[k] = shouldMask ? "••••••••" : maskSecrets(v);
    }
    return out;
  }
  return obj;
}


function AddA2AAgentDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (entry: Extract<SubAgentRef, { kind: "a2a" }>) => void;
}) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [tokenEnvVar, setTokenEnvVar] = useState("");
  const [timeout, setTimeoutVal] = useState(30);

  const canAdd = name.trim() !== "" && endpoint.trim() !== "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add A2A agent</DialogTitle>
          <DialogDescription className="sr-only">An external agent reached over the A2A protocol</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <TextField id="a2a-name" label="Name" helper="Identifier for the A2A agent" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. research-agent" />
          <TextField id="a2a-endpoint" label="Endpoint URL" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="e.g. http://localhost:8080" />
          <TextField
            id="a2a-token-env-var"
            label="Auth token env var (optional)"
            helper="Name of an environment variable holding a bearer token — not the token itself"
            value={tokenEnvVar}
            onChange={(e) => setTokenEnvVar(e.target.value)}
            placeholder="e.g. RESEARCH_AGENT_TOKEN"
          />
          <NumberField id="a2a-timeout" label="Timeout (seconds)" value={timeout} min={1} onValue={(v) => setTimeoutVal(Number(v) || 30)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canAdd}
            onClick={() =>
              onAdd({
                kind: "a2a",
                name: name.trim(),
                endpoint: endpoint.trim(),
                auth: tokenEnvVar.trim() ? { type: "bearer", tokenEnvVar: tokenEnvVar.trim() } : undefined,
                timeout,
              })
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ManagePage() {
  const { agentId } = useParams<{ agentId: string }>();
  const effectiveAgentId = agentId ?? "cuga-default";
  const [llmConfig, setLlmConfig] = useState<NonNullable<AgentConfig["llm"]>>(DEFAULT_CONFIG.llm!);
  const [llmExtraParamsDraft, setLlmExtraParamsDraft] = useState<string | null>(null);
  const [llmExtraParamsError, setLlmExtraParamsError] = useState<string | null>(null);
  const [tools, setToolsState] = useState<ToolEntry[]>(DEFAULT_CONFIG.tools ?? []);
  const [featureFlags, setFeatureFlags] = useState(DEFAULT_CONFIG.feature_flags!);
  const [homescreen, setHomescreen] = useState<HomescreenConfig>(DEFAULT_CONFIG.homescreen ?? DEFAULT_HOMESCREEN);
  const [policies, setPolicies] = useState<NonNullable<AgentConfig["policies"]>>(DEFAULT_CONFIG.policies ?? { enablePolicies: true, policies: [] });
  const [history, setHistory] = useState<ConfigVersion[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  // Code Sandbox section — shown only when the deployment provides a sandbox (the binding is mounted).
  const [sandboxOn, setSandboxOn] = useState(false);
  useEffect(() => {
    api
      .getSandboxSettings()
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { available?: boolean } | null) => setSandboxOn(!!s?.available))
      .catch(() => {});
  }, []);
  // Live-config truth anchor. Sourced from GET /api/manage/config
  // (published=true) on mount and after every successful Publish — never
  // from optimistic client state. The pill in the header reads this so
  // the user ALWAYS knows what's actually serving production traffic,
  // independent of what the draft has been edited to. The 6-expert
  // synthesis identified this as the most important addition: without
  // it, no UI surface answers "what is actually running right now?"
  // without log-reading.
  const [liveKnowledge, setLiveKnowledge] = useState<
    {
      provider: string;
      model: string;
      version: number | null;
      // Published chunking/metric — so the Live pill's diverged check compares
      // draft against the ACTUAL published values, not against itself.
      chunk_size?: number;
      chunk_overlap?: number;
      metric_type?: string;
    } | null
  >(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPoliciesModal, setShowPoliciesModal] = useState(false);
  const [viewVersion, setViewVersion] = useState<{ version: number; config: AgentConfig } | null>(null);
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [connectedTools, setConnectedTools] = useState<ConnectedTool[]>([]);
  const [importStatus, setImportStatus] = useState<"idle" | "ok" | "error">("idle");
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manageVariables, setManageVariables] = useState<Record<string, any>>({});
  const [manageVariablesHistory, setManageVariablesHistory] = useState<Array<{ id: string; title: string; timestamp: number; variables: Record<string, any> }>>([]);
  const [manageSelectedAnswerId, setManageSelectedAnswerId] = useState<string | null>(null);
  const [manageVariablesPanelOpen, setManageVariablesPanelOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<number | "draft" | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [agentContext, setAgentContext] = useState<{
    agent_id: string;
    config_version: number | null;
    skills_enabled?: boolean;
    workspace_filesystem_root?: string;
    knowledge_enabled?: boolean;
    agent_level_knowledge_enabled?: boolean;
    session_level_knowledge_enabled?: boolean;
  } | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentKind, setAgentKind] = useState<"single" | "supervisor">("single");
  const [agentRegistry, setAgentRegistry] = useState(false);
  const [subAgents, setSubAgents] = useState<SubAgentRef[]>([]);
  const [planApproval, setPlanApproval] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AgentItem[]>([]);
  const [showAddA2AModal, setShowAddA2AModal] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [secretsModalOpen, setSecretsModalOpen] = useState(false);
  const [skills, setSkills] = useState<Array<{ name: string; description: string; requirements: string[]; source: string }>>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [knowledgeHealthy, setKnowledgeHealthy] = useState<boolean | null>(null);
  const [knowledgeHealthStatus, setKnowledgeHealthStatus] = useState<string>("unknown");
  const [knowledgeDocCount, setKnowledgeDocCount] = useState(0);
  const [knowledgeDocsVersion, setKnowledgeDocsVersion] = useState(0);
  const [knowledgeConfig, setKnowledgeConfig] = useState<NonNullable<AgentConfig["knowledge"]>>({ ...DEFAULT_KNOWLEDGE_CONFIG });
  const [knowledgeSavedSnapshot, setKnowledgeSavedSnapshot] = useState<AgentConfig["knowledge"] | null>(null);
  const [knowledgeReindexNeeded, setKnowledgeReindexNeeded] = useState(false);
  const [knowledgeReindexing, setKnowledgeReindexing] = useState(false);
  // Self-healing autosave retry for the reindex_in_progress 409. When a
  // vector-affecting PATCH lands while a reindex the FE never armed is in
  // flight (engine-triggered boot/config-drift reindex, or another client's),
  // we can't rely on the child panel's onReindexFinished to release a
  // suppression flag — that callback only fires for reindexes the FE armed,
  // so a flag-based hold would wedge "saving" until a hard refresh. Instead
  // we re-attempt the PATCH on a bounded timer; it succeeds the instant the
  // reindex clears (Layer 2 stops raising). Nonce drives the effect re-run.
  const knowledgeSaveRetryRef = useRef(0);
  const knowledgeSaveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [knowledgeSaveRetryNonce, setKnowledgeSaveRetryNonce] = useState(0);
  // When a knowledge draft PATCH triggers an auto-reindex on the server
  // (e.g. user picks a new profile and the embedding-dim changes), the
  // response carries task_ids in ``auto_reindex.collections[*].result``.
  // We bubble them down to KnowledgePanel so its reindex tile arms
  // automatically — without this prop the user has to click "Reindex"
  // manually to see ANY progress for a server-side migration they
  // didn't explicitly trigger. ``triggerKey`` is the task-IDs join so a
  // re-render with the same payload doesn't re-arm twice.
  const [autoReindexTrigger, setAutoReindexTrigger] = useState<{
    taskIds: string[];
    total: number;
    triggerKey: string;
  } | null>(null);
  // Adaptation 422 wiring (Sami #60): the autosave PATCH below may return
  // a 422 with the structured ClientAdaptationError.to_dict() body. We
  // surface it into the panel via the controlled-state contract so the
  // operator sees what they need to fix instead of a silent no-save.
  // Cleared on the next successful save.
  const [adaptationServerError, setAdaptationServerError] = useState<AdaptationServerErrorShape | null>(null);
  const [knowledgeStale, setKnowledgeStale] = useState(false);
  // Live availability of the active embedder (from /health). null = unknown
  // (don't alarm); false = unreachable → the indexed docs can't be searched.
  const [knowledgeEmbedderAvailable, setKnowledgeEmbedderAvailable] = useState<boolean | null>(null);
  const [knowledgeEmbedderModel, setKnowledgeEmbedderModel] = useState<string>("");
  // "disabled" | "preparing" | "available" | "unavailable". "preparing" means a
  // cold start is still downloading the model — that must not render as an error.
  const [knowledgeEmbedderState, setKnowledgeEmbedderState] = useState<string | null>(null);
  // The scrubbed reason from the backend. It was already on the wire and simply
  // discarded, which is why the UI could only offer a generic guess.
  const [knowledgeEmbedderError, setKnowledgeEmbedderError] = useState<string>("");
  const [knowledgeReindexDeferred, setKnowledgeReindexDeferred] = useState(false);
  const [ragProfiles, setRagProfiles] = useState<Record<string, any>>({});
  const [knowledgePreviewModal, setKnowledgePreviewModal] = useState<{
    attachment: AttachmentSnapshot;
    content?: string;
    downloadUrl: string;
    isPdf: boolean;
  } | null>(null);
  const [llmUseSavedSecret, setLlmUseSavedSecret] = useState(false);
  const [llmSecretsList, setLlmSecretsList] = useState<{ id: string; description?: string; ref: string }[]>([]);
  const [llmForceEnv, setLlmForceEnv] = useState(false);
  const [llmSecretsMode, setLlmSecretsMode] = useState<string>("local");
  const [llmInlineCreate, setLlmInlineCreate] = useState(false);
  const [llmInlineCreateValue, setLlmInlineCreateValue] = useState("");
  const [llmInlineCreateKey, setLlmInlineCreateKey] = useState("");
  const [llmModelsLoading, setLlmModelsLoading] = useState(false);
  const [llmModelsError, setLlmModelsError] = useState<string | null>(null);
  const [llmModelsList, setLlmModelsList] = useState<string[]>([]);
  const skipDraftSaveRef = useRef(true);
  // Preset clicks (env-presets "Use" button) bypass the 800ms autosave
  // debounce — the debounce coalesces keystrokes, but a deliberate
  // button click should feel instant. Set true in onPresetApplied,
  // consumed + reset in the knowledge autosave hook on next run.
  const forceImmediateSaveRef = useRef<boolean>(false);
  const llmConfigRef = useRef(llmConfig);
  llmConfigRef.current = llmConfig;
  const supervisorAbortRef = useRef<AbortController | null>(null);
  const supervisorSaveSeqRef = useRef(0);
  const loadLatestGenRef = useRef(0);
  const effectiveAgentIdRef = useRef(effectiveAgentId);
  effectiveAgentIdRef.current = effectiveAgentId;

  useEffect(() => {
    api.getAgentContext()
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data) =>
          data &&
          setAgentContext({
            agent_id: data.agent_id ?? "cuga-default",
            config_version: data.config_version ?? null,
            skills_enabled: Boolean(data.skills_enabled),
            workspace_filesystem_root:
              typeof data.workspace_filesystem_root === "string"
                ? data.workspace_filesystem_root
                : undefined,
            knowledge_enabled: Boolean(data.knowledge_enabled),
            agent_level_knowledge_enabled: Boolean(data.agent_level_knowledge_enabled),
            session_level_knowledge_enabled: Boolean(data.session_level_knowledge_enabled),
          })
      )
      .catch(() => {});
  }, []);

  const handleManageVariablesUpdate = useCallback((variables: Record<string, any>, history: Array<any>) => {
    setManageVariables(variables);
    setManageVariablesHistory(
      (history ?? []).map((h: any) => ({
        id: h.id ?? String(h.timestamp ?? Math.random()),
        title: h.title ?? "Turn",
        timestamp: h.timestamp ?? 0,
        variables: h.variables ?? {},
      }))
    );
    if (history?.length && !manageSelectedAnswerId) setManageSelectedAnswerId(history[0]?.id ?? null);
  }, [manageSelectedAnswerId]);

  // Same normalisation as upstream; it now lives with the tool types.
  const normalizeTools = useCallback((raw: unknown[]): ToolEntry[] => normalizeToolEntries(raw), []);

  // Carbon rendered its own toast stack from state; here sonner does it.
  const addToast = useCallback((kind: "error" | "info" | "success" | "warning", title: string, subtitle: string) => {
    toast[kind](title, { description: subtitle, duration: 5000 });
  }, []);

  const refreshKnowledgeDocCount = useCallback(async () => {
    try {
      const response = await api.listKnowledgeDocuments();
      if (!response.ok) {
        return;
      }
      const data = await response.json().catch(() => ({}));
      setKnowledgeDocCount(data.documents?.length ?? 0);
    } catch {
      // Count refresh is best-effort; keep existing count on transient failures.
    }
  }, []);

  const handleKnowledgeDocsChanged = useCallback((count?: number) => {
    if (typeof count === "number") {
      setKnowledgeDocCount(count);
    } else {
      void refreshKnowledgeDocCount();
    }
    setKnowledgeDocsVersion((current) => current + 1);
  }, [refreshKnowledgeDocCount]);

  const closeKnowledgePreviewModal = useCallback(() => {
    setKnowledgePreviewModal((current) => {
      if (current?.downloadUrl) {
        URL.revokeObjectURL(current.downloadUrl);
      }
      return null;
    });
  }, []);

  const handlePreviewKnowledgeAttachment = useCallback(async (attachment: AttachmentSnapshot) => {
    try {
      const response = await api.getKnowledgeDocumentFile(
        attachment.scope,
        attachment.knowledge_filename,
      );
      if (!response.ok) {
        addToast("error", "Preview unavailable", response.statusText || "Failed to load attachment.");
        return;
      }

      const blob = await response.blob();
      const lowerName = attachment.display_name.toLowerCase();
      const downloadUrl = URL.createObjectURL(blob);

      if (lowerName.endsWith(".pdf")) {
        setKnowledgePreviewModal({
          attachment,
          downloadUrl,
          isPdf: true,
        });
        return;
      }

      const isTextFile = TEXT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
      if (isTextFile) {
        const content = await blob.text();
        setKnowledgePreviewModal({
          attachment,
          content,
          downloadUrl,
          isPdf: false,
        });
        return;
      }

      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = attachment.display_name;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      addToast("error", "Preview unavailable", error instanceof Error ? error.message : "Unknown error");
    }
  }, [addToast]);

  const loadLatest = useCallback(async () => {
    setConfigLoading(true);
    setLoadError(null);
    const agentId = effectiveAgentId;
    const gen = ++loadLatestGenRef.current;
    const isStale = () => gen !== loadLatestGenRef.current || agentId !== effectiveAgentIdRef.current;
    try {
      skipDraftSaveRef.current = true;
      const [draftRes, toolsListRes] = await Promise.all([
        api.getManageConfig(true, agentId),
        api.getToolsList(true, agentId),
      ]);
      if (isStale()) return;

      // Check for HTTP errors
      if (!draftRes.ok && draftRes.status >= 400) {
        const errorMsg = `Failed to load draft config (${draftRes.status} ${draftRes.statusText})`;
        addToast("error", "Load Error", errorMsg);
      }
      if (!toolsListRes.ok && toolsListRes.status >= 400) {
        const errorMsg = `Failed to load tools list (${toolsListRes.status} ${toolsListRes.statusText})`;
        addToast("warning", "Load Warning", errorMsg);
      }

      const out = { ...DEFAULT_CONFIG };
      let version: number | "draft" | null = null;
      if (draftRes.ok) {
        const data = await draftRes.json();
        if (isStale()) return;
        if (data.version === "draft" || (data.config && Object.keys(data.config).length > 0)) {
          if (data.config) {
            Object.assign(out, data.config);
            if (Array.isArray(out.tools)) {
              out.tools = normalizeTools(out.tools);
            }
            if (out.policies !== undefined && out.policies && typeof out.policies === "object") {
              if (!out.policies.enablePolicies && out.policies.enablePolicies !== false) {
                out.policies.enablePolicies = true;
              }
              if (!Array.isArray(out.policies.policies)) {
                out.policies.policies = [];
              }
            }
            if (data.config.homescreen) {
              const hs = data.config.homescreen;
              out.homescreen = {
                isOn: hs.isOn ?? DEFAULT_HOMESCREEN.isOn,
                greeting: hs.greeting ?? DEFAULT_HOMESCREEN.greeting,
                starters: Array.isArray(hs.starters)
                  ? hs.starters.slice(0, 4).filter((s: unknown): s is string => typeof s === "string")
                  : DEFAULT_HOMESCREEN.starters ?? [],
              };
            }
            if (data.config.agent && typeof data.config.agent === "object") {
              const ag = data.config.agent as { name?: string; description?: string };
              setAgentName(ag.name ?? "");
              setAgentDescription(ag.description ?? "");
            }
            if (data.config.feature_flags && typeof data.config.feature_flags === "object") {
              out.feature_flags = { ...DEFAULT_CONFIG.feature_flags!, ...data.config.feature_flags };
            }
          }
          version = data.version === "draft" ? "draft" : (data.version ?? null);
        }
      }
      if (version === null) {
        const publishedRes = await api.getManageConfig(false, agentId);
        if (isStale()) return;
        if (publishedRes.ok) {
          const data = await publishedRes.json();
          if (isStale()) return;
          // Stamp the Live truth anchor from the PUBLISHED knowledge config.
          // Independent of whatever the draft is — this is the pill the
          // header always reads. Refreshed after every successful Publish
          // via the same endpoint, never updated optimistically.
          const liveKn = data?.config?.knowledge;
          if (liveKn && typeof liveKn === "object") {
            setLiveKnowledge({
              provider: typeof liveKn.embedding_provider === "string" ? liveKn.embedding_provider : "fastembed",
              model: typeof liveKn.embedding_model === "string" ? liveKn.embedding_model : "",
              version: typeof data.version === "number" ? data.version : null,
              chunk_size: typeof liveKn.chunk_size === "number" ? liveKn.chunk_size : undefined,
              chunk_overlap: typeof liveKn.chunk_overlap === "number" ? liveKn.chunk_overlap : undefined,
              metric_type: typeof liveKn.metric_type === "string" ? liveKn.metric_type : undefined,
            });
          }
          if (data.config && Object.keys(data.config).length > 0) {
            Object.assign(out, data.config);
            if (Array.isArray(out.tools)) {
              out.tools = normalizeTools(out.tools);
            }
            if (out.policies !== undefined && out.policies && typeof out.policies === "object") {
              if (!out.policies.enablePolicies && out.policies.enablePolicies !== false) {
                out.policies.enablePolicies = true;
              }
              if (!Array.isArray(out.policies.policies)) {
                out.policies.policies = [];
              }
            }
            if (data.config.homescreen) {
              const hs = data.config.homescreen;
              out.homescreen = {
                isOn: hs.isOn ?? DEFAULT_HOMESCREEN.isOn,
                greeting: hs.greeting ?? DEFAULT_HOMESCREEN.greeting,
                starters: Array.isArray(hs.starters)
                  ? hs.starters.slice(0, 4).filter((s: unknown): s is string => typeof s === "string")
                  : DEFAULT_HOMESCREEN.starters ?? [],
              };
            }
            if (data.config.agent && typeof data.config.agent === "object") {
              const ag = data.config.agent as { name?: string; description?: string };
              setAgentName(ag.name ?? "");
              setAgentDescription(ag.description ?? "");
            }
            if (data.config.feature_flags && typeof data.config.feature_flags === "object") {
              out.feature_flags = { ...DEFAULT_CONFIG.feature_flags!, ...data.config.feature_flags };
            }
          }
          version = typeof data.version === "number" ? data.version : null;
        } else if (publishedRes.status >= 400) {
          const errorMsg = `Failed to load published config (${publishedRes.status} ${publishedRes.statusText})`;
          addToast("error", "Load Error", errorMsg);
        }
      }
      if (isStale()) return;
      if (toolsListRes.ok) {
        const toolsData = await toolsListRes.json();
        if (isStale()) return;
        setConnectedApps(toolsData.apps ?? []);
        setConnectedTools(
          (toolsData.tools ?? []).map((t: ConnectedTool & { id?: string }) => ({
            ...t,
            id: t.id ?? t.name,
          }))
        );
      } else {
        setConnectedApps([]);
        setConnectedTools([]);
      }
      if (isStale()) return;
      replaceLlmConfig(out.llm ?? DEFAULT_CONFIG.llm!);
      setToolsState(Array.isArray(out.tools) ? out.tools : []);
      setFeatureFlags(out.feature_flags ?? DEFAULT_CONFIG.feature_flags!);
      setHomescreen(out.homescreen ?? DEFAULT_HOMESCREEN);
      setSpecialInstructions(out.special_instructions ?? "");
      setPolicies(out.policies ?? { enablePolicies: true, policies: [] });
      setAgentKind(out.agent?.kind === "supervisor" ? "supervisor" : "single");
      setSubAgents(Array.isArray(out.supervisor?.subAgents) ? out.supervisor!.subAgents! : []);
      setPlanApproval(out.supervisor?.planApproval ?? false);
      supervisorSaveSeqRef.current = supervisorSaveSeqFromConfig(out.supervisor);
      if (out.knowledge) {
        setKnowledgeConfig({ ...DEFAULT_KNOWLEDGE_CONFIG, ...out.knowledge });
        setKnowledgeSavedSnapshot(out.knowledge);
      } else {
        // Fallback: load from knowledge engine
        api.getKnowledgeSettings()
          .then((res) => (res.ok ? res.json() : null))
          .then((sData) => {
            if (isStale() || !sData?.knowledge) return;
            setKnowledgeConfig((prev) => ({ ...prev, ...sData.knowledge }));
            setKnowledgeSavedSnapshot(sData.knowledge);
          })
          .catch(() => {});
      }
      setCurrentVersion(version);
      setLoadError(null);
      setTimeout(() => {
        if (!isStale()) skipDraftSaveRef.current = false;
      }, 0);
    } catch (e) {
      if (isStale()) return;
      const errorMsg = e instanceof Error ? e.message : "Failed to load config";
      setLoadError(errorMsg);
      addToast("error", "Load Error", errorMsg);
      skipDraftSaveRef.current = false;
    } finally {
      if (!isStale()) setConfigLoading(false);
    }
  }, [normalizeTools, addToast, effectiveAgentId]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.getManageConfigHistory(effectiveAgentId);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.versions || []);
      }
    } catch {
      setHistory([]);
    }
  }, [effectiveAgentId]);

  const refreshSecrets = useCallback(async () => {
    try {
      const [secretsRes, configRes] = await Promise.all([
        api.getSecrets(effectiveAgentId),
        api.getSecretsConfig(),
      ]);
      let mode = "local";
      if (configRes.ok) {
        const cfg = await configRes.json();
        setLlmForceEnv(!!cfg.force_env);
        mode = cfg.mode || "local";
      }
      setLlmSecretsMode(mode);
      if (secretsRes.ok) {
        const data = await secretsRes.json();
        const raw: { id: string; description?: string; source?: string }[] = data.secrets || data.overrides || [];
        setLlmSecretsList(raw.map((s) => ({
          id: s.id,
          description: s.description,
          ref: s.source === "vault" || mode === "vault"
            ? `vault://secret/${s.id}#value`
            : s.source === "env"
              ? `env://${s.id}`
              : s.source === "aws"
                ? `aws://${s.id}`
                : `db://${s.id}`,
        })));
      }
    } catch {}
  }, [effectiveAgentId]);

  useEffect(() => {
    refreshSecrets();
  }, [refreshSecrets]);

  useEffect(() => {
    setLlmUseSavedSecret(isSecretRef(llmConfig?.api_key ?? ""));
  }, [llmConfig?.api_key]);

  useEffect(() => {
    loadLatest();
    loadHistory();
  }, [loadLatest, loadHistory]);

  useEffect(() => {
    if (agentContext === null) return;
    if (!agentContext.skills_enabled) {
      setSkills([]);
      setSkillsLoading(false);
      return;
    }
    setSkillsLoading(true);
    api.getSkills()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setSkills(data.skills ?? []))
      .catch(() => {})
      .finally(() => setSkillsLoading(false));
  }, [agentContext]);

  useEffect(() => {
    if (!(knowledgeConfig.enabled ?? true) || !(knowledgeConfig.agent_level_enabled ?? true)) {
      setKnowledgeDocCount(0);
    }
  }, [knowledgeConfig.agent_level_enabled, knowledgeConfig.enabled]);

  const refreshKnowledgeHealth = useCallback(async () => {
    try {
      const res = await api.getKnowledgeHealth();
      const data = res.ok ? await res.json() : null;
      if (!data) {
        setKnowledgeHealthy(false);
        setKnowledgeHealthStatus("failed");
        return null;
      }
      setKnowledgeHealthy(data.healthy ?? false);
      setKnowledgeHealthStatus(data.status ?? (data.healthy ? "ready" : "unknown"));
      setKnowledgeStale(data.stale ?? false);
      setKnowledgeReindexDeferred(data.reindex_deferred ?? false);
      setKnowledgeEmbedderAvailable(
        typeof data.embedder_available === "boolean" ? data.embedder_available : null,
      );
      setKnowledgeEmbedderModel(data.embedder_model ?? "");
      setKnowledgeEmbedderState(typeof data.embedder_state === "string" ? data.embedder_state : null);
      setKnowledgeEmbedderError(data.embedder_error ?? "");
      return data;
    } catch {
      setKnowledgeHealthy(false);
      setKnowledgeHealthStatus("failed");
      return null;
    }
  }, []);

  useEffect(() => {
    api.setKnowledgeAgentId(effectiveAgentId || "cuga-default");

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleHealthRefresh = async (attempt = 0) => {
      const data = await refreshKnowledgeHealth();
      if (cancelled || !data) {
        return;
      }

      const stillStarting = data.enabled !== false && !data.healthy && data.status === "starting";
      if (stillStarting && attempt < 20) {
        retryTimer = setTimeout(() => {
          void scheduleHealthRefresh(attempt + 1);
        }, 1500);
      }
    };

    void scheduleHealthRefresh();

    api.listKnowledgeDocuments()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !cancelled) {
          setKnowledgeDocCount(data.documents?.length ?? 0);
        }
      })
      .catch(() => {});

    api.getKnowledgeSettings()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.rag_profiles && !cancelled) {
          setRagProfiles(data.rag_profiles);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [effectiveAgentId, refreshKnowledgeHealth]);

  const assembleConfig = useCallback(
    (overrides?: Partial<AgentConfig>): AgentConfig => {
      const c: AgentConfig = {
        agent: { name: agentName, description: agentDescription || undefined, kind: agentKind },
        supervisor: agentKind === "supervisor" ? { subAgents, planApproval, _saveSeq: supervisorSaveSeqRef.current } : undefined,
        // Preserve a model imported for a supervisor, while omitting the empty
        // editor placeholder so environment defaults still apply.
        llm: agentKind === "supervisor" && !llmConfig.model?.trim() ? undefined : llmConfig,
        tools: tools,
        feature_flags: featureFlags,
        homescreen,
        special_instructions: specialInstructions,
        policies,
        knowledge: knowledgeConfig,
      };
      return overrides ? { ...c, ...overrides } : c;
    },
    [agentName, agentDescription, agentKind, subAgents, planApproval, llmConfig, tools, featureFlags, homescreen, specialInstructions, policies, knowledgeConfig]
  );


  // The save hooks type this setter loosely. It must keep one identity across
  // renders: the knowledge autosave effect lists it as a dependency, and a new
  // function per render would re-send the knowledge draft on every render.
  const setKnowledgeSavedSnapshotLoose = useCallback(
    (v: unknown) => setKnowledgeSavedSnapshot(v as AgentConfig["knowledge"] | null),
    []
  );

  const { saveLlmDraft, scheduleLlmDraftSave } = useLlmDraftSave({
    llmConfigRef,
    effectiveAgentId,
    addToast,
    setDraftSaving,
    setCurrentVersion,
  });

  const { saveAgentDraft } = useAgentDraftSave({
    agentName,
    agentDescription,
    agentKind,
    effectiveAgentId,
    addToast,
    setDraftSaving,
    setCurrentVersion,
  });

  const { saveSpecialInstructionsDraft, scheduleSpecialInstructionsDraftSave } = useSpecialInstructionsDraftSave({
    effectiveAgentId,
    addToast,
    setDraftSaving,
    setCurrentVersion,
  });

  useToolsDraftSave({
    tools,
    effectiveAgentId,
    addToast,
    skipDraftSaveRef,
    setDraftSaving,
    setCurrentVersion,
  });

  const { draftSaveStatus, setDraftSaveStatus } = useKnowledgeDraftSave({
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
    setKnowledgeSavedSnapshot: setKnowledgeSavedSnapshotLoose,
    setKnowledgeDocCount,
  });

  const { performDraftSave } = useFullDraftSave({
    assembleConfig,
    effectiveAgentId,
    addToast,
    setDraftSaving,
    setCurrentVersion,
    importStatus,
    refreshKnowledgeHealth,
  });

  const { showReindexConfirm, setShowReindexConfirm, handleSaveClick, saveConfig } = usePublishConfig({
    assembleConfig,
    agentName,
    knowledgeConfig,
    knowledgeReindexNeeded,
    knowledgeDocCount,
    effectiveAgentId,
    addToast,
    setSaveStatus,
    setCurrentVersion,
    setLiveKnowledge,
    setKnowledgeSavedSnapshot: setKnowledgeSavedSnapshotLoose,
    setKnowledgeDocCount,
    setDraftSaveStatus,
    refreshKnowledgeHealth,
    loadHistory,
  });

  useEffect(() => {
    supervisorAbortRef.current?.abort();
    setDraftSaving(false);
    return () => {
      supervisorAbortRef.current?.abort();
    };
  }, [effectiveAgentId]);

  const saveSupervisorDraft = useCallback(
    async (next: { subAgents: SubAgentRef[]; planApproval: boolean }) => {
      const agentId = effectiveAgentId;
      setDraftSaving(true);
      supervisorAbortRef.current?.abort();
      const ac = new AbortController();
      supervisorAbortRef.current = ac;
      supervisorSaveSeqRef.current += 1;
      const saveSeq = supervisorSaveSeqRef.current;
      try {
        let res = await api.patchManageConfigDraftSupervisor(next, agentId, ac.signal, saveSeq);
        const stillCurrent = () =>
          !ac.signal.aborted && ac === supervisorAbortRef.current && agentId === effectiveAgentIdRef.current;
        if (!stillCurrent()) return;
        if (res.status === 409) {
          const body = await res.json().catch(() => ({} as { detail?: { saveSeq?: unknown } }));
          const serverSeq = body?.detail?.saveSeq;
          const base = typeof serverSeq === "number" && Number.isFinite(serverSeq) ? serverSeq : saveSeq;
          const retrySeq = Math.max(supervisorSaveSeqRef.current, base) + 1;
          supervisorSaveSeqRef.current = retrySeq;
          res = await api.patchManageConfigDraftSupervisor(next, agentId, ac.signal, retrySeq);
          if (!stillCurrent()) return;
        }
        setDraftSaving(false);
        if (res.ok) {
          setCurrentVersion("draft");
        } else {
          addToast("error", "Draft Save Failed", `Failed to save sub-agents (${res.status} ${res.statusText})`);
        }
      } catch (error) {
        if (isAbortError(error) || agentId !== effectiveAgentIdRef.current) return;
        if (ac !== supervisorAbortRef.current) return;
        setDraftSaving(false);
        addToast("error", "Draft Save Failed", error instanceof Error ? error.message : "Network error");
      }
    },
    [addToast, effectiveAgentId]
  );

  const addInternalSubAgent = useCallback(
    (ref: string) => {
      if (!ref || subAgents.some((s) => s.kind === "internal" && s.ref === ref)) return;
      const next = [...subAgents, { kind: "internal" as const, ref }];
      setSubAgents(next);
      saveSupervisorDraft({ subAgents: next, planApproval });
    },
    [subAgents, planApproval, saveSupervisorDraft]
  );

  const addA2ASubAgent = useCallback(
    (entry: Extract<SubAgentRef, { kind: "a2a" }>) => {
      const next = [...subAgents, entry];
      setSubAgents(next);
      saveSupervisorDraft({ subAgents: next, planApproval });
    },
    [subAgents, planApproval, saveSupervisorDraft]
  );

  const removeSubAgent = useCallback(
    (index: number) => {
      const next = subAgents.filter((_, i) => i !== index);
      setSubAgents(next);
      saveSupervisorDraft({ subAgents: next, planApproval });
    },
    [subAgents, planApproval, saveSupervisorDraft]
  );

  const updatePlanApproval = useCallback(
    (checked: boolean) => {
      setPlanApproval(checked);
      saveSupervisorDraft({ subAgents, planApproval: checked });
    },
    [subAgents, saveSupervisorDraft]
  );

  useEffect(() => {
    api.getUiConfig()
      .then((c) => setAgentRegistry(!!c.agent_registry))
      .catch(() => setAgentRegistry(false));
  }, []);

  useEffect(() => {
    if (!agentRegistry || agentKind !== "supervisor") return;
    api.getAgents()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.agents) setAvailableAgents(data.agents);
      })
      .catch(() => {});
  }, [agentKind, agentRegistry]);


  // Knowledge reindex detection — compare current config against the
  // last saved/published state. The principle: only flag "needs
  // re-index" when the CURRENT config would produce a different
  // vector index than the SAVED config. Two configs are equivalent
  // for the index when every field the engine's vector_config_hash
  // considers (provider, model, chunk_size, chunk_overlap, metric)
  // resolves to the same effective value.
  //
  // ``embedding_model = ""`` is the Provider Select's reset value
  // (means "use provider default"). On the SAME provider, an empty
  // current model is functionally equivalent to whatever specific
  // model the snapshot holds — the engine picks the same default at
  // embed time. The general pattern: for every field where the UI
  // can produce an empty/unset value that the engine resolves to the
  // saved value, treat empty current as a match.
  //
  // Only ``embedding_model`` needs this treatment today (numeric
  // chunking fields never empty after edits; metric_type comes from
  // a Select with concrete enum values). Adding more cases is a
  // one-line change in ``isIndexConfigEquivalent``.
  useEffect(() => {
    if (!knowledgeSavedSnapshot) return;
    const saved = { ...DEFAULT_KNOWLEDGE_CONFIG, ...knowledgeSavedSnapshot };
    const changed = !isIndexConfigEquivalent(knowledgeConfig, saved);
    setKnowledgeReindexNeeded(changed && knowledgeDocCount > 0);
  }, [knowledgeConfig, knowledgeSavedSnapshot, knowledgeDocCount]);

  const loadVersion = async (version: number) => {
    try {
      const res = await api.getManageConfigVersion(String(version), effectiveAgentId);
      if (res.ok) {
        const data = await res.json();
        const next = { ...DEFAULT_CONFIG, ...data.config };
        if (Array.isArray(next.tools)) {
          next.tools = normalizeTools(next.tools);
        }
        const ag = next.agent;
        setAgentName(ag?.name ?? "");
        setAgentDescription(ag?.description ?? "");
        replaceLlmConfig(next.llm ?? DEFAULT_CONFIG.llm!);
        setToolsState(Array.isArray(next.tools) ? next.tools : []);
        setFeatureFlags(next.feature_flags ?? DEFAULT_CONFIG.feature_flags!);
        setHomescreen(next.homescreen ?? DEFAULT_HOMESCREEN);
        setPolicies(next.policies ?? { enablePolicies: true, policies: [] });
        setSpecialInstructions(next.special_instructions ?? "");
        setAgentKind(ag?.kind === "supervisor" ? "supervisor" : "single");
        setSubAgents(Array.isArray(next.supervisor?.subAgents) ? next.supervisor.subAgents : []);
        setPlanApproval(next.supervisor?.planApproval ?? false);
        supervisorSaveSeqRef.current = supervisorSaveSeqFromConfig(next.supervisor);
        setKnowledgeConfig(next.knowledge ? { ...DEFAULT_KNOWLEDGE_CONFIG, ...next.knowledge } : { ...DEFAULT_KNOWLEDGE_CONFIG });
        setKnowledgeSavedSnapshot(next.knowledge ?? null);
        setCurrentVersion(version);
        addToast("success", "Version Loaded", `Loaded version ${version}`);
      } else {
        const errorMsg = `Failed to load version ${version} (${res.status} ${res.statusText})`;
        addToast("error", "Load Error", errorMsg);
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 2000);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : `Failed to load version ${version}`;
      addToast("error", "Load Error", errorMsg);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const replaceLlmConfig = (next: NonNullable<AgentConfig["llm"]>) => {
    setLlmConfig(next);
    setLlmExtraParamsDraft(null);
    setLlmExtraParamsError(null);
  };

  const updateLlm = (
    field: keyof NonNullable<AgentConfig["llm"]>,
    value: string | number | boolean | string[] | Record<string, LlmJsonValue> | undefined
  ) => {
    setLlmConfig((c) => {
      const next = { ...(c ?? {}) };
      if (value === undefined) {
        delete next[field];
      } else {
        (next as Record<string, unknown>)[field] = value;
      }
      llmConfigRef.current = next;
      return next;
    });
  };
  const updateLlmTemperature = (value: number) => {
    setLlmConfig((c) => ({ ...(c ?? {}), temperature: value }));
  };
  const clearLlmNumber = (field: "max_tokens" | "top_p" | "top_k" | "frequency_penalty" | "presence_penalty") => {
    setLlmConfig((c) => {
      const next = { ...(c ?? {}) };
      delete next[field];
      return next;
    });
  };

  const updateFeatureFlag = (field: "enable_todos" | "reflection" | "enable_filesystem_tools", value: boolean) => {
    setFeatureFlags((c) => ({ ...(c ?? {}), [field]: value }));
  };

  const updateMaxSteps = (value: number) => {
    setFeatureFlags((c) => ({ ...(c ?? {}), max_steps: value }));
  };

  const updateShortlistingThreshold = (value: number) => {
    setFeatureFlags((c) => ({ ...(c ?? {}), shortlisting_tool_threshold: value }));
  };

  const setTools = useCallback((newTools: ToolEntry[]) => {
    setToolsState(newTools);
  }, []);

  const updateHomescreen = (field: "isOn" | "greeting", value: boolean | string) => {
    setHomescreen((c) => ({ ...(c ?? DEFAULT_HOMESCREEN), [field]: value }));
  };

  const updateStarter = (index: number, value: string) => {
    setHomescreen((c) => {
      const starters = [...(c?.starters ?? DEFAULT_HOMESCREEN.starters ?? [])];
      while (starters.length <= index) starters.push("");
      starters[index] = value;
      return { ...(c ?? DEFAULT_HOMESCREEN), starters: starters.slice(0, 4) };
    });
  };

  const handleImportJson = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setImportStatus("idle");
      setImportError(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = reader.result as string;
          const raw = JSON.parse(text) as Record<string, unknown>;
          const out: AgentConfig = { ...DEFAULT_CONFIG };
          if (raw.llm && typeof raw.llm === "object") {
            out.llm = { ...out.llm, ...(raw.llm as Record<string, unknown>) };
          }
          if (Array.isArray(raw.tools)) {
            out.tools = normalizeTools(raw.tools);
          }
          if (raw.feature_flags && typeof raw.feature_flags === "object") {
            out.feature_flags = { ...out.feature_flags, ...(raw.feature_flags as Record<string, unknown>) };
          }
          if (raw.policies !== undefined) {
            const p = raw.policies;
            if (Array.isArray(p)) {
              out.policies = { enablePolicies: true, policies: p };
            } else if (p && typeof p === "object" && "policies" in p) {
              const po = p as { enablePolicies?: boolean; policies?: unknown[] };
              out.policies = {
                enablePolicies: po.enablePolicies ?? true,
                policies: Array.isArray(po.policies) ? po.policies : [],
              };
            }
          }
          if (raw.homescreen && typeof raw.homescreen === "object") {
            const hs = raw.homescreen as HomescreenConfig;
            out.homescreen = {
              isOn: hs.isOn ?? DEFAULT_HOMESCREEN.isOn,
              greeting: hs.greeting ?? DEFAULT_HOMESCREEN.greeting,
              starters: Array.isArray(hs.starters)
                ? hs.starters.slice(0, 4).filter((s: unknown): s is string => typeof s === "string")
                : DEFAULT_HOMESCREEN.starters ?? [],
            };
          }
          if (raw.knowledge && typeof raw.knowledge === "object") {
            out.knowledge = { ...DEFAULT_KNOWLEDGE_CONFIG, ...(raw.knowledge as Record<string, unknown>) };
          }
          const imported = parseImportedSupervisorFields(raw);
          if (imported.agentName) setAgentName(imported.agentName);
          if (imported.agentDescription !== undefined) setAgentDescription(imported.agentDescription);
          setAgentKind(imported.agentKind ?? "single");
          setSubAgents((imported.subAgents ?? []) as SubAgentRef[]);
          setPlanApproval(imported.planApproval ?? false);
          supervisorSaveSeqRef.current += 1;
          replaceLlmConfig(out.llm ?? DEFAULT_CONFIG.llm!);
          setToolsState(Array.isArray(out.tools) ? out.tools : []);
          setFeatureFlags(out.feature_flags ?? DEFAULT_CONFIG.feature_flags!);
          setHomescreen(out.homescreen ?? DEFAULT_HOMESCREEN);
          setPolicies(out.policies ?? { enablePolicies: true, policies: [] });
          setKnowledgeConfig(out.knowledge ?? { ...DEFAULT_KNOWLEDGE_CONFIG });
          setImportStatus("ok");
          setImportError(null);
          setTimeout(() => setImportStatus("idle"), 2500);
        } catch {
          const msg = "Invalid JSON";
          setImportStatus("error");
          setImportError(msg);
          addToast("error", "Import failed", msg);
          setTimeout(() => {
            setImportStatus("idle");
            setImportError(null);
          }, 2500);
        }
      };
      reader.onerror = () => {
        const msg = "Failed to read file";
        setImportStatus("error");
        setImportError(msg);
        addToast("error", "Import failed", msg);
        setTimeout(() => {
          setImportStatus("idle");
          setImportError(null);
        }, 2500);
      };
      reader.readAsText(file);
    },
    [normalizeTools, addToast]
  );

  const llm = llmConfig ?? {};
  const llmSecretStoredRef = typeof llm.api_key === "string" ? llm.api_key : "";
  const llmSecretSelectValue = matchSecretRef(llmSecretStoredRef, llmSecretsList);
  const llmSecretOrphanInList = storedRefMissingFromList(
    llmSecretStoredRef,
    llmSecretsList,
    llmSecretSelectValue
  );
  const flags = featureFlags ?? {};
  const policiesList = policies?.policies ?? [];
  const summary = policiesSummary(policiesList);
  const policiesEnabled = policies?.enablePolicies ?? false;


  // ── view (new; everything above is the original page logic) ──────────────
  const [pane, setPane] = useState<"config" | "chat">("config");
  const [draftThreadId, setDraftThreadId] = useState(() => uuid());
  void handleManageVariablesUpdate; // upstream keeps this handler but its chat never calls it
  const displayName = configLoading ? "Agent configuration" : agentName || effectiveAgentId;
  const secretLabel = llm.auth_type === "auth_header" ? "Header value" : "API Key";
  const iconButton = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} className="text-muted-foreground" onClick={onClick} />}>
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <ManageShell
      agentId={effectiveAgentId}
      agentName={agentName || effectiveAgentId}
      agentContext={agentContext ?? undefined}
      titleStart={
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Back to agents" className="text-muted-foreground" render={<Link to="/manage" />} />}>
            <ArrowLeftIcon />
          </TooltipTrigger>
          <TooltipContent>Back to agents</TooltipContent>
        </Tooltip>
      }
      title={
        <>
          <span className="hidden text-[0.6875rem] font-medium tracking-[0.1em] text-link uppercase sm:inline">Configuration</span>
          <h1 className="truncate text-sm font-medium">{displayName}</h1>
        </>
      }
      titleEnd={
        <>
          <Tabs value={pane} onValueChange={(v) => setPane(v as "config" | "chat")} className="lg:hidden">
            <TabsList>
              <TabsTrigger value="config">Configure</TabsTrigger>
              <TabsTrigger value="chat">Try it</TabsTrigger>
            </TabsList>
          </Tabs>
          {iconButton("Manage secrets", <KeyRoundIcon />, () => setSecretsModalOpen(true))}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open in chat"
                  className="text-muted-foreground"
                  render={<Link to={effectiveAgentId === "cuga-default" ? "/chat" : `/chat/${encodeURIComponent(effectiveAgentId)}`} />}
                />
              }
            >
              <MessageSquareIcon />
            </TooltipTrigger>
            <TooltipContent>Open the published agent in chat</TooltipContent>
          </Tooltip>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 pt-12">
        {/* ── configuration column ─────────────────────────────────────── */}
        <div className={cn("min-h-0 w-full flex-col border-r lg:flex lg:w-[34rem] lg:shrink-0", pane === "config" ? "flex" : "hidden")}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {configLoading ? (
              <div className="flex flex-col gap-3 p-4" aria-label="Loading agent configuration…">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : loadError ? (
              <div className="flex flex-col items-start gap-3 p-4">
                <Notice kind="error" title="Load Error">
                  {loadError}
                </Notice>
                <Button variant="outline" size="sm" onClick={() => void loadLatest()}>
                  <RotateCcwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </div>
            ) : (
              <Accordion multiple defaultValue={["agent", "subagents", "llm", "tools"]}>
                <Section id="agent" title="Agent">
                  <TextField
                    id="agent-name"
                    label="Name (required)"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    onBlur={() => saveAgentDraft()}
                    placeholder="Enter agent name"
                    error={!agentName.trim() ? "Name is required" : undefined}
                    required
                  />
                  <TextAreaField
                    id="agent-description"
                    label="Description"
                    value={agentDescription}
                    onChange={(e) => setAgentDescription(e.target.value)}
                    onBlur={() => saveAgentDraft()}
                    placeholder="Optional description"
                    rows={3}
                  />
                </Section>

                <Section id="instructions" title="Special Instructions">
                  <Hint>
                    Text injected directly into the agent&apos;s system prompt before every conversation. Use this to give the agent a persona, domain
                    context, or standing rules.
                  </Hint>
                  <TextAreaField
                    id="special-instructions"
                    aria-label="Special instructions"
                    value={specialInstructions}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSpecialInstructions(v);
                      if (!skipDraftSaveRef.current) scheduleSpecialInstructionsDraftSave(v);
                    }}
                    placeholder="e.g. You are a helpful sales assistant for Acme Corp. Always respond formally and focus on enterprise software solutions."
                    rows={6}
                  />
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => saveSpecialInstructionsDraft(specialInstructions, true)}>
                      <SaveIcon data-icon="inline-start" />
                      Save draft
                    </Button>
                  </div>
                </Section>

                {agentRegistry && agentKind === "supervisor" && (
                  <Section id="subagents" title="Sub-agents">
                    <Hint>
                      A supervisor doesn&apos;t use its own tools or LLM section — it delegates to the agents listed below, each an existing agent or
                      an external A2A endpoint.
                    </Hint>
                    <Field>
                      <FieldLabel htmlFor="add-internal-subagent">Add an existing agent</FieldLabel>
                      <NativeSelect
                        id="add-internal-subagent"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) addInternalSubAgent(e.target.value);
                        }}
                      >
                        <NativeSelectOption value="">Select an agent to add…</NativeSelectOption>
                        {availableAgents
                          .filter((a) => a.id !== effectiveAgentId && a.kind !== "supervisor" && !subAgents.some((s) => s.kind === "internal" && s.ref === a.id))
                          .map((a) => (
                            <NativeSelectOption key={a.id} value={a.id}>
                              {a.name?.trim() || a.id}
                            </NativeSelectOption>
                          ))}
                      </NativeSelect>
                    </Field>
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => setShowAddA2AModal(true)}>
                        <PlusIcon data-icon="inline-start" />
                        Add A2A agent
                      </Button>
                    </div>
                    {subAgents.length === 0 ? (
                      <Hint>No sub-agents yet. Add an existing agent or an A2A agent above.</Hint>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {subAgents.map((s, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge variant={s.kind === "internal" ? "secondary" : "outline"}>{s.kind === "internal" ? "Agent" : "A2A"}</Badge>
                              <span className="truncate text-sm">{s.kind === "internal" ? s.ref : `${s.name} (${s.endpoint})`}</span>
                            </div>
                            {iconButton("Remove sub-agent", <Trash2Icon />, () => removeSubAgent(i))}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Field orientation="horizontal" className="items-center">
                      <Switch id="plan-approval-toggle" checked={planApproval} onCheckedChange={(c) => updatePlanApproval(c === true)} />
                      <FieldLabel htmlFor="plan-approval-toggle">Plan approval: {planApproval ? "On" : "Off"}</FieldLabel>
                    </Field>
                    <Hint>When on, the supervisor pauses for approval before delegating to sub-agents.</Hint>
                  </Section>
                )}

                {agentKind !== "supervisor" && (
                  <Section id="llm" title="LLM Configuration">
                    {llmSecretsMode === "local" && llmForceEnv ? (
                      <Notice kind="info" title="Managed via environment">
                        LLM configuration is controlled by settings.toml and environment variables (mode=local + force_env=true). No UI configuration
                        is needed.
                      </Notice>
                    ) : (
                      <>
                        <Field>
                          <FieldLabel htmlFor="llm-provider">Provider</FieldLabel>
                          <NativeSelect
                            id="llm-provider"
                            value={llm.provider ?? "openai"}
                            onChange={(e) => {
                              const id = (e.target.value || "openai") as "groq" | "openai" | "litellm";
                              const prov = LLM_PROVIDERS.find((p) => p.id === id);
                              setLlmConfig((prev) => {
                                const next = { ...(prev ?? {}), provider: id };
                                if (id === "groq") {
                                  next.base_url = "";
                                } else if (prov && (!prev?.model || !prev?.base_url) && (prov.defaultBase || prov.defaultModel)) {
                                  if (!prev?.model && prov.defaultModel) next.model = prov.defaultModel;
                                  if (!prev?.base_url && prov.defaultBase !== undefined) next.base_url = prov.defaultBase;
                                }
                                return next;
                              });
                              setTimeout(() => saveLlmDraft(), 0);
                            }}
                          >
                            {LLM_PROVIDERS.map((p) => (
                              <NativeSelectOption key={p.id} value={p.id}>
                                {p.label}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </Field>

                        <Field>
                          <FieldLabel id="llm-auth-type-label">Auth type</FieldLabel>
                          <RadioGroup
                            aria-labelledby="llm-auth-type-label"
                            value={llm.auth_type ?? "api_key"}
                            onValueChange={(selection) => {
                              updateLlm("auth_type", ((selection as string) ?? "api_key") as "api_key" | "auth_header");
                              setTimeout(saveLlmDraft, 0);
                            }}
                            className="flex flex-row gap-6"
                          >
                            <label className="flex items-center gap-2 text-sm">
                              <RadioGroupItem value="api_key" id="llm-auth-api-key" />
                              API Key
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <RadioGroupItem value="auth_header" id="llm-auth-header" />
                              Auth header
                            </label>
                          </RadioGroup>
                          {(llm.auth_type ?? "api_key") === "auth_header" && (
                            <TextField
                              id="llm-auth-header-name"
                              label="Header name"
                              value={llm.auth_header_name ?? "Authorization"}
                              onChange={(e) => updateLlm("auth_header_name", e.target.value)}
                              onBlur={scheduleLlmDraftSave}
                              placeholder="Authorization"
                            />
                          )}
                        </Field>

                        <div className="flex flex-col gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <CheckField
                              id="llm-use-saved-secret"
                              label="Use saved secret"
                              checked={llmUseSavedSecret}
                              onChange={(checked) => {
                                setLlmUseSavedSecret(checked);
                                setLlmInlineCreate(false);
                              }}
                            />
                            {iconButton("Manage secrets", <KeyRoundIcon />, () => setSecretsModalOpen(true))}
                          </div>
                          {llmUseSavedSecret ? (
                            <>
                              <Field>
                                <FieldLabel htmlFor="llm-api-key-secret">{secretLabel} (saved secret)</FieldLabel>
                                <NativeSelect
                                  id="llm-api-key-secret"
                                  value={llmSecretSelectValue}
                                  onChange={(e) => {
                                    updateLlm("api_key", e.target.value);
                                    setTimeout(saveLlmDraft, 0);
                                  }}
                                >
                                  <NativeSelectOption value="">Select a secret</NativeSelectOption>
                                  {llmSecretOrphanInList && (
                                    <NativeSelectOption value={llmSecretStoredRef}>{`${secretIdFromRef(llmSecretStoredRef)} (configured)`}</NativeSelectOption>
                                  )}
                                  {llmSecretsList.map((s) => (
                                    <NativeSelectOption key={s.id} value={s.ref}>
                                      {s.description ? `${s.id} — ${s.description}` : s.id}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              </Field>
                              <div>
                                <Button variant="ghost" size="sm" onClick={() => setLlmInlineCreate((v) => !v)}>
                                  <KeyRoundIcon data-icon="inline-start" />
                                  {llmInlineCreate ? "Cancel" : "Create new secret"}
                                </Button>
                              </div>
                              {llmInlineCreate && (
                                <div className="flex flex-col gap-3 rounded-md border p-3">
                                  <TextField
                                    id="llm-inline-secret-key"
                                    label="Key name"
                                    value={llmInlineCreateKey}
                                    onChange={(e) => setLlmInlineCreateKey(e.target.value)}
                                    placeholder="e.g. llm-api-key"
                                    helper="Optional; leave empty to auto-generate"
                                  />
                                  <div className="flex flex-wrap items-end gap-2">
                                    <TextField
                                      id="llm-inline-secret-value"
                                      type="password"
                                      label="New secret value"
                                      value={llmInlineCreateValue}
                                      onChange={(e) => setLlmInlineCreateValue(e.target.value)}
                                      placeholder="sk-..."
                                      autoComplete="off"
                                      className="min-w-48 flex-1"
                                    />
                                    <Button
                                      size="sm"
                                      disabled={!llmInlineCreateValue.trim()}
                                      onClick={async () => {
                                        const slug =
                                          llmInlineCreateKey.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "-") ||
                                          `llm-api-key-${Date.now()}`;
                                        const res = await api.createSecret(slug, llmInlineCreateValue.trim(), "LLM API Key", undefined, effectiveAgentId);
                                        if (res.ok) {
                                          const data = await res.json();
                                          const ref = data.ref || `db://${slug}`;
                                          setLlmInlineCreate(false);
                                          setLlmInlineCreateValue("");
                                          setLlmInlineCreateKey("");
                                          // Refresh the list first so the new secret is in the dropdown, then select and persist it.
                                          await refreshSecrets();
                                          updateLlm("api_key", ref);
                                          setTimeout(saveLlmDraft, 0);
                                        }
                                      }}
                                    >
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <TextField
                              type="password"
                              id="llm-api-key"
                              label={secretLabel}
                              value={(llm.api_key ?? "").startsWith("db://") ? "" : (llm.api_key ?? "")}
                              onChange={(e) => updateLlm("api_key", e.target.value)}
                              onBlur={scheduleLlmDraftSave}
                              placeholder="sk-..."
                              autoComplete="off"
                            />
                          )}
                        </div>

                        {/* Groq has a fixed endpoint; OpenAI allows an override; LiteLLM needs one. */}
                        {(llm.provider === "litellm" || !["groq"].includes(llm.provider ?? "")) && (
                          <TextField
                            id="llm-base-url"
                            label="Base URL"
                            value={llm.base_url ?? ""}
                            onChange={(e) => updateLlm("base_url", e.target.value)}
                            onBlur={scheduleLlmDraftSave}
                            placeholder={llm.provider === "litellm" ? "http://localhost:4000" : "https://api.openai.com/v1"}
                            helper={llm.provider === "litellm" ? "Required for LiteLLM proxy" : "Optional; leave empty for default"}
                          />
                        )}
                        <CheckField
                          id="llm-disable-ssl"
                          label="Disable SSL verification"
                          checked={!!llm.disable_ssl}
                          onChange={(checked) => {
                            updateLlm("disable_ssl", checked);
                            setTimeout(saveLlmDraft, 0);
                          }}
                        />

                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-end gap-2">
                            <TextField
                              id="llm-model"
                              label="Model"
                              value={llm.model ?? ""}
                              onChange={(e) => updateLlm("model", e.target.value)}
                              onBlur={scheduleLlmDraftSave}
                              placeholder="gpt-4o"
                              className="min-w-48 flex-1"
                            />
                            <Button
                              variant="outline"
                              disabled={llmModelsLoading}
                              onClick={async () => {
                                setLlmModelsError(null);
                                setLlmModelsList([]);
                                setLlmModelsLoading(true);
                                try {
                                  const res = await api.getLlmModels(llm.api_key ?? "", !!llm.disable_ssl, llm.provider);
                                  if (!res.ok) {
                                    const err = await res.json().catch(() => ({}));
                                    throw new Error(err.detail ?? err.message ?? `${res.status} ${res.statusText}`);
                                  }
                                  const data = await res.json();
                                  setLlmModelsList(Array.isArray(data.models) ? data.models : []);
                                } catch (e) {
                                  setLlmModelsError(e instanceof Error ? e.message : String(e));
                                } finally {
                                  setLlmModelsLoading(false);
                                }
                              }}
                            >
                              List models
                            </Button>
                          </div>
                          {llmModelsLoading && (
                            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Spinner /> Fetching models…
                            </p>
                          )}
                          {llmModelsError && (
                            <Notice kind="error" title="Error">
                              {llmModelsError}
                            </Notice>
                          )}
                          {llmModelsList.length > 0 && (
                            <Field>
                              <FieldLabel htmlFor="llm-model-select">Choose from list</FieldLabel>
                              <NativeSelect
                                id="llm-model-select"
                                value={llm.model ?? ""}
                                onChange={(e) => {
                                  updateLlm("model", e.target.value);
                                  setTimeout(saveLlmDraft, 0);
                                }}
                              >
                                <NativeSelectOption value="">—</NativeSelectOption>
                                {llmModelsList.map((id) => (
                                  <NativeSelectOption key={id} value={id}>
                                    {id}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </Field>
                          )}
                        </div>

                        <fieldset className="flex flex-col gap-3">
                          <legend className="mb-2 font-heading text-sm font-medium">Sampling</legend>
                          <NumberField
                            id="llm-temperature"
                            label="Temperature"
                            min={0}
                            max={2}
                            step={0.1}
                            value={llm.temperature ?? 0.1}
                            onValue={(value) => updateLlmTemperature(Number(value) || 0.1)}
                            onBlur={scheduleLlmDraftSave}
                          />
                          <NumberField
                            id="llm-max-tokens"
                            label="Max tokens"
                            helper="Leave empty to keep the model/TOML default"
                            min={1}
                            step={256}
                            allowEmpty
                            value={llm.max_tokens ?? ""}
                            onValue={(value) => {
                              if (value === "") return clearLlmNumber("max_tokens");
                              if (Number.isFinite(value) && value > 0) updateLlm("max_tokens", Math.floor(value));
                            }}
                            onBlur={scheduleLlmDraftSave}
                          />
                        </fieldset>

                        <Accordion>
                          <AccordionItem value="advanced" className="rounded-md border">
                            <AccordionTrigger className="px-3 text-sm">Advanced LLM params</AccordionTrigger>
                            <AccordionContent className="px-3">
                              <div className="flex flex-col gap-4 pb-2">
                                <NumberField
                                  id="llm-top-p"
                                  label="Top P"
                                  helper="Only sent when set (safer for Bedrock/Claude via OpenAI-compatible endpoints)"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  allowEmpty
                                  value={llm.top_p ?? ""}
                                  onValue={(value) => {
                                    if (value === "") return clearLlmNumber("top_p");
                                    if (Number.isFinite(value)) updateLlm("top_p", value);
                                  }}
                                  onBlur={scheduleLlmDraftSave}
                                />
                                <NumberField
                                  id="llm-top-k"
                                  label="Top K"
                                  helper="Used by Watsonx / LiteLLM when supported"
                                  min={1}
                                  step={1}
                                  allowEmpty
                                  value={llm.top_k ?? ""}
                                  onValue={(value) => {
                                    if (value === "") return clearLlmNumber("top_k");
                                    if (Number.isFinite(value) && value > 0) updateLlm("top_k", Math.floor(value));
                                  }}
                                  onBlur={scheduleLlmDraftSave}
                                />
                                <NumberField
                                  id="llm-frequency-penalty"
                                  label="Frequency penalty"
                                  helper="OpenAI-compatible providers (ignored by Groq/Watsonx)"
                                  min={-2}
                                  max={2}
                                  step={0.1}
                                  allowEmpty
                                  value={llm.frequency_penalty ?? ""}
                                  onValue={(value) => {
                                    if (value === "") return clearLlmNumber("frequency_penalty");
                                    if (Number.isFinite(value)) updateLlm("frequency_penalty", value);
                                  }}
                                  onBlur={scheduleLlmDraftSave}
                                />
                                <NumberField
                                  id="llm-presence-penalty"
                                  label="Presence penalty"
                                  helper="OpenAI-compatible providers (ignored by Groq/Watsonx)"
                                  min={-2}
                                  max={2}
                                  step={0.1}
                                  allowEmpty
                                  value={llm.presence_penalty ?? ""}
                                  onValue={(value) => {
                                    if (value === "") return clearLlmNumber("presence_penalty");
                                    if (Number.isFinite(value)) updateLlm("presence_penalty", value);
                                  }}
                                  onBlur={scheduleLlmDraftSave}
                                />
                                <TextField
                                  id="llm-stop"
                                  label="Stop sequences"
                                  helper="Comma-separated stop strings"
                                  value={Array.isArray(llm.stop) ? llm.stop.join(", ") : (llm.stop ?? "")}
                                  onChange={(e) => {
                                    const parts = e.target.value
                                      .split(",")
                                      .map((s) => s.trim())
                                      .filter(Boolean);
                                    updateLlm("stop", parts.length ? parts : undefined);
                                  }}
                                  onBlur={scheduleLlmDraftSave}
                                />
                                <TextAreaField
                                  id="llm-extra-params"
                                  label="Extra params (JSON)"
                                  helper="Provider-agnostic map for LiteLLM / OpenAI-compatible backends. Auth keys are stripped server-side."
                                  rows={4}
                                  className="font-mono"
                                  error={llmExtraParamsError ?? undefined}
                                  value={
                                    llmExtraParamsDraft ??
                                    (llm.extra_params && Object.keys(llm.extra_params).length > 0 ? JSON.stringify(llm.extra_params, null, 2) : "")
                                  }
                                  onChange={(e) => {
                                    setLlmExtraParamsDraft(e.target.value);
                                    setLlmExtraParamsError(null);
                                  }}
                                  onBlur={() => {
                                    if (llmExtraParamsDraft === null) return;
                                    const raw = llmExtraParamsDraft.trim();
                                    if (!raw) {
                                      updateLlm("extra_params", undefined);
                                      setLlmExtraParamsDraft(null);
                                      setLlmExtraParamsError(null);
                                      scheduleLlmDraftSave();
                                      return;
                                    }
                                    try {
                                      const parsed = JSON.parse(raw) as unknown;
                                      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                                        setLlmExtraParamsError("Extra params must be a JSON object");
                                        return;
                                      }
                                      const isJsonValue = (v: unknown): v is LlmJsonValue => {
                                        if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return true;
                                        if (Array.isArray(v)) return v.every(isJsonValue);
                                        if (typeof v === "object") return Object.values(v as Record<string, unknown>).every(isJsonValue);
                                        return false;
                                      };
                                      const cleaned: Record<string, LlmJsonValue> = {};
                                      let dropped = false;
                                      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                                        if (isJsonValue(v)) cleaned[k] = v;
                                        else dropped = true;
                                      }
                                      if (dropped) {
                                        setLlmExtraParamsError("Extra params must be JSON values (no functions)");
                                        return;
                                      }
                                      updateLlm("extra_params", Object.keys(cleaned).length ? cleaned : undefined);
                                      setLlmExtraParamsDraft(null);
                                      setLlmExtraParamsError(null);
                                      scheduleLlmDraftSave();
                                    } catch {
                                      setLlmExtraParamsError("Invalid JSON");
                                    }
                                  }}
                                />
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </>
                    )}
                  </Section>
                )}

                {sandboxOn && (
                  <Section id="sandbox" title="Code Sandbox (experimental)">
                    <SandboxSettings
                      onError={(title, message) => addToast("error", title, message)}
                      onSaved={(message) => addToast("success", "Code sandbox", message)}
                    />
                  </Section>
                )}

                {agentKind !== "supervisor" && (
                  <Section id="tools" title="Tools">
                    <ToolsConfig
                      tools={tools}
                      onChange={setTools}
                      connectedApps={connectedApps}
                      connectedTools={connectedTools}
                      agentId={effectiveAgentId}
                      builtinTools={featureFlags.builtin_tools}
                      onError={(title, message) => addToast("error", title, message)}
                      onOpenSecrets={() => setSecretsModalOpen(true)}
                    />
                  </Section>
                )}

                {agentContext?.skills_enabled ? (
                  <Section id="skills" title="Skills">
                    {skillsLoading ? (
                      <Skeleton className="h-16" aria-label="Loading skills…" />
                    ) : skills.length === 0 ? (
                      <Hint>
                        No skills found. Add SKILL.md files under <code className="font-mono">.cuga/skills/</code> (default) or set{" "}
                        <code className="font-mono">[skills] root</code> in settings.toml.
                      </Hint>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {skills.map((skill) => {
                          const pipDeps = skill.requirements.filter((r) => !r.startsWith("npm:"));
                          const npmDeps = skill.requirements.filter((r) => r.startsWith("npm:")).map((r) => r.slice(4));
                          const LIMIT = 120;
                          const isLong = skill.description.length > LIMIT;
                          const isExpanded = expandedSkills.has(skill.name);
                          const displayDesc = isLong && !isExpanded ? skill.description.slice(0, LIMIT).trimEnd() + "…" : skill.description;
                          return (
                            <div key={skill.name} className="rounded-md border px-3 py-2.5">
                              <div className="mb-1 flex items-center gap-2">
                                <SparklesIcon className="size-4 text-link" />
                                <span className="text-sm font-bold">{skill.name}</span>
                                <Badge variant="outline" className="ml-auto">
                                  <span className="size-1.5 rounded-full bg-status-ok" /> active
                                </Badge>
                              </div>
                              <p className="text-xs leading-snug text-muted-foreground">
                                {displayDesc}
                                {isLong && (
                                  <button
                                    type="button"
                                    className="ml-1 text-link underline"
                                    onClick={() =>
                                      setExpandedSkills((prev) => {
                                        const next = new Set(prev);
                                        if (isExpanded) next.delete(skill.name);
                                        else next.add(skill.name);
                                        return next;
                                      })
                                    }
                                  >
                                    {isExpanded ? "less" : "more"}
                                  </button>
                                )}
                              </p>
                              {(pipDeps.length > 0 || npmDeps.length > 0) && (
                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                  <PackageIcon className="size-3 shrink-0 text-muted-foreground" />
                                  {pipDeps.map((d) => (
                                    <Badge key={d} variant="secondary">
                                      {d}
                                    </Badge>
                                  ))}
                                  {npmDeps.map((d) => (
                                    <Badge key={d} variant="secondary">
                                      npm:{d}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>
                ) : null}

                <Section id="welcome" title="Welcome Screen">
                  <CheckField
                    id="homescreen-isOn"
                    label="Show welcome screen"
                    checked={homescreen?.isOn ?? true}
                    onChange={(checked) => {
                      updateHomescreen("isOn", checked);
                      setTimeout(() => performDraftSave(), 0);
                    }}
                  />
                  <TextField
                    id="homescreen-greeting"
                    label="Greeting message"
                    value={homescreen?.greeting ?? DEFAULT_HOMESCREEN.greeting ?? ""}
                    onChange={(e) => updateHomescreen("greeting", e.target.value)}
                    onBlur={() => performDraftSave()}
                    placeholder="Hello, how can I help you today?"
                  />
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-2 font-heading text-sm font-medium">Starter buttons (max 4)</legend>
                    {[0, 1, 2, 3].map((i) => (
                      <TextField
                        key={i}
                        id={`homescreen-starter-${i}`}
                        label={`Starter ${i + 1}`}
                        value={(homescreen?.starters ?? [])[i] ?? ""}
                        onChange={(e) => updateStarter(i, e.target.value)}
                        onBlur={() => performDraftSave()}
                        placeholder={i === 0 ? "Hi, what can you do for me?" : "Optional"}
                      />
                    ))}
                  </fieldset>
                  <div>
                    <Button variant="outline" size="sm" onClick={() => performDraftSave()} disabled={draftSaving}>
                      <SaveIcon data-icon="inline-start" />
                      Save welcome screen
                    </Button>
                  </div>
                </Section>

                <Section id="features" title="Features">
                  <CheckField id="enable_todos" label="Enable todos" checked={flags.enable_todos ?? false} onChange={(c) => updateFeatureFlag("enable_todos", c)} />
                  <CheckField id="reflection" label="Reflection" checked={flags.reflection ?? false} onChange={(c) => updateFeatureFlag("reflection", c)} />
                  <CheckField
                    id="enable_filesystem_tools"
                    label="Filesystem tools"
                    helper="Gives the agent read, write, edit, list, and search access to the workspace filesystem."
                    checked={flags.enable_filesystem_tools ?? false}
                    onChange={(c) => updateFeatureFlag("enable_filesystem_tools", c)}
                  />
                  <NumberField id="max_steps" label="Max steps" min={1} max={200} value={flags.max_steps ?? 70} onValue={(v) => updateMaxSteps(Number(v) || 70)} />
                  <NumberField
                    id="shortlisting_tool_threshold"
                    label="Shortlisting tool threshold"
                    min={1}
                    max={500}
                    value={flags.shortlisting_tool_threshold ?? 35}
                    onValue={(v) => updateShortlistingThreshold(Number(v) || 35)}
                    helper="Enable find_tools when total tools exceed this count"
                  />
                  <div>
                    <Button variant="outline" size="sm" onClick={() => performDraftSave()} disabled={draftSaving}>
                      <SaveIcon data-icon="inline-start" />
                      Save Flags
                    </Button>
                  </div>
                </Section>

                <Section id="policies" title="Policies">
                  <p className="text-sm text-body">
                    {policiesEnabled ? `${summary.total} ${summary.total !== 1 ? "policies" : "policy"} defined` : "Policies disabled"}
                  </p>
                  {policiesEnabled && summary.total > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(summary.byType).map(([type, count]) => (
                        <Badge key={type} variant="secondary">
                          {POLICY_TYPE_LABELS[type] ?? type}: {count}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div>
                    <Button variant="outline" size="sm" onClick={() => setShowPoliciesModal(true)}>
                      <ShieldIcon data-icon="inline-start" />
                      Configure policies
                    </Button>
                  </div>
                </Section>

                <Section id="knowledge" title="Knowledge">
                  <p className="flex items-center gap-2 text-sm text-body">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        knowledgeHealthStatus === "starting" || knowledgeHealthy === null || knowledgeHealthStatus === "disabled"
                          ? "bg-muted-foreground"
                          : knowledgeHealthy
                            ? "bg-status-ok"
                            : "bg-status-warn"
                      )}
                    />
                    {knowledgeHealthStatus === "starting" || knowledgeHealthy === null
                      ? "Starting knowledge..."
                      : knowledgeHealthy
                        ? `Connected${knowledgeDocCount > 0 ? ` · ${knowledgeDocCount} document${knowledgeDocCount !== 1 ? "s" : ""} indexed` : ""}`
                        : knowledgeHealthStatus === "disabled"
                          ? "Disabled"
                          : "Disconnected"}
                  </p>
                  {/* Cold start: the model is still loading. Not a failure, so never shown as one. */}
                  {knowledgeEmbedderState === "preparing" && knowledgeDocCount > 0 && (
                    <Notice kind="info" title="Preparing embedder">
                      {`Getting the embedding model${knowledgeEmbedderModel ? ` (${knowledgeEmbedderModel})` : ""} ready — this can take a minute the first time. Search will work as soon as it finishes.`}
                    </Notice>
                  )}
                  {/* Documents exist but their embedder can't embed queries: search returns nothing. */}
                  {knowledgeEmbedderAvailable === false && knowledgeDocCount > 0 && (
                    <Notice kind="error" title="Embedder unavailable">
                      {`Your ${knowledgeDocCount} indexed document${knowledgeDocCount !== 1 ? "s" : ""} can't be searched — ` +
                        `the active embedder${knowledgeEmbedderModel ? ` (${knowledgeEmbedderModel})` : ""} isn't usable. ` +
                        (isLocalEmbeddingProvider(knowledgeEmbedderModel)
                          ? `It runs locally, so there's no key or connection to check — its model files are missing or unreadable. ` +
                            `Restart to let CUGA re-download them; if it persists, check free disk space and network access.`
                          : `Open Configure knowledge base to check its API key / connection and run Test connection.`) +
                        (knowledgeEmbedderError ? ` (${knowledgeEmbedderError})` : "")}
                    </Notice>
                  )}
                  <div>
                    <Button variant="outline" size="sm" onClick={() => setShowKnowledgeModal(true)}>
                      <FileTextIcon data-icon="inline-start" />
                      Configure knowledge base
                    </Button>
                  </div>
                </Section>

                <Section id="history" title="Version History">
                  <Hint>Click a version to set it as your current configuration.</Hint>
                  {history.length === 0 ? (
                    <Hint>No versions yet</Hint>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {history.map((v: ConfigVersion) => (
                        <li key={v.version} className="flex items-center gap-1 rounded-md border pr-1 hover:bg-foreground/5">
                          <button
                            type="button"
                            className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => loadVersion(v.version)}
                          >
                            <Badge variant="secondary">v{v.version}</Badge>
                            <span className="truncate text-body">{new Date(v.created_at).toLocaleString()}</span>
                            <span className="ml-auto hidden text-xs text-muted-foreground group-hover:inline group-focus-visible:inline">Set as current</span>
                          </button>
                          {iconButton(`View JSON of version ${v.version}`, <FileJsonIcon />, () => {
                            api
                              .getManageConfigVersion(String(v.version), effectiveAgentId)
                              .then((res) => (res.ok ? res.json() : null))
                              .then((data) => data && setViewVersion({ version: v.version, config: data.config ?? {} }))
                              .catch(() => {});
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </Accordion>
            )}
          </div>

          {/* ── save bar ───────────────────────────────────────────────── */}
          <div className="glass-chrome flex shrink-0 flex-col gap-2 border-t px-4 py-3">
            <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" aria-label="Import config JSON" onChange={handleImportJson} />
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <UploadIcon data-icon="inline-start" />
                Import
              </Button>
              <Button onClick={handleSaveClick} disabled={saveStatus === "saving" || configLoading || !!loadError}>
                {saveStatus === "saving" ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
                {saveStatus === "saving" && "Publishing…"}
                {saveStatus === "idle" && "Publish"}
                {saveStatus === "success" && "Published"}
                {saveStatus === "error" && "Error"}
              </Button>
              {draftSaving && (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                  <Spinner className="size-3.5" /> Saving draft…
                </span>
              )}
            </div>
            {(loadError || currentVersion != null || importStatus !== "idle") && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {loadError && (
                  <Notice kind="error" title="Error" className="w-full">
                    {loadError}
                  </Notice>
                )}
                {!loadError && importStatus === "ok" && (
                  <Notice kind="success" title="Success" className="w-full">
                    Config imported
                  </Notice>
                )}
                {!loadError && importStatus === "error" && (
                  <Notice kind="error" title="Import failed" className="w-full">
                    {importError ?? "Import failed"}
                  </Notice>
                )}
                {/* Live truth anchor: what is actually serving traffic, from the published config. */}
                {!loadError &&
                  liveKnowledge &&
                  (() => {
                    const diverged = isDivergedFromLive(knowledgeConfig, liveKnowledge);
                    const label = (
                      <>
                        <span aria-hidden className={cn("size-1.5 rounded-full", diverged ? "bg-status-warn" : "bg-status-ok")} />
                        Live: {liveKnowledge.provider} · {liveKnowledge.model || "(default)"}
                        {liveKnowledge.version != null && ` · v${liveKnowledge.version}`}
                      </>
                    );
                    if (!diverged) return <Badge variant="outline">{label}</Badge>;
                    return (
                      <Tooltip>
                        <TooltipTrigger render={<button type="button" className="cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
                          <Badge variant="outline">{label}</Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {`Draft differs from Live (now ${knowledgeConfig.embedding_provider} · ${knowledgeConfig.embedding_model || "(default)"}). Click Publish to apply.`}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })()}
                {!loadError && !draftSaving && currentVersion != null && (
                  <span>
                    Version: {currentVersion === "draft" ? "draft" : `v${currentVersion}`}
                    {history.length > 0 && (
                      <>
                        {" · "}Last publish: v{history[0].version}
                        {typeof history[0].created_at === "string" && <> ({new Date(history[0].created_at).toLocaleDateString()})</>}
                      </>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── try it out: chat against the draft ───────────────────────── */}
        <div className={cn("relative min-h-0 min-w-0 flex-1 lg:block", pane === "chat" ? "block" : "hidden")}>
          {configLoading ? (
            <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6" aria-label="Loading agent preview…">
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <ChatView
              key={`${effectiveAgentId}:${draftThreadId}`}
              agentId={effectiveAgentId}
              threadId={draftThreadId}
              title="Try your configuration"
              isReadonly={false}
              useDraft
              disableHistory
              attachmentScope="agent"
              homescreen={homescreen}
              profile={{ nickname: agentName || effectiveAgentId }}
              knowledgeEnabled={knowledgeConfig.enabled ?? true}
              sessionKnowledgeEnabled={knowledgeConfig.agent_level_enabled ?? true}
              sessionDocsVersion={knowledgeDocsVersion}
              onSessionDocsChanged={() => handleKnowledgeDocsChanged()}
              onThreadChange={() => {}}
              onRestart={() => setDraftThreadId(uuid())}
              onOpenKnowledge={() => setShowKnowledgeModal(true)}
              onPreviewAttachment={(a) => void handlePreviewKnowledgeAttachment(a)}
              headerEnd={
                (manageVariablesHistory.length > 0 || Object.keys(manageVariables).length > 0) && (
                  <Button variant="ghost" size="sm" aria-expanded={manageVariablesPanelOpen} onClick={() => setManageVariablesPanelOpen((o: boolean) => !o)}>
                    <VariableIcon data-icon="inline-start" />
                    Variables
                    <Badge variant="secondary">{Object.keys(manageVariables).length || manageVariablesHistory.length}</Badge>
                  </Button>
                )
              }
            />
          )}
        </div>
      </div>

      <Dialog open={manageVariablesPanelOpen} onOpenChange={setManageVariablesPanelOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Variables</DialogTitle>
            <DialogDescription className="sr-only">Variables produced by the draft conversation</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <VariablesSidebar
              variables={manageVariables}
              history={manageVariablesHistory}
              selectedAnswerId={manageSelectedAnswerId}
              onSelectAnswer={(id: string) => setManageSelectedAnswerId(id)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <SecretsManager
        open={secretsModalOpen}
        onClose={() => {
          setSecretsModalOpen(false);
          refreshSecrets();
        }}
        agentId={effectiveAgentId}
      />

      {showAddA2AModal && (
        <AddA2AAgentDialog
          onClose={() => setShowAddA2AModal(false)}
          onAdd={(entry) => {
            addA2ASubAgent(entry);
            setShowAddA2AModal(false);
          }}
        />
      )}

      {/* agentId: upstream's editor sends no agent id, so with several agents it reads and
          writes the *default* agent's policies. Here it targets the agent being configured. */}
      {showPoliciesModal && (
        <PoliciesConfig
          draftMode={true}
          agentId={effectiveAgentId}
          onClose={() => setShowPoliciesModal(false)}
          onSave={(policies) => setPolicies(policies)}
        />
      )}

      {showKnowledgeModal && (
        <KnowledgePanel
          onClose={() => setShowKnowledgeModal(false)}
          onDocsChanged={handleKnowledgeDocsChanged}
          onHealthChanged={(healthy) => {
            setKnowledgeHealthy(healthy);
            setKnowledgeHealthStatus(healthy ? "ready" : "failed");
          }}
          onToast={(kind: "error" | "success" | "warning", title: string, message: string) => addToast(kind, title, message)}
          knowledgeConfig={knowledgeConfig}
          onKnowledgeConfigChange={setKnowledgeConfig}
          draftSaveStatus={draftSaveStatus}
          onRetryDraftSave={() => {
            // Retrigger the autosave effect with the current value, and re-arm the
            // bounded retry used while a re-index is in progress.
            knowledgeSaveRetryRef.current = 0;
            setKnowledgeConfig((prev) => ({ ...prev }));
          }}
          onDismissDraftSave={() => setDraftSaveStatus({ kind: "idle" })}
          onPresetApplied={() => {
            // An explicit "Use" click skips the keystroke debounce.
            forceImmediateSaveRef.current = true;
          }}
          knowledgeReindexNeeded={knowledgeReindexNeeded}
          knowledgeStale={knowledgeStale}
          knowledgeReindexDeferred={knowledgeReindexDeferred}
          knowledgeReindexing={knowledgeReindexing}
          ragProfiles={ragProfiles}
          adaptationServerError={adaptationServerError}
          onAdaptationServerError={setAdaptationServerError}
          autoReindexTrigger={autoReindexTrigger}
          onAutoReindexConsumed={() => setAutoReindexTrigger(null)}
          onAutoReindexComplete={() => {
            // Re-embedding under the current config finished: advance the saved
            // snapshot so the "Re-index needed" banner clears.
            setKnowledgeSavedSnapshot({ ...knowledgeConfig });
            setKnowledgeReindexNeeded(false);
          }}
          onReindex={async () => {
            setKnowledgeReindexing(true);
            try {
              // Vector-config changes go through the config-aware migration
              // endpoint; a plain re-index uses the original one.
              const res = knowledgeReindexNeeded ? await api.triggerKnowledgeReindexForConfig(effectiveAgentId) : await api.triggerKnowledgeReindex();
              if (res.ok) {
                const data = await res.json();
                // knowledgeReindexing stays set until the panel reports that task
                // polling finished (onReindexFinished): the POST only starts the work.
                if (data?.triggered === false) {
                  setKnowledgeReindexing(false);
                  const ERR: Record<string, { title: string; kind: "warning" | "error"; msg: string }> = {
                    active_snapshot_missing: {
                      title: "Re-index didn't run",
                      kind: "error",
                      msg: "Your active document set isn't on disk. If you restored an older version, re-upload or migrate via CLI.",
                    },
                    copy_failed: {
                      title: "Re-index didn't run",
                      kind: "error",
                      msg: "Couldn't copy your documents to the new collection. Check disk space / permissions and retry.",
                    },
                    reindex_failed: {
                      title: "Re-index didn't run",
                      kind: "error",
                      msg: "Re-index ran but didn't embed anything. Check server logs and retry.",
                    },
                    reindex_busy: {
                      title: "Re-index couldn't start",
                      kind: "warning",
                      msg: "Uploads or another re-index are still running. Wait a moment, then try again.",
                    },
                  };
                  const code = typeof data.error === "string" ? data.error : "unknown";
                  const spec = ERR[code];
                  if (spec) addToast(spec.kind, spec.title, spec.msg);
                  else addToast("error", "Re-index didn't run", `Re-index couldn't run (${code}).`);
                  return null;
                }
                // The saved snapshot is advanced only on full success, via
                // onAutoReindexComplete. /reindex_for_config nests results per
                // collection; /reindex returns them flat. Normalise both.
                if (Array.isArray(data?.collections)) {
                  const allTaskIds: string[] = data.collections.flatMap((c: { result?: { task_ids?: string[] } }) => c?.result?.task_ids ?? []);
                  const allTasks: { task_id: string; filename: string }[] = data.collections.flatMap(
                    (c: { result?: { tasks?: { task_id: string; filename: string }[] } }) => c?.result?.tasks ?? []
                  );
                  const total = data.collections.reduce((sum: number, c: { result?: { count?: number } }) => sum + (c?.result?.count ?? 0), 0);
                  return { count: total || allTaskIds.length, task_ids: allTaskIds, tasks: allTasks };
                }
                return { count: data.count ?? 0, task_ids: data.task_ids ?? [], tasks: data.tasks ?? [] };
              } else if (res.status === 409) {
                addToast("warning", "Cannot re-index", "Uploads in progress. Try again later.");
                setKnowledgeReindexing(false);
              } else {
                addToast("error", "Re-index failed", `Error ${res.status}`);
                setKnowledgeReindexing(false);
              }
            } catch {
              addToast("error", "Re-index failed", "Network error");
              setKnowledgeReindexing(false);
            }
            return null;
          }}
          onReindexFinished={() => setKnowledgeReindexing(false)}
        />
      )}

      <Dialog open={showReindexConfirm} onOpenChange={(o) => !o && setShowReindexConfirm(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Re-index required</DialogTitle>
            <DialogDescription>
              Embedding or chunking settings changed. Publishing will re-index {knowledgeDocCount} document{knowledgeDocCount !== 1 ? "s" : ""} in the
              background. Search may return incomplete results during re-indexing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReindexConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => saveConfig()}>
              Publish &amp; Re-index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!knowledgePreviewModal} onOpenChange={(o) => !o && closeKnowledgePreviewModal()}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{knowledgePreviewModal?.attachment.display_name ?? ""}</DialogTitle>
            <DialogDescription className="sr-only">Document preview</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            {knowledgePreviewModal &&
              (knowledgePreviewModal.isPdf ? (
                <iframe title={knowledgePreviewModal.attachment.display_name} src={knowledgePreviewModal.downloadUrl} className="min-h-[70vh] w-full border-0" />
              ) : (
                <Markdown>
                  {knowledgePreviewModal.attachment.display_name.toLowerCase().endsWith(".md")
                    ? (knowledgePreviewModal.content ?? "")
                    : `\`\`\`\n${knowledgePreviewModal.content ?? ""}\n\`\`\``}
                </Markdown>
              ))}
          </div>
          {knowledgePreviewModal && (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  const anchor = document.createElement("a");
                  anchor.href = knowledgePreviewModal.downloadUrl;
                  anchor.download = knowledgePreviewModal.attachment.display_name;
                  anchor.click();
                }}
              >
                <DownloadIcon data-icon="inline-start" />
                Download
              </Button>
              <Button onClick={closeKnowledgePreviewModal}>Close</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewVersion} onOpenChange={(o) => !o && setViewVersion(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{viewVersion ? `Version ${viewVersion.version}` : ""}</DialogTitle>
            <DialogDescription className="sr-only">Configuration JSON of this version, secrets masked</DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            {viewVersion && (
              <Markdown>
                {"```json\n" +
                  JSON.stringify(
                    maskSecrets(
                      (() => {
                        const { knowledge_state: _ks, ...rest } = viewVersion.config as Record<string, unknown>;
                        void _ks;
                        return rest;
                      })()
                    ),
                    null,
                    2
                  ) +
                  "\n```"}
              </Markdown>
            )}
          </div>
          {viewVersion && (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(maskSecrets(viewVersion.config), null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `config-v${viewVersion.version}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <DownloadIcon data-icon="inline-start" />
                Download
              </Button>
              <Button
                onClick={() => {
                  const next = { ...DEFAULT_CONFIG, ...viewVersion.config };
                  if (Array.isArray(next.tools)) {
                    next.tools = normalizeTools(next.tools);
                  }
                  replaceLlmConfig(next.llm ?? DEFAULT_CONFIG.llm!);
                  setToolsState(Array.isArray(next.tools) ? next.tools : []);
                  setFeatureFlags(next.feature_flags ?? DEFAULT_CONFIG.feature_flags!);
                  setHomescreen(next.homescreen ?? DEFAULT_HOMESCREEN);
                  setPolicies(next.policies ?? { enablePolicies: true, policies: [] });
                  setSpecialInstructions(next.special_instructions ?? "");
                  setAgentKind(next.agent?.kind === "supervisor" ? "supervisor" : "single");
                  setSubAgents(Array.isArray(next.supervisor?.subAgents) ? next.supervisor.subAgents : []);
                  setPlanApproval(next.supervisor?.planApproval ?? false);
                  supervisorSaveSeqRef.current = supervisorSaveSeqFromConfig(next.supervisor);
                  setKnowledgeConfig(next.knowledge ? { ...DEFAULT_KNOWLEDGE_CONFIG, ...next.knowledge } : { ...DEFAULT_KNOWLEDGE_CONFIG });
                  setKnowledgeSavedSnapshot(next.knowledge ?? null);
                  setCurrentVersion(viewVersion.version);
                  setViewVersion(null);
                  addToast("success", "Version loaded", `Version ${viewVersion.version} is now your current configuration`);
                }}
              >
                <SaveIcon data-icon="inline-start" />
                Use as current
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </ManageShell>
  );
}
