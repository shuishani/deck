import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from './components/AuthGate'
import { ToastProvider } from './components/Toast'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  </StrictMode>,
)
