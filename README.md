# UNGRANT

UNGRANT is a Robinhood Chain-only ERC-20 allowance checker and revoker. It includes the responsive interface, wallet/network connection state, bounded read-only allowance discovery, and explicit single-pair ERC-20 allowance revocation. It does not support batch revocation, NFTs, Permit2, or other networks.

## Run locally

```sh
npm install
npm run dev
```

Then open http://localhost:3000. `npm run build` creates a production build and `npm start` serves it.

## Network configuration

The app supports exactly one chain: Robinhood Chain, ID `4663`, using ETH (18 decimals). The default RPC is `https://rpc.mainnet.chain.robinhood.com/`; the explorer is `https://robinhoodchain.blockscout.com`. These values are documented by [Robinhood's network setup guide](https://docs.robinhood.com/chain/add-network-to-wallet/).

To override the RPC, copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_ROBINHOOD_RPC_URL`. The explorer and chain metadata are defined in `src/config/chain.ts`.

## Allowance discovery limits

Discovery checks the latest 50,000 blocks in 2,000-block log requests, then verifies at most 300 unique token/spender pairs with a maximum of six concurrent pair reads. Results only describe the displayed block range; this is not a full-history scan. Log chunks and allowance verification failures are shown as partial/incomplete results. Current allowances are read at the latest block. Public RPC providers can impose rate, timeout, log-range, or response-size limits; override the documented public endpoint with a compatible Robinhood Chain RPC if needed. All calls are read-only and the app does not request transaction permissions.

## Revocation

Revocation is offered only when the connected Robinhood Chain account matches the owner of the displayed scan. Each explicit confirmation rechecks the account, chain, and current allowance before requesting only `approve(spender, 0)` from that token contract. The app waits for the receipt and verifies the transaction sender, token target, chain, and calldata before reporting success. A successful transaction triggers a fresh scan of the same bounded block window. Failed or ambiguous submissions are not retried automatically; review the transaction link and current allowance before explicitly starting another attempt.
