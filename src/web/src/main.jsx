import "vite/modulepreload-polyfill";
import "@rainbow-me/rainbowkit/styles.css";
import PullToRefresh from "pulltorefreshjs";

import { isRunningPWA, getCookie, getLocalAccount } from "./session.mjs";

function commentCountSignifier() {
  const isStoriesPage = window.location.pathname === "/stories";
  const indexQueryParam = new URLSearchParams(window.location.search).get(
    "index",
  );

  if (isStoriesPage && indexQueryParam) {
    const index = indexQueryParam.substring(2);
    // Update localStorage for a specific comment page
    const commentCountElement = document.querySelector(
      `[id^='comment-count-']`,
    );
    if (commentCountElement) {
      const currentCount = parseInt(commentCountElement.textContent, 10);
      localStorage.setItem(`commentCount-${index}`, currentCount.toString());
    }
    return;
  }

  document.querySelectorAll("[id^='chat-bubble-']").forEach((story) => {
    const index = story.id.split("-")[2];
    const commentCountElement = document.getElementById(
      `comment-count-${index}`,
    );
    const currentCount = parseInt(commentCountElement.textContent, 10);
    const storedCountKey = `commentCount-${index}`;
    const storedCount = parseInt(localStorage.getItem(storedCountKey), 10);

    if (isNaN(storedCount)) {
      localStorage.setItem(
        storedCountKey,
        isNaN(currentCount) ? "0" : currentCount.toString(),
      );
    } else if (currentCount > storedCount) {
      const svgElement = story.querySelector("svg");
      svgElement.style.color = "limegreen";
    }
  });
}

async function checkNewStories() {
  let data;
  try {
    const response = await fetch("/api/v1/feeds/new");
    data = await response.json();
  } catch (error) {
    console.error("Error fetching new stories:", error);
    return;
  }

  if (data.status === "success" && data.data.stories.length > 0) {
    const account = getLocalAccount();
    const story = data.data.stories[0];
    const identity = story.identity;
    const latestTimestamp = story.timestamp;
    const localTimestamp = getCookie("newTimestamp");
    const elem = document.getElementById("new-dot");

    if (
      elem &&
      (!localTimestamp || latestTimestamp > Number(localTimestamp)) &&
      account &&
      account.identity !== identity
    ) {
      elem.style.display = "block";
    }
  }
}

function handleClick(event) {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.querySelector("#overlay");
  const isClickOutside = !sidebar.contains(event.target);
  const isSidebarOpen =
    sidebar.style.left === "0" || sidebar.style.left === "0px";
  const isSidebarToggle = event.target.closest(".sidebar-toggle") !== null;
  const isClickOnOverlay = event.target === overlay;

  if (
    isSidebarToggle ||
    (isClickOutside && isSidebarOpen) ||
    isClickOnOverlay
  ) {
    toggleSidebar();
  }
}

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.querySelector("#overlay");
  const isSidebarOpen =
    sidebar.style.left === "0" || sidebar.style.left === "0px";
  var sidebarWidth;

  if (window.innerWidth >= 1200) {
    sidebarWidth = isSidebarOpen ? "-25%" : "0";
  } else if (window.innerWidth >= 768 && window.innerWidth < 1200) {
    sidebarWidth = isSidebarOpen ? "-30%" : "0";
  } else {
    sidebarWidth = isSidebarOpen ? "-75%" : "0";
  }

  sidebar.style.left = sidebarWidth;

  // If the sidebar is open, show the overlay, else hide it
  overlay.style.display = isSidebarOpen ? "none" : "block";
}

document.addEventListener("click", handleClick);

async function addSubmitButton(allowlist, delegations, toast) {
  const submitButtonContainer = document.getElementById("submit-button");
  if (submitButtonContainer) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const SubmitButton = (await import("./SubmitButton.jsx")).default;
    createRoot(submitButtonContainer).render(
      <StrictMode>
        <SubmitButton
          toast={toast}
          allowlist={allowlist}
          delegations={delegations}
        />
      </StrictMode>,
    );
  }
}

async function addVotes(allowlistPromise, delegationsPromise, toast) {
  const voteArrows = document.querySelectorAll(".votearrowcontainer");
  if (voteArrows && voteArrows.length > 0) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const Vote = (await import("./Vote.jsx")).default;

    voteArrows.forEach((arrow) => {
      const title = arrow.getAttribute("data-title");
      const href = arrow.getAttribute("data-href");
      const editorPicks = arrow.getAttribute("data-editorpicks");
      let upvoters;
      try {
        upvoters = JSON.parse(arrow.getAttribute("data-upvoters"));
      } catch (err) {
        console.log("Couldn't parse upvoters", err);
      }
      createRoot(arrow).render(
        <StrictMode>
          <Vote
            title={title}
            href={href}
            allowlistPromise={allowlistPromise}
            delegationsPromise={delegationsPromise}
            upvoters={upvoters}
            toast={toast}
            editorPicks={editorPicks}
          />
        </StrictMode>,
      );
    });
  }
}

async function addBuyButton(allowlistPromise, delegationsPromise, toast) {
  const buyButtonContainer = document.querySelector("#buy-button-container");
  if (buyButtonContainer) {
    const allowlist = await allowlistPromise;
    const delegations = await delegationsPromise;
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const BuyButton = (await import("./BuyButton.jsx")).default;
    createRoot(buyButtonContainer).render(
      <StrictMode>
        <BuyButton
          allowlist={allowlist}
          delegations={delegations}
          toast={toast}
        />
      </StrictMode>,
    );
  }
}

async function addCommentInput(toast, allowlist, delegations) {
  const commentInput = document.querySelector("nav-comment-input");
  if (commentInput) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const CommentInputComponent = (await import("./CommentInput.jsx")).default;
    createRoot(commentInput).render(
      <StrictMode>
        <CommentInputComponent
          toast={toast}
          allowlist={allowlist}
          delegations={delegations}
        />
      </StrictMode>,
    );
  }
}

async function addDelegateButton(allowlist, delegations, toast) {
  const delegateButtonContainer = document.querySelector(".delegate-button");
  if (delegateButtonContainer) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const DelegateButton = (await import("./DelegateButton.jsx")).default;
    createRoot(delegateButtonContainer).render(
      <StrictMode>
        <DelegateButton
          allowlist={allowlist}
          delegations={delegations}
          toast={toast}
        />
      </StrictMode>,
    );
  }
}

async function addConnectedComponents(allowlist, delegations, toast) {
  const { createRoot } = await import("react-dom/client");
  const { StrictMode } = await import("react");
  const {
    ConnectedSettings,
    ConnectedProfile,
    ConnectedLearnMore,
    ConnectedDisconnectButton,
    ConnectedConnectButton,
    RefreshButton,
    ConnectedBuyAdvert,
    ConnectedSimpleDisconnectButton,
  } = await import("./Navigation.jsx");
  const Bell = (await import("./Bell.jsx")).default;

  const bellButton = document.querySelector("#bell");
  bellButton.style = "";
  createRoot(bellButton).render(
    <StrictMode>
      <Bell allowlist={allowlist} delegations={delegations} />
    </StrictMode>,
  );

  const settings = document.querySelector("#nav-settings");
  createRoot(settings).render(
    <StrictMode>
      <ConnectedSettings allowlist={allowlist} delegations={delegations} />
    </StrictMode>,
  );
  const profileLink = document.querySelector("#nav-profile");
  createRoot(profileLink).render(
    <StrictMode>
      <ConnectedProfile allowlist={allowlist} delegations={delegations} />
    </StrictMode>,
  );
  const disconnect = document.querySelector("#nav-disconnect");
  createRoot(disconnect).render(
    <StrictMode>
      <ConnectedDisconnectButton />
    </StrictMode>,
  );

  const simpledisconnect = document.querySelector(
    "nav-simple-disconnect-button",
  );
  if (simpledisconnect) {
    createRoot(simpledisconnect).render(
      <StrictMode>
        <ConnectedSimpleDisconnectButton />
      </StrictMode>,
    );
  }
}

async function addSignupDialogue(allowlist, delegations) {
  const dialogue = document.querySelector("nav-signup-dialogue");
  if (dialogue) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const SignupDialogue = (await import("./SignupDialogue.jsx")).default;
    createRoot(dialogue).render(
      <StrictMode>
        <SignupDialogue allowlist={allowlist} delegations={delegations} />
      </StrictMode>,
    );
  }
}

async function addPasskeysDialogue(toast) {
  const elem = document.querySelector("nav-passkeys-backup");
  if (elem) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const Passkeys = (await import("./Passkeys.jsx")).default;
    const RedirectButton = () => {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <p
            style={{
              color: "black",
              padding: "1rem 3rem 1rem 3rem",
              fontSize: "1rem",
              textAlign: "center",
              marginTop: "1rem",
            }}
          >
            Your next step:
          </p>
          <a href="/invite">
            <button style={{ width: "auto" }} id="button-onboarding">
              Join our Telegram channel
            </button>
          </a>
        </div>
      );
    };
    createRoot(elem).render(
      <StrictMode>
        <Passkeys toast={toast} redirectButton={<RedirectButton />} />
      </StrictMode>,
    );
  }
}

async function addTGLink() {
  const elem = document.querySelector("nav-invite-link");
  if (elem) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const TelegramLink = (await import("./TelegramLink.jsx")).default;
    createRoot(elem).render(
      <StrictMode>
        <TelegramLink />
      </StrictMode>,
    );
  }
}

async function addSubscriptionButton() {
  const button = document.querySelector("push-subscription-button");
  if (button) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const PushSubscriptionButton = (
      await import("./PushSubscriptionButton.jsx")
    ).default;
    const wrapper = button.getAttribute("data-wrapper") === "true";
    createRoot(button).render(
      <StrictMode>
        <PushSubscriptionButton wrapper={wrapper} />
      </StrictMode>,
    );
  }

  const elem = document.querySelector("nav-push-notification-redirector");
  if (elem) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const { Redirector } = await import("./TelegramLink.jsx");
    createRoot(elem).render(
      <StrictMode>
        <Redirector />
      </StrictMode>,
    );
  }
}

async function addModals() {
  const nftmodal = document.querySelector("nav-nft-modal");
  if (nftmodal) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const NFTModal = (await import("./NFTModal.jsx")).default;
    createRoot(nftmodal).render(
      <StrictMode>
        <NFTModal />
      </StrictMode>,
    );
  }

  const onboarding = document.querySelector(".nav-onboarding-modal");
  if (onboarding) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const OnboardingModal = (await import("./OnboardingModal.jsx")).default;
    createRoot(onboarding).render(
      <StrictMode>
        <OnboardingModal />
      </StrictMode>,
    );
  }
}

async function addToaster() {
  const newElement = document.createElement("div");
  newElement.id = "new-element";
  document.body.appendChild(newElement);

  const { createRoot } = await import("react-dom/client");
  const { StrictMode } = await import("react");
  const { Toaster, toast } = await import("react-hot-toast");

  createRoot(newElement).render(
    <StrictMode>
      <Toaster />
    </StrictMode>,
  );
  return toast;
}

async function addAvatar(allowlist, delegations) {
  const avatarElem = document.querySelectorAll("nav-header-avatar");
  if (avatarElem && avatarElem.length > 0) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const Avatar = (await import("./Avatar.jsx")).default;
    avatarElem.forEach((element) => {
      createRoot(element).render(
        <StrictMode>
          <Avatar allowlist={allowlist} delegations={delegations} />
        </StrictMode>,
      );
    });
  }
}

async function addNFTPrice() {
  const nftPriceElements = document.querySelectorAll("nft-price");
  if (nftPriceElements && nftPriceElements.length > 0) {
    const { createRoot } = await import("react-dom/client");
    const { StrictMode } = await import("react");
    const NFTPrice = (await import("./NFTPrice.jsx")).default;
    nftPriceElements.forEach((element) => {
      const fee = element.getAttribute("data-fee");
      createRoot(element).render(
        <StrictMode>
          <NFTPrice fee={fee} />
        </StrictMode>,
      );
    });
  }
}

async function share(toast, index) {
  const FCIcon = (await import("./fcicon.jsx")).default;
  const toastContent = (
    <div style={{ display: "flex", alignItems: "center" }}>
      <a
        style={{ display: "flex", alignItems: "center" }}
        href={`https://warpcast.com/~/compose?embeds[]=https://news.kiwistand.com/stories?index=${index}`}
        target="_blank"
      >
        <FCIcon style={{ height: "15px", color: "white" }} />
        <span> </span>
        <span
          style={{
            marginLeft: "10px",
            textDecoration: "underline",
            color: "white",
          }}
        >
          Share your link on Warpcast
        </span>
      </a>
    </div>
  );

  const toastId = toast(toastContent, {
    duration: 10000,
    style: {
      position: "relative",
      top: `60px`,
      transform: "translate(-50%, -50%)", // You may need to adjust this
      backgroundColor: "#472a91",
    },
  });
}

async function checkMintStatus(fetchAllowList, fetchDelegations) {
  const url = new URL(window.location.href);
  if (url.pathname !== "/indexing") return;

  const address = url.searchParams.get("address");
  const delegate = url.searchParams.get("delegate");
  const { supportsPasskeys } = await import("./session.mjs");
  const { testPasskeys } = await import("./Passkeys.jsx");
  const intervalId = setInterval(async () => {
    const allowList = await fetchAllowList();
    const delegations = await fetchDelegations();

    if (
      !allowList.includes(address) ||
      !Object.values(delegations).includes(address)
    ) {
      console.log("Waiting for mint to be picked up...");
      return;
    }
    if (delegate && !Object.keys(delegations).includes(delegate)) {
      console.log("Waiting for delegate to be picked up");
      return;
    }

    console.log("Mint has been picked up by the node.");
    clearInterval(intervalId);
    if (supportsPasskeys() && (await testPasskeys())) {
      window.location.href = "/passkeys";
    } else {
      window.location.href = "/invite";
    }
  }, 3000);
}

async function start() {
  if (isRunningPWA()) {
    PullToRefresh.init({
      mainElement: "body",
      onRefresh() {
        window.location.reload();
      },
    });
  }
  commentCountSignifier();

  const toast = await addToaster();
  window.toast = toast;

  const { fetchAllowList, fetchDelegations } = await import("./API.mjs");
  checkMintStatus(fetchAllowList, fetchDelegations);

  const allowlistPromise = fetchAllowList();
  const delegationsPromise = fetchDelegations();

  // We're parallelizing all additions into the DOM
  const results = await Promise.allSettled([
    addVotes(allowlistPromise, delegationsPromise, toast),
    addCommentInput(toast, allowlistPromise, delegationsPromise),
    addSubscriptionButton(),
    addTGLink(),
    addPasskeysDialogue(toast),
    addSignupDialogue(await allowlistPromise, await delegationsPromise),
    addModals(),
    addNFTPrice(),
    addAvatar(await allowlistPromise, await delegationsPromise),
    addDelegateButton(await allowlistPromise, await delegationsPromise, toast),
    addBuyButton(allowlistPromise, delegationsPromise, toast),
    addConnectedComponents(
      await allowlistPromise,
      await delegationsPromise,
      toast,
    ),
    addSubmitButton(await allowlistPromise, await delegationsPromise, toast),
    checkNewStories(),
  ]);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Error in promise at index ${index}:`, result.reason);
    }
  });

  if (window.location.pathname === "/new") {
    let url = new URL(window.location.href);
    let index = url.searchParams.get("index");

    if (index) {
      share(toast, index);
      url.searchParams.delete("index");
      window.history.replaceState({}, "", url.href);
    }
  }
}

start();
