import { useTranslation } from "react-i18next"

export function AiDisclosure({ id }: { id: string }) {
  const { t } = useTranslation("common")
  return (
    <p id={id} className="w-fit max-w-full rounded-md border bg-card px-3 py-1 text-sm text-foreground">
      {t("aiDisclosure")}
    </p>
  )
}
