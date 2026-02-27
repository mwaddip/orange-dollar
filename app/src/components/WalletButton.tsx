import { useEffect } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { useProtocol } from '../context/ProtocolContext';

function truncateAddress(addr: string): string {
  if (addr.length <= 13) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const { openConnectModal, disconnect, walletAddress, connecting } =
    useWalletConnect();
  const { setConnectedAddress } = useProtocol();

  // Bridge wallet address into ProtocolContext
  useEffect(() => {
    setConnectedAddress(walletAddress ?? null);
  }, [walletAddress, setConnectedAddress]);

  if (connecting) {
    return (
      <button className="wallet-btn" disabled>
        Connecting...
      </button>
    );
  }

  if (walletAddress) {
    return (
      <button className="wallet-btn connected" onClick={disconnect}>
        {truncateAddress(walletAddress)}
      </button>
    );
  }

  return (
    <button className="wallet-btn" onClick={openConnectModal}>
      Connect Wallet
    </button>
  );
}
