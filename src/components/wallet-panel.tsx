"use client";

import { useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { robinhoodChain } from "@/config/chain";
import { AllowanceDiscovery } from "@/components/allowance-discovery";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletPanel() {
  const account = useAccount();
  const { connectors, connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>();
  const connector = useMemo(
    () => connectors.find((item) => item.id === selectedConnectorId) ?? connectors[0],
    [connectors, selectedConnectorId],
  );
  const connected = account.status === "connected";
  const correctNetwork = connected && account.chainId === robinhoodChain.id;
  const canSwitch = connected && account.connector?.switchChain !== undefined;
  const error = connectError ?? switchError;

  return (
    <>
      <section className="wallet-panel" aria-labelledby="wallet-heading">
        <div className="panel-topline">
          <span id="wallet-heading">WALLET CONNECTION</span>
          <span className={`connection-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />
        </div>

      {!connected ? (
        <>
          <p className="panel-title">Start with your wallet.</p>
          <p className="panel-copy">Connect an EVM wallet to continue. Your wallet stays in your control.</p>
          {connectors.length > 1 && (
            <label className="connector-label">
              Wallet
              <select
                value={connector?.id ?? ""}
                onChange={(event) => setSelectedConnectorId(event.target.value)}
                aria-label="Choose wallet connector"
              >
                {connectors.map((item) => <option key={item.uid} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={!connector || isConnecting}
            onClick={() => connector && connect({ connector })}
          >
            {isConnecting ? "Connecting…" : "Connect wallet"}<span aria-hidden="true">↗</span>
          </button>
          <StatusRow label="Network" value="Connect a wallet to check" tone="muted" />
        </>
      ) : (
        <>
          <p className="panel-title">Wallet connected</p>
          <div className="address-box">
            <span className="address-icon" aria-hidden="true">◈</span>
            <span className="address-value">{account.address ? shortAddress(account.address) : "Address unavailable"}</span>
            <span className="address-full">{account.address}</span>
          </div>
          <StatusRow label="Connected wallet" value={account.connector?.name ?? "EVM wallet"} tone="good" />
          <StatusRow
            label="Active network"
            value={correctNetwork ? "Robinhood Chain" : account.chain?.name ?? `Chain ${account.chainId}`}
            tone={correctNetwork ? "good" : "warning"}
          />
          {correctNetwork ? (
            <p className="network-note"><span aria-hidden="true">✓</span> Ready on Robinhood Chain</p>
          ) : (
            <div className="network-alert" role="status">
              <p>This wallet is on an unsupported network. UNGRANT works only on Robinhood Chain.</p>
              {canSwitch ? (
                <button
                  className="switch-button"
                  type="button"
                  disabled={isSwitching}
                  onClick={() => switchChain({ chainId: robinhoodChain.id })}
                >
                  {isSwitching ? "Switching…" : "Switch to Robinhood Chain"}<span aria-hidden="true">→</span>
                </button>
              ) : <p className="switch-hint">Switch networks in your wallet, then return here.</p>}
            </div>
          )}
          <button className="disconnect-button" type="button" onClick={() => disconnect()}>
            Disconnect wallet
          </button>
        </>
      )}

        {error && <p className="wallet-error" role="alert">{error.message}</p>}
        <p className="panel-footnote">Reads are read-only. A transaction is requested only when you confirm one allowance revocation.</p>
      </section>
      <AllowanceDiscovery connectedAddress={connected ? account.address : undefined} supportedNetwork={correctNetwork} />
    </>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: "good" | "warning" | "muted" }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <span className={`status-value status-${tone}`}><i aria-hidden="true" />{value}</span>
    </div>
  );
}
