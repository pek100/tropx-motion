import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { XIcon, Mail, Loader2, UserPlus, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface InviteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteModal({ open, onOpenChange }: InviteModalProps) {
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createInvite = useMutation(api.invites.createInvite);

  const handleClose = () => {
    setEmail("");
    setAlias("");
    setError(null);
    setSuccess(false);
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await createInvite({
        email: email.trim(),
        alias: alias.trim() || undefined,
      });
      setSuccess(true);
      // Auto-close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
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

        {/* Modal content */}
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[51] m-auto",
            "w-full max-w-md h-fit p-6",
            "bg-white rounded-2xl shadow-lg border border-gray-100",
            "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
            "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
            "pointer-events-auto"
          )}
          onPointerDownOutside={handleClose}
          onInteractOutside={handleClose}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-[var(--tropx-hover)]">
                <UserPlus className="size-5 text-[var(--tropx-vibrant)]" />
              </div>
              <DialogPrimitive.Title className="text-lg font-semibold text-[var(--tropx-dark)]">
                Invite Patient
              </DialogPrimitive.Title>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <XIcon className="size-4 text-[var(--tropx-shadow)]" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          <DialogPrimitive.Description className="text-sm text-[var(--tropx-shadow)] mb-6">
            Send an invitation to a patient. They'll receive a link to join and connect with you.
          </DialogPrimitive.Description>

          {success ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="p-3 rounded-full bg-green-100 mb-4">
                <Check className="size-8 text-green-600" />
              </div>
              <p className="text-[var(--tropx-dark)] font-medium">Invite sent!</p>
              <p className="text-sm text-[var(--tropx-shadow)] mt-1">
                We'll notify them via email.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email field */}
              <div>
                <label
                  htmlFor="invite-email"
                  className="block text-sm font-medium text-[var(--tropx-dark)] mb-1.5"
                >
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--tropx-shadow)]" />
                  <input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="patient@example.com"
                    disabled={isSubmitting}
                    className={cn(
                      "w-full pl-10 pr-4 py-2.5 rounded-xl border-2 transition-all",
                      "text-[var(--tropx-dark)] placeholder:text-[var(--tropx-ivory-dark)]",
                      "focus:outline-none focus:border-[var(--tropx-vibrant)] focus:ring-2 focus:ring-[var(--tropx-vibrant)]/20",
                      error
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200 bg-white hover:border-[var(--tropx-coral)]",
                      isSubmitting && "opacity-50 cursor-not-allowed"
                    )}
                  />
                </div>
              </div>

              {/* Alias field (optional) */}
              <div>
                <label
                  htmlFor="invite-alias"
                  className="block text-sm font-medium text-[var(--tropx-dark)] mb-1.5"
                >
                  Nickname <span className="text-[var(--tropx-shadow)] font-normal">(optional)</span>
                </label>
                <input
                  id="invite-alias"
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="e.g., John - Knee Rehab"
                  disabled={isSubmitting}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-xl border-2 transition-all",
                    "text-[var(--tropx-dark)] placeholder:text-[var(--tropx-ivory-dark)]",
                    "focus:outline-none focus:border-[var(--tropx-vibrant)] focus:ring-2 focus:ring-[var(--tropx-vibrant)]/20",
                    "border-gray-200 bg-white hover:border-[var(--tropx-coral)]",
                    isSubmitting && "opacity-50 cursor-not-allowed"
                  )}
                />
              </div>

              {/* Error message */}
              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {/* Submit button */}
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={!email.trim() || isSubmitting}
                  className={cn(
                    "px-6 py-2.5 rounded-full font-medium transition-all flex items-center gap-2",
                    "hover:scale-[1.02] active:scale-[0.98]",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
                    "bg-[var(--tropx-vibrant)] text-white hover:opacity-90"
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="size-4" />
                      Send Invite
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default InviteModal;
