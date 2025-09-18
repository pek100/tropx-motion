/**
 * React Performance Profiler - Tracks React component render performance during streaming
 * Integrates with React's Profiler API to detect slow renders and re-render issues
 */

import React, { Profiler } from 'react';
import { uiEventLoopMonitor } from './UIEventLoopMonitor';
import { streamingLogger } from './StreamingPerformanceLogger';

// Define the exact type that React expects
type ProfilerOnRenderCallback = (
    id: string,
    phase: "mount" | "update",
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
    interactions: Set<{ id: number; name: string; timestamp: number }>,
    outgoingInteractions?: Set<{ id: number; name: string; timestamp: number }>
) => void;

interface RenderMetrics {
    componentName: string;
    phase: 'mount' | 'update';
    actualDuration: number;
    baseDuration: number;
    startTime: number;
    commitTime: number;
    interactions: Set<any>;
}

interface ComponentStats {
    totalRenders: number;
    totalTime: number;
    avgRenderTime: number;
    maxRenderTime: number;
    mountTime: number;
    updateCount: number;
    slowRenders: number;
    lastRenderTime: number;
}

class ReactPerformanceProfiler {
    private static instance: ReactPerformanceProfiler | null = null;
    private componentStats = new Map<string, ComponentStats>();
    private recentRenders: RenderMetrics[] = [];
    private readonly MAX_RECENT_RENDERS = 200;
    private readonly SLOW_RENDER_THRESHOLD = 20; // 20ms adjusted for monitoring overhead
    private readonly VERY_SLOW_RENDER_THRESHOLD = 50; // 50ms is very slow

    private constructor() {
        this.setupPeriodicReporting();
    }

    static getInstance(): ReactPerformanceProfiler {
        if (!ReactPerformanceProfiler.instance) {
            ReactPerformanceProfiler.instance = new ReactPerformanceProfiler();
        }
        return ReactPerformanceProfiler.instance;
    }

    /**
     * Create a React Profiler callback for a specific component
     */
    createProfilerCallback(componentName: string): ProfilerOnRenderCallback {
        const callback = (
            id: string,
            phase: "mount" | "update",
            actualDuration: number,
            baseDuration: number,
            startTime: number,
            commitTime: number,
            interactions: Set<{ id: number; name: string; timestamp: number }>,
            outgoingInteractions?: Set<{ id: number; name: string; timestamp: number }>
        ): void => {
            this.recordRender(componentName, {
                componentName,
                phase,
                actualDuration,
                baseDuration,
                startTime,
                commitTime,
                interactions
            });
        };
        return callback;
    }

    /**
     * Record a component render
     */
    private recordRender(componentName: string, metrics: RenderMetrics): void {
        // Add to recent renders
        this.recentRenders.push(metrics);
        if (this.recentRenders.length > this.MAX_RECENT_RENDERS) {
            this.recentRenders.shift();
        }

        // Update component stats
        this.updateComponentStats(componentName, metrics);

        // Log slow renders immediately
        if (metrics.actualDuration > this.SLOW_RENDER_THRESHOLD) {
            const severity = metrics.actualDuration > this.VERY_SLOW_RENDER_THRESHOLD ? 'SEVERE' : 'MODERATE';

            console.warn(`🐌 [REACT_SLOW_RENDER] ${severity}: ${componentName} ${metrics.phase} took ${metrics.actualDuration.toFixed(2)}ms`, {
                baseDuration: metrics.baseDuration.toFixed(2),
                phase: metrics.phase,
                interactions: metrics.interactions.size,
                commitTime: metrics.commitTime
            });

            // Also record in UI event loop monitor
            uiEventLoopMonitor.recordBlockingEvent(
                'REACT_RENDER',
                componentName,
                metrics.actualDuration,
                {
                    phase: metrics.phase,
                    baseDuration: metrics.baseDuration,
                    interactions: metrics.interactions.size
                }
            );

            // Record in streaming logger if it's a streaming-related component
            if (this.isStreamingComponent(componentName)) {
                streamingLogger.logIpcMessage(
                    componentName,
                    'react_render',
                    metrics.actualDuration
                );
            }
        }

        // Track excessive re-renders
        const stats = this.componentStats.get(componentName);
        if (stats && metrics.phase === 'update') {
            const timeSinceLastRender = metrics.commitTime - stats.lastRenderTime;
            if (timeSinceLastRender < 50 && stats.updateCount > 5) { // Many updates in short time
                console.warn(`🔄 [REACT_EXCESSIVE_RENDERS] ${componentName} rendered ${stats.updateCount} times recently`, {
                    timeSinceLastRender: timeSinceLastRender.toFixed(2),
                    avgRenderTime: stats.avgRenderTime.toFixed(2)
                });
            }
        }
    }

    /**
     * Update statistics for a component
     */
    private updateComponentStats(componentName: string, metrics: RenderMetrics): void {
        const existing = this.componentStats.get(componentName) || {
            totalRenders: 0,
            totalTime: 0,
            avgRenderTime: 0,
            maxRenderTime: 0,
            mountTime: 0,
            updateCount: 0,
            slowRenders: 0,
            lastRenderTime: 0
        };

        existing.totalRenders++;
        existing.totalTime += metrics.actualDuration;
        existing.avgRenderTime = existing.totalTime / existing.totalRenders;
        existing.maxRenderTime = Math.max(existing.maxRenderTime, metrics.actualDuration);
        existing.lastRenderTime = metrics.commitTime;

        if (metrics.phase === 'mount') {
            existing.mountTime = metrics.actualDuration;
        } else {
            existing.updateCount++;
        }

        if (metrics.actualDuration > this.SLOW_RENDER_THRESHOLD) {
            existing.slowRenders++;
        }

        this.componentStats.set(componentName, existing);
    }

    /**
     * Check if component is related to streaming
     */
    private isStreamingComponent(componentName: string): boolean {
        const streamingKeywords = [
            'chart', 'knee', 'motion', 'streaming', 'data', 'realtime',
            'websocket', 'sensor', 'angle', 'plot', 'graph', 'visualization'
        ];

        const lowerName = componentName.toLowerCase();
        return streamingKeywords.some(keyword => lowerName.includes(keyword));
    }

    /**
     * Get performance stats for a component
     */
    getComponentStats(componentName: string): ComponentStats | null {
        return this.componentStats.get(componentName) || null;
    }

    /**
     * Get all component performance stats
     */
    getAllComponentStats(): Map<string, ComponentStats> {
        return new Map(this.componentStats);
    }

    /**
     * Get slowest rendering components
     */
    getSlowestComponents(limit: number = 10): Array<{ name: string; stats: ComponentStats }> {
        return Array.from(this.componentStats.entries())
            .map(([name, stats]) => ({ name, stats }))
            .sort((a, b) => b.stats.avgRenderTime - a.stats.avgRenderTime)
            .slice(0, limit);
    }

    /**
     * Get components with most re-renders
     */
    getMostActiveComponents(limit: number = 10): Array<{ name: string; stats: ComponentStats }> {
        return Array.from(this.componentStats.entries())
            .map(([name, stats]) => ({ name, stats }))
            .sort((a, b) => b.stats.updateCount - a.stats.updateCount)
            .slice(0, limit);
    }

    /**
     * Get recent slow renders
     */
    getRecentSlowRenders(timeWindowMs: number = 30000): RenderMetrics[] {
        const cutoff = performance.now() - timeWindowMs;
        return this.recentRenders
            .filter(render =>
                render.commitTime > cutoff &&
                render.actualDuration > this.SLOW_RENDER_THRESHOLD
            )
            .sort((a, b) => b.actualDuration - a.actualDuration);
    }

    /**
     * Reset all performance data
     */
    reset(): void {
        this.componentStats.clear();
        this.recentRenders = [];
        console.log('🔄 [REACT_PROFILER] Reset all component performance data');
    }

    /**
     * Setup periodic performance reporting
     */
    private setupPeriodicReporting(): void {
        setInterval(() => {
            this.reportPerformanceSummary();
        }, 30000); // Report every 30 seconds
    }

    /**
     * Report performance summary
     */
    private reportPerformanceSummary(): void {
        const activeComponents = Array.from(this.componentStats.entries())
            .filter(([_, stats]) => stats.lastRenderTime > performance.now() - 30000);

        if (activeComponents.length === 0) return;

        const slowComponents = activeComponents
            .filter(([_, stats]) => stats.avgRenderTime > this.SLOW_RENDER_THRESHOLD)
            .sort((a, b) => b[1].avgRenderTime - a[1].avgRenderTime);

        const activeRerenderers = activeComponents
            .filter(([_, stats]) => stats.updateCount > 10)
            .sort((a, b) => b[1].updateCount - a[1].updateCount);

        if (slowComponents.length > 0 || activeRerenderers.length > 0) {
            console.log('📈 [REACT_PERFORMANCE_SUMMARY] Component performance analysis:');

            if (slowComponents.length > 0) {
                console.log('🐌 Slowest components:',
                    slowComponents.slice(0, 5).map(([name, stats]) => ({
                        component: name,
                        avgRender: `${stats.avgRenderTime.toFixed(2)}ms`,
                        maxRender: `${stats.maxRenderTime.toFixed(2)}ms`,
                        slowRenders: stats.slowRenders
                    }))
                );
            }

            if (activeRerenderers.length > 0) {
                console.log('🔄 Most active components:',
                    activeRerenderers.slice(0, 5).map(([name, stats]) => ({
                        component: name,
                        updates: stats.updateCount,
                        avgRender: `${stats.avgRenderTime.toFixed(2)}ms`
                    }))
                );
            }
        }
    }

    /**
     * Export all performance data
     */
    exportData(): {
        componentStats: { [key: string]: ComponentStats };
        recentRenders: RenderMetrics[];
    } {
        return {
            componentStats: Object.fromEntries(this.componentStats),
            recentRenders: [...this.recentRenders]
        };
    }
}

// Singleton instance
export const reactProfiler = ReactPerformanceProfiler.getInstance();

/**
 * Higher-order component to wrap components with performance profiling
 */
export function withPerformanceProfiler<P extends object>(
    Component: React.ComponentType<P>,
    componentName?: string
): React.ComponentType<P> {
    const displayName = componentName || Component.displayName || Component.name || 'Unknown';

    const WrappedComponent = (props: P) => {
        return React.createElement(
            Profiler,
            {
                id: displayName,
                onRender: reactProfiler.createProfilerCallback(displayName)
            },
            React.createElement(Component, props)
        );
    };

    WrappedComponent.displayName = `withPerformanceProfiler(${displayName})`;
    return WrappedComponent;
}

/**
 * Hook to manually track component render performance
 */
export function useRenderTracking(componentName: string): void {
    const renderStartRef = React.useRef<number>(0);

    React.useLayoutEffect(() => {
        renderStartRef.current = performance.now();
    });

    React.useEffect(() => {
        const renderTime = performance.now() - renderStartRef.current;
        if (renderTime > 1) { // Only track renders >1ms
            uiEventLoopMonitor.recordBlockingEvent(
                'REACT_HOOK_RENDER',
                componentName,
                renderTime
            );
        }
    });
}

// Development mode initialization
if (process.env.NODE_ENV === 'development') {
    console.log('⚛️ [REACT_PROFILER] Initialized React performance profiling');
}