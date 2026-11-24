import { DownloadIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Markdown } from "@/components/markdown"

export interface FilePreview {
  name: string
  /** text content (markdown / code); omit for PDFs */
  content?: string
  /** blob/object URL for PDFs (rendered in an iframe) */
  pdfUrl?: string
  onDownload: () => void
}

/** Workspace / knowledge file preview (Carbon UI: ComposedModal + Markdown). */
export function FilePreviewDialog({ preview, onClose }: { preview: FilePreview | null; onClose: () => void }) {
  const { t } = useTranslation("chat")
  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{preview?.name}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {preview?.pdfUrl ? (
            <iframe title={preview.name} src={preview.pdfUrl} className="h-[70vh] w-full rounded-md border-0" />
          ) : preview ? (
            <Markdown>
              {preview.name.toLowerCase().endsWith(".md") ? (preview.content ?? "") : "```\n" + (preview.content ?? "") + "\n```"}
            </Markdown>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => preview?.onDownload()}>
            <DownloadIcon data-icon="inline-start" />
            {t("preview.download")}
          </Button>
          <DialogClose render={<Button />}>{t("common:action.close")}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
