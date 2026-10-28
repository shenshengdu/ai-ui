import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, User } from "lucide-react";
import { authAPI } from "@/lib/api/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

export const AuthSection = () => {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);
  const [open, setOpen] = useState(false);

  const resetForm = () => {
    setCurrentPassword("");
    setPassword("");
    setConfirmPassword("");
    setMessage(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      resetForm();
    }
  };

  const handleSave = async () => {
    setMessage(null);
    if (!currentPassword) {
      setMessage({ text: t("authSettings.currentRequired"), type: "error" });
      return;
    }
    if (password !== confirmPassword) {
      setMessage({ text: t("auth.passwordMismatch"), type: "error" });
      return;
    }

    if (password.length < 8) {
      setMessage({
        text: t("auth.passwordTooShort"),
        type: "error",
      });
      return;
    }

    setIsSaving(true);
    try {
      await authAPI.changePassword(currentPassword, password);
      setMessage({ text: t("authSettings.changed"), type: "success" });
      setCurrentPassword("");
      setPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setOpen(false);
        setMessage(null);
      }, 1000);
    } catch (error) {
      setMessage({
        text:
          error instanceof Error ? error.message : t("authSettings.changeFailed"),
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <h3 className="text-lg font-medium flex items-center gap-2">
        <User className="h-5 w-5" />
        {t("authSettings.title")}
      </h3>

      <div className="space-y-4">
        <div className="flex justify-between items-center pb-2">
          <div className="space-y-1">
            <Label className="text-base">{t("authSettings.password")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("authSettings.passwordDesc")}
            </p>
          </div>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Lock className="mr-2 h-4 w-4" />
                {t("authSettings.changePassword")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>{t("authSettings.changePassword")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="current-password">{t("authSettings.currentPassword")}</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={t("authSettings.currentPlaceholder")}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">{t("authSettings.newPassword")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("authSettings.newPlaceholder")}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">{t("auth.confirmPassword")}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("authSettings.confirmPlaceholder")}
                    autoComplete="new-password"
                  />
                </div>

                {message && (
                  <div
                    className={`text-sm ${message.type === "error" ? "text-red-500" : "text-green-500"}`}
                  >
                    {message.text}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={
                      isSaving ||
                      !currentPassword ||
                      !password ||
                      !confirmPassword
                    }
                  >
                    {isSaving ? t("common.saving") : t("authSettings.changePassword")}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
};
