export function OfflineDownload() {
  return (
    <div
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '0 24px 32px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid rgba(237, 239, 242, 0.06)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
        }}
      >
        <p style={{ marginBottom: 8 }}>
          <strong>Run offline?</strong>{' '}
          <a
            href="/permafrost-signer.html"
            download="permafrost-signer.html"
            style={{ color: 'var(--orange)' }}
          >
            Download the standalone signer page
          </a>
        </p>
        <p style={{ fontSize: 12, color: 'var(--gray-light)', margin: 0 }}>
          Verify the build, then run from your local machine without trusting this server.
        </p>
      </div>
    </div>
  );
}
