import { WalletPanel } from "@/components/wallet-panel";
import { BrandMark } from "@/components/brand-mark";

export default function Home() {
  return (
    <main className="page-shell">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="UNGRANT home"><BrandMark className="brand-mark" /> <span>UNGRANT</span></a>
        <div className="chain-badge"><span aria-hidden="true" /> ROBINHOOD CHAIN ONLY</div>
      </header>

      <div className="main-content" id="top">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow"><span /> YOUR TOKENS. YOUR PERMISSIONS.</p>
          <h1 id="hero-title">Take back<br />your <em>approvals.</em></h1>
          <p className="hero-copy">UNGRANT helps you review and revoke ERC-20 token allowances on Robinhood Chain. Connect your wallet to get started.</p>
          <div className="hero-meta"><span className="meta-rule" /> BUILT FOR SELF CUSTODY <span className="meta-separator">/</span> CHAIN ID 4663</div>
        </section>

        <WalletPanel />
      </div>

      <footer className="site-footer">
        <span>UNGRANT <span className="footer-dot">·</span> A CLEARER VIEW OF YOUR ONCHAIN PERMISSIONS</span>
        <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">ROBINHOOD CHAIN EXPLORER <span aria-hidden="true">↗</span></a>
      </footer>
    </main>
  );
}
