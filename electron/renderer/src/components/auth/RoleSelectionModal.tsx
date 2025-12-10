"use client";

import { useState } from "react";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Stethoscope, UserRound, Loader2 } from "lucide-react";

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
    icon: <Stethoscope className="w-8 h-8" />,
  },
  {
    id: "patient",
    title: "Patient",
    description: "View recordings shared with you and track your progress.",
    icon: <UserRound className="w-8 h-8" />,
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
    <Dialog open={needsOnboarding} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Welcome to TropX Motion</DialogTitle>
          <DialogDescription>
            {user?.name ? `Hi ${user.name}! ` : ""}
            Please select your role to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelectedRole(option.id)}
              disabled={isSubmitting}
              className={`flex items-start gap-4 p-4 rounded-lg border-2 transition-all text-left ${
                selectedRole === option.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              } ${isSubmitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div
                className={`p-2 rounded-full ${
                  selectedRole === option.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {option.icon}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">{option.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {option.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleRoleSelect}
            disabled={!selectedRole || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Setting up...
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default RoleSelectionModal;
