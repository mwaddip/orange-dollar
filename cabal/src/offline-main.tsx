import './styles/global.css';
import './styles/admin.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OfflineSigner } from './components/OfflineSigner';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OfflineSigner />
  </StrictMode>,
);
