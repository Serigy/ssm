/**
 * Standalone development entry. See libs/mfe-runtime/src/standalone.tsx for
 * what the stub host fakes and what it deliberately does not.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@ssm/ui-kit/styles.css';
import { Standalone } from './standalone.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root ausente no index.html');

createRoot(container).render(
  <StrictMode>
    <Standalone />
  </StrictMode>,
);
