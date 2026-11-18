"use client";

import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { getAccount, waitForTransactionReceipt } from "wagmi/actions";
import { robinhoodChain } from "@/config/chain";
import { formatAllowance, parseOwnerAddress, scanAllowances, TOKEN_ABI, type AllowanceRow, type ScanFailure } from "@/lib/allowance-scan";
import { wagmiConfig } from "@/lib/wagmi";

type ScanState = "idle" | "scanning" | "complete" | "error";
type RevokeStatus = "confirm" | "checking" | "writing" | "confirming" | "success" | "already-zero" | "failed";
const approveAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function describeFailure(failure: ScanFailure) {
  const range = failure.fromBlock !== undefined ? `Blocks ${failure.fromBlock.toString()}–${failure.toBlock?.toString()}: ` : "";
  const subject = failure.subject ? `${failure.subject}: ` : "";
  return `${range}${subject}${failure.message}`;
}

export function AllowanceDiscovery({ connectedAddress, supportedNetwork }: { connectedAddress?: string; supportedNetwork: boolean }) {
  const client = usePublicClient({ chainId: robinhoodChain.id });
  const [addressInput, setAddressInput] = useState(connectedAddress ?? "");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [rows, setRows] = useState<AllowanceRow[]>([]);
  const [resultOwner, setResultOwner] = useState<Address>();
  const [selectedRow, setSelectedRow] = useState<AllowanceRow>();
  const [revokeStatus, setRevokeStatus] = useState<RevokeStatus>();
  const [revokeError, setRevokeError] = useState("");
  const [transactionHash, setTransactionHash] = useState<Hash>();
  const [transactionPairKey, setTransactionPairKey] = useState("");
  const [previousTransactionHash, setPreviousTransactionHash] = useState<Hash>();
  const [attemptAddress, setAttemptAddress] = useState<Address>();
  const [failures, setFailures] = useState<ScanFailure[]>([]);
  const [scanRange, setScanRange] = useState<{ from: bigint; to: bigint }>();
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [verificationProgress, setVerificationProgress] = useState({ completed: 0, total: 0 });
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [error, setError] = useState("");
  const [hasScanned, setHasScanned] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState("");
  const confirmationRef = useRef<HTMLElement>(null);
  const revokeLock = useRef(false);
  const account = useAccount();
  const { writeContractAsync } = useWriteContract();

  const owner = parseOwnerAddress(addressInput);
  const isConnectedAddress = !!connectedAddress && owner?.toLowerCase() === connectedAddress.toLowerCase();
  const writeInProgress = revokeStatus === "checking" || revokeStatus === "writing" || revokeStatus === "confirming";
  const canScan = !!client && !!owner && (!connectedAddress || supportedNetwork) && scanState !== "scanning" && !writeInProgress;

  async function runScan(targetOwner?: Address, preserveRevokeContext = false): Promise<boolean> {
    const scanOwner = targetOwner ?? owner;
    if (!scanOwner || !client || (connectedAddress && !supportedNetwork) || writeInProgress) return false;
    if (targetOwner) setAddressInput(targetOwner);
    if (!preserveRevokeContext) {
      setSelectedRow(undefined);
      setRevokeStatus(undefined);
      setRevokeError("");
      setTransactionHash(undefined);
      setTransactionPairKey("");
      setPreviousTransactionHash(undefined);
    }
    setScanState("scanning");
    setError("");
    setRefreshNotice("");
    setRows([]);
    setResultOwner(scanOwner);
    setFailures([]);
    setScanRange(undefined);
    setProgress({ completed: 0, total: 0 });
    setVerificationProgress({ completed: 0, total: 0 });
    setDiscoveredCount(0);
    setLimitReached(false);
    setHasScanned(true);
    try {
      const result = await scanAllowances({
        client,
        owner: scanOwner,
        onProgress: (completed, total) => {
          setProgress({ completed, total });
        },
        onVerificationProgress: (completed, total) => setVerificationProgress({ completed, total }),
      });
      setRows(result.rows);
      setFailures(result.failures);
      setScanRange({ from: result.fromBlock, to: result.toBlock });
      setProgress({ completed: result.checkedChunks, total: result.totalChunks });
      setDiscoveredCount(result.discoveredPairs);
      setLimitReached(result.limitReached);
      setScanState("complete");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setScanState("error");
      return false;
    }
  }

  const activeWrite = writeInProgress;
  const mayRevokeOwner = !!resultOwner && !!connectedAddress && account.status === "connected" && !!account.address &&
    resultOwner.toLowerCase() === connectedAddress.toLowerCase() && resultOwner.toLowerCase() === account.address.toLowerCase();
  const revokeReady = mayRevokeOwner && supportedNetwork && account.chainId === robinhoodChain.id;
  const walletChangedDuringAttempt = activeWrite && !!attemptAddress && (
    account.status !== "connected" || account.address?.toLowerCase() !== attemptAddress.toLowerCase() || account.chainId !== robinhoodChain.id
  );

  useEffect(() => {
    if (selectedRow && revokeStatus === "confirm") confirmationRef.current?.focus();
  }, [selectedRow, revokeStatus]);

  function askToRevoke(row: AllowanceRow) {
    if (!revokeReady || !resultOwner || scanState !== "complete") return;
    setSelectedRow(row);
    setRevokeStatus("confirm");
    setRevokeError("");
    const nextPairKey = `${row.token.toLowerCase()}:${row.spender.toLowerCase()}`;
    if (transactionHash && transactionPairKey === nextPairKey) setPreviousTransactionHash(transactionHash);
    else setPreviousTransactionHash(undefined);
    setTransactionHash(undefined);
    setTransactionPairKey("");
    setAttemptAddress(undefined);
  }

  async function refreshAfterChange(scanOwner: Address, message: string) {
    const refreshed = await runScan(scanOwner, true);
    setRefreshNotice(refreshed ? message : `${message} The refresh scan could not complete; see the scan error above.`);
  }

  async function confirmRevoke() {
    if (revokeLock.current || revokeStatus !== "confirm" || scanState !== "complete" || !selectedRow || !resultOwner || !client) return;
    revokeLock.current = true;
    let submittedHash: Hash | undefined;
    let writeStarted = false;
    setRevokeStatus("checking");
    setRevokeError("");
    const selectedPairKey = `${selectedRow.token.toLowerCase()}:${selectedRow.spender.toLowerCase()}`;
    if (transactionHash && transactionPairKey === selectedPairKey) setPreviousTransactionHash(transactionHash);
    setTransactionHash(undefined);
    setTransactionPairKey("");
    try {
      const beforeRead = getAccount(wagmiConfig);
      assertRevokeContext(beforeRead, resultOwner);
      setAttemptAddress(beforeRead.address);

      const freshAllowance = await client.readContract({
        address: selectedRow.token,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [resultOwner, selectedRow.spender],
      });
      const beforeWrite = getAccount(wagmiConfig);
      assertRevokeContext(beforeWrite, resultOwner);
      if (freshAllowance === BigInt(0)) {
        setRevokeStatus("already-zero");
        setRevokeError("This token/spender allowance is already zero. No transaction was submitted.");
        await refreshAfterChange(resultOwner, "Refreshed the scan because the allowance was already zero.");
        return;
      }

      setRevokeStatus("writing");
      writeStarted = true;
      const hash = await writeContractAsync({
        address: selectedRow.token,
        abi: approveAbi,
        functionName: "approve",
        args: [selectedRow.spender, BigInt(0)],
        account: beforeWrite.address,
        chainId: robinhoodChain.id,
      });
      submittedHash = hash;
      setTransactionHash(hash);
      setTransactionPairKey(selectedPairKey);
      setRevokeStatus("confirming");

      const receipt = await waitForTransactionReceipt(wagmiConfig, { chainId: robinhoodChain.id, hash });
      if (receipt.status !== "success") {
        throw new Error("The transaction was mined but reverted. No retry was attempted.");
      }

      const transaction = await client.getTransaction({ hash });
      const expectedInput = encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [selectedRow.spender, BigInt(0)] });
      if (
        transaction.from.toLowerCase() !== resultOwner.toLowerCase() ||
        transaction.to?.toLowerCase() !== selectedRow.token.toLowerCase() ||
        transaction.input.toLowerCase() !== expectedInput.toLowerCase() ||
        (transaction.chainId !== null && transaction.chainId !== robinhoodChain.id)
      ) {
        throw new Error("The mined transaction does not match the selected owner, token, spender, and zero-approval call. Review its explorer record before taking further action.");
      }

      setRevokeStatus("success");
      await refreshAfterChange(resultOwner, "Revocation confirmed for this token/spender pair. Refreshed the bounded scan; it is still not exhaustive.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const reverted = message.includes("transaction was mined but reverted");
      setRevokeError(submittedHash && !reverted
        ? `${message} The transaction may already have been submitted. Review its explorer record and current allowance before starting another attempt.`
        : writeStarted && !submittedHash
          ? `${message} If your wallet showed a submission, check its activity before starting another attempt.`
          : message);
      setRevokeStatus("failed");
    } finally {
      revokeLock.current = false;
    }
  }

  const incomplete = failures.length > 0 || limitReached;

  return (
    <section className="discovery-section" aria-labelledby="discovery-title">
      <div className="discovery-heading">
        <p className="eyebrow"><span /> READ-ONLY ONCHAIN LOOKUP</p>
        <h2 id="discovery-title">Review allowance exposure.</h2>
        <p className="discovery-copy">Search recent Approval events, then verify each token and spender against the token’s current allowance.</p>
      </div>

      <div className="scan-card">
        <label className="scan-address-label" htmlFor="scan-address">Wallet address</label>
        <div className="scan-controls">
          <input
            id="scan-address"
            className="scan-address-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            placeholder="0x…"
            aria-describedby="scan-address-help"
            aria-invalid={addressInput.length > 0 && !owner}
          />
          <button className="primary-button scan-button" type="button" onClick={() => runScan()} disabled={!canScan}>
            {scanState === "scanning" ? "Scanning…" : "Scan allowances"}<span aria-hidden="true">↗</span>
          </button>
        </div>
        <p id="scan-address-help" className="scan-help">
          {addressInput.length > 0 && !owner ? "Enter a valid EVM address." : isConnectedAddress ? "Connected wallet selected. You can also inspect another public address." : "Read-only inspection of a public wallet address."}
        </p>
        {!supportedNetwork && <p className="scan-blocked" role="status">Switch your wallet to Robinhood Chain before scanning.</p>}
        {!connectedAddress && <p className="scan-help">Paste any wallet address to inspect it using the configured Robinhood Chain RPC.</p>}
        {hasScanned && scanState === "scanning" && (
          <div className="scan-progress" role="status" aria-live="polite">
            <div className="progress-label"><span>{progress.completed < progress.total ? "Reading Approval event chunks" : verificationProgress.total > 0 ? "Verifying current allowances" : "Reading Approval event chunks"}</span><span>{progress.completed}/{progress.total} chunks{verificationProgress.total > 0 ? ` · ${verificationProgress.completed}/${verificationProgress.total} pairs` : ""}</span></div>
            <div className="progress-track" aria-hidden="true"><span style={{ width: `${progress.total ? Math.min(100, (progress.completed / progress.total) * 100) : 0}%` }} /></div>
          </div>
        )}
      </div>

      {error && <p className="scan-error" role="alert">Scan failed: {error}</p>}

      {scanState === "complete" && scanRange && (
        <div className="results-area" aria-live="polite">
          <div className={`result-notice ${incomplete ? "is-incomplete" : ""}`} role="status">
            <strong>{incomplete ? "Partial results — incomplete scan" : "Bounded scan complete"}</strong>
            <span>Checked blocks {scanRange.from.toString()}–{scanRange.to.toString()} for {resultOwner ? shortAddress(resultOwner) : "the selected address"}.</span>
            <span>This covers only the displayed recent range, not the wallet’s full history.</span>
            {limitReached && <span>Stopped after reaching the {300}-pair discovery cap; later logs in range were not checked.</span>}
          </div>

          {failures.length > 0 && (
            <div className="failure-list" role="alert">
              <h3>Failed reads ({failures.length})</h3>
              <ul>{failures.map((failure, index) => <li key={`${failure.stage}-${index}`}>{describeFailure(failure)}</li>)}</ul>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="empty-results">{discoveredCount === 0 ? "No Approval events were found in this block range." : "No nonzero current allowances were verified for the discovered pairs."}</p>
          ) : (
            <>
              <p className="result-count">{rows.length} nonzero current {rows.length === 1 ? "allowance" : "allowances"} · {discoveredCount} unique pairs discovered</p>
              <div className="allowance-list">
                {rows.map((row) => {
                  const { value, unlimited } = formatAllowance(row);
                  const tokenName = row.name || row.symbol || shortAddress(row.token);
                  const shownValue = row.decimals === undefined ? `${value} (raw units)` : formatUnits(row.allowance, row.decimals);
                  return (
                    <article className="allowance-row" key={`${row.token}-${row.spender}`}>
                      <div className="allowance-main">
                        <div>
                          <span className="allowance-label">TOKEN</span>
                          <h3>{tokenName} {row.symbol && row.name && <span className="token-symbol">({row.symbol})</span>}</h3>
                          <a className="address-link" href={`${robinhoodChain.blockExplorers.default.url}/address/${row.token}`} target="_blank" rel="noreferrer">{row.token}</a>
                        </div>
                        <div className="allowance-amount">
                          <span className="allowance-label">CURRENT ALLOWANCE</span>
                          <strong>{shownValue}</strong>
                          {unlimited && <span className="exposure-badge">UNLIMITED EXPOSURE</span>}
                        </div>
                      </div>
                      <div className="spender-line"><span>SPENDER</span><a className="address-link" href={`${robinhoodChain.blockExplorers.default.url}/address/${row.spender}`} target="_blank" rel="noreferrer">{row.spender}</a></div>
                      {mayRevokeOwner && (
                        <div className="row-action">
                          <button
                            className="revoke-button"
                            type="button"
                            disabled={!supportedNetwork || activeWrite || (account.status === "connected" && account.address?.toLowerCase() !== resultOwner?.toLowerCase())}
                            onClick={() => askToRevoke(row)}
                            aria-label={`Revoke ${tokenName} allowance for spender ${row.spender}`}
                          >
                            {activeWrite && selectedRow?.token === row.token && selectedRow.spender === row.spender ? "Revocation pending…" : "Revoke"}
                          </button>
                          {!supportedNetwork && <span className="revoke-hint">Switch to Robinhood Chain to revoke.</span>}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {selectedRow && resultOwner && revokeStatus && (
            <section ref={confirmationRef} className="revoke-confirmation" aria-labelledby="revoke-confirm-title" aria-live="polite" tabIndex={-1}>
              <div className="revoke-confirm-topline">
                <span className="allowance-label">SINGLE ALLOWANCE ACTION</span>
                {!activeWrite && <button type="button" className="confirmation-close" onClick={() => { setSelectedRow(undefined); setRevokeStatus(undefined); }} aria-label="Close revocation details">×</button>}
              </div>
              <h3 id="revoke-confirm-title">{revokeStatus === "confirm" || revokeStatus === "checking" ? "Confirm this revocation" : revokeStatus === "success" ? "Revocation confirmed" : revokeStatus === "already-zero" ? "No transaction needed" : revokeStatus === "failed" ? "Revocation needs review" : "Revocation in progress"}</h3>
              <p>This action applies only to the allowance shown below.</p>
              <dl className="confirmation-details">
                <div><dt>Token</dt><dd>{selectedRow.name || selectedRow.symbol || shortAddress(selectedRow.token)} · {selectedRow.token}</dd></div>
                <div><dt>Spender</dt><dd>{selectedRow.spender}</dd></div>
                <div><dt>Currently displayed allowance</dt><dd>{selectedRow.decimals === undefined ? `${formatAllowance(selectedRow).value} raw units` : formatUnits(selectedRow.allowance, selectedRow.decimals)}{selectedRow.symbol ? ` ${selectedRow.symbol}` : ""}</dd></div>
              </dl>
              {revokeStatus === "confirm" && <p className="confirmation-warning">UNGRANT will re-read this allowance, then request only <code>approve(spender, 0)</code> from your connected wallet. Review the wallet prompt before approving it.</p>}
              {revokeStatus === "checking" && <p role="status">Rechecking your wallet, network, and current allowance…</p>}
              {revokeStatus === "writing" && <p role="status">Waiting for your wallet to submit the exact approval update…</p>}
              {revokeStatus === "confirming" && <p role="status">Transaction submitted. Waiting for the Robinhood Chain receipt…</p>}
              {walletChangedDuringAttempt && <p className="revoke-warning" role="alert">Your wallet account or network changed during this attempt. The submitted transaction is still being checked on Robinhood Chain. Do not submit another attempt until it is reconciled.</p>}
              {revokeError && <p className={revokeStatus === "failed" ? "revoke-error" : "revoke-warning"} role={revokeStatus === "failed" ? "alert" : "status"}>{revokeError}</p>}
              {transactionHash && <p className="transaction-link">Transaction: <a className="address-link" href={`${robinhoodChain.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer">{shortAddress(transactionHash)} ↗</a></p>}
              {previousTransactionHash && <p className="transaction-link">Previous attempt: <a className="address-link" href={`${robinhoodChain.blockExplorers.default.url}/tx/${previousTransactionHash}`} target="_blank" rel="noreferrer">{shortAddress(previousTransactionHash)} ↗</a></p>}
              {refreshNotice && (revokeStatus === "success" || revokeStatus === "already-zero") && <p className="refresh-notice" role="status">{refreshNotice}</p>}
              <div className="confirmation-actions">
                {(revokeStatus === "confirm" || revokeStatus === "failed") && !revokeReady && <p className="revoke-warning" role="status">Reconnect the scanned owner wallet on Robinhood Chain to continue. No transaction will be requested while the wallet is disconnected, changed, or on another network.</p>}
                {revokeStatus === "confirm" && <button className="revoke-confirm-button" type="button" disabled={!revokeReady || activeWrite} onClick={confirmRevoke}>Confirm and revoke this allowance</button>}
                {revokeStatus === "failed" && <button className="revoke-confirm-button" type="button" disabled={!revokeReady || activeWrite} onClick={() => { setRevokeError(""); setRevokeStatus("confirm"); }}>Start a new attempt</button>}
                {revokeStatus === "success" && <span className="success-label">Exact token/spender revocation confirmed.</span>}
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function assertRevokeContext(account: ReturnType<typeof getAccount>, owner: Address) {
  if (account.status !== "connected" || !account.address) throw new Error("Wallet disconnected. Reconnect the scanned owner wallet before submitting.");
  if (account.address.toLowerCase() !== owner.toLowerCase()) throw new Error("Connected account changed and no longer matches the scanned owner. No transaction was submitted.");
  if (account.chainId !== robinhoodChain.id) throw new Error("Wallet is no longer on Robinhood Chain (4663). No transaction was submitted.");
}
