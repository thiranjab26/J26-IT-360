import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing <div id="root">');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
