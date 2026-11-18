import {
  decodeEventLog,
  getAddress,
  isAddress,
  parseAbi,
  parseAbiItem,
  type Address,
  type PublicClient,
} from "viem";

export const SCAN_BLOCKS = BigInt(50_000);
export const LOG_CHUNK_SIZE = BigInt(2_000);
export const MAX_PAIRS = 300;
export const MAX_CONCURRENT_READS = 6;
export const TOKEN_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const approvalEvent = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");

export type AllowanceRow = {
  token: Address;
  spender: Address;
  allowance: bigint;
  name?: string;
  symbol?: string;
  decimals?: number;
};

export type ScanFailure = { stage: "logs" | "verification"; fromBlock?: bigint; toBlock?: bigint; subject?: string; message: string };
export type ScanResult = {
  rows: AllowanceRow[];
  fromBlock: bigint;
  toBlock: bigint;
  checkedChunks: number;
  totalChunks: number;
  discoveredPairs: number;
  limitReached: boolean;
  failures: ScanFailure[];
};

type ScanOptions = {
  client: PublicClient;
  owner: Address;
  onProgress?: (completed: number, total: number) => void;
  onVerificationProgress?: (completed: number, total: number) => void;
};

async function concurrentMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function scanAllowances({ client, owner, onProgress, onVerificationProgress }: ScanOptions): Promise<ScanResult> {
  const latest = await client.getBlockNumber();
  const fromBlock = latest >= SCAN_BLOCKS - BigInt(1) ? latest - SCAN_BLOCKS + BigInt(1) : BigInt(0);
  const toBlock = latest;
  const totalChunks = Number((toBlock - fromBlock) / LOG_CHUNK_SIZE + BigInt(1));
  const failures: ScanFailure[] = [];
  const pairs = new Map<string, { token: Address; spender: Address }>();
  let checkedChunks = 0;
  let limitReached = false;

  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_SIZE) {
    const end = start + LOG_CHUNK_SIZE - BigInt(1) > toBlock ? toBlock : start + LOG_CHUNK_SIZE - BigInt(1);
    try {
      const logs = await client.getLogs({
        event: approvalEvent,
        args: { owner },
        fromBlock: start,
        toBlock: end,
      });

      let malformedLogs = 0;
      for (const log of logs) {
        if (!log.address || !log.topics[1] || !log.topics[2]) {
          malformedLogs += 1;
          continue;
        }
        try {
          const decoded = decodeEventLog({ abi: [approvalEvent], data: log.data, topics: log.topics });
          const spender = decoded.args.spender;
          const token = getAddress(log.address);
          const pairKey = `${token.toLowerCase()}:${spender.toLowerCase()}`;
          if (!pairs.has(pairKey) && pairs.size >= MAX_PAIRS) {
            limitReached = true;
            break;
          }
          pairs.set(pairKey, { token, spender });
        } catch {
          malformedLogs += 1;
        }
      }
      if (malformedLogs > 0) {
        failures.push({ stage: "logs", fromBlock: start, toBlock: end, message: `${malformedLogs} matching log${malformedLogs === 1 ? " did" : "s did"} not decode as a standard Approval event.` });
      }
    } catch (error) {
      failures.push({ stage: "logs", fromBlock: start, toBlock: end, message: errorMessage(error) });
    }
    checkedChunks += 1;
    onProgress?.(checkedChunks, totalChunks);
    if (limitReached) break;
  }

  const candidates = [...pairs.values()];
  let completedReads = 0;
  const reads = await concurrentMap(candidates, MAX_CONCURRENT_READS, async ({ token, spender }) => {
    try {
      const allowance = await client.readContract({ address: token, abi: TOKEN_ABI, functionName: "allowance", args: [owner, spender], blockNumber: latest });
      if (allowance === BigInt(0)) return null;

      const name = await client.readContract({ address: token, abi: TOKEN_ABI, functionName: "name", blockNumber: latest })
        .then((value) => ({ status: "fulfilled" as const, value }), () => ({ status: "rejected" as const }));
      const symbol = await client.readContract({ address: token, abi: TOKEN_ABI, functionName: "symbol", blockNumber: latest })
        .then((value) => ({ status: "fulfilled" as const, value }), () => ({ status: "rejected" as const }));
      const decimals = await client.readContract({ address: token, abi: TOKEN_ABI, functionName: "decimals", blockNumber: latest })
        .then((value) => ({ status: "fulfilled" as const, value }), () => ({ status: "rejected" as const }));
      return {
        row: {
          token,
          spender,
          allowance,
          ...(name.status === "fulfilled" ? { name: name.value } : {}),
          ...(symbol.status === "fulfilled" ? { symbol: symbol.value } : {}),
          ...(decimals.status === "fulfilled" ? { decimals: Number(decimals.value) } : {}),
        } satisfies AllowanceRow,
      };
    } catch (error) {
      return { failure: { stage: "verification" as const, subject: `${token} / ${spender}`, message: errorMessage(error) } };
    } finally {
      completedReads += 1;
      onVerificationProgress?.(completedReads, candidates.length);
    }
  });

  const rows: AllowanceRow[] = [];
  for (const result of reads) {
    if (!result) continue;
    if ("failure" in result && result.failure) failures.push(result.failure);
    else rows.push(result.row);
  }

  return { rows, fromBlock, toBlock, checkedChunks, totalChunks, discoveredPairs: candidates.length, limitReached, failures };
}

export function parseOwnerAddress(value: string): Address | null {
  const trimmed = value.trim();
  return isAddress(trimmed) ? getAddress(trimmed) : null;
}

export function formatAllowance(row: AllowanceRow) {
  const unlimited = row.allowance >= (BigInt(1) << BigInt(256)) - (BigInt(1) << BigInt(64));
  if (row.decimals === undefined) return { value: row.allowance.toString(), unlimited };
  const divisor = BigInt(10) ** BigInt(row.decimals);
  const whole = row.allowance / divisor;
  const fraction = (row.allowance % divisor).toString().padStart(row.decimals, "0").slice(0, 6).replace(/0+$/, "");
  return { value: fraction ? `${whole}.${fraction}` : whole.toString(), unlimited };
}
