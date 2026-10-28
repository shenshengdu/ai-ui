import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { modKeyLabel, shiftKeyLabel } from "@/lib/platform";

export const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "New chat", keys: [modKeyLabel, shiftKeyLabel, "O"] },
  { label: "Search chats", keys: [modKeyLabel, "K"] },
  { label: "Toggle sidebar", keys: [modKeyLabel, shiftKeyLabel, "S"] },
  { label: "Focus chat input", keys: [shiftKeyLabel, "Esc"] },
  { label: "Copy last response", keys: [modKeyLabel, shiftKeyLabel, "C"] },
  { label: "Delete chat", keys: [modKeyLabel, shiftKeyLabel, "⌫"] },
  { label: "Show shortcuts", keys: [modKeyLabel, "/"] },
  { label: "Send message", keys: ["Enter"] },
  { label: "New line", keys: [shiftKeyLabel, "Enter"] },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader className="text-left">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {SHORTCUTS.map((s) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-4 py-2.5 text-sm"
            >
              <span>{s.label}</span>
              <Kbd keys={s.keys} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
