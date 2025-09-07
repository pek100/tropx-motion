"use client"

import { useState, useCallback, useMemo, memo } from "react"
import { Play, Pause, RotateCcw, Zap, Wifi, WifiOff, Calendar, Dumbbell, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { usePatient } from "@/context/patient/PatientContext"
import { useToast } from "@/hooks/use-toast"

// Type definitions
interface Patient {
    id?: string
    patient_id?: string
    name?: string
    firstName?: string
    avatar?: string
}

interface Session {
    name: string
    id: string
}

interface Exercise {
    name: string
    _id: string
}

interface RecordingData {
    id: string
    exerciseName?: string
    sessionName?: string
    joints_arr?: any[]
    measurement_sequences?: any[]
}

interface BatteryLevels {
    [deviceName: string]: number
}

// AI Icon Component Props
interface AIIconProps {
    className?: string
    animated?: boolean
}

// AI Icon Component with Subtle Animation
const AIIcon = memo<AIIconProps>(({ className, animated = false }) => {
    if (animated) {
        return (
            <svg
                width="20"
                height="20"
                viewBox="0 0 66 66"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className={className}
            >
                {/* First layer - horizontal ellipse (slowest rotation) */}
                <path
                    d="M8.01172 33.1328C8.01172 24.4479 19.1994 17.4072 33 17.4072C46.8006 17.4072 57.9883 24.4479 57.9883 33.1328C57.9882 41.8177 46.8006 48.8584 33 48.8584C19.1994 48.8584 8.0118 41.8177 8.01172 33.1328ZM10.333 33.1328C10.3331 41.8176 20.4806 48.8582 32.998 48.8584C45.5157 48.8584 55.664 41.8177 55.6641 33.1328C55.6641 24.4479 37.5157 17.4072 32.998 17.4072C20.4806 17.4074 10.333 24.448 10.333 33.1328Z"
                    fill="currentColor"
                    style={{
                        animation: "spin 12s linear infinite",
                        transformOrigin: "33px 33px",
                    }}
                />
                {/* Second layer - vertical ellipse (medium rotation, reverse) */}
                <path
                    d="M33 8.02637C43.349 8.02639 51.7383 19.2075 51.7383 33C51.7382 46.7924 43.3489 57.9736 33 57.9736C22.651 57.9736 14.2618 46.7924 14.2617 33C14.2617 19.2075 22.651 8.02637 33 8.02637ZM33 14.9355C22.651 14.9355 14.2617 23.0235 14.2617 33C14.2618 42.9764 22.651 51.0635 33 51.0635C43.349 51.0635 51.7382 42.9764 51.7383 33C51.7383 23.0235 43.349 14.9355 33 14.9355Z"
                    fill="currentColor"
                    style={{
                        animation: "spin 8s linear infinite reverse",
                        transformOrigin: "33px 33px",
                    }}
                />
                {/* Third layer - diagonal ellipse (fastest rotation) */}
                <path
                    d="M25.4388 26.0351C30.6623 20.4691 38.2819 19.1342 42.4583 23.0536C46.6346 26.9731 45.7863 34.6625 40.5628 40.2285C35.3393 45.7944 27.7187 47.1292 23.5423 43.2099C19.3659 39.2905 20.2152 31.6011 25.4388 26.0351ZM32.9407 23.1347C27.2134 23.1678 22.5963 27.6711 22.6282 33.1923C22.6603 38.7133 27.3288 43.1618 33.056 43.1288C38.7833 43.0958 43.4003 38.5934 43.3685 33.0722C43.3366 27.551 38.6681 23.1016 32.9407 23.1347Z"
                    fill="currentColor"
                    style={{
                        animation: "spin 5s linear infinite",
                        transformOrigin: "33px 33px",
                    }}
                />
            </svg>
        )
    }

    // Static version
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 66 66"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            <path
                d="M8.01172 33.1328C8.01172 24.4479 19.1994 17.4072 33 17.4072C46.8006 17.4072 57.9883 24.4479 57.9883 33.1328C57.9882 41.8177 46.8006 48.8584 33 48.8584C19.1994 48.8584 8.0118 41.8177 8.01172 33.1328ZM10.333 33.1328C10.3331 41.8176 20.4806 48.8582 32.998 48.8584C45.5157 48.8584 55.664 41.8177 55.6641 33.1328C55.6641 24.4479 37.5157 17.4072 32.998 17.4072C20.4806 17.4074 10.333 24.448 10.333 33.1328Z"
                fill="currentColor"
            />
            <path
                d="M33 8.02637C43.349 8.02639 51.7383 19.2075 51.7383 33C51.7382 46.7924 43.3489 57.9736 33 57.9736C22.651 57.9736 14.2618 46.7924 14.2617 33C14.2617 19.2075 22.651 8.02637 33 8.02637ZM33 14.9355C22.651 14.9355 14.2617 23.0235 14.2617 33C14.2618 42.9764 22.651 51.0635 33 51.0635C43.349 51.0635 51.7382 42.9764 51.7383 33C51.7383 23.0235 43.349 14.9355 33 14.9355Z"
                fill="currentColor"
            />
            <path
                d="M25.4388 26.0351C30.6623 20.4691 38.2819 19.1342 42.4583 23.0536C46.6346 26.9731 45.7863 34.6625 40.5628 40.2285C35.3393 45.7944 27.7187 47.1292 23.5423 43.2099C19.3659 39.2905 20.2152 31.6011 25.4388 26.0351ZM32.9407 23.1347C27.2134 23.1678 22.5963 27.6711 22.6282 33.1923C22.6603 38.7133 27.3288 43.1618 33.056 43.1288C38.7833 43.0958 43.4003 38.5934 43.3685 33.0722C43.3366 27.551 38.6681 23.1016 32.9407 23.1347Z"
                fill="currentColor"
            />
        </svg>
    )
})

AIIcon.displayName = "AIIcon"

// AI Analysis Button Props
interface AIAnalysisButtonProps {
    onOpenAI: () => void
    isRecording: boolean
    hasRecordingData: boolean
}

// Enhanced AI Analysis Button with Circular Animation
const AIAnalysisButton = memo<AIAnalysisButtonProps>(({ onOpenAI, isRecording, hasRecordingData }) => {
    const [isAnimating, setIsAnimating] = useState<boolean>(false)

    const getStatusBadge = () => {
        if (isRecording) return { variant: "secondary" as const, text: "Recording", color: "bg-amber-500" }
        if (hasRecordingData) return { variant: "default" as const, text: "Ready", color: "bg-green-500" }
        return { variant: "outline" as const, text: "Waiting", color: "bg-gray-400" }
    }

    const status = getStatusBadge()

    const handleClick = useCallback(() => {
        if (isRecording) return

        // Trigger animation
        setIsAnimating(true)

        // Call the original handler after a brief delay to let animation start
        setTimeout(() => {
            onOpenAI()
        }, 150)

        // Reset animation after completion
        setTimeout(() => {
            setIsAnimating(false)
        }, 800)
    }, [onOpenAI, isRecording])

    return (
        <Button
            onClick={handleClick}
            disabled={isRecording}
            className={`
        relative h-12 px-4 rounded-xl transition-all duration-300 group overflow-hidden
        ${
                isRecording
                    ? "bg-gray-100 text-gray-500 cursor-not-allowed border border-gray-200"
                    : "bg-white hover:bg-gray-50 text-gray-900 shadow-md hover:shadow-lg border border-gray-200 hover:border-gray-300"
            }
      `}
        >
            {/* Circular Animation Layers - inspired by rotating logo */}
            {isAnimating && !isRecording && (
                <>
                    {/* First expanding circle (slowest, largest) */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div
                            className="w-8 h-8 border-2 border-[#FF4D35]/30 rounded-full"
                            style={{
                                animation: "expandFade 800ms cubic-bezier(0.4, 0, 0.2, 1) forwards",
                            }}
                        />
                    </div>

                    {/* Second expanding circle (medium speed) */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div
                            className="w-6 h-6 border-2 border-[#FF4D35]/50 rounded-full"
                            style={{
                                animation: "expandFade 600ms cubic-bezier(0.4, 0, 0.2, 1) 100ms forwards",
                            }}
                        />
                    </div>

                    {/* Third expanding circle (fastest, smallest) */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div
                            className="w-4 h-4 border-2 border-[#FF4D35]/70 rounded-full"
                            style={{
                                animation: "expandFade 400ms cubic-bezier(0.4, 0, 0.2, 1) 200ms forwards",
                            }}
                        />
                    </div>

                    {/* Central pulse */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div
                            className="w-2 h-2 bg-[#FF4D35]/80 rounded-full"
                            style={{
                                animation: "centralPulse 300ms cubic-bezier(0.4, 0, 0.2, 1) 300ms forwards",
                            }}
                        />
                    </div>
                </>
            )}

            {/* Diagonal shimmer effect - only when recording data is ready */}
            {!isRecording && hasRecordingData && !isAnimating && (
                <div className="absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-[#FF4D35]/10 to-transparent translate-x-[-100%] group-hover:translate-x-[200%] transition-transform duration-1000 ease-out" />
            )}

            <div className="flex items-center gap-3 relative z-10">
                {/* AI Icon with subtle rotation */}
                <div className="relative flex-shrink-0">
                    <AIIcon
                        className={`transition-all duration-300 ${
                            isRecording ? "text-gray-400" : hasRecordingData ? "text-[#FF4D35]" : "text-gray-600"
                        } ${isAnimating ? "scale-110" : ""}`}
                        animated={!isRecording}
                    />
                </div>

                {/* Content */}
                <div className="flex flex-col items-start min-w-0">
                    <span className="font-semibold text-sm leading-tight whitespace-nowrap">AI Analysis</span>
                    <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${status.color}`} />
                        <span
                            className={`text-xs leading-tight transition-colors duration-300 whitespace-nowrap ${
                                isRecording ? "text-gray-400" : hasRecordingData ? "text-gray-700" : "text-gray-500"
                            }`}
                        >
              {status.text}
            </span>
                    </div>
                </div>

                {/* Status indicator */}
                <div className="flex-shrink-0">
                    {isRecording ? (
                        <div className="w-2 h-2 bg-gray-400 rounded-full" />
                    ) : hasRecordingData ? (
                        <div className="w-2 h-2 bg-green-500 rounded-full" />
                    ) : (
                        <div className="w-2 h-2 bg-gray-400 rounded-full" />
                    )}
                </div>
            </div>

            {/* Add the keyframe animations via style tag */}
            <style>{`
                @keyframes expandFade {
                    0% {
                        transform: scale(0.5);
                        opacity: 0.8;
                    }
                    50% {
                        opacity: 0.4;
                    }
                    100% {
                        transform: scale(3);
                        opacity: 0;
                    }
                }

                @keyframes centralPulse {
                    0% {
                        transform: scale(0);
                        opacity: 1;
                    }
                    50% {
                        transform: scale(1.5);
                        opacity: 0.8;
                    }
                    100% {
                        transform: scale(0);
                        opacity: 0;
                    }
                }
            `}</style>
        </Button>
    )
})

AIAnalysisButton.displayName = "AIAnalysisButton"

// Enhanced Patient Info Section using PatientContext
const PatientInfo = memo(() => {
    const { selectedPatient } = usePatient()

    // Safely handle selectedPatient - it's an object from the context
    const patientName = selectedPatient?.name || selectedPatient?.firstName || "Select Patient"
    const patientId = selectedPatient?.id || selectedPatient?.patient_id || ""
    const initials = patientName && patientName !== "Select Patient" ? patientName.slice(0, 2).toUpperCase() : "PT"

    return (
        <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 border-2 border-[#FF4D35]/20">
                <AvatarImage src={selectedPatient?.avatar || "/placeholder.svg?height=32&width=32"} />
                <AvatarFallback className="bg-[#FF4D35]/10 text-[#FF4D35] text-xs font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-900">{patientName}</span>
                <span className="text-xs text-gray-500">{patientId ? `ID: ${patientId}` : "Active Session"}</span>
            </div>
        </div>
    )
})

PatientInfo.displayName = "PatientInfo"

// Set Selector Props
interface SetSelectorProps {
    currentSet: number
    totalSets: number
    onSetChange: (set: number) => void
    completedSets: Set<number>
    isRecording: boolean
    selectedExercise: Exercise | null
}

// Enhanced Set Selector Component
const SetSelector = memo<SetSelectorProps>(({ currentSet, totalSets, onSetChange, completedSets, isRecording, selectedExercise }) => {
    if (!selectedExercise) return null

    const sets = Array.from({ length: totalSets }, (_, i) => i + 1)

    return (
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">Sets:</span>
                <div className="flex items-center gap-1">
                    {sets.map((setNumber) => {
                        const isCompleted = completedSets.has(setNumber)
                        const isCurrent = setNumber === currentSet
                        const isDisabled = isRecording

                        return (
                            <TooltipProvider key={setNumber}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant={isCurrent ? "default" : isCompleted ? "secondary" : "outline"}
                                            size="sm"
                                            onClick={() => !isDisabled && onSetChange(setNumber)}
                                            disabled={isDisabled}
                                            className={`
                        h-8 w-8 p-0 relative transition-all duration-200
                        ${
                                                isCurrent
                                                    ? "bg-[#FF4D35] hover:bg-[#e63e2b] text-white shadow-md"
                                                    : isCompleted
                                                        ? "bg-green-100 hover:bg-green-200 text-green-700 border-green-300"
                                                        : "hover:bg-gray-50"
                                            }
                        ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}
                      `}
                                        >
                                            <span className="text-xs font-medium">{setNumber}</span>
                                            {isCompleted && (
                                                <CheckCircle className="absolute -top-1 -right-1 w-3 h-3 text-green-600 bg-white rounded-full" />
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="z-50">
                                        <p className="text-sm">
                                            {isCompleted
                                                ? `Set ${setNumber} completed - Click to re-record`
                                                : isCurrent
                                                    ? `Current set: ${setNumber}`
                                                    : `Set ${setNumber} - Not recorded`}
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )
                    })}
                </div>
            </div>

            <Badge variant="outline" className="text-xs">
                {Array.from(completedSets).length}/{totalSets} completed
            </Badge>
        </div>
    )
})

SetSelector.displayName = "SetSelector"

// Session Exercise Selector Props
interface SessionExerciseSelectorProps {
    selectedSession: Session | null
    selectedExercise: Exercise | null
    onSessionExerciseSelect: (session: Session, exercise: Exercise | null) => void
}

// Enhanced Session Exercise Selector with Tabs
const SessionExerciseSelector = memo<SessionExerciseSelectorProps>(({ selectedSession, selectedExercise, onSessionExerciseSelect }) => {
    const [sessionOpen, setSessionOpen] = useState<boolean>(false)
    const [exerciseOpen, setExerciseOpen] = useState<boolean>(false)

    const sessions: string[] = ["Morning Session", "Afternoon Session", "Evening Session"]
    const exercises: string[] = ["Squat Analysis", "Gait Analysis", "Balance Test", "Range of Motion"]

    const handleSessionSelect = (session: string) => {
        onSessionExerciseSelect({ name: session, id: session }, selectedExercise)
        setSessionOpen(false) // Close the popover
    }

    const handleExerciseSelect = (exercise: string) => {
        onSessionExerciseSelect(selectedSession!, { name: exercise, _id: exercise })
        setExerciseOpen(false) // Close the popover
    }

    return (
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-500" />
                <Popover open={sessionOpen} onOpenChange={setSessionOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className="h-9 gap-2 hover:bg-[#FF4D35] hover:text-white transition-colors bg-transparent"
                        >
                            <span className="text-sm">{selectedSession?.name || "Select Session"}</span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="center">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm">Select Session</CardTitle>
                                <CardDescription className="text-xs">Choose your current session</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {sessions.map((session) => (
                                    <Button
                                        key={session}
                                        variant={selectedSession?.name === session ? "default" : "ghost"}
                                        className={`w-full justify-start h-8 text-sm ${
                                            selectedSession?.name === session ? "bg-[#FF4D35] hover:bg-[#e63e2b] text-white" : ""
                                        }`}
                                        onClick={() => handleSessionSelect(session)}
                                    >
                                        {session}
                                    </Button>
                                ))}
                            </CardContent>
                        </Card>
                    </PopoverContent>
                </Popover>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <div className="flex items-center gap-2">
                <Dumbbell className="w-4 h-4 text-gray-500" />
                <Popover open={exerciseOpen} onOpenChange={setExerciseOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className="h-9 gap-2 hover:bg-[#FF4D35] hover:text-white transition-colors bg-transparent"
                        >
                            <span className="text-sm">{selectedExercise?.name || "Select Exercise"}</span>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="center">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-sm">Select Exercise</CardTitle>
                                <CardDescription className="text-xs">Choose the exercise to analyze</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {exercises.map((exercise) => (
                                    <Button
                                        key={exercise}
                                        variant={selectedExercise?.name === exercise ? "default" : "ghost"}
                                        className={`w-full justify-start h-8 text-sm ${
                                            selectedExercise?.name === exercise ? "bg-[#FF4D35] hover:bg-[#e63e2b] text-white" : ""
                                        }`}
                                        onClick={() => handleExerciseSelect(exercise)}
                                    >
                                        {exercise}
                                    </Button>
                                ))}
                            </CardContent>
                        </Card>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    )
})

SessionExerciseSelector.displayName = "SessionExerciseSelector"

// Device Status Props
interface DeviceStatusProps {
    connectedCount: number
    totalDevices: number
    onConnectAll: () => Promise<void>
    isConnecting: boolean
    batteryLevels: BatteryLevels
    connectedDevices: string[] | Map<string, any>
}

// Enhanced Device Status with Progress and Badges
const DeviceStatus = memo<DeviceStatusProps>(
    ({ connectedCount, totalDevices, onConnectAll, isConnecting, batteryLevels, connectedDevices }) => {
        const [isLoading, setIsLoading] = useState<boolean>(false)
        const [autoConnect, setAutoConnect] = useState<boolean>(true)

        const deviceNames = useMemo(() => {
            if (!connectedDevices) return []
            if (connectedDevices instanceof Map) {
                return Array.from(connectedDevices.keys())
            }
            return Array.from(connectedDevices)
        }, [connectedDevices])

        const handleConnectAll = useCallback(async () => {
            if (isLoading) return
            try {
                setIsLoading(true)
                await onConnectAll()
            } finally {
                setIsLoading(false)
            }
        }, [onConnectAll, isLoading])

        const connectionPercentage = (connectedCount / totalDevices) * 100
        const isFullyConnected = connectedCount === totalDevices

        return (
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="h-10 gap-3 hover:bg-gray-50 transition-colors bg-transparent">
                        <div className="flex items-center gap-2">
                            {isFullyConnected ? (
                                <Wifi className="w-4 h-4 text-green-500" />
                            ) : connectedCount > 0 ? (
                                <Wifi className="w-4 h-4 text-amber-500" />
                            ) : (
                                <WifiOff className="w-4 h-4 text-gray-400" />
                            )}
                            <span className="text-sm font-medium">
                {connectedCount}/{totalDevices}
              </span>
                        </div>
                        <Badge
                            variant={isFullyConnected ? "default" : connectedCount > 0 ? "secondary" : "outline"}
                            className={`text-xs ${
                                isFullyConnected
                                    ? "bg-green-500 hover:bg-green-600"
                                    : connectedCount > 0
                                        ? "bg-amber-500 hover:bg-amber-600 text-white"
                                        : ""
                            }`}
                        >
                            {isFullyConnected ? "Connected" : connectedCount > 0 ? "Partial" : "Disconnected"}
                        </Badge>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0 z-50" align="end">
                    <Card>
                        <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-base">Device Management</CardTitle>
                                    <CardDescription className="text-sm">Monitor and control your devices</CardDescription>
                                </div>
                                <Badge variant="outline" className="text-xs">
                                    {connectedCount}/{totalDevices}
                                </Badge>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span>Connection Progress</span>
                                    <span className="font-medium">{Math.round(connectionPercentage)}%</span>
                                </div>
                                <Progress value={connectionPercentage} className="h-2" />
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Auto-connect toggle */}
                            <div className="flex items-center justify-between">
                                <Label htmlFor="auto-connect" className="text-sm font-medium">
                                    Auto-connect devices
                                </Label>
                                <Switch
                                    id="auto-connect"
                                    checked={autoConnect}
                                    onCheckedChange={setAutoConnect}
                                    className="data-[state=checked]:bg-[#FF4D35]"
                                />
                            </div>

                            <Separator />

                            {/* Device list */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">Connected Devices</span>
                                    <Button
                                        size="sm"
                                        onClick={handleConnectAll}
                                        disabled={isLoading || isConnecting}
                                        className="h-7 text-xs bg-[#FF4D35] hover:bg-[#e63e2b]"
                                    >
                                        {isLoading ? (
                                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                                        ) : null}
                                        {isLoading ? "Connecting..." : "Connect All"}
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    {deviceNames.length > 0 ? (
                                        deviceNames.map((deviceName) => {
                                            const batteryLevel = batteryLevels[deviceName]
                                            const isLowBattery = batteryLevel !== undefined && batteryLevel < 20

                                            return (
                                                <div
                                                    key={deviceName}
                                                    className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-2 h-2 bg-green-500 rounded-full" />
                                                        <div>
                                                            <span className="text-sm font-medium text-gray-900">{deviceName}</span>
                                                            <div className="text-xs text-gray-500">Connected</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {isLowBattery && (
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger>
                                                                        <Zap className="h-3 w-3 text-amber-500" />
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>Low battery warning</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        )}
                                                        <Badge
                                                            variant="outline"
                                                            className={`text-xs ${
                                                                isLowBattery ? "border-amber-500 text-amber-700" : "border-green-500 text-green-700"
                                                            }`}
                                                        >
                                                            {batteryLevel !== undefined ? `${batteryLevel}%` : "--"}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            )
                                        })
                                    ) : (
                                        <div className="text-center py-6 text-gray-500">
                                            <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">No devices connected</p>
                                            <p className="text-xs text-gray-400">Click "Connect All" to start</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </PopoverContent>
            </Popover>
        )
    },
)

DeviceStatus.displayName = "DeviceStatus"

// Record Button Props
interface RecordButtonProps {
    isRecording: boolean
    onRecord: () => Promise<void>
    disabled: boolean
    recordingProgress?: number
    connectedCount: number
    selectedSession: Session | null
    selectedExercise: Exercise | null
}

// Enhanced Record Button with Progress and Toast Messages
const RecordButton = memo<RecordButtonProps>(
    ({ isRecording, onRecord, disabled, recordingProgress = 0, connectedCount, selectedSession, selectedExercise }) => {
        const [isLoading, setIsLoading] = useState<boolean>(false)
        const { toast } = useToast()

        const handleClick = useCallback(async () => {
            if (isLoading) return

            // Check conditions and show appropriate toast messages
            if (!isRecording) {
                const issues: string[] = []

                if (connectedCount === 0) {
                    issues.push("Connect at least one device")
                }

                if (!selectedSession) {
                    issues.push("Select a session")
                }

                if (!selectedExercise) {
                    issues.push("Select an exercise")
                }

                if (issues.length > 0) {
                    toast({
                        title: "Cannot Start Recording",
                        description: `Please complete the following steps: ${issues.join(", ")}`,
                        variant: "destructive",
                        duration: 4000,
                    })
                    return
                }
            }

            // If all conditions are met, proceed with recording
            try {
                setIsLoading(true)
                await onRecord()

                // Show success toast
                if (!isRecording) {
                    toast({
                        title: "Recording Started",
                        description: "Successfully started recording session data.",
                        duration: 3000,
                    })
                } else {
                    toast({
                        title: "Recording Stopped",
                        description: "Recording has been stopped and data is being processed.",
                        duration: 3000,
                    })
                }
            } catch (error) {
                toast({
                    title: "Recording Error",
                    description: "Failed to start/stop recording. Please try again.",
                    variant: "destructive",
                    duration: 4000,
                })
            } finally {
                setIsLoading(false)
            }
        }, [onRecord, isLoading, connectedCount, selectedSession, selectedExercise, isRecording, toast])

        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            onClick={handleClick}
                            disabled={isLoading}
                            className={`
              relative rounded-full h-12 w-12 transition-all duration-300 shadow-lg hover:shadow-xl group
              ${
                                isRecording
                                    ? "bg-[#FF4D35] hover:bg-[#e63e2b] scale-110"
                                    : disabled
                                        ? "bg-[#FF4D35] hover:bg-[#e63e2b] hover:scale-105 opacity-75"
                                        : "bg-[#FF4D35] hover:bg-green-500 hover:scale-105"
                            }
            `}
                        >
                            {/* Progress ring for recording */}
                            {isRecording && recordingProgress > 0 && (
                                <div className="absolute inset-0 rounded-full">
                                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                                        <path
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            fill="none"
                                            stroke="rgba(255,255,255,0.3)"
                                            strokeWidth="2"
                                        />
                                        <path
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            fill="none"
                                            stroke="white"
                                            strokeWidth="2"
                                            strokeDasharray={`${recordingProgress}, 100`}
                                        />
                                    </svg>
                                </div>
                            )}

                            {/* Button content */}
                            <div className="relative z-10">
                                {isLoading ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : isRecording ? (
                                    <Pause className="h-5 w-5 text-white" />
                                ) : (
                                    <Play className="h-5 w-5 text-white ml-0.5" />
                                )}
                            </div>

                            {/* Glow effect */}
                            <div className="absolute inset-0 rounded-full bg-white opacity-0 group-hover:opacity-20 transition-opacity duration-300" />

                            {/* Subtle indicator for disabled state */}
                            {disabled && !isRecording && (
                                <div className="absolute inset-0 rounded-full border-2 border-white/30 animate-pulse" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="z-50">
                        <p className="text-sm">
                            {isRecording
                                ? "Stop recording"
                                : disabled
                                    ? "Click to see what's needed to start recording"
                                    : "Start recording"}
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        )
    },
)

RecordButton.displayName = "RecordButton"

// Main Navbar Props
interface NavbarProps {
    connectedCount?: number
    totalDevices?: number
    onConnectAll: () => Promise<void>
    isConnecting?: boolean
    isRecording?: boolean
    onRecord: () => Promise<void>
    onReset: () => void
    onShowDevices?: () => void
    batteryLevels?: BatteryLevels
    onSessionExerciseSelect: (session: Session, exercise: Exercise | null) => void
    selectedSession: Session | null
    selectedExercise: Exercise | null
    connectedDevices?: string[] | Map<string, any>
    onOpenAI?: () => void
    hasRecordingData?: boolean
    recordingProgress?: number
    // Set selector props
    currentSet?: number
    totalSets?: number
    onSetChange?: (set: number) => void
    completedSets?: Set<number>
    // Optional motion processing functions
    recordingData?: RecordingData | null
    getLastRecording?: () => RecordingData | null
    setIsAiModalOpen?: (isOpen: boolean) => void
    setRecordingData?: (data: RecordingData | null) => void
    transformRecordingForAI?: (data: any) => RecordingData
    setCachedAnalysisResults?: (results: any) => void
    setAnalysisRecordingId?: (id: string) => void
    analysisRecordingId?: string
}

// Main Enhanced Navbar with Set Selector
const Navbar = memo<NavbarProps>(
    ({
         connectedCount = 0,
         totalDevices = 4,
         onConnectAll,
         isConnecting = false,
         isRecording = false,
         onRecord,
         onReset,
         onShowDevices,
         batteryLevels = {},
         onSessionExerciseSelect,
         selectedSession,
         selectedExercise,
         connectedDevices = [],
         onOpenAI,
         hasRecordingData = false,
         recordingProgress = 0,
         // Set selector props
         currentSet = 1,
         totalSets = 3,
         onSetChange,
         completedSets = new Set(),
         // Optional motion processing functions
         recordingData,
         getLastRecording,
         setIsAiModalOpen,
         setRecordingData,
         transformRecordingForAI,
         setCachedAnalysisResults,
         setAnalysisRecordingId,
         analysisRecordingId,
     }) => {
        const isRecordDisabled = useMemo(
            () => isConnecting || connectedCount === 0 || !selectedSession || !selectedExercise,
            [isConnecting, connectedCount, selectedSession, selectedExercise],
        )

        const handleOpenAiAnalysis = useCallback(() => {
            console.log("🧠 Opening AI analysis modal from navbar...")

            // Only proceed with advanced data handling if functions are available
            if (onOpenAI) {
                // Simple case - just call the provided onOpenAI function
                onOpenAI()
                return
            }

            // Advanced case - handle recording data if functions are provided
            if (getLastRecording && setRecordingData && transformRecordingForAI && setIsAiModalOpen) {
                // Get the latest recording data if available
                let analysisData = recordingData

                // Fallback: Try to get from coordinator
                if (!analysisData) {
                    analysisData = getLastRecording()
                    if (analysisData) {
                        console.log("📡 Using recording data from coordinator")
                        const transformedData = transformRecordingForAI(analysisData)
                        setRecordingData(transformedData)
                        analysisData = transformedData
                    }
                }

                // Add exercise name and session info to the analysis data
                if (analysisData && selectedExercise) {
                    analysisData.exerciseName = selectedExercise.name || selectedExercise._id || "Unknown Exercise"
                    analysisData.sessionName = selectedSession?.name || "Unknown Session"
                    console.log(`📝 Added exercise name to analysis: ${analysisData.exerciseName}`)
                    console.log(`📝 Added session name to analysis: ${analysisData.sessionName}`)
                }

                // Always open the modal - let the modal handle the no-data state
                if (analysisData) {
                    console.log(`✅ Opening modal with recording data:`, {
                        id: analysisData.id,
                        exerciseName: analysisData.exerciseName,
                        sessionName: analysisData.sessionName,
                        jointsCount: analysisData.joints_arr?.length || 0,
                        measurementsCount: analysisData.measurement_sequences?.length || 0,
                    })

                    // Load cached results for this recording
                    if (analysisData.id !== analysisRecordingId && setCachedAnalysisResults && setAnalysisRecordingId) {
                        setCachedAnalysisResults(null)
                        setAnalysisRecordingId(analysisData.id)
                        console.log("🔄 Reset cache for recording:", analysisData.id)
                    }
                } else {
                    console.log("📭 Opening modal without recording data - modal will show guidance")
                }

                // Always open the modal regardless of data availability
                setIsAiModalOpen(true)
            } else {
                console.warn("⚠️ Advanced recording functions not provided, using simple onOpenAI")
                if (onOpenAI) {
                    onOpenAI()
                }
            }
        }, [
            recordingData,
            getLastRecording,
            analysisRecordingId,
            selectedExercise,
            selectedSession,
            onOpenAI,
            setIsAiModalOpen,
            setRecordingData,
            transformRecordingForAI,
            setCachedAnalysisResults,
            setAnalysisRecordingId,
        ])

        return (
            <div className="w-full border-b border-gray-200 bg-white/95 backdrop-blur-md shadow-sm">
                <div className="flex items-center justify-between max-w-[1600px] mx-auto px-6 py-3">
                    {/* Left Section - AI Analysis & Patient Info */}
                    <div className="flex items-center gap-4">
                        <AIAnalysisButton
                            onOpenAI={handleOpenAiAnalysis}
                            isRecording={isRecording}
                            hasRecordingData={hasRecordingData}
                        />
                        <Separator orientation="vertical" className="h-8" />
                        <PatientInfo />
                    </div>

                    {/* Center Section - Session & Exercise Selection + Set Selector */}
                    <div className="flex-1 flex justify-center px-6">
                        <div className="flex items-center gap-6">
                            <SessionExerciseSelector
                                selectedSession={selectedSession}
                                selectedExercise={selectedExercise}
                                onSessionExerciseSelect={onSessionExerciseSelect}
                            />

                            {selectedExercise && onSetChange && (
                                <>
                                    <Separator orientation="vertical" className="h-6" />
                                    <SetSelector
                                        currentSet={currentSet}
                                        totalSets={totalSets}
                                        onSetChange={onSetChange}
                                        completedSets={completedSets}
                                        isRecording={isRecording}
                                        selectedExercise={selectedExercise}
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    {/* Right Section - Controls */}
                    <div className="flex items-center gap-3">
                        <DeviceStatus
                            connectedCount={connectedCount}
                            totalDevices={totalDevices}
                            onConnectAll={onConnectAll}
                            isConnecting={isConnecting}
                            batteryLevels={batteryLevels}
                            connectedDevices={connectedDevices}
                        />

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={onReset}
                                        disabled={isConnecting}
                                        className="rounded-full h-10 w-10 hover:bg-gray-50 transition-colors bg-transparent"
                                    >
                                        <RotateCcw className="h-4 w-4 text-gray-600" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="z-50">
                                    <p>Reset session</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <RecordButton
                            isRecording={isRecording}
                            onRecord={onRecord}
                            disabled={isRecordDisabled}
                            recordingProgress={recordingProgress}
                            connectedCount={connectedCount}
                            selectedSession={selectedSession}
                            selectedExercise={selectedExercise}
                        />
                    </div>
                </div>
            </div>
        )
    },
)

Navbar.displayName = "Navbar"

export default Navbar