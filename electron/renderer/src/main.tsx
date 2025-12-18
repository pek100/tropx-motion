import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { ThemeProvider } from './components/theme-provider'
import { Toaster } from './components/ui/toaster'
import { ConvexClientProvider } from './lib/convex'
import { RoleSelectionModal } from './components/auth'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexClientProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="tropx-ui-theme">
        <App />
        <RoleSelectionModal />
        <Toaster />
      </ThemeProvider>
    </ConvexClientProvider>
  </React.StrictMode>,
)
