import { createServer } from 'net';

const PORT_RANGE = {
  START: 8080,
  SCAN_COUNT: 50,
} as const;

export interface PortDiscoveryResult {
  port: number;
  available: boolean;
  error?: string;
}

export class PortDiscovery {
  // Find first available port starting from base port
  static async findAvailablePort(startPort: number = PORT_RANGE.START): Promise<number> {
    for (let port = startPort; port < startPort + PORT_RANGE.SCAN_COUNT; port++) {
      const result = await this.checkPort(port);
      if (result.available) return port;
    }

    throw new Error(`No available ports found in range ${startPort}-${startPort + PORT_RANGE.SCAN_COUNT - 1}`);
  }

  // Check if specific port is available
  static async checkPort(port: number): Promise<PortDiscoveryResult> {
    return new Promise((resolve) => {
      const server = createServer();

      const onError = (error: NodeJS.ErrnoException) => {
        server.removeAllListeners();
        resolve({
          port,
          available: false,
          error: error.code === 'EADDRINUSE' ? 'Port in use' : error.message
        });
      };

      const onListening = () => {
        server.close(() => {
          server.removeAllListeners();
          resolve({ port, available: true });
        });
      };

      server.once('error', onError);
      server.once('listening', onListening);

      server.listen(port, 'localhost');
    });
  }

  // Get multiple available ports
  static async getAvailablePorts(count: number, startPort: number = PORT_RANGE.START): Promise<number[]> {
    const ports: number[] = [];
    let currentPort = startPort;

    while (ports.length < count && currentPort < startPort + PORT_RANGE.SCAN_COUNT) {
      const result = await this.checkPort(currentPort);
      if (result.available) ports.push(currentPort);
      currentPort++;
    }

    if (ports.length < count) {
      throw new Error(`Only found ${ports.length} available ports out of ${count} requested`);
    }

    return ports;
  }

  // Validate port number
  static isValidPort(port: number): boolean {
    return Number.isInteger(port) && port >= 1024 && port <= 65535;
  }
}