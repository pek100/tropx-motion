import { JointAngleData, UIJointData } from '../shared/types';
import { JointName } from "../shared/config";

interface UIState {
    left: UIJointData;
    right: UIJointData;
}

/**
 * Optimized UI Processor with throttled updates and batch processing
 * 
 * Key optimizations:
 * 1. Throttled subscriber notifications (60fps max instead of every sample)
 * 2. Batch processing of angle updates
 * 3. Dirty tracking to avoid unnecessary notifications
 * 4. Optimized data structures for minimal memory allocation
 */
export class OptimizedUIProcessor {
    private static instance: OptimizedUIProcessor | null = null;
    private jointDataMap = new Map<string, UIJointData>();
    private subscribers = new Set<(data: UIState) => void>();
    
    // Optimization state
    private isDirty = false;
    private notificationInterval: NodeJS.Timeout | null = null;
    private lastNotificationTime = 0;
    private pendingUpdates = new Map<string, JointAngleData[]>();
    
    // Configuration
    private readonly NOTIFICATION_INTERVAL = 16; // 60fps (16.67ms)
    private readonly MAX_BATCH_SIZE = 10;
    private readonly MIN_UPDATE_INTERVAL = 8; // Minimum 8ms between notifications

    private constructor() {
        this.initializeJointData();
        this.startNotificationLoop();
    }

    static getInstance(): OptimizedUIProcessor {
        if (!OptimizedUIProcessor.instance) {
            OptimizedUIProcessor.instance = new OptimizedUIProcessor();
        }
        return OptimizedUIProcessor.instance;
    }

    static reset(): void {
        if (OptimizedUIProcessor.instance) {
            OptimizedUIProcessor.instance.cleanup();
            OptimizedUIProcessor.instance = null;
        }
    }

    /**
     * Processes joint angle data with batching - no immediate notification
     */
    updateJointAngle(angleData: JointAngleData): void {
        // Add to pending updates instead of immediate processing
        const existing = this.pendingUpdates.get(angleData.jointName) || [];
        existing.push(angleData);
        
        // Keep only recent updates to prevent memory growth
        if (existing.length > this.MAX_BATCH_SIZE) {
            existing.splice(0, existing.length - this.MAX_BATCH_SIZE);
        }
        
        this.pendingUpdates.set(angleData.jointName, existing);
        this.isDirty = true;
    }

    /**
     * Throttled notification loop running at 60fps
     */
    private startNotificationLoop(): void {
        this.notificationInterval = setInterval(() => {
            if (!this.isDirty) return;
            
            const now = performance.now();
            if (now - this.lastNotificationTime < this.MIN_UPDATE_INTERVAL) return;
            
            this.processPendingUpdates();
            this.notifySubscribers();
            
            this.isDirty = false;
            this.lastNotificationTime = now;
        }, this.NOTIFICATION_INTERVAL);
    }

    /**
     * Processes all pending updates in batch
     */
    private processPendingUpdates(): void {
        this.pendingUpdates.forEach((updates, jointName) => {
            if (updates.length === 0) return;
            
            const jointData = this.jointDataMap.get(jointName);
            if (!jointData) return;
            
            // Process the most recent update (or could average/interpolate)
            const latestUpdate = updates[updates.length - 1];
            this.updateJointDataOptimized(jointData, latestUpdate);
            
            // Clear processed updates
            updates.length = 0;
        });
    }

    /**
     * Optimized joint data update with minimal object creation
     */
    private updateJointDataOptimized(jointData: UIJointData, angleData: JointAngleData): void {
        const roundedAngle = Math.round(angleData.angle * 10) / 10;
        
        // Update current value
        jointData.current = roundedAngle;
        jointData.lastUpdate = angleData.timestamp;
        
        // Update device list (reuse array if possible)
        if (jointData.devices.length !== angleData.deviceIds.length || 
            !this.arraysEqual(jointData.devices, angleData.deviceIds)) {
            jointData.devices = [...angleData.deviceIds];
        }
        
        // Update statistics
        if (roundedAngle > jointData.max) {
            jointData.max = roundedAngle;
            jointData.rom = jointData.max - jointData.min;
        }
        
        if (roundedAngle < jointData.min) {
            jointData.min = roundedAngle;
            jointData.rom = jointData.max - jointData.min;
        }
    }

    /**
     * Fast array equality check
     */
    private arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    /**
     * Returns current UI state (optimized to reuse objects)
     */
    private readonly chartState: UIState = {
        left: this.createEmptyJointData(),
        right: this.createEmptyJointData()
    };

    getChartFormat(): UIState {
        // Reuse existing state object, just update properties
        const leftData = this.jointDataMap.get(JointName.LEFT_KNEE);
        const rightData = this.jointDataMap.get(JointName.RIGHT_KNEE);
        
        if (leftData) {
            Object.assign(this.chartState.left, leftData);
        }
        
        if (rightData) {
            Object.assign(this.chartState.right, rightData);
        }
        
        return this.chartState;
    }

    subscribe(callback: (data: UIState) => void): () => void {
        this.subscribers.add(callback);
        
        // Send current state immediately
        callback(this.getChartFormat());
        
        return () => this.subscribers.delete(callback);
    }

    /**
     * Optimized notification that reuses objects
     */
    private notifySubscribers(): void {
        if (this.subscribers.size === 0) return;
        
        const chartData = this.getChartFormat();
        
        // Notify all subscribers with the same object (they should not mutate it)
        this.subscribers.forEach(callback => {
            try {
                callback(chartData);
            } catch (error) {
                console.error('❌ Error in UI subscriber:', error);
            }
        });
    }

    /**
     * Force immediate update (for testing/debugging)
     */
    forceUpdate(): void {
        if (this.isDirty) {
            this.processPendingUpdates();
            this.notifySubscribers();
            this.isDirty = false;
            this.lastNotificationTime = performance.now();
        }
    }

    /**
     * Get performance metrics
     */
    getPerformanceMetrics(): {
        pendingUpdates: number;
        subscriberCount: number;
        isDirty: boolean;
        lastUpdateTime: number;
    } {
        let totalPending = 0;
        this.pendingUpdates.forEach(updates => {
            totalPending += updates.length;
        });
        
        return {
            pendingUpdates: totalPending,
            subscriberCount: this.subscribers.size,
            isDirty: this.isDirty,
            lastUpdateTime: this.lastNotificationTime
        };
    }

    cleanup(): void {
        if (this.notificationInterval) {
            clearInterval(this.notificationInterval);
            this.notificationInterval = null;
        }
        
        this.subscribers.clear();
        this.pendingUpdates.clear();
        this.initializeJointData();
        this.isDirty = false;
    }

    private initializeJointData(): void {
        const defaultData = this.createEmptyJointData();
        this.jointDataMap.set(JointName.LEFT_KNEE, { ...defaultData });
        this.jointDataMap.set(JointName.RIGHT_KNEE, { ...defaultData });
    }

    private createEmptyJointData(): UIJointData {
        return {
            current: 0,
            max: 0,
            min: 0,
            rom: 0,
            lastUpdate: 0,
            devices: []
        };
    }

    // Legacy compatibility methods
    processServerData(recording: any): void {
        // Implementation for processing server data if needed
        this.notifySubscribers();
    }
}