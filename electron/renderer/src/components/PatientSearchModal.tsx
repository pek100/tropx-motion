import { useState, useMemo, useRef, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  XIcon,
  Search,
  Clock,
  UserPlus,
  User,
  Check,
  Loader2,
  Star,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InviteModal } from "./InviteModal";

interface Contact {
  userId: Id<"users">;
  alias?: string;
  addedAt: number;
  starred?: boolean;
  name: string;
  email: string;
  image?: string;
  role?: string;
  displayName: string;
  isMe?: boolean; // Flag for "Me" option
}

interface PatientSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPatient?: (patient: Contact) => void;
  selectedPatientId?: Id<"users"> | null;
  /** When true, renders inline without Dialog wrapper (for side-by-side use) */
  embedded?: boolean;
}

type TabType = "recent" | "starred" | "all";

export function PatientSearchModal({
  open,
  onOpenChange,
  onSelectPatient,
  selectedPatientId,
  embedded = false,
}: PatientSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("recent");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [optimisticStars, setOptimisticStars] = useState<Map<string, boolean>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch contacts from Convex
  const contacts = useQuery(api.users.getContacts) as Contact[] | undefined;

  // Fetch current user for "Me" option
  const currentUser = useQuery(api.users.getMe);

  // Create "Me" contact option
  const meContact: Contact | null = useMemo(() => {
    if (!currentUser) return null;
    return {
      userId: currentUser._id,
      name: currentUser.name ?? "Me",
      email: currentUser.email ?? "",
      image: currentUser.image,
      displayName: "Me",
      addedAt: Date.now(),
      isMe: true,
    };
  }, [currentUser]);

  // Sort contacts by most recent (addedAt) and apply optimistic star updates
  const sortedContacts = useMemo(() => {
    if (!contacts) return [];
    return [...contacts]
      .map((c) => ({
        ...c,
        starred: optimisticStars.has(c.userId) ? optimisticStars.get(c.userId) : c.starred,
      }))
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [contacts, optimisticStars]);

  // Recent contacts (max 5)
  const recentContacts = useMemo(() => {
    return sortedContacts.slice(0, 5);
  }, [sortedContacts]);

  // Starred contacts
  const starredContacts = useMemo(() => {
    return sortedContacts.filter((c) => c.starred === true);
  }, [sortedContacts]);

  // Toggle star mutation
  const toggleStar = useMutation(api.users.toggleContactStar);

  // All contacts including "Me" at top
  const allContacts = useMemo(() => {
    if (meContact) {
      return [meContact, ...sortedContacts];
    }
    return sortedContacts;
  }, [sortedContacts, meContact]);

  // Filter contacts by search query (includes "Me" option)
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();

    const filtered = sortedContacts.filter(
      (contact) =>
        contact.name?.toLowerCase().includes(query) ||
        contact.email?.toLowerCase().includes(query) ||
        contact.alias?.toLowerCase().includes(query)
    );

    // Check if "Me" matches search
    const meMatches =
      meContact &&
      ("me".includes(query) ||
        meContact.name?.toLowerCase().includes(query) ||
        meContact.email?.toLowerCase().includes(query));

    // Return "Me" first if it matches
    if (meMatches && meContact) {
      return [meContact, ...filtered];
    }

    return filtered;
  }, [sortedContacts, searchQuery, meContact]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleClose = () => {
    setSearchQuery("");
    setActiveTab("recent");
    setOptimisticStars(new Map());
    onOpenChange(false);
  };

  const handleSelectPatient = (patient: Contact) => {
    onSelectPatient?.(patient);
    handleClose();
  };

  const handleOpenInvite = () => {
    setIsInviteModalOpen(true);
  };

  const handleToggleStar = (e: React.MouseEvent, userId: Id<"users">) => {
    e.stopPropagation(); // Prevent selecting the contact

    // Get current starred state (from optimistic or actual)
    const contact = sortedContacts.find((c) => c.userId === userId);
    const currentStarred = contact?.starred ?? false;
    const newStarred = !currentStarred;

    // Optimistically update immediately
    setOptimisticStars((prev) => {
      const next = new Map(prev);
      next.set(userId, newStarred);
      return next;
    });

    // Call mutation (fire and forget - optimistic handles UI)
    toggleStar({ userId })
      .then(() => {
        // Clear optimistic state once server confirms
        setOptimisticStars((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
      })
      .catch((err) => {
        console.error("Failed to toggle star:", err);
        // Revert optimistic state on error
        setOptimisticStars((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
      });
  };

  const handleCloseInvite = (open: boolean) => {
    setIsInviteModalOpen(open);
    if (!open) {
      // Re-focus search input when invite modal closes
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const renderContactItem = (contact: Contact) => {
    const isSelected = selectedPatientId === contact.userId;
    const isMe = contact.isMe === true;

    return (
      <button
        key={contact.userId}
        onClick={() => handleSelectPatient(contact)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left group",
          "hover:scale-[1.01] active:scale-[0.99]",
          "cursor-pointer",
          // "Me" gets violet styling
          isMe
            ? isSelected
              ? "bg-violet-100 border border-violet-300"
              : "bg-violet-50 border border-violet-200 hover:bg-violet-100"
            : isSelected
              ? "bg-[var(--tropx-hover)]"
              : "hover:bg-[var(--tropx-ivory)]"
        )}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {contact.image ? (
            <img
              src={contact.image}
              alt={contact.name}
              className={cn(
                "size-9 rounded-full object-cover",
                isMe && "ring-2 ring-violet-400"
              )}
            />
          ) : (
            <div
              className={cn(
                "size-9 rounded-full flex items-center justify-center",
                isMe
                  ? "bg-violet-200 ring-2 ring-violet-400"
                  : "bg-[var(--tropx-ivory)]"
              )}
            >
              <User
                className={cn(
                  "size-4",
                  isMe ? "text-violet-600" : "text-[var(--tropx-shadow)]"
                )}
              />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium truncate",
                isMe ? "text-violet-900" : "text-[var(--tropx-dark)]"
              )}
            >
              {contact.name}
            </span>
            {/* "Me" badge */}
            {isMe && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-violet-500 text-white rounded-full">
                Me
              </span>
            )}
            {contact.alias && !isMe && (
              <span className="text-xs text-[var(--tropx-shadow)] truncate">
                ({contact.alias})
              </span>
            )}
          </div>
          <p
            className={cn(
              "text-xs truncate",
              isMe ? "text-violet-600" : "text-[var(--tropx-shadow)]"
            )}
          >
            {contact.email}
          </p>
        </div>

        {/* Star button (not for "Me") */}
        {!isMe && (
          <button
            onClick={(e) => handleToggleStar(e, contact.userId)}
            className={cn(
              "p-1.5 rounded-full transition-colors",
              contact.starred
                ? "text-amber-500 hover:bg-amber-50"
                : "text-gray-300 hover:text-amber-400 hover:bg-gray-100 opacity-0 group-hover:opacity-100"
            )}
          >
            <Star
              className={cn("size-4", contact.starred && "fill-current")}
            />
          </button>
        )}

        {/* Selected indicator */}
        {isSelected && (
          <div
            className={cn(
              "p-1 rounded-full",
              isMe ? "bg-violet-500" : "bg-[var(--tropx-vibrant)]"
            )}
          >
            <Check className="size-3 text-white" />
          </div>
        )}
      </button>
    );
  };

  // Contacts for current tab
  const tabContacts = useMemo(() => {
    switch (activeTab) {
      case "recent":
        return recentContacts;
      case "starred":
        return starredContacts;
      case "all":
        return allContacts;
      default:
        return recentContacts;
    }
  }, [activeTab, recentContacts, starredContacts, allContacts]);

  // Determine what to show in dropdown
  const isLoading = contacts === undefined;
  const isSearching = searchQuery.trim().length > 0;
  const showSearchResults = isSearching && filteredContacts.length > 0;
  const showNoResults = isSearching && filteredContacts.length === 0 && !isLoading;
  const showTabContacts = !isSearching && tabContacts.length > 0;
  const showEmptyTab = !isSearching && tabContacts.length === 0 && !isLoading;

  // Shared content component for both embedded and dialog modes
  const searchContent = (
    <>
      {/* Search input box */}
      <div
        className="bg-white border border-gray-200 rounded-2xl shadow-lg"
        style={{ backfaceVisibility: "hidden" }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <Search className="h-5 w-5 text-[var(--tropx-vibrant)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search patients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[var(--tropx-dark)] placeholder-[var(--tropx-ivory-dark)] outline-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") handleClose();
            }}
          />
          <button
            onClick={handleClose}
            className="rounded-full p-1 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <XIcon className="h-4 w-4 text-[var(--tropx-shadow)]" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden mt-2"
        style={{ backfaceVisibility: "hidden" }}
      >
        {/* Tab buttons */}
        <div className="flex border-b border-gray-100">
          {([
            { id: "recent" as TabType, label: "Recent", icon: Clock },
            { id: "starred" as TabType, label: "Starred", icon: Star },
            { id: "all" as TabType, label: "All", icon: Users },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer",
                activeTab === tab.id
                  ? "text-[var(--tropx-vibrant)] border-b-2 border-[var(--tropx-vibrant)] -mb-px"
                  : "text-[var(--tropx-shadow)] hover:text-[var(--tropx-dark)]"
              )}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-[var(--tropx-vibrant)]" />
          </div>
        )}

        {/* Tab contacts (when not searching) */}
        {showTabContacts && (
          <div className="p-3 max-h-64 overflow-y-auto">
            <div className="space-y-0.5">
              {tabContacts.map((contact) => renderContactItem(contact))}
            </div>
          </div>
        )}

        {/* Search results (when searching) */}
        {showSearchResults && (
          <div className="p-3 max-h-64 overflow-y-auto">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Search className="h-3.5 w-3.5 text-[var(--tropx-vibrant)]" />
              <span className="text-xs font-medium text-[var(--tropx-shadow)] uppercase tracking-wide">
                Results
              </span>
            </div>
            <div className="space-y-0.5">
              {filteredContacts.map((contact) => renderContactItem(contact))}
            </div>
          </div>
        )}

        {/* No results */}
        {showNoResults && (
          <div className="p-6 text-center">
            <Search className="h-8 w-8 text-[var(--tropx-ivory-dark)] mx-auto mb-2" />
            <p className="text-sm text-[var(--tropx-shadow)]">
              No results for "{searchQuery}"
            </p>
          </div>
        )}

        {/* Empty tab state */}
        {showEmptyTab && (
          <div className="p-6 text-center">
            {activeTab === "starred" ? (
              <>
                <Star className="h-8 w-8 text-[var(--tropx-ivory-dark)] mx-auto mb-2" />
                <p className="text-sm text-[var(--tropx-shadow)]">
                  No starred patients
                </p>
              </>
            ) : (
              <>
                <User className="h-8 w-8 text-[var(--tropx-ivory-dark)] mx-auto mb-2" />
                <p className="text-sm text-[var(--tropx-shadow)]">
                  No patients yet
                </p>
              </>
            )}
          </div>
        )}

        {/* Invite button - always visible when not loading */}
        {!isLoading && (
          <div className="p-3 border-t border-gray-100">
            <button
              onClick={handleOpenInvite}
              className={cn(
                "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl",
                "text-[var(--tropx-vibrant)] font-medium text-sm",
                "hover:bg-[var(--tropx-hover)]",
                "transition-all cursor-pointer",
                "hover:scale-[1.01] active:scale-[0.99]"
              )}
            >
              <UserPlus className="size-4" />
              <span>Invite New Patient</span>
            </button>
          </div>
        )}
      </div>
    </>
  );

  // Ref for click-outside detection in embedded mode
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside for embedded mode
  useEffect(() => {
    if (!embedded || !open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    // Add listener with a small delay to avoid immediate close from the button click
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [embedded, open]);

  // Embedded mode: render inline without Dialog wrapper
  if (embedded) {
    if (!open) return null;
    return (
      <>
        <div ref={containerRef} className="w-80">{searchContent}</div>
        {/* Invite Modal - still needs to be a dialog */}
        <InviteModal
          open={isInviteModalOpen}
          onOpenChange={handleCloseInvite}
        />
      </>
    );
  }

  // Normal mode: render with Dialog wrapper
  return (
    <>
      <DialogPrimitive.Root open={open && !isInviteModalOpen} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          {/* Blur overlay */}
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 modal-blur-overlay cursor-default",
              "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
              "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
            )}
            style={{
              willChange: "opacity",
              transform: "translateZ(0)",
            }}
            onClick={handleClose}
          />

          {/* Centered floating search container */}
          <DialogPrimitive.Content
            className={cn(
              "fixed inset-0 z-[51] m-auto",
              "w-80 h-fit pointer-events-auto",
              "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
              "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]"
            )}
            onPointerDownOutside={handleClose}
            onEscapeKeyDown={handleClose}
          >
            {/* Accessibility: visually hidden title and description */}
            <DialogPrimitive.Title className="sr-only">
              Search Patients
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Search and select a patient from your contacts
            </DialogPrimitive.Description>

            {searchContent}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Invite Modal - rendered outside the search dialog */}
      <InviteModal
        open={isInviteModalOpen}
        onOpenChange={handleCloseInvite}
      />
    </>
  );
}

export default PatientSearchModal;
