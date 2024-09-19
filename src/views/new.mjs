//@format
import { env } from "process";

import htm from "htm";
import vhtml from "vhtml";
import { sub } from "date-fns";
import normalizeUrl from "normalize-url";

import * as ens from "../ens.mjs";
import Header from "./components/header.mjs";
import SecondHeader from "./components/secondheader.mjs";
import Sidebar from "./components/sidebar.mjs";
import Footer from "./components/footer.mjs";
import { custom } from "./components/head.mjs";
import * as store from "../store.mjs";
import * as moderation from "./moderation.mjs";
import * as registry from "../chainstate/registry.mjs";
import { getLastComment, listNewest } from "../cache.mjs";
import Row, { extractDomain } from "./components/row.mjs";
import InviteRow from "./components/invite-row.mjs";
import * as feeds from "../feeds.mjs";
import * as price from "../price.mjs";

const html = htm.bind(vhtml);

let stories = [];
export function getStories() {
  return stories;
}

export function getLatestTimestamp() {
  if (stories.length === 0) {
    throw new Error("No stories available");
  }
  return stories[0].timestamp;
}

let inProgress = false;
export async function recompute() {
  if (inProgress) return;
  inProgress = true;

  let counts = listNewest();

  const path = "/new";
  const config = await moderation.getLists();
  counts = moderation.moderate(counts, config, path);
  const submittedHrefs = new Set(
    counts.map((story) => normalizeUrl(story.href)),
  );

  const feedStories = (await feeds.latest()).filter(
    (story) => !submittedHrefs.has(normalizeUrl(story.href)),
  );

  counts = [...counts, ...feedStories];
  let sortedCounts = counts.sort((a, b) => b.timestamp - a.timestamp);
  let slicedCounts = sortedCounts.slice(0, 40);

  let writers = [];
  try {
    writers = await moderation.getWriters();
  } catch (err) {
    // noop
  }

  let nextStories = [];
  for await (let story of slicedCounts) {
    if (!story.identity || !story.index || !story.upvoters) {
      nextStories.push({
        ...story,
        displayName: "Feedbot",
        avatars: [],
        upvoters: [],
        isOriginal: false,
      });
      continue;
    }

    const lastComment = getLastComment(`kiwi:0x${story.index}`);
    if (lastComment && lastComment.identity) {
      lastComment.identity = await ens.resolve(lastComment.identity);
    }

    const ensData = await ens.resolve(story.identity);

    let avatars = [];
    for await (let upvoter of story.upvoters) {
      const profile = await ens.resolve(upvoter);
      if (profile.safeAvatar) {
        avatars.push(profile.safeAvatar);
      }
    }
    const isOriginal = Object.keys(writers).some(
      (domain) =>
        normalizeUrl(story.href).startsWith(domain) &&
        writers[domain] === story.identity,
    );
    nextStories.push({
      ...story,
      lastComment,
      displayName: ensData.displayName,
      avatars: avatars,
      isOriginal,
    });
  }
  stories = nextStories;
  inProgress = false;
}

export default async function (trie, theme) {
  const mints = await registry.mints();
  const { reward, percentageOff } = await price.getReferralReward(mints);

  let items = stories;
  const path = "/new";
  const ogImage = "https://news.kiwistand.com/kiwi_new_feed_page.png";
  const recentJoiners = await registry.recents();
  return html`
    <html lang="en" op="news">
      <head>
        ${custom(ogImage)}
        <meta
          name="description"
          content="Explore the latest news in the decentralized world on Kiwi News. Stay updated with fresh content handpicked by crypto veterans."
        />
      </head>
      <body>
        <div class="container">
          ${Sidebar(path)}
          <div id="hnmain">
            <table border="0" cellpadding="0" cellspacing="0" bgcolor="#f6f6ef">
              <tr>
                ${await Header(theme)}
              </tr>
              <tr>
                ${SecondHeader(theme, "new")}
              </tr>
              ${items
                .slice(0, 5)
                .map(
                  Row(null, "/new", undefined, null, null, null, recentJoiners),
                )}
              ${InviteRow(reward, percentageOff)}
              ${items
                .slice(5)
                .map(
                  Row(null, "/new", undefined, null, null, null, recentJoiners),
                )}
            </table>
            ${Footer(theme, "/new")}
          </div>
        </div>
      </body>
    </html>
  `;
}
