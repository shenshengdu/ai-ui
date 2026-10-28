import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { modKeyLabel, shiftKeyLabel } from "@/lib/platform";
import { useI18n, type MessageKey } from "@/lib/i18n";

export const SHORTCUTS: { label: MessageKey; keys: string[] }[] = [
  { label: "shortcuts.newChat", keys: [modKeyLabel, shiftKeyLabel, "O"] },
  { label: "shortcuts.search", keys: [modKeyLabel, "K"] },
  { label: "shortcuts.toggleSidebar", keys: [modKeyLabel, shiftKeyLabel, "S"] },
  { label: "shortcuts.focusInput", keys: [shiftKeyLabel, "Esc"] },
  { label: "shortcuts.copyLast", keys: [modKeyLabel, shiftKeyLabel, "C"] },
  { label: "shortcuts.deleteChat", keys: [modKeyLabel, shiftKeyLabel, "⌫"] },
  { label: "shortcuts.show", keys: [modKeyLabel, "/"] },
  { label: "shortcuts.send", keys: ["Enter"] },
  { label: "shortcuts.newLine", keys: [shiftKeyLabel, "Enter"] },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader className="text-left">
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {SHORTCUTS.map((s) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-4 py-2.5 text-sm"
            >
              <span>{t(s.label)}</span>
              <Kbd keys={s.keys} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
