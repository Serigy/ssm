import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@ssm/ui-kit';
import '@ssm/ui-kit/styles.css';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root ausente no index.html');

createRoot(container).render(
  <StrictMode>
    {/*
      One BrowserRouter for the whole application, declared here in the host.
      Remotes consume it through the shared react-router-dom singleton rather
      than creating their own — otherwise each module would keep a separate
      history stack and the back button would skip screens.
    */}
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
