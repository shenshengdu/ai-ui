import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Settings,
  Database,
  ListChecks,
  Server,
  Wrench,
  Loader2,
  FileText,
  Lock,
  BookOpen,
  ImageIcon,
  KeyRound,
} from "lucide-react";
import { ProvidersSection } from "./ProvidersSection";
import { GlobalSettingsSection } from "./GlobalSettingsSection";
import { MediaSection } from "./MediaSection";
import { ModelsSection } from "./ModelsSection";
import { MCPServersSection } from "./MCPServersSection";
import { ToolsSection } from "./ToolsSection";
import { DocumentsSection } from "./DocumentsSection";
import { AuthSection } from "./AuthSection";
import { SkillsSection } from "./SkillsSection";
import { SecretsSection } from "./SecretsSection";
import { useSettingsData } from "@/hooks/useSettingsData";
import { useI18n } from "@/lib/i18n";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab =
  | "providers"
  | "models"
  | "global"
  | "media"
  | "mcp"
  | "tools"
  | "skills"
  | "secrets"
  | "documents"
  | "auth";

const SettingsDialogContent = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>("global");
  const { loaded, loading, fetchAll } = useSettingsData();

  useEffect(() => {
    if (!loaded && !loading) {
      fetchAll();
    }
  }, [loaded, loading, fetchAll]);

  const tabs = [
    {
      id: "global" as const,
      label: t("settings.tab.general"),
      icon: Settings,
    },
    {
      id: "providers" as const,
      label: t("settings.tab.providers"),
      icon: Database,
    },

    {
      id: "models" as const,
      label: t("settings.tab.models"),
      icon: ListChecks,
    },
    {
      id: "mcp" as const,
      label: t("settings.tab.mcp"),
      icon: Server,
    },
    {
      id: "tools" as const,
      label: t("settings.tab.tools"),
      icon: Wrench,
    },
    {
      id: "skills" as const,
      label: t("settings.tab.skills"),
      icon: BookOpen,
    },
    {
      id: "secrets" as const,
      label: t("settings.tab.secrets"),
      icon: KeyRound,
    },
    {
      id: "documents" as const,
      label: t("settings.tab.documents"),
      icon: FileText,
    },
    {
      id: "media" as const,
      label: t("settings.tab.media"),
      icon: ImageIcon,
    },
    {
      id: "auth" as const,
      label: t("settings.tab.account"),
      icon: Lock,
    },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case "providers":
        return <ProvidersSection />;
      case "models":
        return <ModelsSection />;
      case "global":
        return <GlobalSettingsSection />;
      case "media":
        return <MediaSection />;
      case "mcp":
        return <MCPServersSection />;
      case "tools":
        return <ToolsSection />;
      case "skills":
        return <SkillsSection />;
      case "secrets":
        return <SecretsSection />;
      case "documents":
        return <DocumentsSection />;
      case "auth":
        return <AuthSection />;
      default:
        return null;
    }
  };

  return (
    <DialogContent className="w-[calc(100%-1rem)] sm:w-[calc(100%-3rem)] max-w-7xl sm:max-w-4xl h-[80vh] sm:h-[65vh] p-0 flex flex-col rounded-3xl">
      <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
        <DialogTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t("settings.title")}
        </DialogTitle>
      </DialogHeader>

      {!loaded && loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{t("settings.loading")}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
          {/* Top bar on small screens / Sidebar on larger screens */}
          <div className="sm:w-48 border-b sm:border-b-0 sm:border-r flex-shrink-0">
            <div className="overflow-x-auto sm:overflow-x-visible sm:overflow-y-auto sm:h-full">
              <nav className="flex flex-row sm:flex-col gap-1 p-2 sm:p-4 sm:py-6">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 sm:py-3 sm:w-full sm:justify-start rounded-lg transition-colors ${
                        activeTab === tab.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <ScrollArea className="h-full w-full">
              <div className="p-4 sm:p-8 max-w-full">{renderTabContent()}</div>
            </ScrollArea>
          </div>
        </div>
      )}
    </DialogContent>
  );
};

export const SettingsDialog = ({ open, onOpenChange }: SettingsDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SettingsDialogContent />
    </Dialog>
  );
};
