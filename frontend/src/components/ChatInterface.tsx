import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { useModels } from "@/hooks/useModels";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsData } from "@/hooks/useSettingsData";

import {
  Message as MessageComponent,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTextareaHandle,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";

import { Welcome } from "@/components/ai-elements/welcome";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  AlertCircleIcon,
  RotateCcwIcon,
  CopyIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
  Plus,
  UploadIcon,
  ImageIcon,
  FileIcon,
  FolderOpen,
  ReplyIcon,
  Volume2Icon,
  SquareIcon,
  MicIcon,
  MenuIcon,
  SquarePenIcon,
  MoreHorizontalIcon,
  DownloadIcon,
  TrashIcon,
  ChevronDownIcon,
  SparklesIcon,
  PenLineIcon,
  LightbulbIcon,
  CodeIcon,
  ListChecksIcon,
  FileTextIcon,
} from "lucide-react";
import { Loader } from "@/components/ai-elements/loader";
import { Actions, Action } from "@/components/ai-elements/actions";
import { Attachment, FrontendMessage, WelcomeStats } from "@/lib/api/types";
import { BranchNavigation } from "@/components/BranchNavigation";
import { ClientConversation } from "@/lib/clientConversationManager";
import {
  EditableMessage,
  EditableMessageRef,
} from "@/components/ai-elements/editable-message";
import {
  FilePreview,
  AttachmentMessage,
  UploadedFile,
} from "@/components/ui/file-upload";
import { ThoughtsToolsGroup } from "@/components/ai-elements/thoughts-tools-group";
import { collectConversationFileIds } from "@/lib/sandbox/runner";
import { uploadFile, FileUploadError } from "@/lib/api/files";
import { synthesizeMessageSpeech } from "@/lib/api/tts";
import { FileManagerDialog } from "@/components/file-manager/FileManagerDialog";
import { ModelOption, ModelSelect } from "@/components/ai-elements/model-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useSpeechDictation } from "@/hooks/useSpeechDictation";
import { getModelTags } from "@/lib/model-tags";
import {
  conversationToMarkdown,
  downloadTextFile,
  safeFilename,
} from "@/lib/export-conversation";

// Dynamic models are now loaded from providers via useModels hook

interface ChatInterfaceProps {
  messages: FrontendMessage[];
  webSearch: boolean;
  currentConversation: ClientConversation | undefined;
  stats?: WelcomeStats;
  isAuthenticated?: boolean;
  isAuthChecking?: boolean;
  isConversationLoading?: boolean;
  onWebSearchToggle: (enabled: boolean) => void;
  onSendMessage: (
    message: string,
    webSearch: boolean,
    model: string,
    attachments?: import("@/lib/api/types").Attachment[],
  ) => Promise<void>;
  onRetryMessage: (messageId: string, model: string) => Promise<void>;
  onSwitchBranch: (messageId: number, branchIndex: number) => void;
  getBranchInfo: (messageId: number) => {
    count: number;
    activeIndex: number;
    hasMultiple: boolean;
  };
  onUpdateMessage: (messageId: string, newContent: string) => Promise<void>;
  onCancelStream: () => Promise<void>;
  /** Mobile drawer toggle (desktop uses the sidebar rail). */
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  /** Ask the parent to confirm & delete the current conversation. */
  onRequestDeleteConversation?: (conversationId: string) => void;
  /** Rendered under the header (e.g. error banner). */
  banner?: ReactNode;
}

/** Imperative API used by global keyboard shortcuts. */
export type ChatInterfaceHandle = {
  focusComposer(): void;
  copyLastResponse(): boolean;
};

/** Prompt starters shown on an empty chat (ChatGPT-style chips). */
const SUGGESTIONS: { label: string; prompt: string; icon: ReactNode }[] = [
  {
    label: "Summarize text",
    prompt: "Summarize the following text in a few bullet points:\n\n",
    icon: <FileTextIcon className="size-4 text-orange-500" />,
  },
  {
    label: "Help me write",
    prompt: "Help me write ",
    icon: <PenLineIcon className="size-4 text-violet-500" />,
  },
  {
    label: "Brainstorm",
    prompt: "Brainstorm ideas for ",
    icon: <LightbulbIcon className="size-4 text-yellow-500" />,
  },
  {
    label: "Code",
    prompt: "Explain what this code does and suggest improvements:\n\n",
    icon: <CodeIcon className="size-4 text-sky-500" />,
  },
  {
    label: "Make a plan",
    prompt: "Make a step-by-step plan for ",
    icon: <ListChecksIcon className="size-4 text-emerald-500" />,
  },
];

const formatCompact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
      : String(n);

type PromptAreaHandle = {
  focus(options?: FocusOptions): void;
  addFiles(files: File[]): void;
  insertText(text: string): void;
};

type PromptAreaProps = {
  onSend: (message: string, attachments?: Attachment[]) => void;
  placeholder: string;
  isDisabled: boolean;
  models: ModelOption[];
  model: string;
  isModelValid: boolean;
  hasPendingMessages: boolean;
  hasRecentError: boolean;
  onStop: () => void;
  isAuthenticated: boolean;
};

const PromptArea = memo(
  forwardRef<PromptAreaHandle, PromptAreaProps>(function PromptArea(
    {
      onSend,
      placeholder,
      isDisabled,
      models,
      model,
      isModelValid,
      hasPendingMessages,
      hasRecentError,
      onStop,
      isAuthenticated,
    },
    ref,
  ) {
    const [isInputEmpty, setIsInputEmpty] = useState(true);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
    const [pendingFileNames, setPendingFileNames] = useState<string[]>([]);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [fileManagerOpen, setFileManagerOpen] = useState(false);
    const promptInputRef = useRef<PromptInputTextareaHandle>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const dictation = useSpeechDictation((text) => {
      const current = promptInputRef.current?.value ?? "";
      const sep = current && !/\s$/.test(current) ? " " : "";
      promptInputRef.current?.insertText(sep + text);
      setIsInputEmpty(false);
    });

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setIsInputEmpty(e.target.value.trim() === "");
      },
      [],
    );

    const handleAttachFiles = useCallback(
      (files: import("@/lib/api/types").File[]) => {
        const newUploadedFiles = files.map((fileData) => ({
          file: new File([], fileData.name),
          fileData,
        }));
        setUploadedFiles((prev) => [...prev, ...newUploadedFiles]);
        setUploadError(null);
      },
      [],
    );

    const handleRemoveFile = useCallback((index: number) => {
      setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
      setUploadError(null);
    }, []);

    const handleFilesPasted = useCallback(
      async (files: File[]) => {
        if (hasPendingMessages || files.length === 0) return;
        // Add all file names as pending immediately
        const names = files.map((f) => f.name);
        setPendingFileNames((prev) => [...prev, ...names]);
        setUploadError(null);

        for (const file of files) {
          try {
            const fileData = await uploadFile(file);
            setUploadedFiles((prev) => [...prev, { file, fileData }]);
          } catch (error) {
            const errorMessage =
              error instanceof FileUploadError
                ? error.message
                : "Failed to upload file";
            setUploadError(errorMessage);
          }
          // Remove this file from pending regardless of success/failure
          setPendingFileNames((prev) => {
            const idx = prev.indexOf(file.name);
            return idx === -1 ? prev : prev.filter((_, i) => i !== idx);
          });
        }
      },
      [hasPendingMessages],
    );

    const handlePickLocalFiles = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (files.length > 0) handleFilesPasted(files);
      },
      [handleFilesPasted],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: (options?: FocusOptions) =>
          promptInputRef.current?.focus(options),
        addFiles: (files: File[]) => {
          handleFilesPasted(files);
        },
        insertText: (text: string) => {
          promptInputRef.current?.insertText(text);
          setIsInputEmpty(false);
        },
      }),
      [handleFilesPasted],
    );

    const handleSubmit = useCallback(
      (e: React.FormEvent) => {
        e.preventDefault();
        if (!promptInputRef.current?.value.trim() && uploadedFiles.length === 0)
          return;
        if (!isModelValid) return;
        const message = promptInputRef.current?.value ?? "";
        const attachments: Attachment[] | undefined =
          uploadedFiles.length > 0
            ? uploadedFiles.map(({ fileData }) => ({
                id: fileData.id,
                messageId: -1,
                file: fileData,
              }))
            : undefined;
        dictation.stop();
        promptInputRef.current?.clear();
        setIsInputEmpty(true);
        setUploadedFiles([]);
        setPendingFileNames([]);
        setUploadError(null);
        onSend(message, attachments);
        promptInputRef.current?.focus({ preventScroll: true });
      },
      [isModelValid, uploadedFiles, onSend, dictation],
    );

    return (
      <div className="flex-shrink-0 flex justify-center px-3 sm:px-4">
        <PromptInput
          onSubmit={handleSubmit}
          className="chat-interface w-full max-w-3xl mx-auto"
        >
          {(uploadedFiles.length > 0 || pendingFileNames.length > 0) && (
            <div className="px-3 pt-3">
              <div className="flex flex-wrap gap-2">
                {uploadedFiles.map((file, index) => (
                  <FilePreview
                    key={file.fileData.id}
                    file={file}
                    onRemove={() => handleRemoveFile(index)}
                  />
                ))}
                {pendingFileNames.map((name, index) => (
                  <div
                    key={`pending-${index}-${name}`}
                    className="flex items-center gap-2 p-2 bg-background/60 rounded-xl border max-w-xs animate-pulse"
                  >
                    <div className="flex-shrink-0 size-10 rounded border bg-background flex items-center justify-center">
                      <Loader size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{name}</div>
                      <div className="text-xs text-muted-foreground">Uploading...</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(uploadError || dictation.error) && (
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircleIcon size={16} />
                <span>{uploadError || dictation.error}</span>
                <button
                  type="button"
                  onClick={() => {
                    setUploadError(null);
                    dictation.clearError();
                  }}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  <XIcon size={14} />
                </button>
              </div>
            </div>
          )}
          <PromptInputTextarea
            ref={promptInputRef}
            onChange={handleInputChange}
            placeholder={placeholder}
            disabled={isDisabled}
            onFilesPasted={handleFilesPasted}
          />
          <PromptInputToolbar>
            <PromptInputTools>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePickLocalFiles}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handlePickLocalFiles}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PromptInputButton
                    variant="ghost"
                    disabled={hasPendingMessages || isDisabled}
                    className="size-9 text-foreground/80 hover:bg-accent"
                    aria-label="Add photos and files"
                    title={
                      !isAuthenticated
                        ? "Sign in to attach files"
                        : "Add photos and files"
                    }
                  >
                    <Plus className="size-5" />
                  </PromptInputButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="min-w-52">
                  <DropdownMenuItem
                    onSelect={() => imageInputRef.current?.click()}
                  >
                    <ImageIcon />
                    Add photos
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => fileInputRef.current?.click()}
                  >
                    <FileIcon />
                    Add files
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setFileManagerOpen(true)}>
                    <FolderOpen />
                    Choose from library
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </PromptInputTools>
            <div className="flex items-center gap-1.5">
              {dictation.isSupported && (
                <PromptInputButton
                  variant="ghost"
                  onClick={dictation.toggle}
                  disabled={isDisabled}
                  aria-pressed={dictation.isListening}
                  aria-label={dictation.isListening ? "Stop dictation" : "Dictate"}
                  title={dictation.isListening ? "Stop dictation" : "Dictate"}
                  className={cn(
                    "size-9 text-foreground/80 hover:bg-accent",
                    dictation.isListening &&
                      "bg-red-500/15 text-red-600 hover:bg-red-500/20 dark:text-red-400",
                  )}
                >
                  <MicIcon className={cn("size-[18px]", dictation.isListening && "animate-pulse")} />
                </PromptInputButton>
              )}
            <PromptInputSubmit
              disabled={
                isDisabled ||
                (!hasPendingMessages &&
                  isInputEmpty &&
                  uploadedFiles.length === 0) ||
                (!hasPendingMessages && (!model || models.length === 0))
              }
              status={
                hasPendingMessages
                  ? "streaming"
                  : hasRecentError
                    ? "error"
                    : undefined
              }
              onStop={onStop}
            />
            </div>
          </PromptInputToolbar>
        </PromptInput>
        <FileManagerDialog
          open={fileManagerOpen}
          onOpenChange={setFileManagerOpen}
          onAttach={handleAttachFiles}
        />
      </div>
    );
  }),
);

export const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(function ChatInterface({
  messages,
  webSearch,
  currentConversation,
  stats,
  isAuthenticated = false,
  isAuthChecking = false,
  isConversationLoading = false,
  // onWebSearchToggle,
  onSendMessage,
  onRetryMessage,
  onSwitchBranch,
  getBranchInfo,
  onUpdateMessage,
  onCancelStream,
  onToggleSidebar,
  onNewChat,
  onRequestDeleteConversation,
  banner,
}, ref) {
  const isComposerDisabled = isAuthChecking || !isAuthenticated;
  const [isDragOver, setIsDragOver] = useState(false);
  const [replySelection, setReplySelection] = useState<{
    text: string;
    x: number;
    y: number;
    placement: "above" | "below";
  } | null>(null);
  const dragCounterRef = useRef(0);
  const { models, isLoading: modelsLoading } = useModels();
  const {
    updateSingleSetting,
    getSingleSetting,
    isLoading: settingsLoading,
  } = useSettings();

  const {
    data: settingsData,
    loaded: settingsDataLoaded,
    fetchAll: fetchSettingsData,
  } = useSettingsData();

  useEffect(() => {
    if (!settingsDataLoaded) {
      fetchSettingsData();
    }
  }, [settingsDataLoaded, fetchSettingsData]);

  // Auto-select default model when models become available
  const [model, setModel] = useState<string>("");
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(
    null,
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(
    null,
  );
  // Read-aloud TTS (one message at a time)
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null,
  );
  const [ttsLoadingMessageId, setTtsLoadingMessageId] = useState<string | null>(
    null,
  );
  const [ttsErrorMessageId, setTtsErrorMessageId] = useState<string | null>(
    null,
  );
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsObjectUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const editableMessageRefs = useRef<Record<string, EditableMessageRef | null>>(
    {},
  );
  const messageRenderKeysRef = useRef<WeakMap<FrontendMessage, string>>(
    new WeakMap(),
  );
  const messageRenderKeysByIdRef = useRef<Map<string, string>>(new Map());
  const nextMessageRenderKeyRef = useRef(0);
  const conversationRef = useRef<HTMLDivElement>(null);
  const promptAreaRef = useRef<PromptAreaHandle>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const isConversationLoadingRef = useRef(isConversationLoading);
  const hasFocusedInitialLoadRef = useRef(false);
  const previousConversationIdRef = useRef<string | undefined>(undefined);
  const pendingInitialScrollConversationIdRef = useRef<string | null>(null);
  const initialScrollUserInteractedRef = useRef(false);

  // Keep a ref in sync so scroll-settle closures always see the current loading state.
  useEffect(() => {
    isConversationLoadingRef.current = isConversationLoading;
  }, [isConversationLoading]);

  // Focus composer once on initial app load when it becomes usable.
  useEffect(() => {
    if (hasFocusedInitialLoadRef.current) return;
    if (isComposerDisabled) return;

    const input = promptAreaRef.current;
    if (!input) return;

    input.focus({ preventScroll: true });
    hasFocusedInitialLoadRef.current = true;
  }, [isComposerDisabled]);

  // Scroll to bottom when user sends a message
  const scrollToBottom = useCallback(() => {
    const container = conversationRef.current;
    if (!container) return;

    // Use setTimeout to ensure the DOM has updated with the new message
    setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }, 100);
  }, []);

  // Reset interaction flag when conversation changes.
  // Initial scroll is handled by a dedicated effect so it also works with lazy-loaded messages.
  useEffect(() => {
    const currentId = currentConversation?.id;
    const previousId = previousConversationIdRef.current;

    // Check if this is a real conversation switch (not temp ID -> real ID transition)
    // Temp IDs start with "conv-", real IDs are UUIDs (contain dashes in UUID format)
    const isTempId = (id: string | undefined) => id?.startsWith("conv-");
    const isRealConversationSwitch =
      currentId !== previousId &&
      !(isTempId(previousId) && !isTempId(currentId)); // Not transitioning from temp to real

    // Update the ref
    previousConversationIdRef.current = currentId;

    // Only reset interaction and auto-scroll when truly switching conversations
    if (isRealConversationSwitch) {
      setHasInteracted(false);
      pendingInitialScrollConversationIdRef.current = currentId ?? null;
      initialScrollUserInteractedRef.current = false;
      messageRenderKeysRef.current = new WeakMap();
      messageRenderKeysByIdRef.current.clear();
      nextMessageRenderKeyRef.current = 0;
    }
  }, [currentConversation?.id]);

  useEffect(() => {
    const currentId = currentConversation?.id;
    if (!currentId) return;
    if (pendingInitialScrollConversationIdRef.current !== currentId) return;

    // If initial loading completed with no messages, clear the pending initial scroll.
    if (!isConversationLoading && messages.length === 0) {
      pendingInitialScrollConversationIdRef.current = null;
      return;
    }

    if (messages.length === 0) return;

    const container = conversationRef.current;
    if (!container) return;
    const observedContent = container.firstElementChild;
    let settleTimeoutId: number | null = null;

    const scrollToConversationBottom = () => {
      container.scrollTop = container.scrollHeight;
    };

    const clearPendingInitialScroll = () => {
      if (pendingInitialScrollConversationIdRef.current === currentId) {
        pendingInitialScrollConversationIdRef.current = null;
      }
    };

    const scheduleSettle = () => {
      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
      }

      // Don't start the settle countdown while data is still loading — images and SVGs
      // inside the freshly-loaded messages haven't had a chance to paint yet.
      if (isConversationLoadingRef.current) return;

      settleTimeoutId = window.setTimeout(() => {
        if (initialScrollUserInteractedRef.current) return;
        clearPendingInitialScroll();
      }, 2500);
    };

    const stopStickyInitialScroll = () => {
      initialScrollUserInteractedRef.current = true;
      clearPendingInitialScroll();
    };

    const resizeObserver = new ResizeObserver(() => {
      if (pendingInitialScrollConversationIdRef.current !== currentId) return;
      if (initialScrollUserInteractedRef.current) return;

      scrollToConversationBottom();
      scheduleSettle();
    });

    const mutationObserver = new MutationObserver(() => {
      if (pendingInitialScrollConversationIdRef.current !== currentId) return;
      if (initialScrollUserInteractedRef.current) return;

      scrollToConversationBottom();
      scheduleSettle();
    });

    if (observedContent instanceof HTMLElement) {
      resizeObserver.observe(observedContent);
      mutationObserver.observe(observedContent, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }

    container.addEventListener("wheel", stopStickyInitialScroll, {
      passive: true,
    });
    container.addEventListener("touchstart", stopStickyInitialScroll, {
      passive: true,
    });
    container.addEventListener("pointerdown", stopStickyInitialScroll);

    scrollToConversationBottom();
    requestAnimationFrame(scrollToConversationBottom);
    scheduleSettle();

    return () => {
      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
      }

      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener("wheel", stopStickyInitialScroll);
      container.removeEventListener("touchstart", stopStickyInitialScroll);
      container.removeEventListener("pointerdown", stopStickyInitialScroll);
    };
  }, [currentConversation?.id, messages.length, isConversationLoading]);

  /**
   * Synchronize local model state with the default model setting
   * This ensures the prompt input always reflects the current default model
   */
  useEffect(() => {
    if (models.length > 0 && !settingsLoading) {
      const savedModel = getSingleSetting("defaultModel");

      // Check if saved model is still available in current providers
      const isModelAvailable =
        savedModel && models.find((m) => m.id === savedModel);

      if (isModelAvailable && !model) {
        setModel(savedModel); // Sync is only needed if no local model is set
      } else if (!savedModel && !model && models.length > 0) {
        // No default model exists and no local model - let auto-select hook handle this
        // This prevents race conditions between auto-select and this component
      } else if (savedModel && !isModelAvailable && models.length > 0) {
        // Saved model is no longer available, update to first available
        const fallbackModel = models[0].id;
        setModel(fallbackModel);
        updateSingleSetting("defaultModel", fallbackModel).catch((error) => {
          console.error("Failed to update default model setting:", error);
        });
        console.warn(
          `Saved model "${savedModel}" is no longer available. Falling back to "${fallbackModel}".`,
        );
      }
    }
  }, [models, settingsLoading, getSingleSetting, updateSingleSetting, model]);

  /**
   * Handle model selection change and persist to settings
   * Updates both local state and saves preference to backend
   * This ensures the model choice is remembered across sessions
   */
  const handleModelChange = async (newModel: string) => {
    setModel(newModel);

    // Default model should only be updated from settings
    // try {
    //   await updateSingleSetting("defaultModel", newModel);
    // } catch (error) {
    //   console.error("Failed to save model preference:", error);
    // }
  };

  // Check if there are any pending messages
  const hasPendingMessages = messages.some(
    (message) => message.status === "pending",
  );

  // Check if there are recent error messages (within last 2 messages)
  const hasRecentError = messages.slice(-2).some((message) => !!message.error);

  // Validate selected model exists in the loaded models list
  const isModelValid = useMemo(() => {
    return !!model && models.some((m) => m.id === model);
  }, [model, models]);

  // Clear inline warning when model becomes valid
  // (no-op — model warning state removed)

  const handleSend = useCallback(
    (message: string, attachments?: Attachment[]) => {
      setHasInteracted(true);
      initialScrollUserInteractedRef.current = true;
      pendingInitialScrollConversationIdRef.current = null;
      if (messages.length > 0) scrollToBottom();
      onSendMessage(message, webSearch, model, attachments);
    },
    [messages.length, webSearch, model, scrollToBottom, onSendMessage],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      if (isComposerDisabled || hasPendingMessages) return;

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        promptAreaRef.current?.addFiles(files);
      }
    },
    [isComposerDisabled, hasPendingMessages],
  );

  // Text selection → Reply button (show after mouseup or touchend)
  const showReplyForSelection = useCallback((placement: "above" | "below") => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const container = conversationRef.current;
    if (!container) return;
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !container.contains(anchorNode)) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    replyPlacementRef.current = placement;
    setReplySelection({
      text: selection.toString().trim(),
      x: rect.left + rect.width / 2 - containerRect.left,
      y: placement === "above"
        ? rect.top - containerRect.top
        : rect.bottom - containerRect.top,
      placement,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    setTimeout(() => showReplyForSelection("above"), 10);
  }, [showReplyForSelection]);

  const handleTouchEnd = useCallback(() => {
    // Longer delay on touch to let native selection handles settle
    setTimeout(() => showReplyForSelection("below"), 300);
  }, [showReplyForSelection]);

  // Clear reply button when selection is cleared (click/tap elsewhere)
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-reply-btn]")) return;
    setReplySelection(null);
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if ((e.target as HTMLElement).closest("[data-reply-btn]")) return;
    setReplySelection(null);
  }, []);

  // Track last known placement so we can restore after scroll
  const replyPlacementRef = useRef<"above" | "below">("above");

  // Hide on scroll, reposition when scroll stops
  const scrollTimeoutRef = useRef<number | null>(null);
  const [replyHidden, setReplyHidden] = useState(false);

  const handleConversationScroll = useCallback(() => {
    if (!replySelection) return;
    setReplyHidden(true);
    if (scrollTimeoutRef.current) window.clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = window.setTimeout(() => {
      // Recalculate position after scroll settles
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setReplySelection(null);
        setReplyHidden(false);
        return;
      }
      showReplyForSelection(replyPlacementRef.current);
      setReplyHidden(false);
    }, 150);
  }, [replySelection, showReplyForSelection]);

  useEffect(() => {
    const container = conversationRef.current;
    if (!container) return;
    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("scroll", handleConversationScroll);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("touchstart", handleTouchStart);
    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("scroll", handleConversationScroll);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("touchstart", handleTouchStart);
      if (scrollTimeoutRef.current) window.clearTimeout(scrollTimeoutRef.current);
    };
  }, [handleMouseUp, handleTouchEnd, handleMouseDown, handleTouchStart, handleConversationScroll]);

  const handleReply = useCallback(() => {
    if (!replySelection) return;
    const quoted = replySelection.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    promptAreaRef.current?.insertText(`${quoted}\n\n`);
    promptAreaRef.current?.focus();
    setReplySelection(null);
    window.getSelection()?.removeAllRanges();
  }, [replySelection]);

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const flashCopied = useCallback((id: string) => {
    setCopiedMessageId(id);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(
      () => setCopiedMessageId(null),
      2000,
    );
  }, []);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const copyMessage = (messageId: string | null, fallbackContent: string) => {
    const element = messageId
      ? editableMessageRefs.current[messageId]?.getContentElement()
      : null;

    if (element) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      // execCommand('copy') is deprecated but remains the only way to copy
      // a live selection with full computed styles (fonts, tables, colours, etc.).
      // The modern Clipboard API does not support selection-based copying.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const success = document.execCommand("copy");
      selection?.removeAllRanges();
      if (!success) {
        navigator.clipboard.writeText(fallbackContent).catch(console.error);
      }
    } else {
      navigator.clipboard.writeText(fallbackContent).catch(console.error);
    }
  };

  const stopReadAloud = useCallback(() => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.onended = null;
      ttsAudioRef.current.onerror = null;
      ttsAudioRef.current = null;
    }
    if (ttsObjectUrlRef.current) {
      URL.revokeObjectURL(ttsObjectUrlRef.current);
      ttsObjectUrlRef.current = null;
    }
    setSpeakingMessageId(null);
    setTtsLoadingMessageId(null);
  }, []);

  useEffect(() => {
    return () => {
      stopReadAloud();
    };
  }, [stopReadAloud]);

  // Stop playback when switching conversations
  useEffect(() => {
    stopReadAloud();
    setTtsErrorMessageId(null);
  }, [currentConversation?.id, stopReadAloud]);

  // Auto-mounted conversation files for browser_sandbox: the model only sees a filesystem.
  const conversationFileIds = useMemo(
    () => collectConversationFileIds(messages),
    [messages],
  );

  const handleReadAloud = useCallback(
    async (message: FrontendMessage) => {
      if (message.role !== "assistant") return;
      if (!(message.content || "").trim()) return;
      // Backend numeric id required for GET /api/tts/messages/{id}
      if (!/^\d+$/.test(message.id)) return;

      // Toggle off if this message is already speaking or loading
      if (
        speakingMessageId === message.id ||
        ttsLoadingMessageId === message.id
      ) {
        stopReadAloud();
        return;
      }

      stopReadAloud();
      setTtsErrorMessageId(null);
      setTtsLoadingMessageId(message.id);

      const abort = new AbortController();
      ttsAbortRef.current = abort;

      try {
        const blob = await synthesizeMessageSpeech(message.id, abort.signal);
        if (abort.signal.aborted) return;

        const objectUrl = URL.createObjectURL(blob);
        ttsObjectUrlRef.current = objectUrl;
        const audio = new Audio(objectUrl);
        ttsAudioRef.current = audio;

        audio.onended = () => {
          stopReadAloud();
        };
        audio.onerror = () => {
          setTtsErrorMessageId(message.id);
          stopReadAloud();
        };

        setTtsLoadingMessageId(null);
        setSpeakingMessageId(message.id);
        await audio.play();
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error("Read aloud failed:", err);
        setTtsErrorMessageId(message.id);
        stopReadAloud();
      }
    },
    [speakingMessageId, ttsLoadingMessageId, stopReadAloud],
  );

  const handleRetryMessage = async (
    messageId: string,
    overrideModel?: string,
  ) => {
    // Prevent retry when model is invalid
    const retryModel = overrideModel ?? model;
    if (!retryModel || !models.some((m) => m.id === retryModel)) {
      return;
    }
    // "Retry with another model" also switches the picker, like ChatGPT.
    if (overrideModel && overrideModel !== model) {
      setModel(overrideModel);
    }

    // Match send-message behavior: keep extra bottom space and move viewport
    // so the retried streaming response stays in view.
    setHasInteracted(true);
    initialScrollUserInteractedRef.current = true;
    pendingInitialScrollConversationIdRef.current = null;
    scrollToBottom();

    setRetryingMessageId(messageId);
    try {
      await onRetryMessage(messageId, retryModel);
    } finally {
      setRetryingMessageId(null);
    }
  };

  const handleUpdateMessage = async (messageId: string, newContent: string) => {
    setUpdatingMessageId(messageId);
    try {
      await onUpdateMessage(messageId, newContent);
      setEditingMessageId(null);
    } catch (error) {
      console.error("Failed to update message:", error);
    } finally {
      setUpdatingMessageId(null);
    }
  };

  // Create a simple cache for branch info that only updates when conversation data changes
  const branchInfoCache = useMemo(() => {
    const cache = new Map<string, { branchInfo: any; parentId: number }>();

    // Pre-compute branch info for all messages to avoid repeated calculations
    for (const message of messages) {
      if (message.role === "assistant") {
        const messageId = parseInt(message.id);
        // messages may be undefined until fetched — use optional chaining
        const assistantMessage =
          currentConversation?.backendConversation?.messages?.[messageId];

        if (assistantMessage?.parentId) {
          const parentId = assistantMessage.parentId;
          const branchInfo = getBranchInfo(parentId);
          cache.set(message.id, { branchInfo, parentId });
        } else {
          // For messages not yet in backend conversation (newly added), provide default info
          cache.set(message.id, {
            branchInfo: { count: 1, activeIndex: 0, hasMultiple: false },
            parentId: messageId,
          });
        }
      } else {
        cache.set(message.id, {
          branchInfo: { count: 1, activeIndex: 0, hasMultiple: false },
          parentId: parseInt(message.id),
        });
      }
    }

    return cache;
  }, [
    messages,
    currentConversation?.backendConversation,
    currentConversation?.activeBranches,
    getBranchInfo,
  ]);

  // Index of the last assistant turn — its actions stay visible (ChatGPT).
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  useImperativeHandle(
    ref,
    () => ({
      focusComposer: () => promptAreaRef.current?.focus(),
      copyLastResponse: () => {
        const last = lastAssistantIndex >= 0 ? messages[lastAssistantIndex] : undefined;
        if (!last || !last.content?.trim()) return false;
        navigator.clipboard.writeText(last.content).catch(console.error);
        flashCopied(last.id);
        return true;
      },
    }),
    [lastAssistantIndex, messages, flashCopied],
  );

  const handleExport = useCallback(() => {
    const title = currentConversation?.title || "Chat";
    downloadTextFile(
      safeFilename(title),
      conversationToMarkdown(title, messages),
    );
  }, [currentConversation?.title, messages]);

  const renderMessageActions = (message: FrontendMessage, isLast: boolean) => {
    // ChatGPT shows nothing while a response is streaming.
    if (message.status === "pending") return null;
    if (editingMessageId === message.id) return null;

    const messageInfo = branchInfoCache.get(message.id);
    if (!messageInfo) return null;
    const { branchInfo, parentId } = messageInfo;
    const isAssistant = message.role === "assistant";
    const isCopied = copiedMessageId === message.id;

    const copyButton = (
      <Action
        tooltip={isCopied ? "Copied" : message.error ? "Copy error" : "Copy"}
        onClick={() => {
          copyMessage(
            message.error ? null : message.id,
            message.error ? message.error || "Error occurred" : message.content,
          );
          flashCopied(message.id);
        }}
      >
        {isCopied ? (
          <CheckIcon className="size-[18px]" />
        ) : (
          <CopyIcon className="size-[18px]" />
        )}
      </Action>
    );

    if (!isAssistant) {
      return (
        <Actions
          className={cn(
            "justify-end transition-opacity",
            "md:opacity-0 md:group-hover/turn:opacity-100 md:focus-within:opacity-100",
          )}
        >
          {copyButton}
          <Action
            tooltip="Edit message"
            onClick={() => setEditingMessageId(message.id)}
            disabled={updatingMessageId === message.id}
          >
            <PencilIcon className="size-[18px]" />
          </Action>
        </Actions>
      );
    }

    const canRetry = isModelValid && models.length > 0;
    const isRetrying = retryingMessageId === message.id;
    const currentModelName =
      models.find((m) => m.id === model)?.name ?? model;

    return (
      <Actions
        className={cn(
          "-ml-2 transition-opacity",
          !isLast &&
            !message.error &&
            "md:opacity-0 md:group-hover/turn:opacity-100 md:focus-within:opacity-100 md:has-[[data-state=open]]:opacity-100",
        )}
      >
        {branchInfo.hasMultiple && (
          <BranchNavigation
            className="mr-1"
            currentIndex={branchInfo.activeIndex}
            totalCount={branchInfo.count}
            onPrevious={() =>
              onSwitchBranch(parentId, Math.max(0, branchInfo.activeIndex - 1))
            }
            onNext={() =>
              onSwitchBranch(
                parentId,
                Math.min(branchInfo.count - 1, branchInfo.activeIndex + 1),
              )
            }
          />
        )}

        {copyButton}

        {!message.error && message.content?.trim() && (
          <Action
            tooltip={
              ttsErrorMessageId === message.id
                ? "Read aloud failed — check TTS model in Settings → Media"
                : speakingMessageId === message.id
                  ? "Stop reading"
                  : ttsLoadingMessageId === message.id
                    ? "Loading audio…"
                    : "Read aloud"
            }
            onClick={() => handleReadAloud(message)}
            disabled={
              ttsLoadingMessageId !== null && ttsLoadingMessageId !== message.id
            }
            className={
              ttsErrorMessageId === message.id
                ? "text-destructive hover:text-destructive"
                : speakingMessageId === message.id
                  ? "text-foreground"
                  : ""
            }
          >
            {ttsLoadingMessageId === message.id ? (
              <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : speakingMessageId === message.id ? (
              <SquareIcon className="size-4 fill-current" />
            ) : (
              <Volume2Icon className="size-[18px]" />
            )}
          </Action>
        )}

        {/* Try again / switch model (ChatGPT's regenerate menu) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={isRetrying || !canRetry}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Regenerate"
              title={message.error ? "Retry" : "Try again"}
              className={cn(
                "h-8 gap-0.5 rounded-lg px-1.5 text-muted-foreground hover:text-foreground",
                message.error && "text-destructive hover:text-destructive",
              )}
            >
              {isRetrying ? (
                <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <RotateCcwIcon className="size-[18px]" />
              )}
              <ChevronDownIcon className="size-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem onSelect={() => handleRetryMessage(message.id)}>
              <RotateCcwIcon />
              <span className="flex-1">Try again</span>
              <span className="max-w-24 truncate text-xs text-muted-foreground">
                {currentModelName}
              </span>
            </DropdownMenuItem>
            {models.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2.5 py-1 text-xs font-medium">
                  Retry with another model
                </DropdownMenuLabel>
                <div className="max-h-60 overflow-y-auto">
                  {models
                    .filter((m) => m.id !== model)
                    .map((m) => (
                      <DropdownMenuItem
                        key={m.id}
                        onSelect={() => handleRetryMessage(message.id, m.id)}
                      >
                        <SparklesIcon />
                        <span className="min-w-0 flex-1 truncate">
                          {m.name}
                        </span>
                        {getModelTags(m)
                          .slice(0, 1)
                          .map((tag) => (
                            <span
                              key={tag.label}
                              className={`rounded-md border px-1 py-px text-[10px] ${tag.className}`}
                            >
                              {tag.label}
                            </span>
                          ))}
                      </DropdownMenuItem>
                    ))}
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="More actions"
              className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontalIcon className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {!message.error && (
              <DropdownMenuItem
                onSelect={() => setEditingMessageId(message.id)}
                disabled={updatingMessageId === message.id}
              >
                <PencilIcon />
                Edit response
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <div className="space-y-1 px-2.5 py-1.5 text-xs text-muted-foreground">
              <div className="truncate font-medium text-foreground/80">
                {message.model || "Model unknown"}
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
                <span>Tokens</span>
                <span className="text-right">
                  {message.tokenCount ? formatCompact(message.tokenCount) : "—"}
                </span>
                <span>Context</span>
                <span className="text-right">
                  {message.contextSize ? formatCompact(message.contextSize) : "—"}
                </span>
                <span>Speed</span>
                <span className="text-right">
                  {message.speed !== undefined ? `${message.speed} t/s` : "—"}
                </span>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </Actions>
    );
  };

  const renderMessageContent = (message: FrontendMessage) => {
    if (message.error) {
      return (
        <div className="space-y-1.5 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircleIcon className="size-4 flex-shrink-0" />
            {message.role === "assistant"
              ? "Something went wrong"
              : "Failed to send message"}
          </div>
          <div className="text-sm text-destructive/80 break-words">
            {message.error || "An unknown error occurred"}
          </div>
        </div>
      );
    }

    // Waiting for the first token: ChatGPT's pulsing dot.
    if (
      message.role === "assistant" &&
      message.status === "pending" &&
      !message.content &&
      !message.reasoning &&
      !(message.toolCalls && message.toolCalls.length > 0)
    ) {
      return (
        <div className="flex h-7 items-center" aria-label="Thinking">
          <span className="size-3.5 rounded-full bg-foreground animate-thinking" />
        </div>
      );
    }

    return (
      <EditableMessage
        ref={(ref) => {
          if (ref) {
            editableMessageRefs.current[message.id] = ref;
          }
        }}
        content={message.content}
        status={message.status}
        isEditing={editingMessageId === message.id}
        onSave={(newContent) => handleUpdateMessage(message.id, newContent)}
        onCancel={() => setEditingMessageId(null)}
        disabled={updatingMessageId === message.id}
      />
    );
  };

  /** Inline editor card with Cancel / Save (ChatGPT edit-message UI). */
  const renderEditor = (message: FrontendMessage) => (
    <div className="w-full rounded-3xl bg-bubble px-5 py-3">
      {renderMessageContent(message)}
      <div className="mt-2 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-full bg-background px-4 dark:bg-background"
          onClick={() => setEditingMessageId(null)}
          disabled={updatingMessageId === message.id}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-9 rounded-full px-4"
          onClick={() => editableMessageRefs.current[message.id]?.triggerSave()}
          disabled={updatingMessageId === message.id}
        >
          {updatingMessageId === message.id ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );

  const getMessageKey = (message: FrontendMessage) => {
    let messageKey = messageRenderKeysRef.current.get(message);
    if (!messageKey) {
      messageKey = messageRenderKeysByIdRef.current.get(message.id);
      if (!messageKey) {
        messageKey = `msg-${nextMessageRenderKeyRef.current++}`;
      }
      messageRenderKeysRef.current.set(message, messageKey);
    }
    messageRenderKeysByIdRef.current.set(message.id, messageKey);
    return messageKey;
  };

  const renderMessage = (message: FrontendMessage, index: number) => {
    const hasAttachments =
      message.attachments && message.attachments.length > 0;
    const isEditing = editingMessageId === message.id;
    const isLast = index === lastAssistantIndex;

    if (isEditing) {
      return (
        <div className="chat-message-container group/turn space-y-2 py-2">
          {hasAttachments && message.role === "user" && (
            <div className="flex justify-end">
              <AttachmentMessage
                attachments={message.attachments}
                role={message.role}
              />
            </div>
          )}
          {renderEditor(message)}
        </div>
      );
    }

    return (
      <div className="chat-message-container group/turn">
        <MessageComponent
          from={message.role}
          status={message.status}
          error={message.error}
        >
          <div
            className={cn(
              "flex flex-col gap-2 w-full",
              message.role === "user" ? "items-end" : "items-start",
            )}
          >
            {hasAttachments && (
              <AttachmentMessage
                attachments={message.attachments}
                role={message.role}
              />
            )}

            {message.role === "user" ? (
              (message.content || message.error) && (
                <MessageContent content={message.content}>
                  {renderMessageContent(message)}
                </MessageContent>
              )
            ) : (
              <MessageContent content={message.content}>
                <div className="space-y-4">
                  {(message.reasoning ||
                    (message.toolCalls && message.toolCalls.length > 0)) && (
                    <ThoughtsToolsGroup
                      message={message}
                      settingsData={settingsData}
                      conversationFileIds={conversationFileIds}
                    />
                  )}
                  {renderMessageContent(message)}
                </div>
                {renderMessageActions(message, isLast)}
              </MessageContent>
            )}
          </div>
        </MessageComponent>

        {message.role === "user" && renderMessageActions(message, false)}
      </div>
    );
  };

  const isEmpty = messages.length === 0 && !isConversationLoading;
  const selectedModel = models.find((m) => m.id === model);

  return (
    <div
      className="flex-1 flex flex-col min-h-0 relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      <div
        className={cn(
          "absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-all duration-200 ease-out pointer-events-none",
          isDragOver ? "opacity-100 visible" : "opacity-0 invisible",
        )}
      >
        <div
          className={cn(
            "flex flex-col items-center gap-3 text-muted-foreground transition-transform duration-200 ease-out",
            isDragOver ? "scale-100" : "scale-95",
          )}
        >
          <div className="rounded-full bg-secondary p-4">
            <UploadIcon className="size-6" />
          </div>
          <span className="text-sm font-medium">Drop files to attach</span>
        </div>
      </div>

      {/* Header: model picker on the left (ChatGPT-style) */}
      <header className="relative z-10 flex h-[52px] shrink-0 items-center justify-between gap-2 bg-background px-2 md:px-3">
        <div className="flex min-w-0 items-center gap-1">
          {onToggleSidebar && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSidebar}
              className="size-9 rounded-lg md:hidden"
              aria-label="Open sidebar"
            >
              <MenuIcon className="size-5" />
            </Button>
          )}
          <ModelSelect
            models={models}
            value={isModelValid ? model : undefined}
            onChange={handleModelChange}
            loading={modelsLoading}
            disabled={settingsLoading || isComposerDisabled}
            helperMessage="Add AI providers in settings"
            variant="ghost"
            showCount={models.length > 0}
            align="start"
            placeholder={
              modelsLoading
                ? "Loading models..."
                : models.length === 0
                  ? "No models"
                  : "Select a model"
            }
            renderValue={(m) => (
              <span className="truncate text-lg font-medium">{m.name}</span>
            )}
            triggerAriaLabel="Model selector"
            triggerClassName={cn(
              "h-10 max-w-[60vw] gap-1 rounded-xl !px-3 text-lg font-medium text-foreground/90 hover:!bg-accent data-[state=open]:!bg-accent",
              "[&>svg]:size-4 [&>svg]:opacity-60",
            )}
          />
          {selectedModel &&
            getModelTags(selectedModel)
              .slice(0, 1)
              .map((tag) => (
                <span
                  key={tag.label}
                  className={`hidden rounded-md border px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex ${tag.className}`}
                >
                  {tag.label}
                </span>
              ))}
        </div>
        <div className="flex items-center gap-1">
          {currentConversation && messages.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-lg"
                  aria-label="Conversation options"
                >
                  <MoreHorizontalIcon className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onSelect={handleExport}>
                  <DownloadIcon />
                  Export as Markdown
                </DropdownMenuItem>
                {onRequestDeleteConversation && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() =>
                        onRequestDeleteConversation(currentConversation.id)
                      }
                      className="text-destructive focus:text-destructive [&_svg]:!text-destructive"
                    >
                      <TrashIcon />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onNewChat && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onNewChat}
              disabled={isComposerDisabled}
              className="size-9 rounded-lg md:hidden"
              aria-label="New chat"
            >
              <SquarePenIcon className="size-5" />
            </Button>
          )}
        </div>
      </header>

      {banner}

      <Conversation
        ref={conversationRef}
        className={cn("relative", isEmpty ? "flex-1 md:flex-[1.15]" : "flex-1")}
      >
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 pb-6 md:justify-end md:pb-8">
            <Welcome
              isLoading={isAuthChecking}
              isAuthenticated={isAuthenticated}
            />
          </div>
        ) : (
          <ConversationContent className="chat-interface w-full max-w-3xl mx-auto !px-4 sm:!px-6 !pt-4">
            {/* eslint-disable-next-line react-hooks/refs */}
            {messages.map((message, index) => {
              const stableKey = getMessageKey(message);
              return (
                <div key={stableKey} data-index={index} className="pb-4">
                  {renderMessage(message, index)}
                </div>
              );
            })}
            {hasInteracted && (
              <div style={{ minHeight: "calc(-450px + 100vh)" }} />
            )}
          </ConversationContent>
        )}
        {replySelection && !replyHidden && (
          <button
            type="button"
            data-reply-btn
            onMouseDown={(e) => {
              e.preventDefault();
              handleReply();
            }}
            className="absolute z-50 flex items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-sm font-medium shadow-lg hover:bg-accent animate-fade-in transition-colors !duration-100"
            style={{
              left: `${replySelection.x}px`,
              top:
                replySelection.placement === "above"
                  ? `${replySelection.y - 8}px`
                  : `${replySelection.y + 8}px`,
              transform:
                replySelection.placement === "above"
                  ? "translate(-50%, -100%)"
                  : "translate(-50%, 0)",
            }}
          >
            <ReplyIcon className="size-3.5" />
            Ask about this
          </button>
        )}
        <ConversationScrollButton />
      </Conversation>

      <PromptArea
        ref={promptAreaRef}
        onSend={handleSend}
        placeholder={isAuthenticated ? "Ask anything" : "Sign in to start chatting"}
        isDisabled={isComposerDisabled}
        models={models}
        model={model}
        isModelValid={isModelValid}
        hasPendingMessages={hasPendingMessages}
        hasRecentError={hasRecentError}
        onStop={onCancelStream}
        isAuthenticated={isAuthenticated}
      />

      {isEmpty ? (
        <div className="flex flex-col items-center px-4 pt-4 pb-4 md:flex-1">
          {isAuthenticated && (
            <div className="flex max-w-3xl flex-wrap justify-center gap-2 max-md:hidden">
              {SUGGESTIONS.map((sgt) => (
                <button
                  key={sgt.label}
                  type="button"
                  onClick={() => {
                    promptAreaRef.current?.insertText(sgt.prompt);
                    promptAreaRef.current?.focus();
                  }}
                  className="flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm text-foreground/80 hover:bg-accent animate-slide-up"
                >
                  {sgt.icon}
                  {sgt.label}
                </button>
              ))}
            </div>
          )}
          {isAuthenticated && stats && stats.totalConversations > 0 && (
            <p className="mt-6 text-xs tabular-nums text-muted-foreground/80 max-md:hidden">
              {formatCompact(stats.totalTokens + stats.totalInputTokens)} tokens
              {" · "}
              {formatCompact(stats.totalConversations)} chats
              {" · "}
              {formatCompact(stats.totalMessages)} replies
            </p>
          )}
        </div>
      ) : (
        <p className="px-4 py-2 text-center text-xs text-muted-foreground">
          AI can make mistakes. Check important info.
        </p>
      )}
    </div>
  );
});
