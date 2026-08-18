/**
 * Standalone development entry.
 *
 * Running a remote on its own is the only way to work on it without starting
 * the whole platform. It mounts the same Root the shell would, wrapped in a
 * stub host — see standalone.tsx for what that stub does and does not fake.
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
