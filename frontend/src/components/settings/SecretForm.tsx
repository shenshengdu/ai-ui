import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Check, Copy, Loader2 } from "lucide-react";
import { SecretRequest, SecretResponse } from "@/lib/api/types";
import { useI18n } from "@/lib/i18n";

interface SecretFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: SecretRequest) => Promise<void>;
  title: string;
  submitLabel: string;
  secret?: SecretResponse | null;
}

// No spaces: letters, digits, underscore only.
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export const secretRef = (name: string) => `$secrets.${name}$`;

export const SecretForm = ({
  open,
  onOpenChange,
  onSubmit,
  title,
  submitLabel,
  secret,
}: SecretFormProps) => {
  const { t } = useI18n();
  const isEdit = Boolean(secret?.id);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setValue("");
      setError(null);
      setCopied(false);
      return;
    }
    setName(secret?.name ?? "");
    setValue("");
    setError(null);
    setCopied(false);
  }, [open, secret]);

  const previewName = name.replace(/\s+/g, "").toUpperCase() || "NAME";
  const previewRef = secretRef(previewName);

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(previewRef);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.replace(/\s+/g, "").trim();
    if (/\s/.test(name)) {
      setError(t("secretForm.noSpaces"));
      return;
    }
    if (!trimmedName || !NAME_RE.test(trimmedName)) {
      setError(
        t("secretForm.invalidName"),
      );
      return;
    }
    if (!isEdit && !value) {
      setError(t("secretForm.valueRequired"));
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        id: secret?.id,
        name: trimmedName,
        value,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("secretForm.saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="secret-name">{t("common.name")}</Label>
            <Input
              id="secret-name"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s/g, ""))}
              placeholder="GITHUB_TOKEN"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyRef}
                className="inline-flex items-center gap-1.5 max-w-full rounded-md border bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/80"
                title={t("secrets.copyForChat")}
              >
                <span className="truncate">{previewRef}</span>
                {copied ? (
                  <Check className="size-3.5 shrink-0 text-green-600" />
                ) : (
                  <Copy className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="secret-value">{t("secretForm.value")}</Label>
            <Input
              id="secret-value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={isEdit ? t("secretForm.keepValue") : ""}
              autoComplete="new-password"
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                {t("secretForm.writeOnly")}
              </p>
            )}
          </div>
          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
