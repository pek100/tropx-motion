"use client";

import { useState } from "react";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { Button } from "../ui/button";
import { LogIn, LogOut, User, Loader2, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SettingsModal } from "../settings";

interface SignInButtonProps {
  className?: string;
}

export function SignInButton({ className }: SignInButtonProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const {
    isAuthenticated,
    isLoading,
    user,
    signIn,
    signOut,
    isConvexEnabled,
  } = useCurrentUser();

  // Don't render if Convex is not configured
  if (!isConvexEnabled) {
    return null;
  }

  // Loading state
  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled className={className}>
        <Loader2 className="w-4 h-4 animate-spin" />
      </Button>
    );
  }

  // Not authenticated - show sign in
  if (!isAuthenticated || !user) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={signIn}
        className={className}
      >
        <LogIn className="w-4 h-4 mr-2" />
        Sign In
      </Button>
    );
  }

  // Authenticated - show user menu
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={className}>
          {user.image ? (
            <img
              src={user.image}
              alt={user.name}
              className="w-6 h-6 rounded-full mr-2"
            />
          ) : (
            <User className="w-4 h-4 mr-2" />
          )}
          <span className="max-w-[120px] truncate">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-[var(--tropx-card)] border-[var(--tropx-border)]">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium text-[var(--tropx-text-main)]">{user.name}</span>
            <span className="text-xs text-[var(--tropx-text-sub)]">{user.email}</span>
            {user.role && (
              <span className="text-xs text-[var(--tropx-text-sub)] capitalize mt-1">
                {user.role}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[var(--tropx-border)]" />
        <DropdownMenuItem
          onClick={() => setIsSettingsOpen(true)}
          className="text-[var(--tropx-text-main)] focus:text-[var(--tropx-text-main)]"
        >
          <Settings2 className="w-4 h-4 mr-2" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut} className="text-red-500 dark:text-red-400 focus:text-red-600 dark:focus:text-red-300">
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>

      {/* Settings Modal */}
      <SettingsModal open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </DropdownMenu>
  );
}

export default SignInButton;
