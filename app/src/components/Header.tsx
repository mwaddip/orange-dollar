import { NETWORKS } from '../config';
import { useProtocol } from '../context/ProtocolContext';
import { WalletButton } from './WalletButton';

export function Header() {
  const { networkConfig, setNetworkName } = useProtocol();

  return (
    <header className="header">
      <div className="header-left">
        <a href="#" className="logo">OD</a>
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
