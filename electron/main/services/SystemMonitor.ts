import { app, BrowserWindow } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as v8 from 'v8';

export interface SystemSample {
  timestamp: string;
  system: {
    platform: NodeJS.Platform;
    arch: string;
    totalMem: number;
    freeMem: number;
    loadAvg: number[];
    uptimeSec: number;
  };
  mainProcess: {
    pid: number;
    memoryUsage: NodeJS.MemoryUsage;
    heapStats: v8.HeapInfo;
    processMemoryInfo?: Electron.ProcessMemoryInfo;
  };
  rendererPid?: number;
  appMetrics?: Electron.ProcessMetric[];
}

export type MonitorOptions = {
  intervalMs?: number; // default 10000
  logToConsole?: boolean; // default true
  logToFile?: boolean; // default true
  maxSamplesInMemory?: number; // default 300
};

export class SystemMonitor {
  private winProvider: () => BrowserWindow | null;
  private timer: NodeJS.Timeout | null = null;
  private options: Required<MonitorOptions>;
  private samples: SystemSample[] = []; // Use pre-allocated circular array
  private writeIndex: number = 0;
  private sampleCount: number = 0;
  private logStream: fs.WriteStream | null = null;

  constructor(winProvider: () => BrowserWindow | null, opts: MonitorOptions = {}) {
    this.winProvider = winProvider;
    this.options = {
      intervalMs: opts.intervalMs ?? 10000,
      logToConsole: opts.logToConsole ?? true,
      logToFile: opts.logToFile ?? true,
      maxSamplesInMemory: opts.maxSamplesInMemory ?? 300,
    };

    // Pre-allocate array for circular buffer behavior
    this.samples = new Array(this.options.maxSamplesInMemory);
  }

  start() {
    if (this.timer) return; // already running
    if (this.options.logToFile && !this.logStream) {
      try {
        const logDir = app.getPath('userData');
        const logPath = path.join(logDir, 'perf.log');
        this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
        this.logStream.write(`\n# SystemMonitor started ${new Date().toISOString()}\n`);
      } catch (e) {
        // If file logging fails, disable file logging
        this.logStream = null;
        this.options.logToFile = false as any; // keep running without file logging
        // eslint-disable-next-line no-console
        console.warn('SystemMonitor: failed to open log file:', e);
      }
    }

    // Take an immediate sample, then at interval
    void this.sampleAndLog();
    this.timer = setInterval(() => {
      void this.sampleAndLog();
    }, this.options.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.logStream) {
      this.logStream.write(`# SystemMonitor stopped ${new Date().toISOString()}\n`);
      this.logStream.end();
      this.logStream = null;
    }
  }

  setIntervalMs(ms: number) {
    this.options.intervalMs = Math.max(1000, ms);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.sampleAndLog(), this.options.intervalMs);
    }
  }

  isRunning() {
    return !!this.timer;
  }

  getRecentSamples(limit = 100): SystemSample[] {
    if (limit <= 0 || this.sampleCount === 0) return [];

    const result: SystemSample[] = [];
    const actualLimit = Math.min(limit, this.sampleCount);

    // Calculate starting position in circular buffer
    const startOffset = Math.max(0, this.sampleCount - actualLimit);

    for (let i = 0; i < actualLimit; i++) {
      const index = (startOffset + i) % this.samples.length;
      if (this.samples[index]) {
        result.push(this.samples[index]);
      }
    }

    return result;
  }

  async getSnapshot(): Promise<SystemSample> {
    return await this.collectSample();
  }

  private async sampleAndLog() {
    try {
      const sample = await this.collectSample();

      // PERFORMANCE CRITICAL: O(1) circular buffer write - never blocks!
      this.samples[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.samples.length;
      this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length);

      if (this.options.logToConsole) {
        const rendererPid = sample.rendererPid ? `, rendererPid=${sample.rendererPid}` : '';
        const rssMB = (sample.mainProcess.memoryUsage.rss / (1024 * 1024)).toFixed(1);
        const heapMB = (sample.mainProcess.memoryUsage.heapUsed / (1024 * 1024)).toFixed(1);
        // eslint-disable-next-line no-console
        console.info(`Perf: rss=${rssMB}MB, heap=${heapMB}MB${rendererPid}`);

        if (sample.appMetrics) {
          // Summarize per-process memory for relevant process types
          const typesToShow: Electron.ProcessMetric['type'][] = ['Browser', 'Tab', 'GPU'];
          const summary = sample.appMetrics
            .filter(m => typesToShow.includes(m.type))
            .map(m => {
              const mem = m.memory ? (m.memory.workingSetSize / (1024 * 1024)).toFixed(1) : 'n/a';
              const cpu = m.cpu ? (m.cpu.percentCPUUsage).toFixed(1) : 'n/a';
              return `${m.type}[pid=${m.pid}] mem=${mem}MB cpu=${cpu}%`;
            })
            .join(' | ');
          if (summary) {
            // eslint-disable-next-line no-console
            console.info(`AppMetrics: ${summary}`);
          }
        }
      }

      if (this.options.logToFile && this.logStream) {
        this.logStream.write(JSON.stringify(sample) + '\n');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('SystemMonitor sample failed:', e);
    }
  }

  private async collectSample(): Promise<SystemSample> {
    const renderer = this.winProvider()?.webContents;
    let rendererPid: number | undefined;
    try {
      rendererPid = renderer?.getOSProcessId();
    } catch {}

    const [processMemoryInfo, appMetrics] = await Promise.allSettled([
      process.getProcessMemoryInfo(),
      Promise.resolve().then(() => app.getAppMetrics()),
    ]);

    const sample: SystemSample = {
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        totalMem: os.totalmem(),
        freeMem: os.freemem(),
        loadAvg: os.loadavg(),
        uptimeSec: os.uptime(),
      },
      mainProcess: {
        pid: process.pid,
        memoryUsage: process.memoryUsage(),
        heapStats: v8.getHeapStatistics(),
        processMemoryInfo: processMemoryInfo.status === 'fulfilled' ? processMemoryInfo.value : undefined,
      },
      rendererPid,
      appMetrics: appMetrics.status === 'fulfilled' ? appMetrics.value : undefined,
    };
    return sample;
  }
}
