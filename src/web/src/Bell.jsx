// @format
import { useEffect, useState } from "react";
import { WagmiConfig, useAccount } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { eligible } from "@attestate/delegator2";
import SwipeableDrawer from "@mui/material/SwipeableDrawer";
import { Wallet } from "@ethersproject/wallet";

import { Connector, TextConnectButton } from "./Navigation.jsx";
import { RestoreDialogue } from "./Passkeys.jsx";
import * as API from "./API.mjs";
import { isIOS, getLocalAccount, getCookie } from "./session.mjs";
import { client, chains, useProvider } from "./client.mjs";
import { dynamicPrefetch } from "./main.jsx";

const EmailSubscriptionForm = ({
  onSuccess,
  allowlist,
  delegations,
  toast,
}) => {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [subscribeToComments, setSubscribeToComments] = useState(true);
  const [subscribeToNewsletter, setSubscribeToNewsletter] = useState(true);
  const account = useAccount();
  const localAccount = getLocalAccount(account.address, allowlist);
  const provider = useProvider();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("sending");

    try {
      // Subscribe to comment notifications
      if (subscribeToComments) {
        const value = API.messageFab(email, email, "EMAILAUTH");
        let signature;
        try {
          const signer = new Wallet(localAccount.privateKey, provider);
          signature = await signer._signTypedData(
            API.EIP712_DOMAIN,
            API.EIP712_TYPES,
            value,
          );
        } catch (err) {
          console.error("Signing failed:", err);
          setStatus("error");
          return;
        }

        const wait = null;
        const endpoint = "/api/v1/email-notifications";
        const port = window.location.port;

        try {
          const response = await API.send(value, signature, wait, endpoint, port);
          if (response.status !== "success") {
            console.error("API error:", response.details);
            throw new Error(response.details || "Failed to subscribe to comments");
          }
        } catch (err) {
          console.error("Network request failed:", err);
          throw err;
        }
      }

      // Subscribe to newsletter
      if (subscribeToNewsletter) {
        const response = await fetch(
          "https://paragraph.xyz/api/blogs/@kiwi-weekly/subscribe",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email }),
          },
        );

        if (!response.ok) {
          throw new Error("Newsletter subscription failed");
        }
      }

      setStatus("success");
      onSuccess();
    } catch (err) {
      console.error("Subscription error:", err);
      toast.error("Failed to subscribe");
      setStatus("error");
    }
  };

  return (
    <div style={{ width: "100%", maxWidth: "320px", marginBottom: "3rem" }}>
      <h1
        style={{
          fontFamily: "var(--font-family)",
          fontSize: "24px",
          fontWeight: "600",
          marginBottom: "24px",
        }}
      >
        Stay Updated
      </h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "16px",
            border: "var(--border-thin)",
            borderRadius: "2px",
            fontSize: "11pt",
          }}
          required
        />

        <div style={{ marginBottom: "24px" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "12px",
              fontSize: "11pt",
              color: "#666",
            }}
          >
            <input
              type="checkbox"
              checked={subscribeToComments}
              onChange={(e) => setSubscribeToComments(e.target.checked)}
              style={{ marginRight: "8px" }}
            />
            Get notified about replies to your comments
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "11pt",
              color: "#666",
            }}
          >
            <input
              type="checkbox"
              checked={subscribeToNewsletter}
              onChange={(e) => setSubscribeToNewsletter(e.target.checked)}
              style={{ marginRight: "8px" }}
            />
            Subscribe to Kiwi Weekly
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              padding: "8px 16px",
              background: status === "sending" ? "#828282" : "black",
              color: "white",
              border: "none",
              borderRadius: "2px",
              cursor: "pointer",
              fontSize: "11pt",
            }}
          >
            {status === "sending" ? "Subscribing..." : "Subscribe"}
          </button>
        </div>
      </form>
    </div>
  );
};

const NotificationButton = ({ onEnabled }) => {
  const [permissionStatus, setPermissionStatus] = useState("default");

  useEffect(() => {
    const handlePermissionResult = (event) => {
      setPermissionStatus(event.detail);
      if (event.detail === "granted" && onEnabled) {
        onEnabled();
      }
    };

    window.addEventListener(
      "notificationPermissionResult",
      handlePermissionResult,
    );
    return () => {
      window.removeEventListener(
        "notificationPermissionResult",
        handlePermissionResult,
      );
    };
  }, [onEnabled]);

  const handleNotificationRequest = () => {
    if (window.requestIOSNotifications) {
      window.requestIOSNotifications();
    }
  };

  return (
    <button
      onClick={handleNotificationRequest}
      style={{
        padding: "6px 12px",
        background: "black",
        color: "white",
        border: "var(--border)",
        borderRadius: "2px",
        cursor: "pointer",
        fontSize: "10pt",
      }}
    >
      {permissionStatus === "granted"
        ? "Notifications Enabled"
        : "Enable Notifications"}
    </button>
  );
};

const IOSAppLogin = (props) => {
  const { allowlist, delegations, toast } = props;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState("login");
  const PasskeysLogin = RestoreDialogue(allowlist, delegations, toast);

  const [shouldReload, setShouldReload] = useState(false);

  const handleLoginSuccess = () => {
    setShouldReload(true);
    setCurrentStep("pushNotifications");
  };

  const handleSkip = () => {
    if (currentStep === "pushNotifications") {
      setCurrentStep("complete");
    }
  };

  const handleClose = () => {
    setIsDrawerOpen(false);
    if (shouldReload) {
      window.location.reload();
    }
  };

  const renderContent = () => {
    switch (currentStep) {
      case "login":
        return (
          <>
            <img
              src="kiwi-icon.webp"
              alt="Logo"
              style={{
                width: "64px",
                height: "64px",
                marginBottom: "16px",
              }}
            />
            <h1
              style={{
                fontFamily: "var(--font-family)",
                fontSize: "24px",
                fontWeight: "600",
                marginBottom: "24px",
              }}
            >
              Welcome Back
            </h1>
            <div style={{ width: "100%", maxWidth: "320px" }}>
              <PasskeysLogin 
                onSuccess={handleLoginSuccess} 
                callback={() => {}}
              />
              {window.location.protocol === "http:" && (
                <button
                  onClick={() => {
                    setShouldReload(true);
                    setCurrentStep("pushNotifications");
                  }}
                  style={{
                    border: "none",
                    background: "none",
                    color: "#666",
                    fontSize: "9pt",
                    padding: "12px 0",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  Skip login (development only)
                </button>
              )}
            </div>
          </>
        );

      case "pushNotifications":
        return (
          <EmailSubscriptionForm
            onSuccess={() => setCurrentStep("complete")}
            onSkip={() => setCurrentStep("complete")}
            allowlist={allowlist}
            delegations={delegations}
            toast={toast}
          />
        );

      case "complete":
        return (
          <div
            style={{ width: "100%", maxWidth: "320px", textAlign: "center" }}
          >
            <img
              src="kiwi-icon.webp"
              alt="Logo"
              style={{
                width: "64px",
                height: "64px",
                marginBottom: "16px",
              }}
            />
            <h1
              style={{
                fontFamily: "var(--font-family)",
                fontSize: "24px",
                fontWeight: "600",
                marginBottom: "24px",
              }}
            >
              You're all set!
            </h1>
          </div>
        );
    }
  };

  return (
    <>
      <button
        onClick={() => setIsDrawerOpen(true)}
        style={{
          padding: "8px 0",
          border: "none",
          borderRadius: "2px",
          backgroundColor: "#E2F266",
          color: "black",
          fontSize: "8pt",
          cursor: "pointer",
          width: "100%",
        }}
      >
        Login
      </button>

      <SwipeableDrawer
        anchor="bottom"
        open={isDrawerOpen}
        onClose={handleClose}
        onOpen={() => setIsDrawerOpen(true)}
        disableBackdropTransition={!isIOS()}
        disableDiscovery={isIOS()}
      >
        <div style={{ position: "relative", height: "100%" }}>
          <div
            style={{
              padding: "16px 0 16px 8px",
              borderBottom: "1px solid rgba(0, 0, 0, 0.1)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              {currentStep !== "complete" && (
                <button
                  onClick={handleClose}
                  style={{
                    border: "none",
                    background: "none",
                    fontSize: "16px",
                    fontWeight: "500",
                    color: "var(--full-contrast-color)",
                    cursor: "pointer",
                    padding: "8px 16px",
                  }}
                >
                  Cancel
                </button>
              )}
              {currentStep === "pushNotifications" && (
                <button
                  onClick={() => {
                    handleSkip();
                    handleClose();
                  }}
                  style={{
                    border: "none",
                    background: "none",
                    fontSize: "16px",
                    fontWeight: "500",
                    color: "var(--full-contrast-color)",
                    cursor: "pointer",
                    padding: "8px 16px",
                  }}
                >
                  Skip
                </button>
              )}
              {currentStep === "complete" && (
                <button
                  onClick={handleClose}
                  style={{
                    border: "none",
                    background: "none",
                    fontSize: "16px",
                    fontWeight: "500",
                    color: "var(--full-contrast-color)",
                    cursor: "pointer",
                    padding: "8px 16px",
                  }}
                >
                  Done
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              height: "calc(100% - 60px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "2rem",
              gap: "24px",
            }}
          >
            {renderContent()}
          </div>
        </div>
      </SwipeableDrawer>
    </>
  );
};

let wasTitleSet = false;
const Bell = (props) => {
  let address;
  const account = useAccount();
  const localAccount = getLocalAccount(account.address, props.allowlist);
  if (localAccount) {
    address = localAccount.identity;
  } else if (account.isConnected) {
    address = account.address;
  }
  const isEligible =
    address && eligible(props.allowlist, props.delegations, address);

  const localLastUpdate = parseInt(getCookie("lastUpdate"), 10);
  const [lastUpdate, setLastUpdate] = useState(localLastUpdate);
  const [notificationCount, setNotificationCount] = useState(0);
  const [readNotifications, setReadNotifications] = useState(0);
  const [cacheBuster, setCacheBuster] = useState("");
  const [isFull, setIsFull] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const link = isEligible
    ? `/activity?address=${address}${
        cacheBuster ? `&cacheBuster=${cacheBuster}` : ""
      }`
    : "/kiwipass-mint";

  const handleClick = () => {
    setIsFull(!isFull);
  };

  useEffect(() => {
    if (!address || isLoading) return;

    const fetchAndUpdateNotifications = async () => {
      setIsLoading(true);

      try {
        const notifications = await API.fetchNotifications(address);
        const localLastUpdate = parseInt(getCookie("lastUpdate"), 10);
        setReadNotifications(notifications.length);

        const newNotifications = notifications
          .filter((elem) => elem.timestamp > localLastUpdate)
          .sort((a, b) => b.timestamp - a.timestamp);
        if (newNotifications.length > 0) {
          setCacheBuster(`0x${newNotifications[0].message.index}`);
        }
        setNotificationCount(newNotifications.length);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAndUpdateNotifications();
  }, [address]);

  if (
    (isEligible && !lastUpdate && readNotifications === 0) ||
    window.location.pathname === "/indexing" ||
    window.location.pathname === "/kiwipass-mint" ||
    window.location.pathname === "/demonstration" ||
    window.location.pathname === "/invite" ||
    window.location.pathname === "/passkeys" ||
    window.location.pathname === "/notifications" ||
    window.location.pathname === "/whattosubmit" ||
    window.location.pathname === "/pwa" ||
    window.location.pathname === "/start" ||
    window.location.pathname === "/friends"
  ) {
    return null;
  }
  const isIOSApp = document.documentElement.classList.contains("kiwi-ios-app");

  if (!getCookie("identity") || !isEligible) {
    if (isIOSApp) {
      return <IOSAppLogin {...props} />;
    }
    return (
      <TextConnectButton
        className={props.mobile ? "mobile-bell" : "bell-button"}
        style={{
          color: "black",
          textAlign: "center",
          fontSize: props.mobile ? "6pt" : "9pt",
          display: props.mobile ? "inline-flex" : "inline",
          padding: props.mobile ? "" : "10px 10px",
          flexGrow: 1,
          border: props.mobile ? "none" : "3px inset #59321C",
          backgroundColor: "#E2F266",
        }}
        allowlist={props.allowlist}
        delegations={props.delegations}
        text={
          <>
            {props.mobile ? (
              <span style={{ display: "inline-block", lineHeight: "1" }}>
                Con-
                <br />
                nect
              </span>
            ) : (
              "Connect"
            )}
          </>
        }
      />
    );
  }

  dynamicPrefetch(link);
  if (notificationCount > 0 && !wasTitleSet) {
    document.title = `[${notificationCount}] ${document.title}`;
    wasTitleSet = true;
  }

  const disabled = !lastUpdate && readNotifications === 0;
  return (
    <a
      data-no-instant
      disabled={disabled}
      title="Notifications"
      href={link}
      className={props.mobile ? "mobile-bell" : "bell-button"}
      onClick={handleClick}
      style={{
        padding: props.mobile ? "" : "10px 10px",
        backgroundColor: props.mobile ? "" : "var(--bg-off-white)",
        border: props.mobile ? "" : "var(--border)",
        borderRadius: "2px",
        display: "inline-flex",
        position: "relative",
      }}
    >
      {isFull || window.location.pathname === "/activity" ? (
        <BellSVGFull mobile={props.mobile} />
      ) : (
        <BellSVG
          mobile={props.mobile}
          style={disabled ? { color: "grey" } : {}}
        />
      )}
      {notificationCount > 0 && (
        <span
          style={{
            position: "absolute",
            top: props.mobile ? "8px" : "5px",
            right: props.mobile ? "32px" : "8px",
            backgroundColor: "red",
            borderRadius: "2px",
            color: "white",
            padding: "1px",
            fontSize: "8px",
            fontWeight: "bold",
            minWidth: "13px",
            height: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {notificationCount}
        </span>
      )}
    </a>
  );
};

const Form = (props) => {
  return (
    <Connector {...props}>
      <Bell {...props} />
    </Connector>
  );
};

export default Form;

const BellSVGFull = (props) => (
  <svg
    style={
      props.mobile
        ? {}
        : {
            color: "black",
            width: "1.5rem",
          }
    }
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
  >
    <rect width="256" height="256" fill="none" />
    <path d="M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216Z" />
  </svg>
);
const BellSVG = (props) => (
  <svg
    style={
      props.mobile
        ? { ...props.style }
        : {
            color: "black",
            width: "1.5rem",
            ...props.style,
          }
    }
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
  >
    <rect width="256" height="256" fill="none" />
    <path
      d="M96,192a32,32,0,0,0,64,0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    />
    <path
      d="M56,104a72,72,0,0,1,144,0c0,35.82,8.3,64.6,14.9,76A8,8,0,0,1,208,192H48a8,8,0,0,1-6.88-12C47.71,168.6,56,139.81,56,104Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="16"
    />
  </svg>
);
