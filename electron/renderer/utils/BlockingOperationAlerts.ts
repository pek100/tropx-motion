/**
 * Blocking Operation Alerts - Real-time alerts for UI performance issues during streaming
 * Provides immediate feedback and actionable insights for performance problems
 */

import { uiEventLoopMonitor } from './UIEventLoopMonitor';
import { streamingLogger } from './StreamingPerformanceLogger';
import { reactProfiler } from './ReactPerformanceProfiler';

interface AlertConfig {
    enabled: boolean;
    thresholds: {
        moderateBlocking: number;  // 16ms default
        severeBlocking: number;    // 50ms default
        criticalBlocking: number;  // 100ms default
    };
    notifications: {
        console: boolean;
        visual: boolean;
        sound: boolean;
    };
    rateLimiting: {
        maxAlertsPerMinute: number;
        cooldownMs: number;
    };
}

interface BlockingAlert {
    id: string;
    timestamp: number;
    severity: 'moderate' | 'severe' | 'critical';
    source: 'event_loop' | 'react_render' | 'chart_update' | 'streaming';
    component: string;
    operation: string;
    duration: number;
    context?: any;
    actionable: string;
}

interface PerformanceInsight {
    type: 'frequent_blocking' | 'slow_component' | 'memory_pressure' | 'high_frequency_updates';
    component: string;
    description: string;
    recommendation: string;
    severity: 'info' | 'warning' | 'error';
    data?: any;
}

class BlockingOperationAlerts {
    private static instance: BlockingOperationAlerts | null = null;
    private alerts: BlockingAlert[] = [];
    private insights: PerformanceInsight[] = [];
    private alertCounts = new Map<string, number>();
    private lastAlertTime = new Map<string, number>();

    private config: AlertConfig = {
        enabled: true,
        thresholds: {
            moderateBlocking: 25,   // 25ms allows for monitoring overhead
            severeBlocking: 50,     // 50ms is very noticeable
            criticalBlocking: 100   // 100ms+ is unacceptable
        },
        notifications: {
            console: true,
            visual: process.env.NODE_ENV === 'development',
            sound: false
        },
        rateLimiting: {
            maxAlertsPerMinute: 20,
            cooldownMs: 3000  // 3 second cooldown per component
        }
    };

    private readonly MAX_ALERTS_STORED = 100;
    private readonly MAX_INSIGHTS_STORED = 50;
    private monitoringInterval: NodeJS.Timeout | null = null;

    private constructor() {
        this.startRealTimeMonitoring();
        this.setupPeriodicAnalysis();
    }

    static getInstance(): BlockingOperationAlerts {
        if (!BlockingOperationAlerts.instance) {
            BlockingOperationAlerts.instance = new BlockingOperationAlerts();
        }
        return BlockingOperationAlerts.instance;
    }

    /**
     * Configure alert system
     */
    configure(config: Partial<AlertConfig>): void {
        this.config = { ...this.config, ...config };
        console.log('🔔 [BLOCKING_ALERTS] Configuration updated:', this.config);
    }

    /**
     * Enable or disable the alert system
     */
    setEnabled(enabled: boolean): void {
        this.config.enabled = enabled;
        console.log(`🔔 [BLOCKING_ALERTS] ${enabled ? 'Enabled' : 'Disabled'} blocking operation alerts`);
    }

    /**
     * Start real-time monitoring for blocking operations
     */
    private startRealTimeMonitoring(): void {
        // Monitor event loop delays
        this.monitoringInterval = setInterval(() => {
            if (!this.config.enabled) return;

            this.checkEventLoopBlocking();
            this.checkReactPerformance();
            this.checkStreamingPerformance();
            this.generateInsights();
        }, 1000); // Check every second
    }

    /**
     * Check for event loop blocking issues
     */
    private checkEventLoopBlocking(): void {
        const recentEvents = uiEventLoopMonitor.getRecentBlockingEvents(5000); // Last 5 seconds

        for (const event of recentEvents) {
            if (this.shouldCreateAlert(event.component, event.duration)) {
                this.createAlert({
                    source: 'event_loop',
                    component: event.component,
                    operation: event.operation,
                    duration: event.duration,
                    context: event.context,
                    actionable: this.getActionableAdvice('event_loop', event.component, event.duration)
                });
            }
        }
    }

    /**
     * Check for React render performance issues
     */
    private checkReactPerformance(): void {
        const slowComponents = reactProfiler.getRecentSlowRenders(10000); // Last 10 seconds

        for (const render of slowComponents) {
            if (this.shouldCreateAlert(render.componentName, render.actualDuration)) {
                this.createAlert({
                    source: 'react_render',
                    component: render.componentName,
                    operation: `${render.phase}_render`,
                    duration: render.actualDuration,
                    context: {
                        phase: render.phase,
                        baseDuration: render.baseDuration,
                        interactions: render.interactions.size
                    },
                    actionable: this.getActionableAdvice('react_render', render.componentName, render.actualDuration)
                });
            }
        }
    }

    /**
     * Check for streaming performance issues
     */
    private checkStreamingPerformance(): void {
        const recentBlocking = streamingLogger.getRecentBlockingOperations(5000); // Last 5 seconds

        for (const operation of recentBlocking) {
            if (this.shouldCreateAlert(operation.component, operation.duration || 0)) {
                this.createAlert({
                    source: 'streaming',
                    component: operation.component,
                    operation: operation.operationId,
                    duration: operation.duration || 0,
                    context: {
                        type: operation.type,
                        dataSize: operation.dataSize,
                        metadata: operation.metadata
                    },
                    actionable: this.getActionableAdvice('streaming', operation.component, operation.duration || 0)
                });
            }
        }
    }

    /**
     * Determine if an alert should be created (rate limiting)
     */
    private shouldCreateAlert(component: string, duration: number): boolean {
        if (!this.config.enabled) return false;
        if (duration < this.config.thresholds.moderateBlocking) return false;

        const key = component;
        const now = Date.now();
        const lastAlert = this.lastAlertTime.get(key) || 0;
        const alertCount = this.alertCounts.get(key) || 0;

        // Cooldown check
        if (now - lastAlert < this.config.rateLimiting.cooldownMs) {
            return false;
        }

        // Rate limiting check
        if (alertCount >= this.config.rateLimiting.maxAlertsPerMinute) {
            return false;
        }

        return true;
    }

    /**
     * Create and process a new alert
     */
    private createAlert(alertData: Omit<BlockingAlert, 'id' | 'timestamp' | 'severity'>): void {
        const severity = this.determineSeverity(alertData.duration);
        const alert: BlockingAlert = {
            id: `${alertData.component}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            severity,
            ...alertData
        };

        // Add to alerts
        this.alerts.push(alert);
        if (this.alerts.length > this.MAX_ALERTS_STORED) {
            this.alerts.shift();
        }

        // Update tracking
        this.updateAlertTracking(alertData.component);

        // Send notifications
        this.sendNotifications(alert);
    }

    /**
     * Determine alert severity based on duration
     */
    private determineSeverity(duration: number): 'moderate' | 'severe' | 'critical' {
        if (duration >= this.config.thresholds.criticalBlocking) return 'critical';
        if (duration >= this.config.thresholds.severeBlocking) return 'severe';
        return 'moderate';
    }

    /**
     * Update alert tracking for rate limiting
     */
    private updateAlertTracking(component: string): void {
        const now = Date.now();
        this.lastAlertTime.set(component, now);

        const currentCount = this.alertCounts.get(component) || 0;
        this.alertCounts.set(component, currentCount + 1);

        // Reset counters every minute
        setTimeout(() => {
            this.alertCounts.set(component, Math.max(0, (this.alertCounts.get(component) || 0) - 1));
        }, 60000);
    }

    /**
     * Send notifications for the alert
     */
    private sendNotifications(alert: BlockingAlert): void {
        if (this.config.notifications.console) {
            this.sendConsoleNotification(alert);
        }

        if (this.config.notifications.visual) {
            this.sendVisualNotification(alert);
        }

        if (this.config.notifications.sound && alert.severity === 'critical') {
            this.sendSoundNotification(alert);
        }
    }

    /**
     * Send console notification
     */
    private sendConsoleNotification(alert: BlockingAlert): void {
        const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'severe' ? '⚠️' : '🐌';
        const severityColor = alert.severity === 'critical' ? '\x1b[31m' : alert.severity === 'severe' ? '\x1b[33m' : '\x1b[36m';
        const resetColor = '\x1b[0m';

        console.log(`${emoji} ${severityColor}[UI_BLOCKING_ALERT]${resetColor} ${alert.severity.toUpperCase()}: ${alert.component}.${alert.operation} blocked for ${alert.duration.toFixed(2)}ms`);
        console.log(`   💡 Action: ${alert.actionable}`);

        if (alert.context) {
            console.log(`   📋 Context:`, alert.context);
        }
    }

    /**
     * Send visual notification (development only)
     */
    private sendVisualNotification(alert: BlockingAlert): void {
        if (typeof document === 'undefined') return;

        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${alert.severity === 'critical' ? '#fee2e2' : alert.severity === 'severe' ? '#fef3c7' : '#dbeafe'};
            border: 1px solid ${alert.severity === 'critical' ? '#f87171' : alert.severity === 'severe' ? '#f59e0b' : '#60a5fa'};
            color: ${alert.severity === 'critical' ? '#991b1b' : alert.severity === 'severe' ? '#92400e' : '#1e40af'};
            padding: 12px 16px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            max-width: 400px;
            z-index: 10000;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        `;

        notification.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">
                ${alert.severity.toUpperCase()} UI Blocking
            </div>
            <div>${alert.component}.${alert.operation}: ${alert.duration.toFixed(2)}ms</div>
            <div style="margin-top: 8px; font-size: 11px; opacity: 0.8;">
                ${alert.actionable}
            </div>
        `;

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    /**
     * Send sound notification for critical alerts
     */
    private sendSoundNotification(alert: BlockingAlert): void {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (error) {
            // Ignore audio errors
        }
    }

    /**
     * Get actionable advice for performance issues
     */
    private getActionableAdvice(source: string, component: string, duration: number): string {
        const isStreamingComponent = component.toLowerCase().includes('chart') ||
                                   component.toLowerCase().includes('knee') ||
                                   component.toLowerCase().includes('streaming');

        switch (source) {
            case 'event_loop':
                if (duration > 100) return 'CRITICAL: Check for synchronous operations, large DOM manipulations, or blocking computations';
                if (duration > 50) return 'Move heavy operations to Web Workers or use requestIdleCallback';
                return 'Consider using requestAnimationFrame for smoother updates';

            case 'react_render':
                if (isStreamingComponent) return 'Optimize chart data updates - use memoization, reduce re-renders, or implement virtualization';
                if (duration > 50) return 'Use React.memo, useMemo, or useCallback to prevent unnecessary re-renders';
                return 'Check component dependencies and optimize render logic';

            case 'streaming':
                if (component.includes('Chart')) return 'Reduce chart update frequency or implement data batching';
                if (component.includes('Data')) return 'Implement data throttling or use circular buffers';
                return 'Optimize data processing pipeline or reduce update frequency';

            default:
                return 'Profile the specific operation to identify bottlenecks';
        }
    }

    /**
     * Generate performance insights based on patterns
     */
    private generateInsights(): void {
        this.checkFrequentBlockingComponents();
        this.checkHighFrequencyUpdates();
        this.checkMemoryPressure();
    }

    /**
     * Check for components that block frequently
     */
    private checkFrequentBlockingComponents(): void {
        const recentAlerts = this.alerts.filter(alert => Date.now() - alert.timestamp < 30000); // Last 30 seconds
        const componentCounts = new Map<string, number>();

        for (const alert of recentAlerts) {
            const count = componentCounts.get(alert.component) || 0;
            componentCounts.set(alert.component, count + 1);
        }

        for (const [component, count] of componentCounts) {
            if (count >= 5) { // 5+ blocking events in 30 seconds
                this.addInsight({
                    type: 'frequent_blocking',
                    component,
                    description: `${component} has blocked ${count} times in the last 30 seconds`,
                    recommendation: 'This component needs immediate optimization - consider async processing or data throttling',
                    severity: 'error',
                    data: { blockingCount: count, timeWindow: 30 }
                });
            }
        }
    }

    /**
     * Check for high-frequency updates that might cause blocking
     */
    private checkHighFrequencyUpdates(): void {
        const streamingMetrics = uiEventLoopMonitor.getStreamingMetrics();

        if (streamingMetrics.dataUpdatesPerSecond > 120) {
            this.addInsight({
                type: 'high_frequency_updates',
                component: 'StreamingSystem',
                description: `Very high data update frequency: ${streamingMetrics.dataUpdatesPerSecond.toFixed(1)}/s`,
                recommendation: 'Consider implementing update throttling or data batching to reduce UI pressure',
                severity: 'warning',
                data: { updatesPerSecond: streamingMetrics.dataUpdatesPerSecond }
            });
        }
    }

    /**
     * Check for memory pressure indicators
     */
    private checkMemoryPressure(): void {
        if (typeof performance !== 'undefined' && performance.memory) {
            const memory = performance.memory;
            const usageRatio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

            if (usageRatio > 0.8) {
                this.addInsight({
                    type: 'memory_pressure',
                    component: 'MemorySystem',
                    description: `High memory usage: ${(usageRatio * 100).toFixed(1)}% of heap limit`,
                    recommendation: 'Consider implementing data cleanup, reducing buffer sizes, or garbage collection optimization',
                    severity: 'warning',
                    data: {
                        usedMB: Math.round(memory.usedJSHeapSize / 1024 / 1024),
                        limitMB: Math.round(memory.jsHeapSizeLimit / 1024 / 1024),
                        usageRatio
                    }
                });
            }
        }
    }

    /**
     * Add a performance insight
     */
    private addInsight(insight: Omit<PerformanceInsight, 'timestamp'>): void {
        // Check if similar insight already exists
        const existing = this.insights.find(i =>
            i.type === insight.type &&
            i.component === insight.component &&
            Date.now() - (i as any).timestamp < 60000 // Within last minute
        );

        if (existing) return; // Don't duplicate recent insights

        const newInsight: PerformanceInsight & { timestamp: number } = {
            ...insight,
            timestamp: Date.now()
        };

        this.insights.push(newInsight);
        if (this.insights.length > this.MAX_INSIGHTS_STORED) {
            this.insights.shift();
        }

        // Log insight
        const emoji = insight.severity === 'error' ? '🔥' : insight.severity === 'warning' ? '💡' : 'ℹ️';
        console.log(`${emoji} [PERFORMANCE_INSIGHT] ${insight.component}: ${insight.description}`);
        console.log(`   🎯 Recommendation: ${insight.recommendation}`);
    }

    /**
     * Setup periodic analysis and reporting
     */
    private setupPeriodicAnalysis(): void {
        setInterval(() => {
            this.reportPerformanceSummary();
        }, 60000); // Report every minute
    }

    /**
     * Report performance summary
     */
    private reportPerformanceSummary(): void {
        const recentAlerts = this.alerts.filter(alert => Date.now() - alert.timestamp < 60000); // Last minute

        if (recentAlerts.length > 0) {
            const severityCounts = {
                critical: recentAlerts.filter(a => a.severity === 'critical').length,
                severe: recentAlerts.filter(a => a.severity === 'severe').length,
                moderate: recentAlerts.filter(a => a.severity === 'moderate').length
            };

            console.log('📊 [BLOCKING_SUMMARY] Last minute performance alerts:', severityCounts);

            // Show top blocking components
            const componentCounts = new Map<string, number>();
            for (const alert of recentAlerts) {
                componentCounts.set(alert.component, (componentCounts.get(alert.component) || 0) + 1);
            }

            const topBlockers = Array.from(componentCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            if (topBlockers.length > 0) {
                console.log('🎯 [TOP_BLOCKERS]', topBlockers.map(([comp, count]) => `${comp}: ${count} alerts`));
            }
        }

        // Report insights
        const recentInsights = this.insights.filter(insight => Date.now() - (insight as any).timestamp < 60000);
        if (recentInsights.length > 0) {
            console.log('💡 [PERFORMANCE_INSIGHTS] Active recommendations:', recentInsights.length);
        }
    }

    /**
     * Get all recent alerts
     */
    getRecentAlerts(timeWindowMs: number = 60000): BlockingAlert[] {
        const cutoff = Date.now() - timeWindowMs;
        return this.alerts.filter(alert => alert.timestamp > cutoff);
    }

    /**
     * Get all recent insights
     */
    getRecentInsights(timeWindowMs: number = 300000): PerformanceInsight[] {
        const cutoff = Date.now() - timeWindowMs;
        return this.insights.filter(insight => (insight as any).timestamp > cutoff);
    }

    /**
     * Export all alert and insight data
     */
    exportData(): {
        alerts: BlockingAlert[];
        insights: PerformanceInsight[];
        config: AlertConfig;
    } {
        return {
            alerts: [...this.alerts],
            insights: [...this.insights],
            config: { ...this.config }
        };
    }

    /**
     * Reset all data
     */
    reset(): void {
        this.alerts = [];
        this.insights = [];
        this.alertCounts.clear();
        this.lastAlertTime.clear();
        console.log('🔄 [BLOCKING_ALERTS] Reset all alert data');
    }

    /**
     * Cleanup resources
     */
    cleanup(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        this.reset();
    }
}

// Create and export singleton
export const blockingAlerts = BlockingOperationAlerts.getInstance();

// Auto-start in development mode
if (process.env.NODE_ENV === 'development') {
    console.log('🔔 [BLOCKING_ALERTS] Initialized blocking operation alerts system');
}

// Export for manual control
export { BlockingOperationAlerts };