"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import {
  ActivityIcon,
  ChevronsUpDownIcon,
  KeyboardIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  LanguagesIcon,
  LogInIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  SunMoonIcon,
  TrashIcon,
  UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ComponentProps,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ClientConversation } from "@/lib/clientConversationManager";
import { useAuth } from "@/hooks/useAuth";
import { usePinnedConversations } from "@/hooks/usePinnedConversations";
import { LoginDialog } from "@/components/auth/LoginDialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { groupConversations } from "@/lib/conversation-groups";
import { modKeyLabel, shiftKeyLabel } from "@/lib/platform";
import { useTheme, type Theme } from "@/components/theme-provider";
import { useI18n, type LanguagePref } from "@/lib/i18n";

export interface ConversationSidebarProps extends ComponentProps<"div"> {
  conversations?: ClientConversation[];
  activeConversationId?: string | null;
  onConversationSelect?: (conversationId: string) => void;
  onNewChat?: () => void;
  /** Called when the user asks to delete; the parent shows the confirmation. */
  onDeleteConversation?: (conversationId: string) => void;
  onRenameConversation?: (conversationId: string, newTitle: string) => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isLoading?: boolean;
}

type FlatItem =
  | { type: "header"; id: string; label: string }
  | { type: "item"; id: string; data: ClientConversation; pinned: boolean };

/** One icon button in the collapsed rail, with a tooltip to its right. */
const RailButton = ({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-lg text-foreground/80 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent"
        {...props}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="right">{label}</TooltipContent>
  </Tooltip>
);

/** Full-width nav row ("New chat", "Search chats"). */
const NavRow = ({
  icon,
  label,
  shortcut,
  ...props
}: ComponentProps<"button"> & {
  icon: ReactNode;
  label: string;
  shortcut?: string[];
}) => (
  <button
    type="button"
    className="group/nav flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-foreground hover:bg-sidebar-accent disabled:pointer-events-none disabled:opacity-50"
    {...props}
  >
    <span className="flex size-5 items-center justify-center text-foreground/80 [&_svg]:size-[18px]">
      {icon}
    </span>
    <span className="flex-1 truncate text-left">{label}</span>
    {shortcut && (
      <Kbd
        keys={shortcut}
        className="opacity-0 transition-opacity group-hover/nav:opacity-100 max-md:hidden"
      />
    )}
  </button>
);

export const ConversationSidebar = ({
  conversations = [],
  activeConversationId,
  onConversationSelect,
  onNewChat,
  onDeleteConversation,
  onRenameConversation,
  onOpenSearch,
  onOpenSettings,
  onOpenShortcuts,
  isCollapsed = false,
  onToggleCollapse,
  isLoading = false,
  className,
  ...props
}: ConversationSidebarProps) => {
  const { isAuthenticated, isCheckingAuth } = useAuth();
  const { pinned, togglePin } = usePinnedConversations();
  const { t, locale } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const canChat = isAuthenticated && !isCheckingAuth;

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];
    const pinnedSet = new Set(pinned);
    const byId = new Map(conversations.map((c) => [c.id, c]));

    const pinnedConvs = pinned
      .map((id) => byId.get(id))
      .filter((c): c is ClientConversation => !!c);
    if (pinnedConvs.length > 0) {
      items.push({ type: "header", id: "header-pinned", label: t("sidebar.pinned") });
      for (const c of pinnedConvs) {
        items.push({ type: "item", id: c.id, data: c, pinned: true });
      }
    }

    // Manager already keeps sidebar order (newest first).
    const rest = conversations.filter((c) => !pinnedSet.has(c.id));
    for (const group of groupConversations(rest, t, locale)) {
      items.push({
        type: "header",
        id: `header-${group.label}`,
        label: group.label,
      });
      for (const c of group.items) {
        items.push({ type: "item", id: c.id, data: c, pinned: false });
      }
    }
    return items;
  }, [conversations, pinned, t, locale]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;

  const rowVirtualizer = useVirtualizer({
    // count=0 while collapsed avoids measureElement caching 0px row heights under
    // display:none (caused mid-list start + jumpy upward scroll on reopen).
    count: isCollapsed ? 0 : flatItems.length,
    getScrollElement: () => (isCollapsed ? null : scrollRef.current),
    estimateSize: (index) =>
      flatItemsRef.current[index]?.type === "header" ? 36 : 36,
    overscan: 10,
    getItemKey: (index) => flatItemsRef.current[index]?.id ?? index,
  });

  // Pin to top only on collapse→open so the newest chats are visible.
  const wasCollapsedRef = useRef(isCollapsed);
  useLayoutEffect(() => {
    const justOpened = wasCollapsedRef.current && !isCollapsed;
    wasCollapsedRef.current = isCollapsed;
    if (!justOpened) return;

    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    rowVirtualizer.scrollToOffset(0, { align: "start" });
  }, [isCollapsed, rowVirtualizer]);

  const handleSaveRename = (conversationId: string) => {
    if (editingTitle.trim() && onRenameConversation) {
      onRenameConversation(conversationId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  return (
    <aside
      className={cn("sidebar", isCollapsed && "collapsed", className)}
      aria-label={t("sidebar.label")}
      {...props}
    >
      {isCollapsed ? (
        /* ── Collapsed icon rail (desktop) ─────────────────────────── */
        <div className="sidebar-rail flex h-full w-full flex-col items-center gap-1 py-2">
          <RailButton
            label={
              <span className="flex items-center gap-2">
                {t("sidebar.openSidebar")}
                <Kbd keys={[modKeyLabel, shiftKeyLabel, "S"]} />
              </span>
            }
            onClick={onToggleCollapse}
            className="group/logo size-9 rounded-lg hover:bg-sidebar-accent dark:hover:bg-sidebar-accent"
            aria-label={t("sidebar.openSidebar")}
          >
            <img
              src="/favicon.svg"
              alt=""
              className="size-6 group-hover/logo:hidden"
            />
            <PanelLeftOpenIcon className="hidden size-5 group-hover/logo:block" />
          </RailButton>
          <div className="h-2" />
          <RailButton
            label={t("sidebar.newChat")}
            onClick={onNewChat}
            disabled={!canChat}
            aria-label={t("sidebar.newChat")}
          >
            <SquarePenIcon className="size-[18px]" />
          </RailButton>
          <RailButton
            label={t("sidebar.searchChats")}
            onClick={onOpenSearch}
            disabled={!canChat}
            aria-label={t("sidebar.searchChats")}
          >
            <SearchIcon className="size-[18px]" />
          </RailButton>
          <div className="flex-1" />
          <AccountMenu
            compact
            onOpenSettings={onOpenSettings}
            onOpenShortcuts={onOpenShortcuts}
          />
        </div>
      ) : (
        /* ── Expanded sidebar ─────────────────────────────────────── */
        <div className="flex h-full w-full flex-col">
          {/* Header */}
          <div className="flex h-[52px] shrink-0 items-center justify-between px-2">
            <button
              type="button"
              onClick={onNewChat}
              disabled={!canChat}
              className="flex h-9 items-center gap-2 rounded-lg px-2 hover:bg-sidebar-accent disabled:pointer-events-none"
              title={t("sidebar.newChat")}
            >
              <img src="/favicon.svg" alt="" className="size-6" />
              <span className="text-[15px] font-semibold tracking-tight">
                {t("app.name")}
              </span>
              <span className="text-[10px] font-normal text-muted-foreground">
                v{__APP_VERSION__}
              </span>
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleCollapse}
                  className="size-9 rounded-lg text-foreground/70 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent"
                  aria-label={t("sidebar.closeSidebar")}
                >
                  <PanelLeftCloseIcon className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <span className="flex items-center gap-2">
                  {t("sidebar.closeSidebar")}
                  <Kbd keys={[modKeyLabel, shiftKeyLabel, "S"]} />
                </span>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Primary actions */}
          <nav className="shrink-0 space-y-0.5 px-2 pb-2">
            <NavRow
              icon={<SquarePenIcon />}
              label={t("sidebar.newChat")}
              shortcut={[modKeyLabel, shiftKeyLabel, "O"]}
              onClick={onNewChat}
              disabled={!canChat}
            />
            <NavRow
              icon={<SearchIcon />}
              label={t("sidebar.searchChats")}
              shortcut={[modKeyLabel, "K"]}
              onClick={onOpenSearch}
              disabled={!canChat}
            />
          </nav>

          {/* Conversations */}
          <div className="relative min-h-0 flex-1">
            <ScrollArea className="h-full" type="scroll" viewportRef={scrollRef}>
              {(isCheckingAuth || isLoading) &&
              conversations.length === 0 ? (
                <div className="space-y-2 px-4 py-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-4 animate-pulse rounded bg-sidebar-accent"
                      style={{ width: `${85 - i * 9}%` }}
                    />
                  ))}
                </div>
              ) : conversations.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {isAuthenticated
                    ? t("sidebar.emptyAuthed")
                    : t("sidebar.emptyGuest")}
                </div>
              ) : (
                <div className="px-2 pb-4">
                  <div
                    className="relative w-full"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                      const item = flatItems[virtualItem.index];
                      if (!item) return null;
                      const isActive =
                        item.type === "item" &&
                        activeConversationId === item.data.id;
                      const isMenuOpen =
                        item.type === "item" && menuOpenId === item.data.id;

                      return (
                        <div
                          key={virtualItem.key}
                          data-index={virtualItem.index}
                          ref={rowVirtualizer.measureElement}
                          className="absolute top-0 left-0 w-full"
                          style={{
                            transform: `translateY(${virtualItem.start}px)`,
                          }}
                        >
                          {item.type === "header" ? (
                            <h3 className="px-2.5 pt-5 pb-1.5 text-xs font-medium text-muted-foreground">
                              {item.label}
                            </h3>
                          ) : editingId === item.data.id ? (
                            <div className="py-px">
                              <input
                                value={editingTitle}
                                onChange={(e) =>
                                  setEditingTitle(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleSaveRename(item.data.id);
                                  } else if (e.key === "Escape") {
                                    handleCancelRename();
                                  }
                                }}
                                onBlur={() => handleSaveRename(item.data.id)}
                                className="h-9 w-full rounded-lg border border-ring/60 bg-background px-2.5 text-sm outline-none"
                                autoFocus
                                onFocus={(e) => e.currentTarget.select()}
                              />
                            </div>
                          ) : (
                            <div
                              className={cn(
                                "group/item relative flex h-9 items-center rounded-lg",
                                isActive || isMenuOpen
                                  ? "bg-sidebar-accent"
                                  : "hover:bg-sidebar-accent",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  onConversationSelect?.(item.data.id)
                                }
                                onDoubleClick={() => {
                                  setEditingId(item.data.id);
                                  setEditingTitle(item.data.title);
                                }}
                                className="h-full min-w-0 flex-1 rounded-lg px-2.5 text-left text-sm"
                                title={item.data.title}
                              >
                                <span
                                  className={cn(
                                    "block truncate",
                                    "group-hover/item:[mask-image:linear-gradient(to_right,black_75%,transparent)]",
                                    (isActive || isMenuOpen) &&
                                      "[mask-image:linear-gradient(to_right,black_75%,transparent)]",
                                  )}
                                >
                                  {item.data.title || t("sidebar.untitled")}
                                </span>
                              </button>
                              <DropdownMenu
                                open={isMenuOpen}
                                onOpenChange={(o) =>
                                  setMenuOpenId(o ? item.data.id : null)
                                }
                              >
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label={t("sidebar.chatOptions")}
                                    className={cn(
                                      "absolute right-1 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground",
                                      "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100",
                                      (isActive || isMenuOpen) && "opacity-100",
                                      "max-md:opacity-100",
                                    )}
                                  >
                                    <MoreHorizontalIcon className="size-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="start"
                                  side="bottom"
                                  className="min-w-44"
                                >
                                  <DropdownMenuItem
                                    onSelect={() => togglePin(item.data.id)}
                                  >
                                    {item.pinned ? (
                                      <PinOffIcon />
                                    ) : (
                                      <PinIcon />
                                    )}
                                    {item.pinned ? t("sidebar.unpin") : t("sidebar.pin")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setEditingId(item.data.id);
                                      setEditingTitle(item.data.title);
                                    }}
                                  >
                                    <PencilIcon />
                                    {t("common.rename")}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      onDeleteConversation?.(item.data.id)
                                    }
                                    className="text-destructive focus:text-destructive [&_svg]:!text-destructive"
                                  >
                                    <TrashIcon />
                                    {t("common.delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Account */}
          <div className="shrink-0 border-t border-border/60 p-2">
            <AccountMenu
              onOpenSettings={onOpenSettings}
              onOpenShortcuts={onOpenShortcuts}
            />
          </div>
        </div>
      )}
    </aside>
  );
};

/** Profile button + menu at the bottom of the sidebar (ChatGPT-style). */
const AccountMenu = ({
  compact = false,
  onOpenSettings,
  onOpenShortcuts,
}: {
  compact?: boolean;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
}) => {
  const { isAuthenticated, isCheckingAuth, logout, isLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const { t, pref, setPref } = useI18n();
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (!isCheckingAuth && !isAuthenticated) {
      setLoginOpen(true);
    }
  }, [isAuthenticated, isCheckingAuth]);

  if (isCheckingAuth) {
    return <div className={compact ? "size-9" : "h-11"} />;
  }

  if (!isAuthenticated) {
    return (
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen}>
        {compact ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg"
            aria-label={t("account.logIn")}
          >
            <LogInIcon className="size-[18px]" />
          </Button>
        ) : (
          <Button className="h-10 w-full rounded-full font-medium">
            <LogInIcon className="size-4" />
            {t("account.logIn")}
          </Button>
        )}
      </LoginDialog>
    );
  }

  const avatar = (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
      <UserIcon className="size-4" />
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            type="button"
            aria-label={t("account.account")}
            className="flex size-9 items-center justify-center rounded-lg hover:bg-sidebar-accent"
          >
            {avatar}
          </button>
        ) : (
          <button
            type="button"
            className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
          >
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {t("account.account")}
              </span>
            </span>
            <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "right" : "top"}
        align={compact ? "end" : "start"}
        className={cn("min-w-60", !compact && "min-w-(--radix-dropdown-menu-trigger-width)")}
      >
        <DropdownMenuItem onSelect={() => onOpenSettings?.()}>
          <SettingsIcon />
          {t("account.settings")}
        </DropdownMenuItem>
        {/* Inline pickers instead of submenus: submenus overflow narrow screens. */}
        <InlineSegment
          icon={<SunMoonIcon />}
          label={t("account.theme")}
          value={theme}
          onChange={(v) => setTheme(v as Theme)}
          options={[
            { value: "system", label: t("account.themeSystem"), icon: <MonitorIcon /> },
            { value: "light", label: t("account.themeLight"), icon: <SunIcon /> },
            { value: "dark", label: t("account.themeDark"), icon: <MoonIcon /> },
          ]}
        />
        <InlineSegment
          icon={<LanguagesIcon />}
          label={t("account.language")}
          value={pref}
          onChange={(v) => setPref(v as LanguagePref)}
          options={[
            { value: "system", label: t("account.languageSystem") },
            { value: "zh", label: "中文" },
            { value: "en", label: "EN" },
          ]}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOpenShortcuts?.()}>
          <KeyboardIcon />
          <span className="whitespace-nowrap">{t("account.shortcuts")}</span>
          <Kbd keys={[modKeyLabel, "/"]} className="ml-auto max-md:hidden" />
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/api/gateway-health/" target="_blank" rel="noopener">
            <ActivityIcon />
            {t("account.gatewayStatus")}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isLoading}
          onSelect={() => {
            logout().catch((err) => console.error("Logout failed:", err));
          }}
        >
          <LogOutIcon />
          {isLoading ? t("account.loggingOut") : t("account.logOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** A labelled row with a segmented control, rendered inside a dropdown menu. */
const InlineSegment = ({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
}) => (
  <div className="px-2.5 py-1.5" role="group" aria-label={label}>
    <div className="mb-1.5 flex items-center gap-2.5 text-sm text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      {label}
    </div>
    <div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-accent/70 p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className={cn(
              "flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs whitespace-nowrap transition-colors [&_svg]:size-3.5",
              active
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.icon}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  </div>
);
