"use client";

import { useCurrentUser } from "../../hooks/useCurrentUser";
import { Button } from "../ui/button";
import { LogIn, LogOut, User, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface SignInButtonProps {
  className?: string;
}

export function SignInButton({ className }: SignInButtonProps) {
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
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium">{user.name}</span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
            {user.role && (
              <span className="text-xs text-muted-foreground capitalize mt-1">
                {user.role}
              </span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} className="text-red-600">
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default SignInButton;
