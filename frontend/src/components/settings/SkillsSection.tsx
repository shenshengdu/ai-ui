import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "../ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BookOpen, Edit, ExternalLink, Eye, Plus, Trash2 } from "lucide-react";
import { SkillForm } from "./SkillForm";
import { SkillRequest, SkillResponse } from "@/lib/api/types";
import { useSettingsData } from "@/hooks/useSettingsData";
import { useI18n } from "@/lib/i18n";

export const SkillsSection = () => {
  const { t } = useI18n();
  const {
    data,
    addSkill,
    updateSkill,
    deleteSkill,
    updateSettingsLocal,
    saveSettings,
  } = useSettingsData();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [togglingBuiltins, setTogglingBuiltins] = useState(false);

  const builtinsEnabled = data.settings.enableBuiltinSkills !== "false";

  // Switch onClick does not pass a boolean — flip from current state.
  const handleBuiltinToggle = async () => {
    setTogglingBuiltins(true);
    try {
      updateSettingsLocal(
        "enableBuiltinSkills",
        builtinsEnabled ? "false" : "true",
      );
      await saveSettings();
    } finally {
      setTogglingBuiltins(false);
    }
  };

  const handleAddSkill = async (skillData: SkillRequest) => {
    await addSkill(skillData);
    setShowAddForm(false);
  };

  const handleEditSkill = async (skillData: SkillRequest) => {
    await updateSkill(skillData);
    setEditingSkill(null);
    setViewOnly(false);
  };

  const handleDeleteSkill = async (id: string, name: string) => {
    if (id.startsWith("builtin:")) {
      return;
    }
    if (confirm(t("skills.confirmDelete", { name }))) {
      await deleteSkill(id);
    }
  };

  const openSkill = (skill: SkillResponse, readOnly: boolean) => {
    setViewOnly(readOnly);
    setEditingSkill(skill);
  };

  const userSkills = data.skills.filter((s) => !s.builtin);
  const builtinSkills = data.skills.filter((s) => s.builtin);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          {t("skills.title")}
        </h3>
        <Button
          onClick={() => setShowAddForm(true)}
          variant="outline"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t("skills.add")}</span>
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("skills.intro")}{" "}
        <a
          href="https://github.com/Bajahaw/ai-ui/tree/main/examples/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary inline-flex items-center gap-1 hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("skills.browseExamples")}
        </a>
      </p>

      <div className="flex items-center justify-between">
        <Label className="!mb-0">{t("skills.enableBuiltin")}</Label>
        <Switch
          className="mx-1"
          checked={builtinsEnabled}
          onCheckedChange={handleBuiltinToggle}
          disabled={togglingBuiltins}
        />
      </div>

      {data.skills.length === 0 ? (
        <Card className="p-6 text-center bg-transparent border-dashed">
          <div className="space-y-2">
            <p className="text-muted-foreground">{t("skills.empty")}</p>
            <Button
              onClick={() => setShowAddForm(true)}
              variant="outline"
              size="sm"
            >
              <Plus className="h-4 w-4" />
              {t("skills.addFirst")}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6 overflow-hidden">
          {userSkills.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t("skills.yours")}
              </h4>
              {userSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onEdit={() => openSkill(skill, false)}
                  onDelete={() => handleDeleteSkill(skill.id, skill.name)}
                />
              ))}
            </div>
          )}

          {builtinSkills.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">
                {t("skills.builtin")}
                {!builtinsEnabled && (
                  <span className="ml-2 text-xs font-normal">{t("skills.disabledTag")}</span>
                )}
              </h4>
              {builtinSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  inactive={!builtinsEnabled}
                  onView={() => openSkill(skill, true)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <SkillForm
        open={showAddForm}
        onOpenChange={setShowAddForm}
        onSubmit={handleAddSkill}
        title={t("skills.add")}
        submitLabel={t("skills.add")}
      />

      <SkillForm
        open={!!editingSkill}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSkill(null);
            setViewOnly(false);
          }
        }}
        onSubmit={handleEditSkill}
        skill={editingSkill}
        title={viewOnly ? t("skills.viewBuiltinTitle") : t("skills.editTitle")}
        submitLabel={t("common.saveChanges")}
        readOnly={viewOnly}
      />
    </div>
  );
};

function SkillCard({
  skill,
  inactive = false,
  onEdit,
  onView,
  onDelete,
}: {
  skill: SkillResponse;
  inactive?: boolean;
  onEdit?: () => void;
  onView?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card
      className={`p-4 bg-transparent overflow-hidden ${
        inactive ? "opacity-60" : ""
      }`}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="truncate max-w-[75px] sm:max-w-[280px]">
                {skill.name}
              </h4>
              {skill.builtin && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {t("skills.system")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onView && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onView}
                title={t("skills.view")}
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
            {onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onEdit}
                title={t("skills.edit")}
              >
                <Edit className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                title={t("skills.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {skill.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {skill.description}
          </p>
        )}
      </div>
    </Card>
  );
}
