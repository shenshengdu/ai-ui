import type React from "react";
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  PresentationIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

interface FileCardProps {
  href: string;
  filename: React.ReactNode;
  isExternal?: boolean;
}

export function FileCard({ href, filename, isExternal = false }: FileCardProps) {
  const { t } = useI18n();
  const extMatch = href.match(/\.([a-zA-Z0-9]+)(?:[\?#]|$)/);
  const extension = extMatch ? extMatch[1].toUpperCase() : "FILE";

  let Icon = FileIcon;
  let typeLabel = t("fileType.document");

  if (["XLSX", "XLS", "CSV"].includes(extension)) {
    Icon = FileSpreadsheetIcon;
    typeLabel = t("fileType.spreadsheet");
  } else if (["PPT", "PPTX", "PPS", "PPSX"].includes(extension)) {
    Icon = PresentationIcon;
    typeLabel = t("fileType.presentation");
  } else if (["PNG", "JPG", "JPEG", "GIF", "WEBP", "BMP", "SVG", "HEIC"].includes(extension)) {
    Icon = FileImageIcon;
    typeLabel = t("fileType.image");
  } else if (["MP3", "WAV", "OGG", "M4A", "AAC", "FLAC"].includes(extension)) {
    Icon = FileAudioIcon;
    typeLabel = t("fileType.audio");
  } else if (["MP4", "MOV", "WEBM", "AVI", "MKV", "M4V"].includes(extension)) {
    Icon = FileVideoIcon;
    typeLabel = t("fileType.video");
  } else if (["ZIP", "TAR", "GZ", "RAR", "7Z"].includes(extension)) {
    Icon = FileArchiveIcon;
    typeLabel = t("fileType.archive");
  } else if (["PDF"].includes(extension)) {
    typeLabel = t("fileType.pdf");
  } else if (["DOC", "DOCX", "TXT", "MD", "GO", "JS", "TS", "JSON", "YAML", "YML", "XML", "HTML", "CSS", "SCSS", "SQL", "PY", "RB", "JAVA", "C", "CPP", "RS"].includes(extension)) {
    Icon = FileTextIcon;
    if (["GO", "JS", "TS", "JSON"].includes(extension)) typeLabel = t("fileType.code");
  } else if (extension === "FILE") {
    typeLabel = t("fileType.unknown");
  }

  const isSameOrigin = !isExternal && !href.startsWith("http");

  return (
    <a 
      href={href} 
      {...(isSameOrigin ? { download: true } : { target: "_blank", rel: "noopener noreferrer" })}
      className="group block no-underline my-4 px-0 max-w-full"
    >
      <Card className="flex items-center justify-between p-4 rounded-xl transition-colors !duration-100 hover:bg-secondary/20">
        <div className="flex items-center gap-4 overflow-hidden">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-foreground">{filename}</span>
              {isExternal && (
                  <ExternalLinkIcon className="h-3 w-3" />
              )}
            </div>
            <span className="truncate text-xs text-muted-foreground">
              {typeLabel} • {extension}
            </span>
          </div>
        </div>
        <div className="mx-4 shrink-0">
            <DownloadIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>
    </a>
  );
}
