/**
 * UI Event Loop Monitor - Detects blocking operations in renderer process
 * Specifically designed to identify streaming-related UI blocking issues
 */

interface UIBlockingEvent {
    operation: string;
    component: string;
    duration: number;
    timestamp: number;
    stackTrace?: string;
    context?: any;
}

interface StreamingMetrics {
    dataUpdatesPerSecond: number;
    chartRendersPerSecond: number;
    avgRenderTime: number;
    maxRenderTime: number;
    droppedFrames: number;
}

class UIEventLoopMonitor {
    private static instance: UIEventLoopMonitor | null = null;
    private blockingEvents: UIBlockingEvent[] = [];
    private lastLoopTime = performance.now();
    private monitoringTimer: number | null = null;
    private isMonitoring = false;

    // Streaming-specific metrics
    private streamingMetrics: StreamingMetrics = {
        dataUpdatesPerSecond: 0,
        chartRendersPerSecond: 0,
        avgRenderTime: 0,
        maxRenderTime: 0,
        droppedFrames: 0
    };

    private dataUpdateCounter = 0;
    private chartRenderCounter = 0;
    private renderTimes: number[] = [];
    private lastMetricsReset = performance.now();

    // Thresholds for blocking detection
    private readonly BLOCKING_THRESHOLD_MS = 20; // >20ms blocks 60fps (adjusted for monitoring overhead)
    private readonly SEVERE_BLOCKING_MS = 50;     // >50ms severely blocks UI
    private readonly MAX_EVENTS_STORED = 200;
    private readonly METRICS_RESET_INTERVAL = 5000; // 5 seconds

    private constructor() {
        this.setupEventLoopMonitoring();
        this.setupStreamingMetrics();
    }

    static getInstance(): UIEventLoopMonitor {
        if (!UIEventLoopMonitor.instance) {
            UIEventLoopMonitor.instance = new UIEventLoopMonitor();
        }
        return UIEventLoopMonitor.instance;
    }

    /**
     * Start comprehensive UI event loop monitoring
     */
    startMonitoring(): void {
        if (this.isMonitoring) return;

        console.log('🔍 [UI_MONITOR] Starting UI event loop monitoring for streaming performance');
        this.isMonitoring = true;
        this.lastLoopTime = performance.now();

        // Monitor event loop delays every frame
        const checkEventLoop = () => {
            if (!this.isMonitoring) return;

            const currentTime = performance.now();
            const delay = currentTime - this.lastLoopTime;

            // Account for expected delay (assuming 60fps = ~16ms)
            if (delay > this.BLOCKING_THRESHOLD_MS) {
                // Only log every 10th event to reduce console spam
                const shouldLog = Math.random() < 0.1; // 10% sample rate
                this.recordBlockingEvent('EVENT_LOOP_DELAY', 'RendererProcess', delay, {
                    expectedDelay: 16,
                    actualDelay: delay,
                    severity: delay > this.SEVERE_BLOCKING_MS ? 'SEVERE' : 'MODERATE',
                    logEvent: shouldLog
                });
            }

            this.lastLoopTime = currentTime;
            this.monitoringTimer = requestAnimationFrame(checkEventLoop);
        };

        this.monitoringTimer = requestAnimationFrame(checkEventLoop);

        // Setup periodic metrics reporting
        this.setupPeriodicReporting();
    }

    /**
     * Stop monitoring
     */
    stopMonitoring(): void {
        console.log('🔍 [UI_MONITOR] Stopping UI event loop monitoring');
        this.isMonitoring = false;
        if (this.monitoringTimer) {
            cancelAnimationFrame(this.monitoringTimer);
            this.monitoringTimer = null;
        }
    }

    /**
     * Record a specific blocking operation during streaming
     */
    recordBlockingEvent(operation: string, component: string, duration: number, context?: any): void {
        const event: UIBlockingEvent = {
            operation,
            component,
            duration,
            timestamp: Date.now(),
            context,
            stackTrace: this.captureStackTrace()
        };

        this.blockingEvents.push(event);

        // Maintain circular buffer
        if (this.blockingEvents.length > this.MAX_EVENTS_STORED) {
            this.blockingEvents.shift();
        }

        // Log immediately for severe blocking (always) or moderate blocking (throttled)
        const shouldLog = context?.logEvent !== false;
        if (duration > this.SEVERE_BLOCKING_MS) {
            console.error(`🚨 [UI_BLOCKING] SEVERE: ${component}.${operation} blocked for ${duration.toFixed(2)}ms`, context);
        } else if (duration > this.BLOCKING_THRESHOLD_MS && shouldLog) {
            console.warn(`⚠️ [UI_BLOCKING] ${component}.${operation} blocked for ${duration.toFixed(2)}ms`, context);
        }
    }

    /**
     * Track data update frequency during streaming
     */
    recordDataUpdate(component: string): void {
        this.dataUpdateCounter++;

        // Log high-frequency updates that might cause blocking
        const now = performance.now();
        const elapsed = now - this.lastMetricsReset;
        if (elapsed > 100) { // Check every 100ms
            const updatesPerSecond = (this.dataUpdateCounter / elapsed) * 1000;
            if (updatesPerSecond > 120) { // More than 120 updates/sec might be excessive
                console.warn(`⚠️ [UI_STREAMING] High data update frequency: ${updatesPerSecond.toFixed(1)}/s in ${component}`);
            }
        }
    }

    /**
     * Track chart render performance
     */
    recordChartRender(component: string, renderTime: number): void {
        this.chartRenderCounter++;
        this.renderTimes.push(renderTime);

        // Maintain render time history
        if (this.renderTimes.length > 100) {
            this.renderTimes.shift();
        }

        // Update streaming metrics
        this.streamingMetrics.maxRenderTime = Math.max(this.streamingMetrics.maxRenderTime, renderTime);
        this.streamingMetrics.avgRenderTime = this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length;

        // Log slow renders
        if (renderTime > this.BLOCKING_THRESHOLD_MS) {
            this.recordBlockingEvent('CHART_RENDER', component, renderTime, {
                renderTime,
                avgRenderTime: this.streamingMetrics.avgRenderTime
            });
        }
    }

    /**
     * Track React component render times
     */
    wrapComponentRender<T>(componentName: string, renderFn: () => T): T {
        const start = performance.now();
        const result = renderFn();
        const duration = performance.now() - start;

        if (duration > 5) { // Log renders >5ms
            this.recordBlockingEvent('REACT_RENDER', componentName, duration);
        }

        return result;
    }

    /**
     * Setup streaming-specific metrics tracking
     */
    private setupStreamingMetrics(): void {
        setInterval(() => {
            const now = performance.now();
            const elapsed = now - this.lastMetricsReset;

            if (elapsed >= this.METRICS_RESET_INTERVAL) {
                // Calculate rates
                this.streamingMetrics.dataUpdatesPerSecond = (this.dataUpdateCounter / elapsed) * 1000;
                this.streamingMetrics.chartRendersPerSecond = (this.chartRenderCounter / elapsed) * 1000;

                // Reset counters
                this.dataUpdateCounter = 0;
                this.chartRenderCounter = 0;
                this.lastMetricsReset = now;

                // Log metrics if streaming is active
                if (this.streamingMetrics.dataUpdatesPerSecond > 10) {
                    console.log('📊 [STREAMING_METRICS]', {
                        dataUpdates: `${this.streamingMetrics.dataUpdatesPerSecond.toFixed(1)}/s`,
                        chartRenders: `${this.streamingMetrics.chartRendersPerSecond.toFixed(1)}/s`,
                        avgRenderTime: `${this.streamingMetrics.avgRenderTime.toFixed(2)}ms`,
                        maxRenderTime: `${this.streamingMetrics.maxRenderTime.toFixed(2)}ms`
                    });
                }

                // Reset max render time
                this.streamingMetrics.maxRenderTime = 0;
            }
        }, 1000);
    }

    /**
     * Setup periodic reporting of blocking events
     */
    private setupPeriodicReporting(): void {
        setInterval(() => {
            if (!this.isMonitoring) return;

            const recentEvents = this.getRecentBlockingEvents(10000); // Last 10 seconds
            if (recentEvents.length > 0) {
                const severeEvents = recentEvents.filter(e => e.duration > this.SEVERE_BLOCKING_MS);
                const moderateEvents = recentEvents.filter(e => e.duration > this.BLOCKING_THRESHOLD_MS && e.duration <= this.SEVERE_BLOCKING_MS);

                if (severeEvents.length > 0 || moderateEvents.length > 5) {
                    console.log('📈 [UI_BLOCKING_SUMMARY] Recent blocking events:', {
                        severe: severeEvents.length,
                        moderate: moderateEvents.length,
                        topBlocking: recentEvents
                            .sort((a, b) => b.duration - a.duration)
                            .slice(0, 3)
                            .map(e => ({
                                operation: `${e.component}.${e.operation}`,
                                duration: `${e.duration.toFixed(2)}ms`
                            }))
                    });
                }
            }
        }, 10000); // Report every 10 seconds
    }

    /**
     * Setup DOM mutation and event listener monitoring
     */
    private setupEventLoopMonitoring(): void {
        // Monitor for excessive DOM mutations during streaming
        if (typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver((mutations) => {
                if (mutations.length > 50) { // Many mutations at once
                    const start = performance.now();
                    // Allow mutations to process
                    setTimeout(() => {
                        const duration = performance.now() - start;
                        if (duration > 5) {
                            this.recordBlockingEvent('DOM_MUTATIONS', 'MutationObserver', duration, {
                                mutationCount: mutations.length
                            });
                        }
                    }, 0);
                }
            });

            // Start observing when document is ready
            if (document.body) {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });
            }
        }
    }

    /**
     * Get recent blocking events
     */
    getRecentBlockingEvents(timeWindowMs: number): UIBlockingEvent[] {
        const cutoff = Date.now() - timeWindowMs;
        return this.blockingEvents.filter(event => event.timestamp > cutoff);
    }

    /**
     * Get current streaming metrics
     */
    getStreamingMetrics(): StreamingMetrics {
        return { ...this.streamingMetrics };
    }

    /**
     * Capture stack trace for debugging
     */
    private captureStackTrace(): string {
        try {
            throw new Error();
        } catch (e) {
            return (e as Error).stack?.split('\n').slice(2, 6).join('\n') || '';
        }
    }

    /**
     * Cleanup resources
     */
    cleanup(): void {
        this.stopMonitoring();
        this.blockingEvents = [];
    }
}

// Create and export singleton instance
export const uiEventLoopMonitor = UIEventLoopMonitor.getInstance();

// Auto-start monitoring in development
if (process.env.NODE_ENV === 'development') {
    uiEventLoopMonitor.startMonitoring();
    console.log('🔍 [UI_MONITOR] Auto-started in development mode');
}