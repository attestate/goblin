import React, { useState, useEffect } from "react";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiConfig, useAccount } from "wagmi";
import { Wallet } from "@ethersproject/wallet";
import { eligible } from "@attestate/delegator2";

import { PasskeysSVG } from "./icons.jsx";
import theme from "./theme.jsx";
import { useProvider, client, chains } from "./client.mjs";
import { ProgressBar } from "./DelegateButton.jsx";
import {
  isIOS,
  getLocalAccount,
  supportsPasskeys,
  setCookie,
  tenYearsInSeconds,
} from "./session.mjs";

export const rp = {
  name: "Kiwi News",
  id: window.location.hostname,
};

export const truncate = (address) =>
  address.slice(0, 6) +
  "..." +
  address.slice(address.length - 4, address.length);

export const testPasskeys = async () =>
  supportsPasskeys() &&
  window.PublicKeyCredential &&
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
  PublicKeyCredential.isConditionalMediationAvailable &&
  (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) &&
  (await PublicKeyCredential.isConditionalMediationAvailable());

export const toBuffer = (data) => {
  return new TextEncoder().encode(data).buffer;
};

export const RestoreDialogue = (allowlist, delegations, toast) => {
  return () => {
    const provider = useProvider();
    const [featureAvailable, setFeatureAvailable] = useState(false);
    useEffect(() => {
      (async () => {
        const isAvailable = await testPasskeys();
        setFeatureAvailable(isAvailable);
      })();
    });

    async function read() {
      const options = {
        publicKey: {
          challenge: genVal(),
          rp,
          userVerification: "discouraged",
          extensions: {
            largeBlob: {
              read: true,
            },
          },
        },
      };

      let assertion;
      try {
        assertion = await navigator.credentials.get(options);
      } catch (err) {
        toast.error(`Error reading large blob: ${err.toString()}`);
        return;
      }
      const largeBlobData = assertion.getClientExtensionResults().largeBlob;
      const textDecoder = new TextDecoder();
      const decodedData = textDecoder.decode(largeBlobData.blob);
      if (!decodedData) {
        toast.error(
          `Error decoding blob data. This is the decoded data: "${decodedData}"`,
        );
        return;
      }
      const wallet = new Wallet(decodedData, provider);
      const identity = eligible(allowlist, delegations, wallet.address);
      localStorage.setItem(`-kiwi-news-${identity}-key`, decodedData);
      setCookie("identity", identity, tenYearsInSeconds);
      if (props.callback) {
        props.callback();
      } else {
        window.location.pathname = "/";
      }
    }

    if (!featureAvailable || window.location.pathname === "/settings")
      return null;
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <button
          onClick={read}
          id="button-onboarding"
          style={{
            width: "auto",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            fontSize: "15px",
            gap: "4px",
            borderRadius: "2px",
            padding: "0.4rem 0.75rem",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <PasskeysSVG style={{ color: "white", width: "24px" }} /> Connect with
          Passkeys
        </button>
        <p style={{ color: "black", fontSize: "8pt" }}>
          (Available if you've previously saved your key to iCloud Keychain)
        </p>
      </div>
    );
  };
};

async function generateUserId(address1, address2) {
  const encoder = new TextEncoder();
  const data = encoder.encode(address1 + address2);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

export const genVal = (size = 32) => {
  const randomValues = new Uint8Array(size);
  window.crypto.getRandomValues(randomValues);
  return randomValues;
};

const Dialogue = (props) => {
  return (
    <div>
      <h2
        style={{
          fontSize: "24px",
          fontWeight: "600",
          color: "black",
          marginBottom: "24px",
          textAlign: "left",
        }}
      >
        Save your key securely with Passkeys
      </h2>
      <h3
        style={{
          fontSize: "16px",
          fontWeight: "600",
          color: "black",
          marginBottom: "12px",
          textAlign: "left",
        }}
      >
        Important requirements:
      </h3>
      <ul
        style={{
          lineHeight: "1.5",
          marginTop: "0",
          marginBottom: "20px",
          paddingLeft: "20px",
          textAlign: "left",
        }}
      >
        <li>
          Use Apple's built-in Passwords app and enable iCloud Passwords in
          Settings if needed
        </li>
        <li>Third-party password managers are not currently supported</li>
      </ul>
      <details
        style={{
          marginTop: "15px",
          fontSize: "0.9em",
          color: "#666",
          textAlign: "left",
          background: "white",
          padding: "15px",
          borderRadius: "4px",
        }}
      >
        <summary style={{ cursor: "pointer", marginBottom: "10px" }}>
          Why these requirements?
        </summary>
        <p
          style={{
            marginTop: "10px",
            lineHeight: "1.4",
            paddingLeft: "0",
            textAlign: "left",
          }}
        >
          Our app uses advanced passkey features that are currently only fully
          supported by Apple's implementation. While passkeys work on Android
          and Windows for basic authentication, some security features (like
          end-to-end encrypted sync) may not be available. We're actively
          monitoring platform support to expand these features as they become
          available.
        </p>
      </details>
    </div>
  );
};

function BackupKey(props) {
  const [rawId, setRawId] = useState(null);
  const [lbResult, setLbResult] = useState(null);
  const [progress, setProgress] = useState(1);
  const [featureAvailable, setFeatureAvailable] = useState(false);
  useEffect(() => {
    (async () => {
      const isAvailable = await testPasskeys();
      if (
        !isAvailable &&
        props.callback &&
        typeof props.callback === "function"
      ) {
        props.callback();
        // NOTE: We have to reload the page here because the Vote
        // component isn't reloading based on the updates in the
        // localStorage, for example, when we store a new application key
        // there. So we reload the page to fix this.
        window.location.pathname = "/";
        return;
      }
      setFeatureAvailable(isAvailable);
    })();
  });

  let address;
  const account = useAccount();
  const localAccount = getLocalAccount(account.address, props.allowlist);
  if (account.isConnected) {
    address = account.address;
  }
  if (localAccount) {
    address = localAccount.identity;
  }

  async function create() {
    if (isIOS()) {
      alert(
        "Please select 'Passwords' app when prompted. For the best security and sync experience, third-party password managers are not currently supported.",
      );
    }
    const id = await generateUserId(localAccount.identity, localAccount.signer);
    const publicKey = {
      challenge: genVal(),
      rp,
      user: {
        id,
        name: `Kiwi Wallet ${new Date().toLocaleDateString()} ${truncate(
          localAccount.identity,
        )}`,
        displayName: `Kiwi Wallet ${new Date().toLocaleDateString()} ${truncate(
          localAccount.identity,
        )}`,
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred",
      },
      extensions: {
        largeBlob: {
          support: "required",
        },
      },
    };
    let newCredential;
    try {
      newCredential = await navigator.credentials.create({ publicKey });
    } catch (err) {
      props.toast.error(
        `Error while creating the credential ${err.toString()}`,
      );
      console.log(err);
      return;
    }
    setRawId(newCredential.rawId);
    setProgress(2);
  }

  const store = async () => {
    const write = new TextEncoder().encode(localAccount.privateKey);
    const options = {
      challenge: genVal(),
      rp,
      userVerification: "discouraged",
      allowCredentials: [
        {
          type: "public-key",
          id: rawId,
        },
      ],
      extensions: {
        largeBlob: {
          write,
        },
      },
    };

    let assertion;
    try {
      assertion = await navigator.credentials.get({ publicKey: options });
    } catch (err) {
      console.log(err);
      props.toast.error(`Error while storing the credential ${err.toString()}`);
      return;
    }
    if (assertion.getClientExtensionResults()?.largeBlob?.written) {
      setLbResult("Backup successful!");
    } else {
      setLbResult(
        "Backup failed. This can happen if you're using a password manager like 1Password or if you're not on iOS 17+. Please try again using iCloud Keychain.",
      );
    }

    if (props.callback && typeof props.callback === "function") {
      props.callback();
      // NOTE: We have to reload the page here because the Vote
      // component isn't reloading based on the updates in the
      // localStorage, for example, when we store a new application key
      // there. So we reload the page to fix this.
      window.location.pathname = "/";
    }
    setProgress(3);
  };

  if (!address || !localAccount || !featureAvailable) {
    return null;
  }
  if (lbResult && lbResult.includes("successful")) {
    const successContent = (
      <div>
        <ProgressBar progress={progress} />
        <h3
          style={{
            marginTop: "0",
            fontSize: "1.2rem",
            color: "black",
            marginBottom: "20px",
          }}
        >
          <span>Backup successful!</span>
        </h3>
        <p
          style={{
            fontWeight: "bold",
            color: "black",
            marginBottom: "20px",
            textAlign: "left",
          }}
        >
          All set! Next time you connect, just tap "Connect with Passkeys" to
          instantly access your account.
        </p>
      </div>
    );

    // Only show TestFlight link in app onboarding flow
    if (props.isAppOnboarding) {
      return (
        <div>
          {successContent}
          <a
            href="/app-testflight"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              fontWeight: "bold",
              color: "black",
              textDecoration: "none",
              borderRadius: "2px",
              marginTop: "20px",
            }}
          >
            Continue to App Installation →
          </a>
        </div>
      );
    }

    return successContent;
  } else if (lbResult) {
    return (
      <span style={{ color: "black", fontWeight: "bold" }}>{lbResult}</span>
    );
  }

  return (
    <div>
      {!rawId ? (
        <div>
          <ProgressBar progress={progress} />
          <span>
            <Dialogue />
            <br />
            <button
              style={{
                width: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
              id="button-onboarding"
              onClick={create}
            >
              <PasskeysSVG style={{ color: "white", width: "24px" }} /> Set Up
              Passkey (Step 1/2)
            </button>
          </span>
          <br />
          <br />
          {props.redirectButton ? props.redirectButton : ""}
        </div>
      ) : (
        <div>
          <ProgressBar progress={progress} />
          <span>
            <Dialogue />
            <br />
            <button
              style={{
                width: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
              id="button-onboarding"
              onClick={store}
            >
              <PasskeysSVG style={{ color: "white", width: "24px" }} /> Save Key
              (Step 2/2)
            </button>
          </span>
          <br />
          <br />
          {props.redirectButton ? props.redirectButton : ""}
        </div>
      )}
    </div>
  );
}

const Form = (props) => {
  return (
    <WagmiConfig config={client}>
      <RainbowKitProvider chains={chains}>
        <BackupKey {...props} />
      </RainbowKitProvider>
    </WagmiConfig>
  );
};

export default Form;
