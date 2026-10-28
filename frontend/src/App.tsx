import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { ConversationSidebar } from "@/components/ai-elements/conversation-sidebar";
import { SearchChatsDialog } from "@/components/ai-elements/search-chats-dialog";
import {
  ChatInterface,
  type ChatInterfaceHandle,
} from "@/components/ChatInterface";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useConversations } from "@/hooks/useConversations";
import { useAuth } from "@/hooks/useAuth";
import { usePinnedConversations } from "@/hooks/usePinnedConversations";
import { SettingsDialog } from "@/components/settings";
import { Attachment } from "@/lib/api/types";
import { NavigateFunction, useNavigate, useParams } from "react-router-dom";
import { hasModKey, isMobileViewport } from "@/lib/platform";
import { useI18n } from "@/lib/i18n";

import { XIcon } from "lucide-react";

const SIDEBAR_STATE_KEY = "ai-ui-sidebar-collapsed";

function historyIdx(): number {
  return typeof window.history.state?.idx === "number"
    ? window.history.state.idx
    : 0;
}

function goToNewChat(navigate: NavigateFunction) {
  if (historyIdx() > 0) {
    navigate(-1);
    return;
  }
  navigate("/", { replace: true });
}

function seedHomeUnderConversation(convId: string) {
  if (historyIdx() > 0) {
    return;
  }
  const state = window.history.state ?? {};
  window.history.replaceState({ ...state, idx: 0 }, "", "/");
  window.history.pushState({ ...state, idx: 1 }, "", `/c/${convId}`);
}

function App() {
  const { isAuthenticated, isCheckingAuth } = useAuth();
  const { convId } = useParams<{ convId?: string }>();
  const navigate = useNavigate();
  const [webSearch, setWebSearch] = useState(false);
  // Desktop remembers the user's choice; mobile always starts closed.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (isMobileViewport()) return true;
    try {
      return localStorage.getItem(SIDEBAR_STATE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const chatRef = useRef<ChatInterfaceHandle>(null);
  const { unpin } = usePinnedConversations();
  const { t } = useI18n();

  const [isProcessing, setIsProcessing] = useState(false);
  const [lastMessageSignature, setLastMessageSignature] = useState<string>("");
  const [lastMessageTime, setLastMessageTime] = useState<number>(0);
  const [showSettings, setShowSettings] = useState(false);

  // Touch handling for swipe gestures
  const touchStartRef = useRef<number | null>(null);
  const minSwipeDistance = 50;
  const maxEdgeStart = 50; // Only allow opening swipe from the left edge

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const touchEnd = e.changedTouches[0].clientX;
    const distance = touchStartRef.current - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    const startFromLeftEdge = touchStartRef.current < maxEdgeStart;

    // Reset touch start
    touchStartRef.current = null;

    // Only handle gestures on mobile
    if (window.innerWidth >= 768) return;

    if (isRightSwipe && startFromLeftEdge && sidebarCollapsed) {
      setSidebarCollapsed(false);
    } else if (isLeftSwipe && !sidebarCollapsed) {
      setSidebarCollapsed(true);
    }
  };

  // Conversation management with optimistic updates
  const {
    conversations,
    currentConversation,
    activeConversationId,
    sendMessageStream,
    retryMessageStream,
    selectConversation,
    startNewChat,
    getCurrentMessages,
    isLoading: conversationsLoading,
    isConversationLoading,
    hasHydrated,
    error: conversationsError,
    clearError,
    deleteConversation,
    renameConversation,
    switchBranch,
    getBranchInfo,
    updateMessage,
    cancelStream,
    stats,
  } = useConversations();

  useLayoutEffect(() => {
    if (convId) {
      seedHomeUnderConversation(convId);
    }
  }, [convId]);

  useEffect(() => {
    if (!isAuthenticated || isCheckingAuth) {
      return;
    }

    if (!convId) {
      if (activeConversationId) {
        startNewChat();
      }
      return;
    }

    if (activeConversationId !== convId) {
      selectConversation(convId);
    }
  }, [
    convId,
    activeConversationId,
    isAuthenticated,
    isCheckingAuth,
    selectConversation,
    startNewChat,
    navigate,
  ]);

  useEffect(() => {
    if (
      !convId ||
      !isAuthenticated ||
      isCheckingAuth ||
      !hasHydrated ||
      conversationsLoading
    ) {
      return;
    }

    const exists = conversations.some(
      (conversation) => conversation.id === convId,
    );
    if (!exists) {
      goToNewChat(navigate);
    }
  }, [
    convId,
    conversations,
    hasHydrated,
    conversationsLoading,
    isAuthenticated,
    isCheckingAuth,
    navigate,
  ]);

  const handleSendMessage = async (
    message: string,
    webSearchEnabled: boolean,
    model: string,
    attachments?: Attachment[],
  ) => {
    // Enhanced duplicate prevention for StrictMode and race conditions
    const currentTime = Date.now();
    const timeSinceLastMessage = currentTime - lastMessageTime;

    if (isProcessing) {
      return;
    }

    // Prevent duplicate messages within 1 second with same content (StrictMode protection)
    const attachmentKey = attachments?.map((a) => a.file.id).join(",") ?? "";
    const messageSignature = `${message}|${attachmentKey}`;
    if (messageSignature === lastMessageSignature && timeSinceLastMessage < 1000) {
      return;
    }

    setIsProcessing(true);
    setLastMessageSignature(messageSignature);
    setLastMessageTime(currentTime);

    try {
      // Use streaming for better UX
      await sendMessageStream(
        activeConversationId,
        message,
        model,
        webSearchEnabled,
        attachments,
        (newConvId) =>
          navigate(`/c/${newConvId}`, { replace: Boolean(convId) }),
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryMessage = async (messageId: string, model: string) => {
    if (!activeConversationId || !currentConversation) return;

    try {
      const failedMessage = currentConversation.messages.find(
        (m: any) => m.id === messageId,
      );
      if (!failedMessage) return;

      if (failedMessage.role === "user") {
        await sendMessageStream(
          activeConversationId,
          failedMessage.content,
          model,
          webSearch,
          failedMessage.attachments,
        );
      } else if (failedMessage.role === "assistant") {
        // Use streaming retry for assistant messages
        await retryMessageStream(messageId, model);
      }
    } catch (error) {
      console.error("Retry failed:", error);
    }
  };

  const handleUpdateMessage = async (messageId: string, newContent: string) => {
    if (!activeConversationId) return;

    try {
      await updateMessage(messageId, newContent);
    } catch (error) {
      console.error("Failed to update message:", error);
    }
  };

  const closeDrawerOnMobile = () => {
    if (isMobileViewport()) setSidebarCollapsed(true);
  };

  const handleNewChat = () => {
    if (convId) {
      goToNewChat(navigate);
    }
    setWebSearch(false);
    clearError();
    closeDrawerOnMobile();
    // Land the cursor in the composer, like ChatGPT.
    requestAnimationFrame(() => chatRef.current?.focusComposer());
  };

  const handleConversationSelect = (conversationId: string) => {
    closeDrawerOnMobile();
    if (conversationId === convId) {
      return;
    }
    navigate(`/c/${conversationId}`, { replace: Boolean(convId) });
  };

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      if (!isMobileViewport()) {
        try {
          localStorage.setItem(SIDEBAR_STATE_KEY, next ? "1" : "0");
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  const handleWebSearchToggle = (enabled: boolean) => {
    setWebSearch(enabled);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await deleteConversation(conversationId);
      unpin(conversationId);
      if (convId === conversationId) {
        goToNewChat(navigate);
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const pendingDeleteTitle = pendingDeleteId
    ? conversations.find((c) => c.id === pendingDeleteId)?.title
    : undefined;

  const handleRenameConversation = async (
    conversationId: string,
    newTitle: string,
  ) => {
    try {
      await renameConversation(conversationId, newTitle);
    } catch (error) {
      console.error("Failed to rename conversation:", error);
    }
  };

  // Global keyboard shortcuts (mirrors ChatGPT's set; see ShortcutsDialog).
  const shortcutStateRef = useRef({
    handleNewChat,
    handleToggleSidebar,
    convId,
    canChat: isAuthenticated && !isCheckingAuth,
  });
  shortcutStateRef.current = {
    handleNewChat,
    handleToggleSidebar,
    convId,
    canChat: isAuthenticated && !isCheckingAuth,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = shortcutStateRef.current;
      const key = e.key.toLowerCase();
      const mod = hasModKey(e);

      if (mod && e.shiftKey && key === "o") {
        e.preventDefault();
        if (st.canChat) st.handleNewChat();
      } else if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        if (st.canChat) setSearchOpen((o) => !o);
      } else if (mod && e.shiftKey && key === "s") {
        e.preventDefault();
        st.handleToggleSidebar();
      } else if (mod && (key === "/" || e.code === "Slash")) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      } else if (mod && e.shiftKey && key === "c") {
        if (chatRef.current?.copyLastResponse()) e.preventDefault();
      } else if (mod && e.shiftKey && (key === "backspace" || key === "delete")) {
        if (st.convId) {
          e.preventDefault();
          setPendingDeleteId(st.convId);
        }
      } else if (e.shiftKey && key === "escape") {
        e.preventDefault();
        chatRef.current?.focusComposer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Use convId (URL) as the source of truth for what to display.
  // This prevents the old conversation from briefly flashing during navigation
  // when activeConversationId hasn't been cleared yet by React's state flush.
  const displayedConversation = convId ? currentConversation : undefined;

  // Get current messages for display
  const currentMessages = displayedConversation
    ? getCurrentMessages(displayedConversation)
    : [];

  // Treat the conversation as still loading when the URL has a convId but the
  // conversation or its messages haven't been resolved yet.  This suppresses the
  // Welcome/stats placeholder during the transient window on hard reload.
  const isConvPendingRoute =
    !!convId && (!displayedConversation || currentMessages.length === 0);

  // Use the ordering provided by the conversation manager directly.
  // The manager tracks createdAt/updatedAt and maintains the intended order,
  // so avoid re-sorting here which can ignore client-side timestamps or temporary ids.
  const safeConversations = useMemo(() => {
    return Array.isArray(conversations) ? [...conversations] : [];
  }, [conversations]);

  // Browser tab title follows the open chat.
  const displayedTitle = displayedConversation?.title;
  useEffect(() => {
    const app = t("app.name");
    document.title = displayedTitle ? `${displayedTitle} · ${app}` : app;
  }, [displayedTitle, t]);

  return (
    <div
      className="flex fixed inset-0 overflow-hidden overscroll-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Overlay for mobile drawer */}
      {!sidebarCollapsed && (
        <div className="sidebar-overlay" onClick={handleToggleSidebar} />
      )}

      <ConversationSidebar
        conversations={safeConversations}
        activeConversationId={displayedConversation ? activeConversationId : null}
        onConversationSelect={handleConversationSelect}
        onNewChat={handleNewChat}
        onDeleteConversation={setPendingDeleteId}
        onRenameConversation={handleRenameConversation}
        onOpenSearch={() => {
          closeDrawerOnMobile();
          setSearchOpen(true);
        }}
        onOpenSettings={() => {
          closeDrawerOnMobile();
          setShowSettings(true);
        }}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        isLoading={conversationsLoading}
      />

      {/* Main Content */}
      <main className="chat-container overflow-hidden relative">
        <ChatInterface
          ref={chatRef}
          messages={currentMessages}
          webSearch={webSearch}
          currentConversation={displayedConversation}
          stats={stats}
          isAuthenticated={isAuthenticated}
          isAuthChecking={isCheckingAuth}
          isConversationLoading={isConversationLoading || isConvPendingRoute}
          onWebSearchToggle={handleWebSearchToggle}
          onSendMessage={handleSendMessage}
          onRetryMessage={handleRetryMessage}
          onSwitchBranch={switchBranch}
          getBranchInfo={getBranchInfo}
          onUpdateMessage={handleUpdateMessage}
          onCancelStream={cancelStream}
          onToggleSidebar={handleToggleSidebar}
          onNewChat={handleNewChat}
          onRequestDeleteConversation={setPendingDeleteId}
          banner={
            conversationsError ? (
              <div className="flex justify-center px-4 pb-2">
                <div className="flex w-full max-w-3xl items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive animate-slide-up">
                  <p className="flex-1 break-words">{conversationsError}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearError}
                    className="size-6 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t("common.dismiss")}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null
          }
        />
      </main>

      <SearchChatsDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        conversations={safeConversations}
        onSelect={handleConversationSelect}
        onNewChat={handleNewChat}
        canSearchServer={isAuthenticated}
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title={t("deleteChat.title")}
        description={
          <>
            {t("deleteChat.descriptionBefore")}
            <strong className="font-semibold text-foreground">
              {pendingDeleteTitle || t("deleteChat.fallbackName")}
            </strong>
            {t("deleteChat.descriptionAfter")}
          </>
        }
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={() => {
          if (pendingDeleteId) void handleDeleteConversation(pendingDeleteId);
        }}
      />

      {/* Settings Dialog */}
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}

export default App;
