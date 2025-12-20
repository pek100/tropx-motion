"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { Stethoscope, UserRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RoleOption {
  id: "physiotherapist" | "patient";
  title: string;
  description: string;
  icon: React.ReactNode;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    id: "physiotherapist",
    title: "Physiotherapist",
    description: "Record and manage patient sessions, invite patients, and share recordings.",
    icon: <Stethoscope className="w-7 h-7" />,
  },
  {
    id: "patient",
    title: "Patient",
    description: "View recordings shared with you and track your progress.",
    icon: <UserRound className="w-7 h-7" />,
  },
];

export function RoleSelectionModal() {
  const { needsOnboarding, completeOnboarding, user, isConvexEnabled } =
    useCurrentUser();
  const [selectedRole, setSelectedRole] = useState<"physiotherapist" | "patient" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Don't render if Convex not configured or user doesn't need onboarding
  if (!isConvexEnabled || !needsOnboarding) {
    return null;
  }

  const handleRoleSelect = async () => {
    if (!selectedRole) return;

    setIsSubmitting(true);
    try {
      await completeOnboarding(selectedRole);
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogPrimitive.Root open={needsOnboarding} onOpenChange={() => {}}>
      <DialogPrimitive.Portal>
        {/* Blur overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 modal-blur-overlay",
            "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
            "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
          )}
          style={{
            willChange: "opacity",
            transform: "translateZ(0)",
          }}
        />

        {/* Modal content */}
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[51] m-auto",
            "w-full max-w-md h-fit p-6",
            "bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]",
            "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
            "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
            "pointer-events-auto"
          )}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="mb-6">
            <DialogPrimitive.Title className="text-xl font-semibold text-[var(--tropx-text-main)]">
              Welcome to TropX Motion
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-[var(--tropx-text-sub)] mt-1">
              {user?.name ? `Hi ${user.name}! ` : ""}
              Please select your role to continue.
            </DialogPrimitive.Description>
          </div>

          {/* Role options */}
          <div className="grid gap-3">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setSelectedRole(option.id)}
                disabled={isSubmitting}
                className={cn(
                  "flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left",
                  "hover:scale-[1.01] active:scale-[0.99]",
                  selectedRole === option.id
                    ? "border-[var(--tropx-vibrant)] bg-[var(--tropx-hover)]"
                    : "border-[var(--tropx-border)] hover:border-[var(--tropx-vibrant)]/50 hover:bg-[var(--tropx-hover)]",
                  isSubmitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                )}
              >
                <div
                  className={cn(
                    "p-2.5 rounded-full transition-colors",
                    selectedRole === option.id
                      ? "bg-[var(--tropx-vibrant)] text-white"
                      : "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)]"
                  )}
                >
                  {option.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[var(--tropx-text-main)]">{option.title}</h3>
                  <p className="text-sm text-[var(--tropx-text-sub)] mt-1">
                    {option.description}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Continue button */}
          <div className="flex justify-end mt-6">
            <button
              onClick={handleRoleSelect}
              disabled={!selectedRole || isSubmitting}
              className={cn(
                "px-6 py-2.5 rounded-full font-medium transition-all",
                "hover:scale-[1.02] active:scale-[0.98]",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
                selectedRole
                  ? "bg-[var(--tropx-vibrant)] text-white hover:opacity-90"
                  : "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)]"
              )}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Setting up...
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default RoleSelectionModal;
