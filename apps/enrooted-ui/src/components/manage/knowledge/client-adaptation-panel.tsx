/*
 * Knowledge harness panel: operator-supplied rules appended to the
 * knowledge-agent system prompt, plus the glossary.
 *
 * (The config keys are still `client_adaptation_*`: the backend/API names are
 * stable. Only the user-facing strings say "Knowledge harness".)
 *
 * Ported from cuga-agent/src/frontend_workspaces/agentic_chat/src/ClientAdaptationPanel.tsx
 * (Copyright IBM Corp., Apache-2.0)
 */
import * as React from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, CircleAlertIcon, PlusIcon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react"

import { Markdown } from "@/components/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import type { AdaptationServerErrorShape, GlossaryEntry } from "@/lib/manage/knowledge-types"
import { cn } from "@/lib/utils"
import { IconButton, InlineLoading, Notice, StatusDot, Tile } from "./parts"

// Must match CLIENT_ADAPTATION_MAX_CHARS in src/cuga/backend/knowledge/config.py.
// Enforced server-side; mirrored here for instant feedback only.
export const CLIENT_ADAPTATION_MAX_CHARS = 3000

// Unicode bidi-override codepoints, see _BIDI_OVERRIDE_CODEPOINTS in config.py.
// Mirrored client-side: a cheap, deterministic check that catches the
// prompt-smuggling vector at type-time.
const BIDI_OVERRIDE_RE = /[‪-‮⁦-⁩]/
const BIDI_OVERRIDE_RE_GLOBAL = /[‪-‮⁦-⁩]/g

// Mirrors backend constants for client-side validation only: the server is
// authoritative.
export const GLOSSARY_MAX_ENTRIES = 50
export const GLOSSARY_MAX_TERM_LEN = 100
export const GLOSSARY_MAX_ALIAS_LEN = 100
export const GLOSSARY_MAX_ALIASES_PER_ENTRY = 10
export const GLOSSARY_MAX_DEFINITION_LEN = 200

const EDITOR_ID = "knowledge-client-adaptation"

// Curated starting templates. Each one is an editable seed: picking a template
// appends it to the textarea; the result is plain editable text. `marker` is
// the substring used to detect "already added" (the body's section heading).
// `key` names the title/description in the locale files (harness.template.<key>);
// the body is prompt text for the model and stays in English.
const TEMPLATES: Array<{
  id: string
  key: string
  body: string
  marker: string
}> = [
  {
    id: "token-preservation",
    key: "tokenPreservation",
    marker: "## Token preservation",
    body:
      "## Token preservation\n\nWhen retrieval contains literal tokens shaped as `[Bracketed]`\n" +
      "labels, `A > B > C` paths, codes (`K3`, `9.150.1`), or quoted field\n" +
      "names, reproduce them character-for-character. Don't translate.\n",
  },
  {
    id: "answer-policy",
    key: "answerPolicy",
    marker: "## Answer policy",
    body:
      "## Answer policy\n\nWhen retrieval contains a procedure, answer with the procedure.\n\n" +
      '- WRONG: "We did not find an explicit process — contact support."\n' +
      '- RIGHT: "Per <file>: open [Settings] > [Network], set Mode = Manual."\n' +
      '- WRONG: "click the save button"\n' +
      '- RIGHT: "click [Save]"\n' +
      '- WRONG: "code 3 or 4 — verify"\n' +
      '- RIGHT: "[code 3] for case A; [code 4] for case B (per docs)"\n\n' +
      "Hedging is correct ONLY when retrieval returned zero hits.\n",
  },
  {
    id: "support-runbook",
    key: "supportRunbook",
    marker: "## Support runbook",
    body:
      "## Support runbook — verbatim discipline\n\n" +
      '- WRONG: "use the network troubleshooter"\n' +
      '- RIGHT: "open [Settings] > [Network] > [Diagnostics]; click [Run Test]"\n' +
      '- WRONG: "error code 0x80004005 — check the docs"\n' +
      '- RIGHT: "error code 0x80004005 means TLS handshake failed; per <runbook.pdf>: rotate the cert via Vault and restart nginx"\n' +
      '- WRONG: "the procedure is not documented"\n' +
      "- RIGHT: quote the procedure from the retrieved chunk verbatim — bracketed labels, codes, and menu paths intact.\n",
  },
  {
    id: "empty-context",
    key: "emptyContext",
    marker: "## Empty-context discipline",
    body:
      "## Empty-context discipline\n\n" +
      "When retrieval returns zero hits, say so plainly — don't fall back to general knowledge.\n\n" +
      '- WRONG: "Click [Save] to commit the change."   (guessed, no retrieval hit)\n' +
      '- RIGHT: "I didn\'t find a documented procedure for this. Can you share the runbook or narrow the question?"\n' +
      '- WRONG: "The setting lives under [Admin] > [Permissions]."   (no source)\n' +
      '- RIGHT: "No matching documentation. Try the exact feature name, or share the spec."\n' +
      '- WRONG: "code 503 likely means the cache failed."   (general knowledge, not the docs)\n' +
      "- RIGHT: name what you searched, report zero hits, and ask for a narrower query or a source link.\n",
  },
  {
    id: "vocabulary-hints",
    key: "vocabularyHints",
    marker: "## Vocabulary hints",
    body:
      "## Vocabulary hints\n\n" +
      "When the question uses one of these terms, also consider the others as matches in retrieved content:\n\n" +
      "- PTO ↔ paid time off ↔ vacation ↔ leave\n" +
      "- 401(k) ↔ 401k ↔ retirement plan\n" +
      "- SLA ↔ service level agreement\n" +
      "- credentials ↔ creds ↔ secret ↔ token\n\n" +
      "Treat acronyms and spelled-out forms as equivalent. Cite whichever form actually appears in the retrieved chunk.\n",
  },
  {
    id: "source-citation",
    key: "sourceCitation",
    marker: "## Source citation",
    body:
      "## Source citation\n\n" +
      "After every procedural claim — steps, codes, paths, button names — append `(source: <filename>)` in parentheses.\n\n" +
      '- WRONG: "Click [Save] to commit."\n' +
      '- RIGHT: "Click [Save] to commit (source: handbook.pdf)."\n\n' +
      "If you can't point to a retrieved chunk for a claim, omit the claim entirely — don't pad with general knowledge.\n",
  },
]

// Client-side validation result: only the deterministic subset of the server checks.
export type LocalValidation =
  | { kind: "ok" }
  | { kind: "length"; length: number; max: number }
  | { kind: "bidi" }

export function validateClientAdaptation(text: string): LocalValidation {
  if (text.length > CLIENT_ADAPTATION_MAX_CHARS) {
    return { kind: "length", length: text.length, max: CLIENT_ADAPTATION_MAX_CHARS }
  }
  if (BIDI_OVERRIDE_RE.test(text)) return { kind: "bidi" }
  return { kind: "ok" }
}

// Remove only the bidi-override range; leave all other characters intact.
function stripInvisibleChars(text: string): string {
  return text.replace(BIDI_OVERRIDE_RE_GLOBAL, "")
}

export interface ClientAdaptationDriftState {
  driftFromPublished: boolean
  publishedHashShort: string
  draftHashShort: string
}

export interface ClientAdaptationPanelProps {
  value: string
  onChange: (next: string) => void
  glossary?: GlossaryEntry[]
  onGlossaryChange?: (next: GlossaryEntry[]) => void
  // Single-shot atomic clear for BOTH `value` and `glossary`. The parent merges
  // both deltas into one state update so neither overwrites the other. If
  // omitted, Reset falls back to the dual-call path (best-effort).
  onReset?: () => void
  saveState?: "idle" | "saving" | "saved" | "error"
  /** Accepted for call-site compatibility; not rendered (as in the original). */
  drift?: ClientAdaptationDriftState
  serverError?: AdaptationServerErrorShape | null
}

/**
 * Marks this surface as AI-affecting; the popover explains the model effect
 * (stands in for Carbon's AILabel).
 */
function AdaptationAILabel() {
  const { t } = useTranslation("knowledge")
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("harness.aiLabel")}
            className="cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        <Badge variant="outline">{t("harness.aiBadge")}</Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <h6 className="text-sm font-semibold">{t("harness.title")}</h6>
        <p className="text-[0.8125rem] text-muted-foreground">{t("harness.about")}</p>
      </PopoverContent>
    </Popover>
  )
}

export function ClientAdaptationPanel({
  value,
  onChange,
  glossary,
  onGlossaryChange,
  onReset,
  saveState = "idle",
  serverError,
}: ClientAdaptationPanelProps) {
  const { t } = useTranslation("knowledge")
  const [mode, setMode] = React.useState<0 | 1>(0) // 0 = Edit, 1 = Rendered preview
  const entries: GlossaryEntry[] = glossary ?? []

  const localValidation = React.useMemo(() => validateClientAdaptation(value), [value])
  const isEmpty = value.trim().length === 0 && entries.length === 0

  // Single-click reset. Atomic via `onReset` when the parent provides it (the
  // only way to clear text + glossary without the stale-closure overwrite that
  // `onChange("") + onGlossaryChange([])` suffers from).
  const onResetClick = () => {
    if (isEmpty) return
    if (onReset) {
      onReset()
      return
    }
    onChange("")
    if (onGlossaryChange) onGlossaryChange([])
  }

  // Glossary mutation helpers (all immutable; the parent owns the state).
  const updateEntry = (i: number, patch: Partial<GlossaryEntry>) => {
    if (!onGlossaryChange) return
    onGlossaryChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  const removeEntry = (i: number) => {
    if (!onGlossaryChange) return
    onGlossaryChange(entries.filter((_, idx) => idx !== i))
  }
  const addEntry = () => {
    if (!onGlossaryChange) return
    if (entries.length >= GLOSSARY_MAX_ENTRIES) return
    onGlossaryChange([...entries, { term: "", aliases: [], definition: "" }])
  }

  // If the editor already has content, append after a separator; otherwise set.
  const onTemplateClick = (templateBody: string) => {
    onChange(isEmpty ? templateBody : value.trimEnd() + "\n\n" + templateBody)
  }

  const saveText =
    saveState === "saving"
      ? t("common:state.saving")
      : saveState === "error"
        ? t("shared.couldntSave")
        : saveState === "saved"
          ? t("shared.saved")
          : ""

  const hasNotification =
    localValidation.kind === "bidi" ||
    serverError?.error === "contract_override_phrase" ||
    serverError?.error === "control_char"

  const invalid = localValidation.kind !== "ok" || !!serverError
  const invalidText =
    localValidation.kind === "length"
      ? t("harness.overBy", { over: localValidation.length - localValidation.max })
      : localValidation.kind === "bidi"
        ? t("harness.bidiInline")
        : (serverError?.message ?? "")

  return (
    <section
      aria-roledescription={t("harness.roleDescription")}
      aria-label={t("harness.editorLabel")}
      className="flex max-w-[780px] flex-col gap-3"
    >
      {/* One calm header line: dot · title · AI label · save text */}
      <div className="flex items-center gap-2">
        <StatusDot state={isEmpty ? "off" : "ok"} title={isEmpty ? t("harness.statusOff") : t("harness.statusActive")} />
        <h5 className="text-sm font-semibold">{t("harness.title")}</h5>
        <span className="sr-only">{isEmpty ? t("harness.srOff") : t("harness.srActive")}</span>
        <AdaptationAILabel />
        <span className="flex-1" />
        {saveState === "saving" ? (
          <InlineLoading>{t("common:state.saving")}</InlineLoading>
        ) : (
          saveText && (
            <span aria-live="polite" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {saveState === "error" && (
                <CircleAlertIcon className="size-3.5 text-status-warn" aria-hidden="true" />
              )}
              {saveText}
            </span>
          )
        )}
      </div>

      {/* The editor. Hidden (not unmounted) in preview so "Find" keeps working. */}
      <div className={cn("flex flex-col gap-1", mode === 1 && "hidden")}>
        <Textarea
          id={EDITOR_ID}
          aria-label={t("harness.markdownLabel")}
          aria-invalid={invalid || undefined}
          aria-describedby={`${EDITOR_ID}-meta`}
          placeholder={t("harness.placeholder")}
          value={value}
          rows={10}
          className="min-h-56 font-mono"
          onChange={(e) => onChange(e.target.value)}
        />
        <div id={`${EDITOR_ID}-meta`} className="flex items-start justify-between gap-3 text-xs">
          <span className="flex items-start gap-1.5 text-warn-text" role={invalid ? "alert" : undefined}>
            {invalid && invalidText && (
              <>
                <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-status-warn" aria-hidden="true" />
                {invalidText}
              </>
            )}
          </span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {value.length}/{CLIENT_ADAPTATION_MAX_CHARS}
          </span>
        </div>
      </div>

      {/* The rendered preview is a quiet inline panel, not a competing tab. */}
      {mode === 1 && (
        <Tile className="min-h-44 p-4">
          {isEmpty ? (
            <em className="text-[0.8125rem] text-muted-foreground">{t("harness.nothingYet")}</em>
          ) : (
            <Markdown size="sm">{value}</Markdown>
          )}
        </Tile>
      )}

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2.5"
          onClick={() => setMode((m) => (m === 0 ? 1 : 0))}
        >
          {mode === 0 ? t("harness.previewRendered") : t("harness.backToEdit")}
        </Button>
      </div>

      {/* Inline notifications: rendered only when present */}
      {hasNotification && (
        <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-2">
          {localValidation.kind === "bidi" && (
            <Notice
              kind="warning"
              title={t("harness.bidi.title")}
              actionLabel={t("harness.bidi.action")}
              onAction={() => onChange(stripInvisibleChars(value))}
            >
              {t("harness.bidi.body")}
            </Notice>
          )}
          {serverError?.error === "contract_override_phrase" && (
            <Notice
              kind="error"
              title={t("harness.contract.title")}
              actionLabel={t("harness.contract.action")}
              onAction={() => {
                const el = document.getElementById(EDITOR_ID) as HTMLTextAreaElement | null
                const phrase = serverError.phrase
                if (!el || !phrase) return
                const idx = value.toLowerCase().indexOf(phrase.toLowerCase())
                if (idx >= 0) {
                  // The editor is hidden in preview mode: switch back first.
                  setMode(0)
                  setTimeout(() => {
                    el.focus()
                    el.setSelectionRange(idx, idx + phrase.length)
                  }, 0)
                }
              }}
            >
              {t("harness.contract.body", { phrase: JSON.stringify(serverError.phrase) })}
            </Notice>
          )}
          {serverError?.error === "control_char" && (
            <Notice kind="error" title={t("harness.controlChar.title")}>
              {t("harness.controlChar.body", { codepoint: String(serverError.codepoint) })}
            </Notice>
          )}
        </div>
      )}

      {/* Examples gallery: always visible. Inserting a template APPENDS to the
          current text; the "Added" mark is a passive hint, not a lock. */}
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h6 className="text-[0.8125rem] font-semibold">{t("harness.examples.heading")}</h6>
          <span className="text-xs text-muted-foreground">{t("harness.examples.hint")}</span>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isEmpty}
            onClick={onResetClick}
            title={isEmpty ? t("harness.examples.nothingToReset") : t("harness.examples.resetTitle")}
          >
            <RotateCcwIcon data-icon="inline-start" />
            {t("harness.examples.reset")}
          </Button>
        </div>
        <ul aria-label={t("harness.examples.listLabel")} className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
          {TEMPLATES.map((template) => {
            const added = value.includes(template.marker)
            return (
              <li key={template.id} className="flex">
                <button
                  type="button"
                  onClick={() => onTemplateClick(template.body)}
                  title={added ? t("harness.examples.appendAgain") : t("harness.examples.append")}
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors outline-none hover:bg-foreground/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-[0.8125rem] font-semibold">
                      {t(`harness.template.${template.key}.title`)}
                    </span>
                    {added && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[0.6875rem] text-muted-foreground"
                        title={t("harness.examples.alreadyInserted")}
                      >
                        <CheckIcon className="size-3 text-status-ok" aria-hidden="true" />
                        {t("harness.examples.added")}
                      </span>
                    )}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {t(`harness.template.${template.key}.description`)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Glossary: borderless rows, chip aliases */}
      {onGlossaryChange && (
        <div className="mt-5 flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h6 className="text-[0.8125rem] font-semibold">{t("harness.glossary.heading")}</h6>
            <span className="text-xs text-muted-foreground">{t("harness.glossary.hint")}</span>
            <span className="flex-1" />
            {entries.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {entries.length} / {GLOSSARY_MAX_ENTRIES}
              </span>
            )}
          </div>

          {entries.length > 0 && (
            <div role="table" aria-label={t("harness.glossary.tableLabel")} className="overflow-x-auto">
              <div role="row" className={cn(GLOSSARY_GRID, "pb-1")}>
                <ColumnHeader>{t("harness.glossary.term")}</ColumnHeader>
                <ColumnHeader>{t("harness.glossary.aliases")}</ColumnHeader>
                <ColumnHeader>{t("harness.glossary.definition")}</ColumnHeader>
                <span role="columnheader" className="sr-only">
                  {t("harness.glossary.actions")}
                </span>
              </div>
              {entries.map((e, i) => (
                <GlossaryRow
                  key={`gloss-${i}`}
                  index={i}
                  entry={e}
                  onTermChange={(v) => updateEntry(i, { term: v })}
                  onAliasesChange={(v) => updateEntry(i, { aliases: v })}
                  onDefinitionChange={(v) => updateEntry(i, { definition: v })}
                  onRemove={() => removeEntry(i)}
                />
              ))}
            </div>
          )}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2.5"
              onClick={addEntry}
              disabled={entries.length >= GLOSSARY_MAX_ENTRIES}
            >
              <PlusIcon data-icon="inline-start" />
              {t("harness.glossary.addTerm")}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── GlossaryRow ────────────────────────────────────────────────────────────
// A borderless row with a thin bottom divider reads as a table, not a stack of
// cards. Aliases are chips: Enter / comma commits, Backspace on an empty input
// removes the last chip.
const GLOSSARY_GRID =
  "grid min-w-[36rem] grid-cols-[minmax(120px,1fr)_minmax(220px,2fr)_minmax(180px,2fr)_28px] items-center gap-x-3"

function ColumnHeader({ children }: { children: React.ReactNode }) {
  return (
    <span role="columnheader" className="text-[0.6875rem] tracking-wider text-muted-foreground uppercase">
      {children}
    </span>
  )
}

function GlossaryRow({
  index,
  entry,
  onTermChange,
  onAliasesChange,
  onDefinitionChange,
  onRemove,
}: {
  index: number
  entry: GlossaryEntry
  onTermChange: (v: string) => void
  onAliasesChange: (v: string[]) => void
  onDefinitionChange: (v: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation("knowledge")
  // The draft is local so typing an alias does not re-render the parent.
  const [aliasDraft, setAliasDraft] = React.useState("")
  const aliasInputRef = React.useRef<HTMLInputElement | null>(null)
  const aliases = entry.aliases ?? []

  const commitChip = () => {
    const v = aliasDraft.trim()
    if (!v) return
    if (aliases.length >= GLOSSARY_MAX_ALIASES_PER_ENTRY) return
    if (aliases.some((a) => a.toLowerCase() === v.toLowerCase())) {
      setAliasDraft("")
      return
    }
    onAliasesChange([...aliases, v])
    setAliasDraft("")
  }

  const removeChip = (i: number) => onAliasesChange(aliases.filter((_, idx) => idx !== i))

  return (
    <div role="row" className={cn(GLOSSARY_GRID, "border-b py-2")}>
      <div role="cell">
        <Input
          id={`gloss-term-${index}`}
          aria-label={t("harness.glossary.term")}
          placeholder="K3"
          value={entry.term}
          maxLength={GLOSSARY_MAX_TERM_LEN}
          onChange={(ev) => onTermChange(ev.target.value)}
        />
      </div>
      <div
        role="cell"
        onClick={() => aliasInputRef.current?.focus()}
        className="flex min-h-8 cursor-text flex-wrap items-center gap-1 rounded-lg border border-input px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      >
        {aliases.map((a, i) => (
          <Badge key={`a-${i}`} variant="secondary" className="pr-0.5">
            {a}
            <button
              type="button"
              aria-label={t("harness.glossary.removeAlias", { alias: a })}
              title={t("harness.glossary.removeAlias", { alias: a })}
              className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={(ev) => {
                ev.stopPropagation()
                removeChip(i)
              }}
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}
        <input
          ref={aliasInputRef}
          aria-label={
            entry.term
              ? t("harness.glossary.addAliasFor", { term: entry.term })
              : t("harness.glossary.addAliasForThis")
          }
          value={aliasDraft}
          maxLength={GLOSSARY_MAX_ALIAS_LEN}
          onChange={(e) => setAliasDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              commitChip()
            } else if (e.key === "Backspace" && !aliasDraft && aliases.length > 0) {
              e.preventDefault()
              removeChip(aliases.length - 1)
            }
          }}
          onBlur={commitChip}
          placeholder={aliases.length === 0 ? t("harness.glossary.aliasPlaceholder") : ""}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div role="cell">
        <Input
          id={`gloss-def-${index}`}
          aria-label={t("harness.glossary.definition")}
          placeholder={t("harness.glossary.definitionPlaceholder")}
          value={entry.definition ?? ""}
          maxLength={GLOSSARY_MAX_DEFINITION_LEN}
          onChange={(ev) => onDefinitionChange(ev.target.value)}
        />
      </div>
      <div role="cell">
        <IconButton label={t("harness.glossary.removeTerm")} onClick={onRemove}>
          <Trash2Icon />
        </IconButton>
      </div>
    </div>
  )
}
