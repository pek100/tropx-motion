// scripts/dev-server.js - Development helper script
const { spawn } = require('child_process');
const chalk = require('chalk');
const { platform } = require('os');

class DevServer {
    constructor() {
        this.processes = new Map();
        this.isShuttingDown = false;
    }

    log(service, message, color = 'white') {
        const timestamp = new Date().toLocaleTimeString();
        console.log(chalk[color](`[${timestamp}] [${service}] ${message}`));
    }

    async startService(name, command, args = [], options = {}) {
        if (this.processes.has(name)) {
            this.log(name, 'Already running', 'yellow');
            return;
        }

        this.log(name, `Starting: ${command} ${args.join(' ')}`, 'cyan');
        
        const process = spawn(command, args, {
            stdio: 'pipe',
            shell: platform() === 'win32',
            ...options
        });

        // Handle output
        process.stdout.on('data', (data) => {
            const message = data.toString().trim();
            if (message) this.log(name, message, 'green');
        });

        process.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message && !message.includes('Warning')) {
                this.log(name, message, 'red');
            }
        });

        process.on('close', (code) => {
            if (!this.isShuttingDown) {
                this.log(name, `Exited with code ${code}`, code === 0 ? 'gray' : 'red');
                this.processes.delete(name);
            }
        });

        this.processes.set(name, process);
        return process;
    }

    async startAll() {
        this.log('DevServer', 'Starting development environment...', 'cyan');

        // Start TypeScript compiler for main process
        await this.startService(
            'TypeScript',
            'npx',
            ['tsc-watch', '-p', 'tsconfig.main.json', '--onSuccess', 'echo "Main process compiled"']
        );

        // Wait a bit for initial compilation
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Start Vite dev server for renderer
        await this.startService(
            'Vite',
            'npx',
            ['vite', '--port', '3000']
        );

        // Wait for Vite to be ready
        await this.waitForPort(3000);

        // Start Electron
        await this.startService(
            'Electron',
            'npx',
            ['electron', '.'],
            { env: { ...process.env, NODE_ENV: 'development' } }
        );

        this.log('DevServer', 'All services started successfully!', 'green');
    }

    async waitForPort(port, timeout = 30000) {
        const net = require('net');
        const start = Date.now();

        return new Promise((resolve, reject) => {
            const checkPort = () => {
                const socket = new net.Socket();
                
                socket.on('connect', () => {
                    socket.destroy();
                    resolve();
                });

                socket.on('error', () => {
                    if (Date.now() - start > timeout) {
                        reject(new Error(`Timeout waiting for port ${port}`));
                    } else {
                        setTimeout(checkPort, 500);
                    }
                });

                socket.connect(port, 'localhost');
            };

            checkPort();
        });
    }

    async shutdown() {
        this.isShuttingDown = true;
        this.log('DevServer', 'Shutting down all services...', 'yellow');

        const shutdownPromises = Array.from(this.processes.entries()).map(([name, process]) => {
            return new Promise((resolve) => {
                this.log(name, 'Stopping...', 'yellow');
                process.kill('SIGTERM');
                
                setTimeout(() => {
                    if (!process.killed) {
                        process.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);
            });
        });

        await Promise.all(shutdownPromises);
        this.log('DevServer', 'All services stopped', 'gray');
        process.exit(0);
    }
}

// Handle graceful shutdown
const devServer = new DevServer();

process.on('SIGINT', () => devServer.shutdown());
process.on('SIGTERM', () => devServer.shutdown());

// Start development server
devServer.startAll().catch(console.error);

---

// electron/main/utils/Logger.ts - Enhanced logging system
import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

interface LogEntry {
    timestamp: number;
    level: LogLevel;
    category: string;
    message: string;
    data?: any;
}

export class Logger {
    private static instance: Logger;
    private logBuffer: LogEntry[] = [];
    private readonly maxBufferSize = 1000;
    private readonly flushInterval = 5000; // 5 seconds
    private logFile: string | null = null;
    private flushTimer: NodeJS.Timeout | null = null;

    private constructor() {
        this.setupLogFile();
        this.startFlushTimer();
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private setupLogFile(): void {
        try {
            const logDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            const date = new Date().toISOString().split('T')[0];
            this.logFile = path.join(logDir, `motion-capture-${date}.log`);
        } catch (error) {
            console.error('Failed to setup log file:', error);
        }
    }

    private startFlushTimer(): void {
        this.flushTimer = setInterval(() => {
            this.flush();
        }, this.flushInterval);
    }

    private addToBuffer(level: LogLevel, category: string, message: string, data?: any): void {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            category,
            message,
            data
        };

        this.logBuffer.push(entry);

        // Console output for development
        if (process.env.NODE_ENV === 'development') {
            this.logToConsole(entry);
        }

        // Auto-flush if buffer is full
        if (this.logBuffer.length >= this.maxBufferSize) {
            this.flush();
        }
    }

    private logToConsole(entry: LogEntry): void {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const levelStr = LogLevel[entry.level];
        const prefix = `[${time}] [${levelStr}] [${entry.category}]`;
        
        switch (entry.level) {
            case LogLevel.DEBUG:
                console.debug(prefix, entry.message, entry.data || '');
                break;
            case LogLevel.INFO:
                console.info(prefix, entry.message, entry.data || '');
                break;
            case LogLevel.WARN:
                console.warn(prefix, entry.message, entry.data || '');
                break;
            case LogLevel.ERROR:
                console.error(prefix, entry.message, entry.data || '');
                break;
        }
    }

    private flush(): void {
        if (this.logBuffer.length === 0 || !this.logFile) return;

        try {
            const logLines = this.logBuffer.map(entry => {
                const time = new Date(entry.timestamp).toISOString();
                const level = LogLevel[entry.level];
                const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
                return `${time} [${level}] [${entry.category}] ${entry.message}${dataStr}`;
            });

            fs.appendFileSync(this.logFile, logLines.join('\n') + '\n');
            this.logBuffer = [];
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    // Public logging methods
    static debug(category: string, message: string, data?: any): void {
        Logger.getInstance().addToBuffer(LogLevel.DEBUG, category, message, data);
    }

    static info(category: string, message: string, data?: any): void {
        Logger.getInstance().addToBuffer(LogLevel.INFO, category, message, data);
    }

    static warn(category: string, message: string, data?: any): void {
        Logger.getInstance().addToBuffer(LogLevel.WARN, category, message, data);
    }

    static error(category: string, message: string, data?: any): void {
        Logger.getInstance().addToBuffer(LogLevel.ERROR, category, message, data);
    }

    static cleanup(): void {
        const instance = Logger.getInstance();
        if (instance.flushTimer) {
            clearInterval(instance.flushTimer);
        }
        instance.flush();
    }
}

---

// electron/main/utils/HealthMonitor.ts - System health monitoring
export interface HealthMetrics {
    cpu: {
        usage: number;
        loadAverage: number[];
    };
    memory: {
        used: number;
        total: number;
        percentage: number;
    };
    system: {
        uptime: number;
        platform: string;
        arch: string;
    };
    websocket: {
        connections: number;
        messagesPerSecond: number;
        bytesPerSecond: number;
    };
    motionProcessing: {
        isActive: boolean;
        devicesConnected: number;
        dataRate: number;
        errors: number;
    };
}

export class HealthMonitor {
    private metrics: HealthMetrics;
    private messageCount = 0;
    private byteCount = 0;
    private lastResetTime = Date.now();
    private updateInterval: NodeJS.Timeout | null = null;
    private subscribers = new Set<(metrics: HealthMetrics) => void>();

    constructor() {
        this.metrics = this.initializeMetrics();
        this.startMonitoring();
    }

    private initializeMetrics(): HealthMetrics {
        return {
            cpu: { usage: 0, loadAverage: [] },
            memory: { used: 0, total: 0, percentage: 0 },
            system: {
                uptime: process.uptime(),
                platform: process.platform,
                arch: process.arch
            },
            websocket: {
                connections: 0,
                messagesPerSecond: 0,
                bytesPerSecond: 0
            },
            motionProcessing: {
                isActive: false,
                devicesConnected: 0,
                dataRate: 0,
                errors: 0
            }
        };
    }

    private startMonitoring(): void {
        this.updateInterval = setInterval(() => {
            this.updateMetrics();
            this.notifySubscribers();
        }, 5000); // Update every 5 seconds
    }

    private updateMetrics(): void {
        // Update CPU metrics
        const cpuUsage = process.cpuUsage();
        this.metrics.cpu.usage = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
        this.metrics.cpu.loadAverage = require('os').loadavg();

        // Update memory metrics
        const memUsage = process.memoryUsage();
        const totalMem = require('os').totalmem();
        this.metrics.memory.used = memUsage.heapUsed;
        this.metrics.memory.total = totalMem;
        this.metrics.memory.percentage = (memUsage.heapUsed / totalMem) * 100;

        // Update system metrics
        this.metrics.system.uptime = process.uptime();

        // Calculate WebSocket metrics
        const timeDiff = (Date.now() - this.lastResetTime) / 1000;
        this.metrics.websocket.messagesPerSecond = this.messageCount / timeDiff;
        this.metrics.websocket.bytesPerSecond = this.byteCount / timeDiff;

        // Reset counters
        this.messageCount = 0;
        this.byteCount = 0;
        this.lastResetTime = Date.now();
    }

    // Public methods for updating metrics
    recordWebSocketMessage(byteSize: number): void {
        this.messageCount++;
        this.byteCount += byteSize;
    }

    updateWebSocketConnections(count: number): void {
        this.metrics.websocket.connections = count;
    }

    updateMotionProcessing(data: {
        isActive: boolean;
        devicesConnected: number;
        dataRate: number;
        errors?: number;
    }): void {
        this.metrics.motionProcessing = {
            ...this.metrics.motionProcessing,
            ...data
        };
    }

    getMetrics(): HealthMetrics {
        return { ...this.metrics };
    }

    subscribe(callback: (metrics: HealthMetrics) => void): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    private notifySubscribers(): void {
        this.subscribers.forEach(callback => {
            try {
                callback(this.getMetrics());
            } catch (error) {
                console.error('Health monitor subscriber error:', error);
            }
        });
    }

    // Health check methods
    isHealthy(): boolean {
        return (
            this.metrics.memory.percentage < 90 && // Memory usage under 90%
            this.metrics.cpu.usage < 80 && // CPU usage reasonable
            this.metrics.motionProcessing.errors < 10 // Low error rate
        );
    }

    getHealthScore(): number {
        let score = 100;
        
        // Deduct points for high resource usage
        if (this.metrics.memory.percentage > 70) score -= 20;
        if (this.metrics.cpu.usage > 60) score -= 20;
        if (this.metrics.motionProcessing.errors > 5) score -= 30;
        if (this.metrics.websocket.connections === 0) score -= 10;

        return Math.max(0, score);
    }

    getSystemStatus(): 'healthy' | 'warning' | 'critical' {
        const score = this.getHealthScore();
        if (score >= 80) return 'healthy';
        if (score >= 60) return 'warning';
        return 'critical';
    }

    cleanup(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.subscribers.clear();
    }
}

---

// scripts/build-check.js - Pre-build validation
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class BuildChecker {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    log(message, type = 'info') {
        const colors = {
            info: 'blue',
            success: 'green',
            warning: 'yellow',
            error: 'red'
        };
        console.log(chalk[colors[type]](`[${type.toUpperCase()}] ${message}`));
    }

    checkFile(filePath, required = true) {
        const exists = fs.existsSync(filePath);
        if (!exists && required) {
            this.errors.push(`Required file missing: ${filePath}`);
        } else if (!exists) {
            this.warnings.push(`Optional file missing: ${filePath}`);
        }
        return exists;
    }

    checkDirectory(dirPath, required = true) {
        const exists = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
        if (!exists && required) {
            this.errors.push(`Required directory missing: ${dirPath}`);
        } else if (!exists) {
            this.warnings.push(`Optional directory missing: ${dirPath}`);
        }
        return exists;
    }

    checkPackageJson() {
        this.log('Checking package.json...');
        
        if (!this.checkFile('package.json')) return;

        const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        
        // Check required dependencies
        const requiredDeps = ['electron', 'ws', 'react', 'react-dom'];
        requiredDeps.forEach(dep => {
            if (!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep]) {
                this.errors.push(`Missing dependency: ${dep}`);
            }
        });

        // Check scripts
        const requiredScripts = ['dev', 'build', 'package'];
        requiredScripts.forEach(script => {
            if (!pkg.scripts?.[script]) {
                this.warnings.push(`Missing script: ${script}`);
            }
        });

        this.log('package.json check complete');
    }

    checkElectronStructure() {
        this.log('Checking Electron file structure...');

        // Required directories
        this.checkDirectory('electron');
        this.checkDirectory('electron/main');
        this.checkDirectory('electron/preload');
        this.checkDirectory('electron/renderer');

        // Required files
        this.checkFile('electron/main/main.ts');
        this.checkFile('electron/preload/preload.ts');
        this.checkFile('electron/renderer/index.html');
        this.checkFile('electron/renderer/main.tsx');

        this.log('Electron structure check complete');
    }

    checkMotionProcessing() {
        this.log('Checking motion processing files...');

        // Check if motion processing exists
        this.checkDirectory('src/services/motionProcessing');
        this.checkFile('src/services/motionProcessing/MotionProcessingCoordinator.ts');
        this.checkFile('src/sdk/core/MuseManager.ts');
        this.checkFile('src/sdk/core/MuseData.ts');

        this.log('Motion processing check complete');
    }

    checkTypeScript() {
        this.log('Checking TypeScript configuration...');

        this.checkFile('tsconfig.json');
        this.checkFile('tsconfig.main.json');

        // Check if TypeScript can compile
        try {
            require('typescript');
        } catch (error) {
            this.errors.push('TypeScript not installed');
        }

        this.log('TypeScript check complete');
    }

    checkBuildTools() {
        this.log('Checking build tools...');

        // Check Vite
        try {
            require('vite');
        } catch (error) {
            this.errors.push('Vite not installed');
        }

        // Check electron-builder
        try {
            require('electron-builder');
        } catch (error) {
            this.warnings.push('electron-builder not installed (required for packaging)');
        }

        this.log('Build tools check complete');
    }

    async runAllChecks() {
        this.log('Starting build validation...', 'info');

        this.checkPackageJson();
        this.checkElectronStructure();
        this.checkMotionProcessing();
        this.checkTypeScript();
        this.checkBuildTools();

        // Report results
        if (this.errors.length > 0) {
            this.log(`Found ${this.errors.length} error(s):`, 'error');
            this.errors.forEach(error => this.log(`  ${error}`, 'error'));
        }

        if (this.warnings.length > 0) {
            this.log(`Found ${this.warnings.length} warning(s):`, 'warning');
            this.warnings.forEach(warning => this.log(`  ${warning}`, 'warning'));
        }

        if (this.errors.length === 0) {
            this.log('Build validation passed!', 'success');
            return true;
        } else {
            this.log('Build validation failed. Please fix errors before building.', 'error');
            return false;
        }
    }
}

// Run validation
if (require.main === module) {
    const checker = new BuildChecker();
    checker.runAllChecks().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = BuildChecker;