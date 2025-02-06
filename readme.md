# Kiwistand

[![Node.js badge](https://github.com/attestate/kiwistand/actions/workflows/node.js.yml/badge.svg)](https://github.com/attestate/kiwistand/actions/workflows/node.js.yml)

Kiwistand is a P2P node client for a web3-friendly Hacker News that nobody controls but everybody co-owns.

<img width="680" alt="Screenshot 2023-08-10 at 15 53 46" src="https://github.com/attestate/kiwistand/assets/2758453/d741ca3b-67a2-4356-822c-0c32df0dadc3">

Kiwi stores links and upvotes on the protocol level. Thanks to that, users can create their own UIs and permissionlessly create apps on top of it (see: [awesome-kiwi for the list of apps and contributors](https://github.com/attestate/awesome-kiwinews)).

You can learn the story behind the project in this [4 min video by Tim Daubenschutz](https://www.youtube.com/watch?v=WujtU15yAyk).

## Requirements

#### Basic requirements:

- node >= 19 (best to check package.json value though)
- RPC nodes on Ethereum Mainnet & Optimism

It's highly likely that you'll need either a paid Alchemy account to make the node work because it is downloading a lot of block data. You might also try rate-limiting the speed at which the node tries to download event logs.

There's an option where you can just download one of the latest database backups manually and rename it to the right directory. For that visit [attestate/kiwinews-backups](https://github.com/attestate/kiwinews-backups) and please reach out if you need an up-to-date backup.

Please reach out to us if you don't have access to an Alchemy account and we'll figure something out!

## Getting started

If you want to deploy Kiwi News with Terraform, check out [this repo](https://github.com/x4901/kiwi-news-deploy).

```bash
git clone git@github.com:attestate/kiwistand.git
cp .env-copy .env
npm i
# and then for the frontend
cd src/web && npm i && cd ../..
npm run dev:anon
# might error when trying to create the data dir, that's a bug right now, just run it again
```

To set up the Kiwi node correctly, make sure to generate a valid Alchemy or Infura key (ideally paid because we're going to make a lot of requests).
In your `.env` file, replace the value of `OPTIMISM_RPC_HTTP_HOST` with your full Alchemy key "https://opt-mainnet.g.alchemy.com/v2/abcd". Then run the node using `npm run dev:anon`. Please also add a `RPC_HTTP_HOST`, we need it to resolve ENS names.

**NOTE:** The `dev:anon` npm script overwrites several environment variables. And so do other `dev:...` commands. This is done to test the software in different situations. E.g. `dev:bootstrap` is not connecting the node to the online p2p network, meaning that its data won't be shared with the Kiwi News mainnet. But e.g. `dev:anon` runs directly on mainnet and synchronizes the node.

**NOTE2:** When the node is fully synchronized, it can take a while to load the feed pages like `/`, `/new` or `/best` when using e.g. `dev:anon`. This is because the server is caching all signature validations for the first time. To not have to wait for the server to cache all the signatures, you can also load e.g. `/welcome` or a page that doesn't require the database and hence doesn't need to validate signatures.

**FINALLY:** If you don't use Alchemy or Infura and if your Ethereum RPC node is behind a custom reverse proxy with Authorization requirements, consider adding the @attestate/crawler RPC_API_KEY environment variable ([details](https://attestate.com/crawler/main/configuration.html#environment-variables)).

You can also watch the video explaining [how to get started editing the Kiwi News frontend](https://www.loom.com/share/e0e8866450d54c52b161e77907d1ccb9).

## Syncing to the network

Kiwistand isn't venture capital funded and so its algorithm is a bit rough around the edges. Please don't expect a super polished piece of software! We're working with constraints. That said, despite all of the challenges, we're trying to keep the set reconciliation algorithm as best in shape as we can! If you're running into issues, please make sure to reach out to Tim on Telegram.

Now, for actually syncing the node, please follow the guide in `Contributing.md`!

## Debugging

Once you're up and running, you might want to submit new links to the network. However, we encourage you to NOT do that on the main net.

Instead, if you must test submitting new links then run the node in bootstrap mode (no mainnet data) or in the "anon:local" mode that doesn't send data to the p2p network.

```bash
npm run dev:bootstrap

# or

npm run dev:anon:local
```

## How does the protocol work

- [Building decentralized social networks | Tim Daubenschütz at zusocial in Istanbul](https://www.youtube.com/watch?v=Rys5UEi2SWg)

#### Demos:

- [Loom: Set Reconciliation demo (40 secs)](https://www.loom.com/share/abf43323b00547689bf11520f565f4bc)
- [Loom: Set Reconciliation algorithm explained (9 mins)](https://www.loom.com/share/2a68f5e22d9843ab99edad2deaed9281)

## Key features

1. **Sybil Protection**: NFT ownership is required for posting and voting, reducing spam and duplicate accounts.
2. **Public Goods Infrastructure**: Data is shared across all nodes using a set reconciliation algorithm, preventing single-entity control.
3. **Complete Open Source Package**: Kiwi News includes frontend, backend, and protocol code, all under GPL3.
4. **Streamlined User Interaction**: Kiwi News supports key delegation, which allows automatic signing of user actions. This means users don't have to manually confirm each action via wallet connect or similar methods, making the user experience smoother.

## API

- [HTTP API](https://attestate.com/kiwistand/main/)

## Node operators

Since [https://news.kiwistand.com](https://news.kiwistand.com) is now running live as a p2p node, you're invited to run your own nodes and frontends.

However, please consider joining a chat like the [attestate dev chat](https://t.me/kiwinewsdevs) to stay in touch for eventual upgrade announcements, as the protocol is far from being complete.

## Changelog

See changelog.md file.

## License

GPL-3.0-only, see LICENSE file

## Getting in Touch

Kiwi Devs Telegram chat:

- [Kiwi Devs Chat](https://t.me/kiwinewsdevs)
