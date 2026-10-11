import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './pdf/pdfWorker';
import './styles/global.css';
import './styles/components.css';
import './styles/library.css';
import './styles/reader.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
