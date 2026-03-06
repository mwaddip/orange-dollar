export function OfflineDownload() {
  return (
    <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
      <p style={{ marginBottom: 8 }}>
        <strong>Run offline?</strong>{' '}
        <a
          href="/ceremony-offline.html"
          download="ceremony-offline.html"
          style={{ color: 'var(--orange)' }}
        >
          Download the standalone ceremony page
        </a>
      </p>
      <p style={{ fontSize: 12, color: 'var(--gray-light)', margin: 0 }}>
        Verify the build, then run from your local machine without trusting this server.
      </p>
    </div>
  );
}
