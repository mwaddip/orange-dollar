import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletConnectProvider } from '@btc-vision/walletconnect';
import { ProtocolProvider } from './context/ProtocolContext';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletConnectProvider theme="dark">
      <ProtocolProvider>
        <App />
      </ProtocolProvider>
    </WalletConnectProvider>
  </StrictMode>,
);
