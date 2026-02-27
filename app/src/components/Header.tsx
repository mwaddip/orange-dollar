import { NETWORKS } from '../config';
import { useProtocol } from '../context/ProtocolContext';
import { WalletButton } from './WalletButton';

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = ['Trade', 'Dashboard', 'Admin'];

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const { networkConfig, setNetworkName } = useProtocol();

  return (
    <header className="header">
      <div className="header-left">
        <span className="logo">OD</span>
        <nav className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
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
