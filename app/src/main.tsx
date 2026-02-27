import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletConnectProvider } from '@btc-vision/walletconnect';
import { ProtocolProvider } from './context/ProtocolContext';
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/Toast';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletConnectProvider theme="dark">
      <ProtocolProvider>
        <ToastProvider>
          <App />
          <ToastContainer />
        </ToastProvider>
      </ProtocolProvider>
    </WalletConnectProvider>
  </StrictMode>,
);
