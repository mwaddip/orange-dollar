import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletConnectProvider } from '@btc-vision/walletconnect';
import { ProtocolProvider } from './context/ProtocolContext';
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/Toast';
import { App } from './App';
import { loadNetworks } from './config';

const root = createRoot(document.getElementById('root')!);

loadNetworks()
  .then((networks) => {
    root.render(
      <StrictMode>
        <WalletConnectProvider theme="dark">
          <ProtocolProvider networks={networks}>
            <ToastProvider>
              <App />
              <ToastContainer />
            </ToastProvider>
          </ProtocolProvider>
        </WalletConnectProvider>
      </StrictMode>,
    );
  })
  .catch((err) => {
    root.render(
      <div style={{ padding: 32, color: '#f55', fontFamily: 'monospace' }}>
        Failed to load config: {String(err)}
      </div>,
    );
  });
