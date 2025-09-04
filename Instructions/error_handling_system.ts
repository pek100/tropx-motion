// electron/main/utils/ErrorHandler.ts - Centralized error handling
import { Logger } from './Logger';

export enum ErrorCode {
    // System errors
    INITIALIZATION_FAILED = 'INIT_FAILED',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
    
    // Device errors
    DEVICE_CONNECTION_FAILED = 'DEVICE_CONNECT_FAILED',
    DEVICE_DISCONNECTED = 'DEVICE_DISCONNECTED',
    BLUETOOTH_UNAVAILABLE = 'BLUETOOTH_UNAVAILABLE',
    
    // Motion processing errors
    MOTION_PROCESSING_FAILED = 'MOTION_PROCESSING_FAILED',
    RECORDING_FAILED = 'RECORDING_FAILED',
    DATA_CORRUPTION = 'DATA_CORRUPTION',
    
    // Network errors
    WEBSOCKET_FAILED = 'WEBSOCKET_FAILED',
    CLIENT_DISCONNECTED = 'CLIENT_DISCONNECTED',
    
    // Unknown error
    UNKNOWN = 'UNKNOWN'
}

export interface AppError {
    code: ErrorCode;
    message: string;
    details?: any;
    timestamp: number;
    recoverable: boolean;
    component: string;
    stack?: string;
}

export class ErrorHandler {
    private static instance: ErrorHandler;
    private errorListeners = new Set<(error: AppError) => void>();
    private errorHistory: AppError[] = [];
    private readonly maxHistorySize = 50;

    private constructor() {
        this.setupGlobalErrorHandlers();
    }

    static getInstance(): ErrorHandler {
        if (!ErrorHandler.instance) {
            ErrorHandler.instance = new ErrorHandler();
        }
        return ErrorHandler.instance;
    }

    private setupGlobalErrorHandlers(): void {
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.handleError(ErrorCode.UNKNOWN, error.message, {
                stack: error.stack,
                type: 'uncaughtException'
            }, 'system', false);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            this.handleError(ErrorCode.UNKNOWN, 'Unhandled promise rejection', {
                reason: reason,
                promise: promise,
                type: 'unhandledRejection'
            }, 'system', false);
        });
    }

    handleError(
        code: ErrorCode,
        message: string,
        details?: any,
        component: string = 'unknown',
        recoverable: boolean = true
    ): AppError {
        const error: AppError = {
            code,
            message,
            details,
            timestamp: Date.now(),
            recoverable,
            component,
            stack: new Error().stack
        };

        // Log the error
        Logger.error('ErrorHandler', `[${code}] ${message}`, {
            component,
            details,
            recoverable
        });

        // Add to history
        this.addToHistory(error);

        // Notify listeners
        this.notifyListeners(error);

        // Attempt recovery if possible
        if (recoverable) {
            this.attemptRecovery(error);
        }

        return error;
    }

    private addToHistory(error: AppError): void {
        this.errorHistory.push(error);
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory.shift();
        }
    }

    private notifyListeners(error: AppError): void {
        this.errorListeners.forEach(listener => {
            try {
                listener(error);
            } catch (err) {
                console.error('Error in error listener:', err);
            }
        });
    }

    private async attemptRecovery(error: AppError): Promise<boolean> {
        Logger.info('ErrorHandler', `Attempting recovery for: ${error.code}`);

        switch (error.code) {
            case ErrorCode.DEVICE_CONNECTION_FAILED:
                return this.recoverDeviceConnection(error);
            
            case ErrorCode.WEBSOCKET_FAILED:
                return this.recoverWebSocket(error);
            
            case ErrorCode.MOTION_PROCESSING_FAILED:
                return this.recoverMotionProcessing(error);
            
            default:
                return false;
        }
    }

    private async recoverDeviceConnection(error: AppError): Promise<boolean> {
        try {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Attempt reconnection logic would go here
            Logger.info('ErrorHandler', 'Device connection recovery attempted');
            return true;
        } catch (err) {
            Logger.error('ErrorHandler', 'Device connection recovery failed', err);
            return false;
        }
    }

    private async recoverWebSocket(error: AppError): Promise<boolean> {
        try {
            // WebSocket recovery logic would go here
            Logger.info('ErrorHandler', 'WebSocket recovery attempted');
            return true;
        } catch (err) {
            Logger.error('ErrorHandler', 'WebSocket recovery failed', err);
            return false;
        }
    }

    private async recoverMotionProcessing(error: AppError): Promise<boolean> {
        try {
            // Motion processing recovery logic would go here
            Logger.info('ErrorHandler', 'Motion processing recovery attempted');
            return true;
        } catch (err) {
            Logger.error('ErrorHandler', 'Motion processing recovery failed', err);
            return false;
        }
    }

    // Public methods
    onError(listener: (error: AppError) => void): () => void {
        this.errorListeners.add(listener);
        return () => this.errorListeners.delete(listener);
    }

    getErrorHistory(): AppError[] {
        return [...this.errorHistory];
    }

    getErrorStats(): {
        total: number;
        byCode: Record<string, number>;
        byComponent: Record<string, number>;
        recoverable: number;
    } {
        const stats = {
            total: this.errorHistory.length,
            byCode: {} as Record<string, number>,
            byComponent: {} as Record<string, number>,
            recoverable: 0
        };

        this.errorHistory.forEach(error => {
            stats.byCode[error.code] = (stats.byCode[error.code] || 0) + 1;
            stats.byComponent[error.component] = (stats.byComponent[error.component] || 0) + 1;
            if (error.recoverable) stats.recoverable++;
        });

        return stats;
    }

    clearHistory(): void {
        this.errorHistory = [];
    }
}

// Convenience functions
export const handleError = (
    code: ErrorCode,
    message: string,
    details?: any,
    component?: string,
    recoverable?: boolean
) => ErrorHandler.getInstance().handleError(code, message, details, component, recoverable);

---

// electron/renderer/components/ErrorBoundary.tsx - React error boundary
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
    errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo });
        
        // Log error to main process
        console.error('React Error Boundary caught an error:', error, errorInfo);
        
        // Send error to main process via IPC if available
        if (window.electronAPI) {
            // Could add error reporting method to electronAPI
        }
    }

    handleReload = () => {
        window.location.reload();
    };

    handleReset = () => {
        this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
                    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
                        <div className="text-center">
                            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                            <h2 className="text-xl font-semibold text-gray-900 mb-2">
                                Something went wrong
                            </h2>
                            <p className="text-gray-600 mb-6">
                                The application encountered an unexpected error. You can try reloading or resetting the application.
                            </p>

                            {process.env.NODE_ENV === 'development' && this.state.error && (
                                <details className="text-left bg-gray-100 p-4 rounded mb-6">
                                    <summary className="cursor-pointer font-medium">Error Details</summary>
                                    <pre className="mt-2 text-xs overflow-auto">
                                        {this.state.error.toString()}
                                        {this.state.errorInfo?.componentStack}
                                    </pre>
                                </details>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={this.handleReset}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
                                >
                                    <Home className="w-4 h-4" />
                                    Reset
                                </button>
                                <button
                                    onClick={this.handleReload}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#FF4D35] hover:bg-[#e63e2b] text-white rounded-md transition-colors"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Reload
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

---

// electron/renderer/hooks/useErrorHandler.ts - React hook for error handling
import { useState, useEffect, useCallback } from 'react';

interface AppError {
    code: string;
    message: string;
    details?: any;
    timestamp: number;
    recoverable: boolean;
    component: string;
}

export const useErrorHandler = () => {
    const [errors, setErrors] = useState<AppError[]>([]);
    const [isConnected, setIsConnected] = useState(false);

    // Mock WebSocket connection for error handling
    useEffect(() => {
        // In real implementation, this would connect to the WebSocket
        // and listen for error messages from the main process
        setIsConnected(true);
    }, []);

    const addError = useCallback((error: Omit<AppError, 'timestamp'>) => {
        const newError: AppError = {
            ...error,
            timestamp: Date.now()
        };
        
        setErrors(prev => [...prev.slice(-9), newError]); // Keep last 10 errors
    }, []);

    const removeError = useCallback((timestamp: number) => {
        setErrors(prev => prev.filter(error => error.timestamp !== timestamp));
    }, []);

    const clearErrors = useCallback(() => {
        setErrors([]);
    }, []);

    // Helper function for common error scenarios
    const handleAsyncError = useCallback(async <T>(
        operation: () => Promise<T>,
        errorCode: string,
        component: string
    ): Promise<T | null> => {
        try {
            return await operation();
        } catch (error) {
            addError({
                code: errorCode,
                message: error instanceof Error ? error.message : 'Unknown error',
                details: error,
                recoverable: true,
                component
            });
            return null;
        }
    }, [addError]);

    return {
        errors,
        isConnected,
        addError,
        removeError,
        clearErrors,
        handleAsyncError
    };
};

---

// electron/renderer/components/ErrorToast.tsx - Error notification component
import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, AlertTriangle, X } from 'lucide-react';

interface ErrorToastProps {
    error: {
        code: string;
        message: string;
        recoverable: boolean;
        timestamp: number;
    };
    onDismiss: () => void;
    autoHideDuration?: number;
}

export const ErrorToast: React.FC<ErrorToastProps> = ({
    error,
    onDismiss,
    autoHideDuration = 5000
}) => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        if (autoHideDuration > 0) {
            const timer = setTimeout(() => {
                setIsVisible(false);
                setTimeout(onDismiss, 300); // Wait for fade out animation
            }, autoHideDuration);

            return () => clearTimeout(timer);
        }
    }, [autoHideDuration, onDismiss]);

    const getIcon = () => {
        if (error.recoverable) {
            return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
        } else {
            return <AlertCircle className="w-5 h-5 text-red-500" />;
        }
    };

    const getBgColor = () => {
        if (error.recoverable) {
            return 'bg-yellow-50 border-yellow-200';
        } else {
            return 'bg-red-50 border-red-200';
        }
    };

    return (
        <div className={`fixed top-4 right-4 z-50 transition-all duration-300 ${
            isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}>
            <div className={`max-w-sm rounded-lg border p-4 shadow-lg ${getBgColor()}`}>
                <div className="flex items-start gap-3">
                    {getIcon()}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                            {error.code.replace(/_/g, ' ')}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                            {error.message}
                        </p>
                        {error.recoverable && (
                            <p className="text-xs text-gray-500 mt-2">
                                Attempting automatic recovery...
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => {
                            setIsVisible(false);
                            setTimeout(onDismiss, 300);
                        }}
                        className="flex-shrink-0 p-1 hover:bg-gray-100 rounded"
                    >
                        <X className="w-4 h-4 text-gray-400" />
                    </button>
                </div>
            </div>
        </div>
    );
};

---

// electron/renderer/components/ErrorToastContainer.tsx - Container for managing multiple error toasts
import React from 'react';
import { ErrorToast } from './ErrorToast';
import { useErrorHandler } from '../hooks/useErrorHandler';

export const ErrorToastContainer: React.FC = () => {
    const { errors, removeError } = useErrorHandler();

    return (
        <div className="fixed top-4 right-4 z-50 space-y-2">
            {errors.map((error) => (
                <ErrorToast
                    key={error.timestamp}
                    error={error}
                    onDismiss={() => removeError(error.timestamp)}
                />
            ))}
        </div>
    );
};

---

// electron/main/utils/CrashReporter.ts - Crash reporting and recovery
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger';

interface CrashReport {
    timestamp: number;
    version: string;
    platform: string;
    error: {
        message: string;
        stack?: string;
        code?: string;
    };
    systemInfo: {
        totalMemory: number;
        freeMemory: number;
        cpuUsage: any;
        uptime: number;
    };
    appState: {
        isRecording: boolean;
        connectedDevices: number;
        wsConnections: number;
    };
}

export class CrashReporter {
    private static instance: CrashReporter;
    private crashDir: string;

    private constructor() {
        this.crashDir = path.join(process.cwd(), 'crashes');
        this.ensureCrashDir();
        this.setupCrashHandlers();
    }

    static getInstance(): CrashReporter {
        if (!CrashReporter.instance) {
            CrashReporter.instance = new CrashReporter();
        }
        return CrashReporter.instance;
    }

    private ensureCrashDir(): void {
        if (!fs.existsSync(this.crashDir)) {
            fs.mkdirSync(this.crashDir, { recursive: true });
        }
    }

    private setupCrashHandlers(): void {
        process.on('uncaughtException', (error) => {
            this.reportCrash(error, 'uncaughtException');
            // Give time to write crash report
            setTimeout(() => process.exit(1), 1000);
        });

        process.on('unhandledRejection', (reason) => {
            const error = reason instanceof Error ? reason : new Error(String(reason));
            this.reportCrash(error, 'unhandledRejection');
        });
    }

    private async reportCrash(error: Error, type: string): Promise<void> {
        try {
            const crashReport: CrashReport = {
                timestamp: Date.now(),
                version: process.env.npm_package_version || '1.0.0',
                platform: process.platform,
                error: {
                    message: error.message,
                    stack: error.stack,
                    code: type
                },
                systemInfo: {
                    totalMemory: require('os').totalmem(),
                    freeMemory: require('os').freemem(),
                    cpuUsage: process.cpuUsage(),
                    uptime: process.uptime()
                },
                appState: await this.getAppState()
            };

            const filename = `crash-${Date.now()}.json`;
            const filepath = path.join(this.crashDir, filename);
            
            fs.writeFileSync(filepath, JSON.stringify(crashReport, null, 2));
            
            Logger.error('CrashReporter', `Crash reported: ${filename}`, crashReport);
            
            console.error('💥 Application crashed:', error.message);
            console.error('📋 Crash report saved to:', filepath);
            
        } catch (reportError) {
            console.error('Failed to write crash report:', reportError);
        }
    }

    private async getAppState(): Promise<CrashReport['appState']> {
        // This would gather current application state
        // In a real implementation, you'd query your services
        return {
            isRecording: false,
            connectedDevices: 0,
            wsConnections: 0
        };
    }

    getCrashReports(): CrashReport[] {
        try {
            const files = fs.readdirSync(this.crashDir)
                .filter(file => file.startsWith('crash-') && file.endsWith('.json'))
                .sort()
                .slice(-10); // Get last 10 reports

            return files.map(file => {
                const content = fs.readFileSync(path.join(this.crashDir, file), 'utf8');
                return JSON.parse(content);
            });
        } catch (error) {
            Logger.error('CrashReporter', 'Failed to read crash reports', error);
            return [];
        }
    }

    clearOldReports(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
        try {
            const files = fs.readdirSync(this.crashDir);
            const now = Date.now();

            files.forEach(file => {
                const filepath = path.join(this.crashDir, file);
                const stats = fs.statSync(filepath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filepath);
                    Logger.info('CrashReporter', `Deleted old crash report: ${file}`);
                }
            });
        } catch (error) {
            Logger.error('CrashReporter', 'Failed to clean old crash reports', error);
        }
    }
}