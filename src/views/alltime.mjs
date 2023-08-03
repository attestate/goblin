//@format
import { env } from "process";
import { URL } from "url";

import htm from "htm";
import vhtml from "vhtml";
import normalizeUrl from "normalize-url";
import { sub, differenceInMinutes } from "date-fns";
import { fetchBuilder, MemoryCache } from "node-fetch-cache";

import * as ens from "../ens.mjs";
import Header from "./components/header.mjs";
import SecondHeader from "./components/secondheader.mjs";
import Sidebar from "./components/sidebar.mjs";
import Footer from "./components/footer.mjs";
import Head from "./components/head.mjs";
import * as store from "../store.mjs";
import * as id from "../id.mjs";
import * as moderation from "./moderation.mjs";
import * as registry from "../chainstate/registry.mjs";
import log from "../logger.mjs";
import { EIP712_MESSAGE } from "../constants.mjs";
import Row from "./components/row.mjs";

const html = htm.bind(vhtml);
const fetch = fetchBuilder.withCache(
  new MemoryCache({
    ttl: 60000 * 5, //5mins
  })
);

function extractDomain(link) {
  const parsedUrl = new URL(link);
  return parsedUrl.hostname;
}

const itemAge = (timestamp) => {
  const now = new Date();
  const ageInMinutes = differenceInMinutes(now, new Date(timestamp * 1000));
  return ageInMinutes;
};

export function count(leaves) {
  const stories = {};

  leaves = leaves.sort((a, b) => a.timestamp - b.timestamp);
  for (const leaf of leaves) {
    const key = `${normalizeUrl(leaf.href)}`;
    let story = stories[key];

    if (!story) {
      story = {
        title: leaf.title,
        timestamp: leaf.timestamp,
        href: leaf.href,
        identity: leaf.identity,
        displayName: leaf.displayName,
        upvotes: 1,
        upvoters: [leaf.identity],
      };
      stories[key] = story;
    } else {
      if (leaf.type === "amplify") {
        story.upvotes += 1;
        story.upvoters.push(leaf.identity);
        if (!story.title && leaf.title) story.title = leaf.title;
      }
    }
  }
  return Object.values(stories);
}

async function topstories(leaves, start, end) {
  return count(leaves)
    .sort((a, b) => b.upvotes - a.upvotes) // Sort by upvotes, not considering time
    .slice(start, end);
}

export default async function index(trie, theme, page) {
  const from = null;
  const amount = null;
  const parser = JSON.parse;
  const allowlist = await registry.allowlist();
  const delegations = await registry.delegations();

  let leaves = await store.posts(
    trie,
    from,
    amount,
    parser,
    null,
    allowlist,
    delegations
  );
  const policy = await moderation.getLists();
  leaves = moderation.moderate(leaves, policy);

  const totalStories = parseInt(env.TOTAL_STORIES, 10);
  const start = totalStories * page;
  const end = totalStories * (page + 1);
  const storyPromises = await topstories(leaves, start, end);

  let stories = [];
  for await (let story of storyPromises) {
    const ensData = await ens.resolve(story.identity);
    let avatars = [];
    for await (let upvoter of story.upvoters) {
      const upvoterEnsData = await ens.resolve(upvoter);
      let avatarUrl = upvoterEnsData.avatar;
      if (avatarUrl && !avatarUrl.startsWith("https")) {
        avatarUrl = upvoterEnsData.avatar_url;
      }
      if (avatarUrl) {
        avatars.push(avatarUrl);
      }
    }
    stories.push({
      ...story,
      displayName: ensData.displayName,
      avatars: avatars,
    });
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
              ${SecondHeader(theme, "alltime")}
            </tr>
            <tr class="spacer" style="height:15px"></tr>
            ${stories.map(Row())}
            <tr class="spacer" style="height:15px"></tr>
            <tr
              style="display: block; padding: 10px; background-color: ${theme.color}"
            >
              <td></td>
            </tr>
          </table>
          ${Footer(theme, "/alltime")}
        </center>
      </body>
    </html>
  `;
}
