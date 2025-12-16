"use client";

import { useState, useEffect, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "../ui/button";
import { Loader2, XIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { isConvexConfigured } from "../../lib/convex";
import { useAuthActions } from "@convex-dev/auth/react";
import { isElectron } from "../../lib/platform";
import { cn } from "../../lib/utils";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Benefit slides data - all icons use TropX orange
const BENEFITS = [
  {
    id: "ai-analysis",
    title: "AI-Powered Analysis",
    description: "Get instant insights on joint movement patterns and rehabilitation progress",
    Icon: AIAnalysisIcon,
    color: "var(--tropx-vibrant)",
  },
  {
    id: "cloud-sync",
    title: "Cloud Sync",
    description: "Access your recordings from any device, anywhere",
    Icon: CloudSyncIcon,
    color: "var(--tropx-vibrant)",
  },
  {
    id: "patient-management",
    title: "Patient Management",
    description: "Organize patient profiles and track their progress over time",
    Icon: PatientManagementIcon,
    color: "var(--tropx-vibrant)",
  },
];

// AI Analysis Icon - Brain with sparkles
function AIAnalysisIcon({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Brain outline */}
      <motion.path
        d="M32 12C24 12 18 18 18 26C18 30 20 34 24 36C24 40 24 44 24 48C24 50 26 52 28 52H36C38 52 40 50 40 48C40 44 40 40 40 36C44 34 46 30 46 26C46 18 40 12 32 12Z"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
      />
      {/* Brain details */}
      <motion.path
        d="M26 26C28 24 30 26 32 24C34 22 36 26 38 24"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.6 }}
      />
      <motion.path
        d="M26 32C28 30 30 32 32 30C34 28 36 32 38 30"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.8 }}
      />
      {/* Sparkles */}
      <motion.circle
        cx="12" cy="16" r="2"
        fill={color}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.2, 1], opacity: [0, 1, 0.8] }}
        transition={{ duration: 0.5, delay: 1.2, repeat: Infinity, repeatDelay: 2 }}
      />
      <motion.circle
        cx="52" cy="20" r="1.5"
        fill={color}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.2, 1], opacity: [0, 1, 0.8] }}
        transition={{ duration: 0.5, delay: 1.5, repeat: Infinity, repeatDelay: 2 }}
      />
      <motion.circle
        cx="50" cy="38" r="2"
        fill={color}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.2, 1], opacity: [0, 1, 0.8] }}
        transition={{ duration: 0.5, delay: 1.8, repeat: Infinity, repeatDelay: 2 }}
      />
      {/* Star sparkle */}
      <motion.path
        d="M10 32L12 28L14 32L18 34L14 36L12 40L10 36L6 34L10 32Z"
        fill={color}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1, 0.8], opacity: [0, 1, 0.6] }}
        transition={{ duration: 0.6, delay: 1.4, repeat: Infinity, repeatDelay: 2.5 }}
      />
    </svg>
  );
}

// Cloud Sync Icon - Cloud with arrows
function CloudSyncIcon({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cloud */}
      <motion.path
        d="M48 36C52.4183 36 56 32.4183 56 28C56 23.5817 52.4183 20 48 20C48 20 48 20 48 20C48 13.3726 42.6274 8 36 8C30.4772 8 25.8239 11.7549 24.4 16.8C24.2687 16.8 24.1358 16.8 24 16.8C17.3726 16.8 12 22.1726 12 28.8C12 35.4274 17.3726 40.8 24 40.8H48C48 40.8 48 36 48 36Z"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
      />
      {/* Sync arrows */}
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.5 }}
      >
        <motion.path
          d="M28 48L32 44L36 48"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          animate={{ y: [0, -2, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M32 44V56"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          animate={{ y: [0, -2, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.g>
      <motion.g
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.5 }}
      >
        <motion.path
          d="M40 56L44 52L48 56"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: "rotate(180deg)", transformOrigin: "44px 54px" }}
          animate={{ y: [0, 2, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.75 }}
        />
        <motion.path
          d="M44 44V56"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          animate={{ y: [0, 2, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.75 }}
        />
      </motion.g>
    </svg>
  );
}

// Patient Management Icon - Person with chart
function PatientManagementIcon({ color }: { color: string }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Person */}
      <motion.circle
        cx="24" cy="18" r="8"
        stroke={color}
        strokeWidth="2.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      />
      <motion.path
        d="M12 52C12 42 17.3726 34 24 34C30.6274 34 36 42 36 52"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, delay: 0.4, ease: "easeInOut" }}
      />
      {/* Chart */}
      <motion.rect
        x="38" y="24" width="18" height="28" rx="2"
        stroke={color}
        strokeWidth="2"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.8 }}
      />
      {/* Chart bars */}
      <motion.rect
        x="42" y="40" width="3" height="8" rx="1"
        fill={color}
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay: 1.2 }}
        style={{ transformOrigin: "43.5px 48px" }}
      />
      <motion.rect
        x="47" y="36" width="3" height="12" rx="1"
        fill={color}
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay: 1.4 }}
        style={{ transformOrigin: "48.5px 48px" }}
      />
      <motion.rect
        x="52" y="32" width="3" height="16" rx="1"
        fill={color}
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay: 1.6 }}
        style={{ transformOrigin: "53.5px 48px" }}
      />
      {/* Checkmark */}
      <motion.path
        d="M42 28L45 31L52 24"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 1.8 }}
      />
    </svg>
  );
}

// Carousel component
function BenefitsCarousel({ currentIndex, setCurrentIndex }: {
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
}) {
  // Auto-advance carousel
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((currentIndex + 1) % BENEFITS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [currentIndex, setCurrentIndex]);

  const goToPrev = useCallback(() => {
    setCurrentIndex((currentIndex - 1 + BENEFITS.length) % BENEFITS.length);
  }, [currentIndex, setCurrentIndex]);

  const goToNext = useCallback(() => {
    setCurrentIndex((currentIndex + 1) % BENEFITS.length);
  }, [currentIndex, setCurrentIndex]);

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[var(--tropx-light)] to-white border border-[var(--tropx-vibrant)]/10 p-4">
      {/* Carousel content */}
      <div className="relative h-[180px]">
        <AnimatePresence mode="wait">
          {BENEFITS.map((benefit, index) => (
            index === currentIndex && (
              <motion.div
                key={benefit.id}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="absolute inset-0 flex flex-col items-center justify-center text-center px-4"
              >
                {/* Icon */}
                <div className="mb-3">
                  <benefit.Icon color={benefit.color} />
                </div>

                {/* Title */}
                <h4 className="font-semibold text-base text-[var(--tropx-dark)] mb-1">
                  {benefit.title}
                </h4>

                {/* Description */}
                <p className="text-sm text-[var(--tropx-shadow)] leading-snug">
                  {benefit.description}
                </p>
              </motion.div>
            )
          ))}
        </AnimatePresence>
      </div>

      {/* Navigation arrows */}
      <button
        onClick={goToPrev}
        className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/80 hover:bg-white shadow-sm transition-all cursor-pointer hover:scale-105"
        aria-label="Previous benefit"
      >
        <ChevronLeft className="size-4 text-[var(--tropx-shadow)]" />
      </button>
      <button
        onClick={goToNext}
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/80 hover:bg-white shadow-sm transition-all cursor-pointer hover:scale-105"
        aria-label="Next benefit"
      >
        <ChevronRight className="size-4 text-[var(--tropx-shadow)]" />
      </button>

      {/* Dot indicators */}
      <div className="flex justify-center gap-2 mt-3">
        {BENEFITS.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={cn(
              "w-2 h-2 rounded-full transition-all cursor-pointer",
              index === currentIndex
                ? "bg-[var(--tropx-vibrant)] w-4"
                : "bg-gray-300 hover:bg-gray-400"
            )}
            aria-label={`Go to benefit ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

// Inner component that uses hooks - only rendered when Convex is configured
function AuthModalContent({
  open,
  onOpenChange,
  onSuccess,
}: AuthModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const { signIn } = useAuthActions();

  // Reset carousel when modal opens
  useEffect(() => {
    if (open) {
      setCarouselIndex(0);
      setError(null);
    }
  }, [open]);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (isElectron() && window.electronAPI?.auth) {
        // Electron: Use popup OAuth flow via web app
        console.log('[AuthModal] Using Electron OAuth popup flow');
        const result = await window.electronAPI.auth.signInWithGoogle();

        if (result.success) {
          console.log('[AuthModal] OAuth successful, tokens injected - reloading to apply auth');
          onOpenChange(false);
          onSuccess?.();
          // Convex Auth reads tokens on initialization, so reload to pick them up
          window.location.reload();
        } else {
          setError(result.error || "Failed to sign in. Please try again.");
          setIsLoading(false);
        }
      } else {
        // Web: Use Convex Auth directly
        console.log('[AuthModal] Using Convex Auth (web)');
        await signIn("google");
        // Convex Auth handles the redirect, no need to do anything else
      }
    } catch (err) {
      console.error("Sign in error:", err);
      setError("Failed to sign in. Please try again.");
      setIsLoading(false);
    }
  };

  const handleClose = () => onOpenChange(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Blur overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 modal-blur-overlay cursor-default',
            'data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]',
            'data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]'
          )}
          style={{
            willChange: 'opacity',
            transform: 'translateZ(0)',
          }}
          onClick={handleClose}
        />

        {/* Modal content */}
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 z-[51] m-auto',
            'w-full max-w-md h-fit p-6',
            'bg-white rounded-2xl shadow-lg border border-gray-100',
            'data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]',
            'data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]',
            'pointer-events-auto'
          )}
          onPointerDownOutside={handleClose}
          onInteractOutside={handleClose}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {/* TropX Logo */}
              <svg
                width="36"
                height="36"
                viewBox="0 0 1024 1024"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M536.573 188.5C480.508 217.268 427.514 275.625 441.339 293.707C458.235 315.077 528.125 283.844 583.423 229.597C645.632 167.952 620.288 146.582 536.573 188.5Z"
                  fill="var(--tropx-vibrant)"
                />
                <path
                  d="M753.405 396.365C627.93 499.319 494.412 599.86 487.977 595.838C484.76 594.229 480.738 549.187 478.325 497.71C471.89 367.409 452.587 326.388 397.892 326.388C348.828 326.388 279.656 410.038 191.985 575.73C116.378 718.9 98.6828 808.18 138.899 840.353C150.964 850.005 167.051 857.244 175.898 857.244C199.224 857.244 260.352 823.462 326.307 773.594L385.023 729.356L406.74 771.181C452.587 862.874 525.78 873.331 658.494 807.376C699.515 786.463 771.904 739.812 818.555 702.813C899.792 640.076 986.66 563.665 986.66 555.622C986.66 553.209 960.117 570.099 927.14 591.816C817.751 665.814 673.777 728.552 615.061 728.552C583.692 728.552 534.628 701.205 515.324 673.053L496.02 644.098L537.845 607.903C675.385 490.471 853.141 327.193 848.315 322.367C847.511 320.758 804.078 353.736 753.405 396.365ZM389.849 566.882C396.284 603.077 398.697 637.663 396.284 644.098C393.871 650.532 375.371 664.206 355.263 673.858C321.481 690.748 316.655 690.748 296.547 679.488C265.983 662.597 262.765 616.75 289.308 576.534C316.655 535.513 359.285 493.688 370.545 497.71C375.371 499.319 384.219 529.883 389.849 566.882Z"
                  fill="var(--tropx-vibrant)"
                />
              </svg>
              <div>
                <DialogPrimitive.Title className="text-lg font-semibold text-[var(--tropx-dark)]">
                  Welcome to TropX
                </DialogPrimitive.Title>
                <p className="text-xs text-[var(--tropx-shadow)]">Sign in to unlock cloud features</p>
              </div>
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

          {/* Benefits Carousel */}
          <BenefitsCarousel
            currentIndex={carouselIndex}
            setCurrentIndex={setCarouselIndex}
          />

          {/* Sign In Section */}
          <div className="mt-5 space-y-3">
            {/* Google Sign In Button */}
            <Button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              size="lg"
              className="w-full relative group"
              variant="outline"
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <svg
                  className="mr-2 h-5 w-5"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )}
              {isLoading ? "Signing in..." : "Continue with Google"}
            </Button>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-red-50 border border-red-100 p-3 text-center text-sm text-red-600"
              >
                {error}
              </motion.div>
            )}

            {/* Terms */}
            <p className="text-center text-xs text-[var(--tropx-shadow)]">
              By signing in, you agree to our{" "}
              <a href="#" className="underline hover:text-[var(--tropx-dark)]">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="underline hover:text-[var(--tropx-dark)]">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Main export - checks if Convex is configured
export function AuthModal({ open, onOpenChange, onSuccess }: AuthModalProps) {
  // If Convex not configured, don't render anything
  if (!isConvexConfigured()) {
    return null;
  }

  return (
    <AuthModalContent
      open={open}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />
  );
}

export default AuthModal;
