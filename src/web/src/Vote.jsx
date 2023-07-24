// @format
import { useSigner, useAccount, WagmiConfig, useProvider } from "wagmi";
import { Wallet } from "@ethersproject/wallet";
import { RainbowKitProvider, ConnectButton } from "@rainbow-me/rainbowkit";

import * as API from "./API.mjs";
import { client, chains } from "./client.mjs";
import { showMessage } from "./message.mjs";

const Container = (props) => {
  return (
    <WagmiConfig client={client}>
      <RainbowKitProvider chains={chains}>
        <Vote {...props} />
      </RainbowKitProvider>
    </WagmiConfig>
  );
};

const Vote = (props) => {
  const value = API.messageFab(props.title, props.href);
  const account = useAccount();
  const localKey = localStorage.getItem(`-kiwi-news-${account.address}-key`);
  const provider = useProvider();
  const result = useSigner();
  let signer, isError, isLocal;
  if (localKey) {
    signer = new Wallet(localKey, provider);
    isLocal = true;
  } else {
    signer = result.data;
    isError = result.isError;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isLocal) showMessage("Please sign the message in your wallet");
    const signature = await signer._signTypedData(
      API.EIP712_DOMAIN,
      API.EIP712_TYPES,
      value
    );
    const response = await API.send(value, signature);

    console.log(response);
    if (response.status === "success") {
      let url = new URL(window.location.origin + "/new");
      url.searchParams.set("bpc", "1");
      url.searchParams.set("success", "true");
      window.location.href = url.href;
    } else if (response.status === "error") {
      showMessage(`You have already submitted or upvoted this link before :(`);
      return;
    }
};


  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal }) => {
        const connected = account && chain && mounted;
        return (
          <div
            onClick={(e) => {
              if (!connected) {
                openConnectModal();
              }
              handleSubmit(e);
            }}
            className="votearrow"
            title="upvote"
          ></div>
        );
      }}
    </ConnectButton.Custom>
  );
};

export default Container;
