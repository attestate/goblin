import { useState } from "react";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiConfig, useAccount, useSigner, useProvider } from "wagmi";
import { Wallet } from "@ethersproject/wallet";

import * as API from "./API.mjs";
import { getLocalAccount } from "./session.mjs";
import { client, chains } from "./client.mjs";

const CommentInput = (props) => {
  const { toast } = props;

  let address;
  const account = useAccount();
  const localAccount = getLocalAccount(account.address);
  if (account.isConnected) {
    address = account.address;
  }
  if (localAccount) {
    address = localAccount.identity;
  }

  const provider = useProvider();
  const result = useSigner();
  let signer, isError;
  if (localAccount && localAccount.privateKey) {
    signer = new Wallet(localAccount.privateKey, provider);
  } else {
    signer = result.data;
    isError = result.isError;
  }

  const [text, setText] = useState("");
  const handleSubmit = async (e) => {
    e.preventDefault();
    const urlParams = new URLSearchParams(window.location.search);
    const index = urlParams.get("index");

    if (text.length < 15 || text.length > 10_000) {
      toast.error("Comment must be between 15 and 10000 characters.");
      return;
    }
    const type = "comment";
    const value = API.messageFab(text, `kiwi:${index}`, type);

    let signature;
    try {
      signature = await signer._signTypedData(
        API.EIP712_DOMAIN,
        API.EIP712_TYPES,
        value,
      );
    } catch (err) {
      console.log(err);
      toast.error(`Error! Sad Kiwi! "${err.message}"`);
      return;
    }

    const wait = false;
    const response = await API.send(value, signature, wait);
    location.reload();
  };

  console.log(address);
  if (!address) return null;
  return (
    <div
      style={{
        margin: "0 0 1rem 1rem",
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
      ></textarea>
      <br />
      <br />
      <button onClick={handleSubmit}>Add comment</button>
    </div>
  );
};

const Container = (props) => {
  return (
    <WagmiConfig client={client}>
      <RainbowKitProvider chains={chains}>
        <CommentInput {...props} />
      </RainbowKitProvider>
    </WagmiConfig>
  );
};

export default Container;
