// Performance monitoring service for WebSocket streaming
export class PerformanceMonitor {
  private metrics = {
    messagesSent: 0,
    messagesPerSecond: 0,
    bytesTransferred: 0,
    binaryMessages: 0,
    jsonMessages: 0,
    batchedMessages: 0,
    averageLatency: 0,
    memoryUsage: 0,
    connectedClients: 0
  };

  private lastMetricsTime = Date.now();
  private lastMessageCount = 0;
  private latencyMeasurements: number[] = [];

  // Record message sent
  recordMessage(size: number, isBinary: boolean, isBatched: boolean): void {
    this.metrics.messagesSent++;
    this.metrics.bytesTransferred += size;
    
    if (isBinary) {
      this.metrics.binaryMessages++;
    } else {
      this.metrics.jsonMessages++;
    }
    
    if (isBatched) {
      this.metrics.batchedMessages++;
    }
  }

  // Record latency measurement
  recordLatency(latency: number): void {
    this.latencyMeasurements.push(latency);
    
    // Keep only last 100 measurements
    if (this.latencyMeasurements.length > 100) {
      this.latencyMeasurements.shift();
    }
    
    this.metrics.averageLatency = 
      this.latencyMeasurements.reduce((a, b) => a + b, 0) / this.latencyMeasurements.length;
  }

  // Update client count
  updateClientCount(count: number): void {
    this.metrics.connectedClients = count;
  }

  // Calculate messages per second
  updateMessagesPerSecond(): void {
    const now = Date.now();
    const timeDiff = (now - this.lastMetricsTime) / 1000;
    
    if (timeDiff >= 1) { // Update every second
      const messageDiff = this.metrics.messagesSent - this.lastMessageCount;
      this.metrics.messagesPerSecond = Math.round(messageDiff / timeDiff);
      
      this.lastMetricsTime = now;
      this.lastMessageCount = this.metrics.messagesSent;
    }
  }

  // Update memory usage
  updateMemoryUsage(): void {
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage = Math.round(memUsage.rss / 1024 / 1024); // MB
  }

  // Get current performance metrics
  getMetrics(): typeof this.metrics {
    this.updateMessagesPerSecond();
    this.updateMemoryUsage();
    return { ...this.metrics };
  }

  // Get performance summary for logging
  getSummary(): string {
    const metrics = this.getMetrics();
    return `Performance: ${metrics.messagesPerSecond} msg/s, ` +
           `${metrics.bytesTransferred} bytes, ` +
           `${metrics.connectedClients} clients, ` +
           `${metrics.averageLatency.toFixed(1)}ms latency, ` +
           `${metrics.memoryUsage}MB RAM ` +
           `(Binary: ${metrics.binaryMessages}, Batched: ${metrics.batchedMessages})`;
  }

  // Reset all metrics
  reset(): void {
    this.metrics = {
      messagesSent: 0,
      messagesPerSecond: 0,
      bytesTransferred: 0,
      binaryMessages: 0,
      jsonMessages: 0,
      batchedMessages: 0,
      averageLatency: 0,
      memoryUsage: 0,
      connectedClients: 0
    };
    this.lastMetricsTime = Date.now();
    this.lastMessageCount = 0;
    this.latencyMeasurements = [];
  }
}