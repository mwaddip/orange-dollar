import { NETWORKS } from '../config';
import { useProtocol } from '../context/ProtocolContext';
import { WalletButton } from './WalletButton';

export function Header() {
  const { networkConfig, setNetworkName } = useProtocol();

  return (
    <header className="header">
      <div className="header-left">
        <a href="#" className="logo">
          <svg className="logo-coin" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <circle cx="256" cy="256" r="224" fill="#F7931A" />
            <circle className="logo-ring" cx="256" cy="256" r="170" fill="none" stroke="#F5F7FA" strokeWidth="20" strokeLinecap="round" strokeDasharray="103.5177 30" strokeDashoffset="118.5177" />
            <rect x="156" y="244" width="200" height="24" rx="12" fill="#F5F7FA" />
            <circle cx="256" cy="256" r="20" fill="#F5F7FA" />
          </svg>
          <span className="logo-text">Orange <span className="logo-accent">Dollar</span></span>
        </a>
      </div>
      <div className="header-right">
        <select
          className="network-select"
          value={networkConfig.name}
          onChange={(e) => setNetworkName(e.target.value)}
        >
          {Object.values(NETWORKS).map((net) => (
            <option key={net.name} value={net.name}>
              {net.label}
            </option>
          ))}
        </select>
        <WalletButton />
      </div>
    </header>
  );
}
