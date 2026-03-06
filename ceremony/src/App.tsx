import { DKGWizard } from './components/DKGWizard';
import { OfflineDownload } from './components/OfflineDownload';
import './styles/ceremony.css';

export function App() {
  return (
    <>
      <DKGWizard />
      <OfflineDownload />
    </>
  );
}
