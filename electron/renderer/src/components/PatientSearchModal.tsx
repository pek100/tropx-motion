import { useState, useMemo, useRef, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "convex/react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InviteModal } from "./InviteModal";

interface Contact {
  userId: Id<"users">;
  alias?: string;
  addedAt: number;
  name: string;
  email: string;
  image?: string;
  role?: string;
  displayName: string;
}

interface PatientSearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPatient?: (patient: Contact) => void;
  selectedPatientId?: Id<"users"> | null;
}

export function PatientSearchModal({
  open,
  onOpenChange,
  onSelectPatient,
  selectedPatientId,
}: PatientSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch contacts from Convex
  const contacts = useQuery(api.users.getContacts) as Contact[] | undefined;

  // Sort contacts by most recent (addedAt)
  const sortedContacts = useMemo(() => {
    if (!contacts) return [];
    return [...contacts].sort((a, b) => b.addedAt - a.addedAt);
  }, [contacts]);

  // Recent contacts (max 3)
  const recentContacts = useMemo(() => {
    return sortedContacts.slice(0, 3);
  }, [sortedContacts]);

  // Filter contacts by search query
  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return sortedContacts.filter(
      (contact) =>
        contact.name?.toLowerCase().includes(query) ||
        contact.email?.toLowerCase().includes(query) ||
        contact.alias?.toLowerCase().includes(query)
    );
  }, [sortedContacts, searchQuery]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleClose = () => {
    setSearchQuery("");
    onOpenChange(false);
  };

  const handleSelectPatient = (patient: Contact) => {
    onSelectPatient?.(patient);
    handleClose();
  };

  const handleOpenInvite = () => {
    setIsInviteModalOpen(true);
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

    return (
      <button
        key={contact.userId}
        onClick={() => handleSelectPatient(contact)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left group",
          "hover:scale-[1.01] active:scale-[0.99]",
          isSelected
            ? "bg-[var(--tropx-hover)]"
            : "hover:bg-[var(--tropx-ivory)]",
          "cursor-pointer"
        )}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {contact.image ? (
            <img
              src={contact.image}
              alt={contact.name}
              className="size-9 rounded-full object-cover"
            />
          ) : (
            <div className="size-9 rounded-full bg-[var(--tropx-ivory)] flex items-center justify-center">
              <User className="size-4 text-[var(--tropx-shadow)]" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--tropx-dark)] truncate">
              {contact.name}
            </span>
            {contact.alias && (
              <span className="text-xs text-[var(--tropx-shadow)] truncate">
                ({contact.alias})
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--tropx-shadow)] truncate">
            {contact.email}
          </p>
        </div>

        {/* Selected indicator */}
        {isSelected && (
          <div className="p-1 rounded-full bg-[var(--tropx-vibrant)]">
            <Check className="size-3 text-white" />
          </div>
        )}
      </button>
    );
  };

  // Determine what to show in dropdown
  const isLoading = contacts === undefined;
  const showRecent = !searchQuery.trim() && recentContacts.length > 0;
  const showSearchResults = searchQuery.trim() && filteredContacts.length > 0;
  const showNoResults = searchQuery.trim() && filteredContacts.length === 0 && !isLoading;
  const showNoContacts = !searchQuery.trim() && contacts && contacts.length === 0;

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

          {/* Centered floating search container - using inset-0 m-auto like ActionModal */}
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

            {/* Dropdown results */}
            <div
              className="bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden mt-2"
              style={{ backfaceVisibility: "hidden" }}
            >
              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-[var(--tropx-vibrant)]" />
                </div>
              )}

              {/* Recent contacts (when not searching) */}
              {showRecent && (
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Clock className="h-3.5 w-3.5 text-[var(--tropx-shadow)]" />
                    <span className="text-xs font-medium text-[var(--tropx-shadow)] uppercase tracking-wide">
                      Recent
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {recentContacts.map((contact) => renderContactItem(contact))}
                  </div>
                </div>
              )}

              {/* Search results */}
              {showSearchResults && (
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <User className="h-3.5 w-3.5 text-[var(--tropx-vibrant)]" />
                    <span className="text-xs font-medium text-[var(--tropx-shadow)] uppercase tracking-wide">
                      Patients
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

              {/* No contacts yet */}
              {showNoContacts && (
                <div className="p-6 text-center">
                  <User className="h-8 w-8 text-[var(--tropx-ivory-dark)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--tropx-shadow)]">
                    No patients yet
                  </p>
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
