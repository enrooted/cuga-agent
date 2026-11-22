import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import { cn } from "@/lib/utils"

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import { useHighlightedCode } from "@/hooks/use-highlighted-code"
import { CitationChip } from "@/components/chat/citation-chip"
import type { MessageSource } from "@/lib/citations"

// The Carbon UI renders answers with markdown-it (html:true). We keep raw HTML
// for the few tags CUGA actually emits — <details>/<summary> in sub-agent
// steps and <cuga-cite> citation chips — and sanitize everything else.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary", "cuga-cite"],
  attributes: {
    ...defaultSchema.attributes,
    "cuga-cite": ["n", "msg"],
    details: ["open"],
  },
}

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language)
  return (
    <>
      {lines.map((line, i) => (
        <CodeBlockLine key={i}>{line}</CodeBlockLine>
      ))}
    </>
  )
}

function FencedCode({ code, language, size }: { code: string; language: string; size?: "sm" | "default" }) {
  return (
    <CodeBlock size={size} className="my-2">
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap={size === "sm"} className={size === "sm" ? "max-h-64" : "max-h-[32rem]"}>
        {language ? <HighlightedCode code={code} language={language} /> : code.replace(/\n$/, "")}
      </CodeBlockContent>
    </CodeBlock>
  )
}

export function Markdown({
  children,
  sources,
  onOpenCitation,
  size = "default",
  className,
}: {
  children: string
  sources?: MessageSource[]
  onOpenCitation?: (n: number) => void
  /** "sm" for content inside trace rows (smaller, wrapped code). */
  size?: "sm" | "default"
  className?: string
}) {
  const components = React.useMemo<Components>(
    () => ({
      pre: ({ children }) => <>{children}</>,
      code: ({ className: cls, children: code, node }) => {
        const text = String(code ?? "")
        const isBlock = node?.position?.start.line !== node?.position?.end.line || /language-/.test(cls ?? "")
        if (!isBlock) {
          return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{code}</code>
        }
        const language = /language-([\w-]+)/.exec(cls ?? "")?.[1] ?? ""
        return <FencedCode code={text} language={language} size={size} />
      },
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-4 hover:decoration-2">
          {children}
        </a>
      ),
      details: ({ children }) => (
        <details className="my-1 rounded-md border px-3 py-1.5 [&[open]>summary]:mb-2">{children}</details>
      ),
      summary: ({ children }) => (
        <summary className="cursor-pointer text-sm font-medium text-foreground">{children}</summary>
      ),
      table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      th: ({ children }) => <th className="border px-2 py-1 text-left font-medium">{children}</th>,
      td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
      // custom element produced by injectCitations
      "cuga-cite": ({ n }: { n?: string }) => {
        const num = Number(n)
        const source = sources?.find((s) => s.n === num)
        return <CitationChip n={num} source={source} onOpen={() => onOpenCitation?.(num)} />
      },
    }),
    [onOpenCitation, size, sources]
  )

  return (
    <div
      className={cn(
        "markdown min-w-0 text-sm leading-relaxed wrap-break-word text-body",
        "[&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground [&_strong]:font-bold [&_strong]:text-foreground",
        "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:text-xs [&_h6]:font-semibold",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-3",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
