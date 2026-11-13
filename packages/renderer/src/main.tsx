import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initBackend } from './backend';

// Initialize dual BackendAdapter (Electron / Tauri v2) before React mounts
initBackend();

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
