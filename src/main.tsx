/**
 * Main entry point for optimized TropX Motion Capture System
 * Initializes all performance-critical components and systems
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import OptimizedMotionApp from './components/OptimizedMotionApp';
import { systemIntegration } from './integration/SystemIntegration';
import { PERFORMANCE_CONSTANTS } from './core/constants';
import './main.css';

/**
 * Application initialization with performance optimizations
 */
class ApplicationInitializer {
  private static instance: ApplicationInitializer | null = null;
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): ApplicationInitializer {
    if (!ApplicationInitializer.instance) {
      ApplicationInitializer.instance = new ApplicationInitializer();
    }
    return ApplicationInitializer.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('Application already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing TropX Motion Capture System...');
      
      // Performance optimizations
      this.setupPerformanceOptimizations();
      
      // Initialize core systems
      await this.initializeCoreComponents();
      
      // Render React application
      this.renderApplication();
      
      this.isInitialized = true;
      console.log('✅ TropX Motion Capture System initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
      this.handleInitializationError(error);
    }
  }

  private setupPerformanceOptimizations(): void {
    console.log('⚡ Setting up performance optimizations...');

    // Prevent default drag and drop behavior
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    // Disable right-click context menu in production
    if (import.meta.env.PROD) {
      document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Setup error boundary for React errors
    window.addEventListener('error', this.handleGlobalError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);

    // Memory management - force garbage collection periodically
    if ('gc' in window) {
      setInterval(() => {
        try {
          (window as any).gc();
        } catch (error) {
          // Garbage collection not available in this environment
        }
      }, PERFORMANCE_CONSTANTS.GC_PREVENTION_INTERVAL_MS);
    }

    // Optimize scrolling performance
    document.body.style.scrollBehavior = 'smooth';

    // Prevent text selection for better UX
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    console.log('✅ Performance optimizations configured');
  }

  private async initializeCoreComponents(): Promise<void> {
    console.log('🔧 Initializing core components...');
    
    try {
      // Initialize system integration layer
      await systemIntegration.initialize();
      console.log('✅ System integration initialized');

      // Setup cleanup handlers
      this.setupCleanupHandlers();
      
      console.log('✅ Core components initialized');
      
    } catch (error) {
      console.error('❌ Core component initialization failed:', error);
      throw error;
    }
  }

  private renderApplication(): void {
    console.log('🎨 Rendering React application...');
    
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Root container not found');
    }

    const root = ReactDOM.createRoot(container);
    
    // Render with React.StrictMode in development only
    const AppComponent = import.meta.env.DEV ? (
      <React.StrictMode>
        <OptimizedMotionApp />
      </React.StrictMode>
    ) : (
      <OptimizedMotionApp />
    );

    root.render(AppComponent);
    
    console.log('✅ React application rendered');
  }

  private setupCleanupHandlers(): void {
    const cleanup = () => {
      console.log('🧹 Cleaning up application resources...');
      
      try {
        // Cleanup system integration
        systemIntegration.cleanup();
        
        // Remove event listeners
        window.removeEventListener('error', this.handleGlobalError);
        window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
        
        console.log('✅ Application cleanup completed');
      } catch (error) {
        console.error('❌ Error during cleanup:', error);
      }
    };

    // Cleanup on page unload
    window.addEventListener('beforeunload', cleanup);
    
    // Cleanup on process exit (Electron)
    if (typeof window !== 'undefined' && 'electronAPI' in window) {
      // Electron-specific cleanup
      window.addEventListener('close', cleanup);
    }
  }

  private handleGlobalError = (event: ErrorEvent): void => {
    console.error('Global error caught:', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error
    });

    // In production, you might want to send this to an error reporting service
    if (import.meta.env.PROD) {
      // Example: sendErrorToService(event.error);
    }
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    console.error('Unhandled promise rejection:', event.reason);
    
    // Prevent default handling
    event.preventDefault();

    // In production, you might want to send this to an error reporting service
    if (import.meta.env.PROD) {
      // Example: sendErrorToService(event.reason);
    }
  };

  private handleInitializationError(error: unknown): void {
    console.error('Application initialization failed:', error);
    
    // Show error message to user
    const container = document.getElementById('root');
    if (container) {
      container.innerHTML = `
        <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          color: #333;
          text-align: center;
          padding: 2rem;
        ">
          <div style="
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            max-width: 500px;
          ">
            <div style="
              width: 64px;
              height: 64px;
              background: #ef4444;
              border-radius: 50%;
              margin: 0 auto 1rem;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 32px;
              color: white;
            ">⚠</div>
            
            <h1 style="margin: 0 0 1rem 0; font-size: 1.5rem; color: #1f2937;">
              Initialization Failed
            </h1>
            
            <p style="margin: 0 0 1rem 0; color: #6b7280; line-height: 1.5;">
              The TropX Motion Capture System failed to initialize properly. 
              Please check the console for detailed error information.
            </p>
            
            <button onclick="window.location.reload()" style="
              background: #3b82f6;
              color: white;
              border: none;
              padding: 0.75rem 1.5rem;
              border-radius: 6px;
              cursor: pointer;
              font-size: 0.875rem;
              font-weight: 500;
              transition: background-color 0.2s;
            " onmouseover="this.style.background='#2563eb'" 
               onmouseout="this.style.background='#3b82f6'">
              Retry Initialization
            </button>
          </div>
        </div>
      `;
    }
  }
}

/**
 * Application startup
 */
async function startApplication(): Promise<void> {
  console.log('🎯 Starting TropX Motion Capture System...');
  
  try {
    const initializer = ApplicationInitializer.getInstance();
    await initializer.initialize();
  } catch (error) {
    console.error('❌ Application startup failed:', error);
  }
}

// Performance tracking
const startTime = performance.now();

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    startApplication().then(() => {
      const loadTime = performance.now() - startTime;
      console.log(`🎯 Application loaded in ${loadTime.toFixed(2)}ms`);
    });
  });
} else {
  // DOM is already ready
  startApplication().then(() => {
    const loadTime = performance.now() - startTime;
    console.log(`🎯 Application loaded in ${loadTime.toFixed(2)}ms`);
  });
}

// Export for debugging purposes
if (import.meta.env.DEV) {
  (window as any).__TROPX_DEBUG__ = {
    systemIntegration,
    ApplicationInitializer,
    PERFORMANCE_CONSTANTS
  };
}