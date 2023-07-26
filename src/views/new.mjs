import { env } from "process";
import url from "url";

import htm from "htm";
import vhtml from "vhtml";
import normalizeUrl from "normalize-url";
import { formatDistanceToNow, sub } from "date-fns";

import * as ens from "../ens.mjs";
import Header from "./components/header.mjs";
import SecondHeader from "./components/secondheader.mjs";
import Sidebar from "./components/sidebar.mjs";
import Footer from "./components/footer.mjs";
import Head from "./components/head.mjs";
import * as store from "../store.mjs";
import * as moderation from "./moderation.mjs";
import * as registry from "../chainstate/registry.mjs";
import { count } from "./feed.mjs";

const html = htm.bind(vhtml);

function extractDomain(link) {
  const parsedUrl = new url.URL(link);
  return parsedUrl.hostname;
}

export default async function (trie, theme) {
  const config = await moderation.getLists();

  const aWeekAgo = sub(new Date(), {
    weeks: 1,
  });
  const from = null;
  const amount = null;
  const parser = JSON.parse;
  const aWeekAgoUnixTime = Math.floor(aWeekAgo.getTime() / 1000);
  const allowlist = await registry.allowlist();
  const delegations = await registry.delegations();
  let leaves = await store.posts(
    trie,
    from,
    amount,
    parser,
    aWeekAgoUnixTime,
    allowlist,
    delegations
  );
  leaves = moderation.moderate(leaves, config);

  let counts = count(leaves);
  let sortedCounts = counts.sort((a, b) => b.timestamp - a.timestamp);
  let slicedCounts = sortedCounts.slice(0, 40);

  let stories = [];
  for await (let item of slicedCounts) {
    const ensData = await ens.resolve(item.identity);
    stories.push({
      ...item,
      displayName: ensData.displayName,
    });
  }

  let farcasterLink = "";
  let popupHtml = "";
  if (queryParams.success === "true") {
    let submittedLink = decodeURIComponent(queryParams.submittedLink);
    farcasterLink = `https://warpcast.com/~/compose?embeds[]=${encodeURIComponent(
      submittedLink
    )}&text=(submitted%20to%20%40kiwi)&embeds[]=https://news.kiwistand.com`;

    popupHtml = `
      <p>Thanks for your submission. Your Kiwi Score increased by one 🥝!</p>
      <p>It’d be great if you shared your link on Farcaster, too.</p>
      <a href="${farcasterLink}" target="_blank">
        <img src="/Farcaster.png" alt="Farcaster icon" />
      </a>
    `;
  }

  return html`
    <html lang="en" op="news">
      <head>
        ${Head}
        <meta
          name="description"
          content="Explore the latest news in the decentralized world on Kiwi News. Stay updated with fresh content handpicked by crypto veterans."
        />
      </head>
      <body>
        ${Sidebar}
        <center>
          <table
            id="hnmain"
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="85%"
            bgcolor="#f6f6ef"
          >
            <tr>
              ${Header(theme)}
            </tr>
            <tr>
              ${SecondHeader(theme, "new")}
            </tr>
            ${stories.map(
              (story, i) => html`
                <tr>
                  <td>
                    <div style="padding: 10px 5px 0 10px;">
                      <div style="display: flex; align-items: flex-start;">
                        <div
                          style="font-size: 13pt; display: flex; align-items: center; min-width: 35px;"
                        >
                          <span>${i + 1}.</span>
                        </div>
                        <div
                          style="display: flex; align-items: center; min-width: 30px;"
                        >
                          <a href="#">
                            <div
                              class="votearrowcontainer"
                              data-title="${story.title}"
                              data-href="${story.href}"
                              data-upvoters="${JSON.stringify(story.upvoters)}"
                            ></div>
                          </a>
                        </div>
                        <div style="flex-grow: 1;">
                          <span>
                            <a
                              href="${story.href}"
                              target="_blank"
                              class="story-link"
                              style="line-height: 13pt; font-size: 13pt;"
                            >
                              ${story.title}
                            </a>
                            <span
                              style="padding-left: 5px; word-break: break-all;"
                              >(${extractDomain(story.href)})</span
                            >
                          </span>
                          <div style="margin-top: 2px; font-size: 10pt;">
                            <span>
                              ${story.upvotes}
                              <span> upvotes by </span>
                              <a
                                href="/upvotes?address=${story.identity}"
                                class="meta-link"
                              >
                                ${story.displayName}
                              </a>
                              <span> </span>
                              ${formatDistanceToNow(
                                new Date(story.timestamp * 1000)
                              )}
                              <span> ago | </span>
                              <a
                                target="_blank"
                                data-free="https://warpcast.com/~/compose?embeds[]=${story.href}&text=${encodeURIComponent(
                                  `(found on @kiwi)`
                                )}&embeds[]=https://news.kiwistand.com"
                                data-premium="https://warpcast.com/~/compose?embeds[]=${story.href}"
                                class="caster-link"
                              >
                                Cast
                              </a>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              `
            )}
            <tr class="spacer" style="height:15px"></tr>
          </table>
          ${Footer(theme, "/new")}
        </center>
        <div style="display: none" id="html-message">
        ${html([popupHtml])}
        </div>
        <script>
          function addFarcasterLinkToUrlParams() {
            const farcasterLink = document.querySelector(".caster-link");
          }
        </script>
      </body>
    </html>
  `;
}
