//@format

// NOTE: Throughout this file we use Cloudflare-specific cache control headers:
// - s-maxage: Controls Cloudflare CDN caching duration
// - stale-while-revalidate: We implement a custom worker on news.kiwistand.com 
//   to handle stale-while-revalidate since Cloudflare doesn't support this natively

import { env } from "process";
import { readFile } from "fs/promises";
import path, { basename } from "path";

import morgan from "morgan";
import express from "express";
import cookieParser from "cookie-parser";
import { utils } from "ethers";
import htm from "htm";
import "express-async-errors";
import { sub } from "date-fns";
import DOMPurify from "isomorphic-dompurify";
import ws from "ws";
import { createServer } from "http";
import { FileSystemCache, getCacheKey } from "node-fetch-cache";

import * as registry from "./chainstate/registry.mjs";
import log from "./logger.mjs";
import { SCHEMATA } from "./constants.mjs";
import theme from "./theme.mjs";
import feed, { index } from "./views/feed.mjs";
import story, { generateStory } from "./views/story.mjs";
import newest, * as newAPI from "./views/new.mjs";
import best, * as bestAPI from "./views/best.mjs";
import privacy from "./views/privacy.mjs";
import guidelines from "./views/guidelines.mjs";
import onboarding from "./views/onboarding.mjs";
import referral from "./views/referral.mjs";
import join from "./views/join.mjs";
import kiwipass from "./views/kiwipass.mjs";
import gateway from "./views/gateway.mjs";
import kiwipassmint from "./views/kiwipass-mint.mjs";
import friends from "./views/friends.mjs";
import whattosubmit from "./views/whattosubmit.mjs";
import onboardingReader from "./views/onboarding-reader.mjs";
import onboardingCurator from "./views/onboarding-curator.mjs";
import onboardingSubmitter from "./views/onboarding-submitter.mjs";
import shortcut from "./views/shortcut.mjs";
import subscribe from "./views/subscribe.mjs";
import upvotes from "./views/upvotes.mjs";
import community from "./views/community.mjs";
import stats from "./views/stats.mjs";
import users from "./views/users.mjs";
import basics from "./views/basics.mjs";
import retention from "./views/retention.mjs";
import * as activity from "./views/activity.mjs";
import * as comments from "./views/comments.mjs";
import about from "./views/about.mjs";
import why from "./views/why.mjs";
import submit from "./views/submit.mjs";
import settings from "./views/settings.mjs";
import start from "./views/start.mjs";
import indexing from "./views/indexing.mjs";
import invite from "./views/invite.mjs";
import passkeys from "./views/passkeys.mjs";
import appOnboarding from "./views/app-onboarding.mjs";
import appTestflight from "./views/app-testflight.mjs";
import demonstration from "./views/demonstration.mjs";
import notifications from "./views/notifications.mjs";
import pwa from "./views/pwa.mjs";
import pwaandroid from "./views/pwaandroid.mjs";
import * as curation from "./views/curation.mjs";
import * as moderation from "./views/moderation.mjs";
import { parse, metadata } from "./parser.mjs";
import { toAddress, resolve } from "./ens.mjs";
import * as preview from "./preview.mjs";
import * as store from "./store.mjs";
import * as ens from "./ens.mjs";
import * as karma from "./karma.mjs";
import * as frame from "./frame.mjs";
import * as subscriptions from "./subscriptions.mjs";
import * as telegram from "./telegram.mjs";
import * as email from "./email.mjs";
import * as price from "./price.mjs";
import {
  getRandomIndex,
  getSubmission,
  trackOutbound,
  getRecommendations,
} from "./cache.mjs";

const app = express();
const server = createServer(app);

app.set("etag", false);
app.use((req, res, next) => {
  res.setHeader("Last-Modified", new Date().toUTCString());
  next();
});

app.use(
  morgan(
    ':remote-addr - :remote-user ":method :url" :status ":referrer" ":user-agent"',
  ),
);
app.use(
  "/assets",
  express.static("src/public/assets", {
    setHeaders: (res, pathName) => {
      if (env.NODE_ENV === "production") {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);

app.use(
  express.static("src/public", {
    setHeaders: (res, pathName) => {
      if (env.NODE_ENV !== "production") return;
      if (!/\/assets\//.test(pathName)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  }),
);
app.use(express.json());
app.use(cookieParser());

// NOTE: We use s-maxage for Cloudflare CDN caching, while max-age controls browser caching
app.get("/.well-known/apple-app-site-association", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000");
  res.json({
    "webcredentials": {
      "apps": [
        "SKFAD6UPBF.attestate.Kiwi-News-iOS"
      ]
    },
    "applinks": {
      "apps": [],
      "details": [
        {
          "appIDs": ["SKFAD6UPBF.attestate.Kiwi-News-iOS"],
          "components": [
            {
              "/": "/*",
              "comment": "Matches all URLs"
            }
          ]
        }
      ]
    }
  });
});

function loadTheme(req, res, next) {
  res.locals.theme = theme;
  next();
}

app.use(loadTheme);

// NOTE: sendError and sendStatus are duplicated here (compare with
// /src/api.mjs) because eventually we wanna rip apart the Kiwi News website
// from the node software.
function sendError(reply, code, message, details) {
  log(`http error: "${code}", "${message}", "${details}"`);
  return reply.status(code).json({
    status: "error",
    code,
    message,
    details,
  });
}

function sendStatus(reply, code, message, details, data) {
  const obj = {
    status: "success",
    code,
    message,
    details,
  };
  if (data) obj.data = data;
  return reply.status(code).json(obj);
}

export async function launch(trie, libp2p) {
  const wss = new ws.Server({ noServer: true });
  const clients = new Set();

  app.use((err, req, res, next) => {
    log(`Express error: "${err.message}", "${err.stack}"`);
    res.status(500).send("Internal Server Error");
  });

  // NOTE: If you're reading this as an external contributor, yes the
  // fingerprint.mjs file isn't distributed along with the other code because
  // we must not allow people to understand what the criteria are that cast a
  // requester a unique user. Users can control all aspects of a request, so if
  // we'd open source this functionality, users could game the request to
  // increase their ranking on the site.
  let fingerprint;
  try {
    fingerprint = await import("./fingerprint.mjs");
  } catch (err) {
    fingerprint = await import("./fingerprint_example.mjs");
  }
  app.get("/random", async (request, reply) => {
    reply.header("Cache-Control", "no-cache");
    let index;
    try {
      index = getRandomIndex();
    } catch (err) {
      return reply.status(404).send("Not Found");
    }
    return reply.redirect(`/stories?index=${index}`);
  });
  function removeReferrerParams(link) {
    const url = new URL(link);
    if (url.hostname.endsWith("mirror.xyz")) {
      url.searchParams.delete("referrerAddress");
    } else if (
      url.hostname.endsWith("paragraph.xyz") ||
      url.hostname.endsWith("zora.co") ||
      url.hostname.endsWith("manifold.xyz")
    ) {
      url.searchParams.delete("referrer");
    } else if (url.hostname.endsWith("foundation.app")) {
      url.searchParams.delete("ref");
    }
    return url.toString();
  }
  app.post("/outbound", async (request, reply) => {
    reply.header("Cache-Control", "no-cache");
    const { url } = request.query;
    if (!url) {
      return reply.status(400).send("URL parameter is required");
    }
    if (!fingerprint) {
      return reply.redirect(url);
    }

    const hash = fingerprint.generate(request);
    const cleanUrl = removeReferrerParams(url);
    trackOutbound(cleanUrl, hash);
    return reply.status(204).send();
  });
  app.get("/outbound", async (request, reply) => {
    reply.header("Cache-Control", "no-cache");
    const { url } = request.query;
    if (!url) {
      return reply.status(400).send("URL parameter is required");
    }
    if (!fingerprint) {
      return reply.redirect(url);
    }

    const hash = fingerprint.generate(request);
    const cleanUrl = removeReferrerParams(url);
    trackOutbound(cleanUrl, hash);

    return reply.redirect(url);
  });
  app.get("/friends", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=3600, max-age=3600, stale-while-revalidate=86400",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await friends(reply.locals.theme));
  });
  app.get("/kiwipass-mint", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=604800",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await kiwipassmint(reply.locals.theme));
  });
  app.post("/api/v1/search", async (req, reply) => {
    let response;
    try {
      const apiUrl = "https://knsearch.x4901.xyz/api/v1/search";
      const requestOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-API-Key": process.env.KN_SEARCH_API_KEY,
        },
        body: JSON.stringify({
          query: req.body.query,
          sort: "popularity",
        }),
      };
      response = await fetch(apiUrl, requestOptions);
    } catch (error) {
      const code = 500;
      const httpMessage = "Internal Server Error";
      const details = "Failed to connect to search service";
      return sendError(reply, code, httpMessage, details);
    }

    if (!response.ok) {
      const code = response.status;
      const httpMessage = "Search Request Failed";
      const details = `Search service responded with status ${response.status}`;
      return sendError(reply, code, httpMessage, details);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      const code = 500;
      const httpMessage = "Internal Server Error";
      const details = "Failed to parse search results";
      return sendError(reply, code, httpMessage, details);
    }

    const code = 200;
    const httpMessage = "OK";
    const details = "Search completed successfully";
    return sendStatus(reply, code, httpMessage, details, data);
  });
  app.get("/api/v1/sales", async (request, reply) => {
    if (request.query.granularity === "all") {
      const data = await price.getSalesData();
      const csv = [
        Object.keys([0]).join(","),
        ...data.map((row) => Object.values(row).join(",")),
      ].join("\n");

      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", 'attachment; filename="sales.csv"');
      reply.send(csv);
    }
    if (request.query.granularity === "week") {
      const sales = await price.getSalesData();
      const weeklySales = price.calcWeeklyIncome(sales);
      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", 'attachment; filename="sales.csv"');
      reply.send(weeklySales);
    }
  });
  app.delete("/api/v1/cache", async (req, res) => {
    const { url } = req.body;

    if (!url) {
      const code = 400;
      const message = "Invalid request";
      const details = "URL required";
      return sendError(res, code, message, details);
    }

    const cache = new FileSystemCache({
      cacheDirectory: path.resolve(env.CACHE_DIR),
    });

    try {
      const key = getCacheKey(url);
      await cache.remove(key);

      const code = 200;
      const message = "Cache entry removed";
      const details = "Successfully removed cache entry";
      return sendStatus(res, code, message, details);
    } catch (err) {
      const code = 500;
      const message = "Cache removal failed";
      return sendError(res, code, message);
    }
  });
  app.get("/unsubscribe/:secret", async (req, res) => {
    const { secret } = req.params;

    try {
      const success = await email.unsubscribe(secret);
      if (!success) {
        return res.status(404).send("Invalid or expired unsubscribe link");
      }

      res.send(`
       <html>
         <body>
           <h1>Unsubscribed</h1>
           <p>You have been successfully unsubscribed from notifications.</p>
         </body>
       </html>
     `);
    } catch (err) {
      console.error("Unsubscribe error:", err);
      res.status(500).send("Error processing unsubscribe request");
    }
  });

  app.post("/api/v1/email-notifications", async (request, reply) => {
    const message = request.body;
    const testExpr = /.+@.+\..+/;

    if (!message || message.type !== "EMAILAUTH") {
      return sendError(reply, 400, "Bad Request", "Invalid message type");
    }

    if (message.title === message.href && !testExpr.test(message.title)) {
      return sendError(
        reply,
        400,
        "Bad Request",
        "Title and href must be emails and the same",
      );
    }
    const userEmail = message.title;

    try {
      const identity = await email.validate(message);
      await email.addSubscription(identity, userEmail);

      const code = 200;
      const httpMessage = "OK";
      const details = "Successfully subscribed to email notifications";
      return sendStatus(reply, code, httpMessage, details);
    } catch (err) {
      const code = 500;
      const httpMessage = "Internal Server Error";
      const details = err.toString();
      return sendError(reply, code, httpMessage, details);
    }
  });

  app.post("/api/v1/telegram", async (request, reply) => {
    const message = request.body;
    // NOTE: The message here is ALMOST a compliant Kiwi News amplify or
    // comment message just to not having to implement an entirely new
    // validation flow for signing and validating a message. However, we
    // wouldn't want this message to be circulated on the protocol and so we
    // intentionally set all properties to TGAUTH.
    if (
      !message ||
      message.title !== "TGAUTH" ||
      message.href !== "TGAUTH" ||
      message.type !== "TGAUTH"
    ) {
      const code = 400;
      const httpMessage = "Bad Request";
      const details = "Body must include title and href with value 'TGAUTH'.";
      return sendError(reply, code, httpMessage, details);
    }
    let inviteLink;
    try {
      inviteLink = await telegram.generateLink(message);
    } catch (err) {
      const code = 400;
      const httpMessage = "Bad Request";
      const details = err.toString();
      return sendError(reply, code, httpMessage, details);
    }
    const code = 200;
    const httpMessage = "OK";
    const details = "Successfully generated Telegram link.";
    return sendStatus(reply, code, httpMessage, details, { link: inviteLink });
  });
  app.post("/api/v1/mint/success", async (request, reply) => {
    const content = frame.callback(request.body?.untrustedData?.transactionId);
    const code = 200;
    reply.header("Cache-Control", "no-cache");
    return reply.status(code).type("text/html").send(content);
  });
  app.post("/api/v1/mint/:referral?", async (request, reply) => {
    let referral;
    try {
      referral = utils.getAddress(request.params.referral);
    } catch (err) {}

    let data;
    try {
      data = await frame.buy(referral);
    } catch (err) {
      const code = 500;
      const httpMessage = "Internal Server Error";
      const details = err.toString();
      return sendError(reply, code, httpMessage, details);
    }
    const code = 200;
    reply.header("Cache-Control", "no-cache");
    return reply.status(code).json(data);
  });
  app.post("/api/v1/subscriptions/:address", async (request, reply) => {
    function isValidWebPushSubscription(subscription) {
      if (!subscription || typeof subscription !== "object") {
        return false;
      }

      const { endpoint, keys } = subscription;

      if (!endpoint || typeof endpoint !== "string") {
        return false;
      }

      if (!keys || typeof keys !== "object" || !keys.p256dh || !keys.auth) {
        return false;
      }

      return true;
    }
    reply.header("Cache-Control", "no-cache");

    let address;
    try {
      address = utils.getAddress(request.params.address);
    } catch (err) {
      const code = 400;
      const httpMessage = "Bad Request";
      const details =
        "Please only submit subscription along with a valid Ethereum addresses.";
      reply.header("Cache-Control", "public, max-age=0,  must-revalidate");
      return sendError(reply, code, httpMessage, details);
    }

    if (!isValidWebPushSubscription(request.body)) {
      const code = 400;
      const httpMessage = "Bad Request";
      const details = "Error storing subscription";
      reply.header("Cache-Control", "public, max-age=0, must-revalidate");
      return sendError(reply, code, httpMessage, details);
    }

    try {
      subscriptions.store(address, request.body);
    } catch (err) {
      const code = 500;
      const httpMessage = "Internal Server Error";
      const details = "Error storing subscription";
      reply.header("Cache-Control", "public, max-age=0, must-revalidate");
      return sendError(reply, code, httpMessage, details);
    }

    const code = 200;
    const httpMessage = "OK";
    const details = "Successfully subscribed via push notifications";
    return sendStatus(reply, code, httpMessage, details);
  });
  app.get("/api/v1/metadata", async (request, reply) => {
    reply.header("Cache-Control", "no-cache");

    let data;
    try {
      data = await metadata(request.query.url);
    } catch (err) {
      log(`parser.metadata failure: ${err.stack}`);
      const code = 500;
      const httpMessage = "Internal Server Error";
      const details = "Failed to parse link metadata";
      return sendError(reply, code, httpMessage, details);
    }
    const code = 200;
    const httpMessage = "OK";
    const details = "Downloaded and parsed URL's metadata";
    return sendStatus(reply, code, httpMessage, details, data);
  });
  app.get("/api/v1/price", async (request, reply) => {
    reply.header("Cache-Control", "no-cache");
    const mints = await registry.mints();
    const value = await price.getPrice(mints);
    const code = 200;
    const httpMessage = "OK";
    const details = "Calculated current price";
    return sendStatus(reply, code, httpMessage, details, {
      price: value.price.toString(),
    });
  });
  app.get("/api/v1/parse", async (request, reply) => {
    const embed = await parse(request.query.url);
    reply.header("Cache-Control", "no-cache");
    return reply.status(200).type("text/html").send(embed);
  });
  app.get("/api/v1/karma/:address", async (request, reply) => {
    let address;
    try {
      address = utils.getAddress(request.params.address);
    } catch (err) {
      const code = 400;
      const httpMessage = "Bad Request";
      const details = "Please only submit valid Ethereum addresses.";
      reply.header("Cache-Control", "public, max-age=0, must-revalidate");
      return sendError(reply, code, httpMessage, details);
    }

    const points = karma.resolve(address);
    const code = 200;
    const httpMessage = "OK";
    const details = `Karma`;
    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=259200",
    );
    return sendStatus(reply, code, httpMessage, details, {
      address,
      karma: points,
    });
  });
  app.get("/api/v1/feeds/:name", async (request, reply) => {
    let stories = [];
    if (request.params.name === "hot") {
      let page = parseInt(request.query.page);
      if (isNaN(page) || page < 1) {
        page = 0;
      }

      let results;
      const domain = undefined;
      const lookback = sub(new Date(), {
        weeks: 3,
      });
      const paginate = false;
      const showAd = false;
      const showContest = false;
      const appCuration = request.query.curation === "true";
      try {
        results = await index(
          trie,
          page,
          domain,
          lookback,
          paginate,
          showAd,
          showContest,
          appCuration,
        );
      } catch (err) {
        log(`Error in api/v1/feeds/hot: ${err.stack}`);
      }
      reply.header(
        "Cache-Control",
        "public, s-maxage=300, max-age=300,  must-revalidate, stale-while-revalidate=30",
      );
      stories = results.stories;
    } else if (request.params.name === "new") {
      reply.header("Cache-Control", "no-cache");

      try {
        stories = newAPI.getStories();
      } catch (err) {
        log(`Error in api/v1/feeds/new: ${err.stack}`);
      }
    } else if (request.params.name === "best") {
      reply.header(
        "Cache-Control",
        "public, s-maxage=3600, max-age=3600, must-revalidate, stale-while-revalidate=86400",
      );

      let page = parseInt(request.query.page);
      if (isNaN(page) || page < 1) {
        page = 0;
      }

      const periodValues = ["all", "year", "month", "week", "day"];
      let { period } = request.query;
      if (!period || !periodValues.includes(period)) {
        period = "week";
      }

      try {
        stories = await bestAPI.getStories(
          trie,
          page,
          period,
          request.query.domain,
        );
      } catch (err) {
        log(`error in /api/v1/feeds/best: ${err.stack}`);
      }
    } else {
      const code = 501;
      const httpMessage = "Not Implemented";
      const details =
        "We currently don't implement any other endpoint but 'hot' and 'new'";
      reply.header("Cache-Control", "public, max-age=0, must-revalidate");
      return sendError(reply, code, httpMessage, details);
    }

    const code = 200;
    const httpMessage = "OK";
    const details = `${request.params.name} feed`;
    return sendStatus(reply, code, httpMessage, details, { stories });
  });

  app.get("/api/v1/stories", async (request, reply) => {
    let submission;

    const index = request.query.index;
    try {
      submission = getSubmission(index);
    } catch (e) {
      log(`/api/v1/stories: Error in getSubmission: ${err.stack}`);
      const code = 404;
      const httpMessage = "Not Found";
      const details = "Couldn't find the submission";
      return sendError(reply, code, httpMessage, details);
    }

    const identities = new Set();
    submission.comments.forEach((comment) => {
      identities.add(comment.identity);
      comment.reactions.forEach((reaction) => {
        reaction.reactors.forEach((reactor) => identities.add(reactor));
      });
    });

    const profileResults = await Promise.allSettled(
      Array.from(identities).map((id) => resolve(id)),
    );

    const profiles = Object.fromEntries(
      Array.from(identities).map((id, i) => [
        id,
        profileResults[i].status === "fulfilled"
          ? profileResults[i].value
          : null,
      ]),
    );

    const enrichedComments = submission.comments.map((comment) => ({
      ...comment,
      identity: profiles[comment.identity],
      reactions: comment.reactions.map((reaction) => ({
        ...reaction,
        reactorProfiles: reaction.reactors
          .map((reactor) => profiles[reactor])
          .filter(Boolean),
      })),
    }));

    reply.header(
      "Cache-Control",
      "public, s-maxage=10, max-age=10, stale-while-revalidate=31536000",
    );
    const code = 200;
    const httpMessage = "OK";
    const details = "Responding with story queried by index";
    return sendStatus(reply, code, httpMessage, details, {
      ...submission,
      comments: enrichedComments,
    });
  });

  app.get("/gateway", async (request, reply) => {
    let referral;
    try {
      referral = utils.getAddress(request.query.referral);
    } catch (err) {
      //noop
    }

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=259200",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await gateway(referral));
  });

  app.get("/", async (request, reply) => {
    let identity, hash;
    if (request.query.custom === "true") {
      hash = fingerprint.generate(request);
    }

    try {
      identity = utils.getAddress(request.query.identity);
      hash = fingerprint.generate(request);
    } catch (err) {}

    let page = parseInt(request.query.page);
    if (isNaN(page) || page < 1) {
      page = 0;
    }

    let content;
    try {
      content = await feed(
        trie,
        reply.locals.theme,
        page,
        DOMPurify.sanitize(request.query.domain),
        identity,
        hash,
      );
    } catch (err) {
      log(`Error in /: ${err.stack}`);
      return reply.status(500).send("Internal Server Error");
    }
    reply.header(
      "Cache-Control",
      "public, s-maxage=5, max-age=5, stale-while-revalidate=3600",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/stories/:slug?", async (request, reply) => {
    if (request.params.slug) {
      // NOTE: The slug is used to make the story URL more human readable, at
      // the same time though, the slug is really just cosmetical as the index
      // always informs about the actual origin of a domain
      reply.header("Cache-Control", "public, max-age=31536000, immutable");
      const queryParams = new URLSearchParams(request.query).toString();
      return reply.redirect(`/stories?${queryParams}`);
    }

    let referral;
    try {
      referral = utils.getAddress(request.query.referral);
    } catch (err) {}

    let submission;
    try {
      submission = await generateStory(request.query.index);
    } catch (err) {
      return reply.status(404).type("text/plain").send(err.message);
    }

    const hexIndex = request.query.index.substring(2);
    const content = await story(
      trie,
      reply.locals.theme,
      DOMPurify.sanitize(hexIndex),
      submission,
      referral,
    );
    reply.header(
      "Cache-Control",
      "public, s-maxage=10, max-age=10, stale-while-revalidate=31536000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  // NOTE: During the process of combining the feed and the editor's picks, we
  // decided to expose people to the community pick's tab right from the front
  // page, which is why while deprecating the /feed, we're forwarding to root.
  app.get("/feed", function (req, res) {
    res.redirect(301, "/");
  });
  app.get("/dau", function (req, res) {
    res.redirect(301, "/stats");
  });
  app.get("/new", async (request, reply) => {
    const content = await newest(trie, reply.locals.theme);
    let timestamp;

    // NOTE: Especially for international customers /new got embarassingly slow
    // taking up to 2s to load as the page had to served previously from
    // Germany and not via Cloudflare. Now when the `cached` QS is present
    // we'll allow this page to be cached. We'll only use this configuration
    // when the user visits the new page looking for new content, not right
    // after submission.
    if (request.query.cached) {
      reply.header(
        "Cache-Control",
        "public, s-maxage=1, max-age=1, stale-while-revalidate=5",
      );
    } else {
      reply.header("Cache-Control", "no-cache");
    }

    return reply.status(200).type("text/html").send(content);
  });
  app.get("/alltime", function (req, res) {
    return res.redirect(301, "/best?period=all");
  });
  app.get("/best", async (request, reply) => {
    let page = parseInt(request.query.page);
    if (isNaN(page) || page < 1) {
      page = 0;
    }

    const periodValues = ["all", "year", "month", "week", "day"];
    let { period } = request.query;
    if (!period || !periodValues.includes(period)) {
      period = "week";
    }

    let content;
    try {
      content = await best(
        trie,
        reply.locals.theme,
        page,
        period,
        DOMPurify.sanitize(request.query.domain),
      );
    } catch (err) {
      log(`Error rendering /best ${err.stack}`);
      return reply.status(500).send("Internal Server Error");
    }

    reply.header(
      "Cache-Control",
      "public, s-maxage=3600, max-age=3600, stale-while-revalidate=2592000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/community", async (request, reply) => {
    const content = await community(
      trie,
      reply.locals.theme,
      request.query,
      DOMPurify.sanitize(request.cookies.identity),
    );

    reply.header("Cache-Control", "private, must-revalidate");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/price", async (request, reply) => {
    const content = await price.chart(reply.locals.theme);
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/retention", async (request, reply) => {
    const content = await retention(trie, reply.locals.theme);
    reply.header(
      "Cache-Control",
      "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=120",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/users", async (request, reply) => {
    const content = await users(trie, reply.locals.theme);
    reply.header(
      "Cache-Control",
      "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=120",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/basics", async (request, reply) => {
    const content = await basics(trie, reply.locals.theme);
    reply.header(
      "Cache-Control",
      "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=120",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/stats", async (request, reply) => {
    const content = await stats(trie, reply.locals.theme);
    reply.header(
      "Cache-Control",
      "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=120",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/about", async (request, reply) => {
    const content = await about(reply.locals.theme);

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/passkeys", async (request, reply) => {
    const content = await passkeys(reply.locals.theme);

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });

  app.get("/app-onboarding", async (request, reply) => {
    const content = await appOnboarding(reply.locals.theme);

    reply.header(
      "Cache-Control", 
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });

  app.get("/app-testflight", async (request, reply) => {
    const content = await appTestflight(reply.locals.theme);

    reply.header(
      "Cache-Control", 
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/pwaandroid", async (request, reply) => {
    const content = await pwaandroid(reply.locals.theme);

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/pwa", async (request, reply) => {
    const content = await pwa(reply.locals.theme);

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/notifications", async (request, reply) => {
    const content = await notifications(reply.locals.theme);

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/demonstration", async (request, reply) => {
    const content = await demonstration(reply.locals.theme);

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/invite", async (request, reply) => {
    const content = await invite(reply.locals.theme);

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/indexing", async (request, reply) => {
    const content = await indexing(reply.locals.theme);

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/start", async (request, reply) => {
    const content = await start(reply.locals.theme);

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/settings", async (request, reply) => {
    const content = await settings(
      reply.locals.theme,
      DOMPurify.sanitize(request.cookies.identity),
    );

    reply.header(
      "Cache-Control",
      "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=86400",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/why", async (request, reply) => {
    const content = await why(reply.locals.theme, request.cookies.identity);

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  // TODO: Remove this page after having removed its links from the page for a
  // few days or weeks
  app.get("/comments", async (request, reply) => {
    let data;
    try {
      data = await comments.data();
    } catch (err) {
      return reply.status(400).type("text/plain").send(err.toString());
    }
    const content = await comments.page(reply.locals.theme, data.notifications);
    reply.header(
      "Cache-Control",
      "public, max-age=10, no-transform, must-revalidate, stale-while-revalidate=3600",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/api/v1/activity", async (request, reply) => {
    let data;

    const skipDetails = true;
    try {
      data = await activity.data(
        trie,
        DOMPurify.sanitize(request.cookies.identity || request.query.address),
        parseInt(request.cookies.lastUpdate, 10),
        skipDetails,
      );
    } catch (err) {
      log(`Error getting activity data: ${err.stack}`);
      const code = 400;
      const httpMessage = "Bad Request";
      return sendError(reply, code, httpMessage, "Invalid query parameters");
    }
    const code = 200;
    const httpMessage = "OK";
    const details = "Notifications feed";

    reply.header(
      "Cache-Control",
      "public, maxage=10, s-maxage=10, stale-while-revalidate=3600",
    );
    return sendStatus(reply, code, httpMessage, details, {
      notifications: data.notifications,
      lastServerValue: data.latestValue,
    });
  });
  app.get("/activity", async (request, reply) => {
    let data;
    try {
      data = await activity.data(
        trie,
        DOMPurify.sanitize(request.cookies.identity || request.query.address),
        parseInt(request.cookies.lastUpdate, 10),
      );
    } catch (err) {
      return reply.status(400).type("text/plain").send(err.toString());
    }
    const content = await activity.page(
      reply.locals.theme,
      DOMPurify.sanitize(request.cookies.identity || request.query.address),
      data.notifications,
      parseInt(request.cookies.lastUpdate, 10),
    );
    if (data && data.lastUpdate) {
      reply.cookie("lastUpdate", data.lastUpdate, {
        maxAge: 60 * 60 * 24 * 7 * 1000,
      });
    }
    reply.header("Cache-Control", "no-cache");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/subscribe", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await subscribe(reply.locals.theme));
  });
  app.get("/privacy-policy", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await privacy(reply.locals.theme));
  });
  app.get("/guidelines", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await guidelines(reply.locals.theme));
  });
  app.get("/onboarding", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=3600, max-age=3600, stale-while-revalidate=864000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(
        await onboarding(
          reply.locals.theme,
          DOMPurify.sanitize(request.cookies.identity),
        ),
      );
  });
  app.get("/whattosubmit", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await whattosubmit(reply.locals.theme));
  });
  app.get("/referral", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=3600, max-age=3600, stale-while-revalidate=864000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await referral(reply.locals.theme));
  });
  app.get("/onboarding-reader", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=3600, max-age=3600, stale-while-revalidate=864000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(
        await onboardingReader(
          reply.locals.theme,
          DOMPurify.sanitize(request.cookies.identity),
        ),
      );
  });
  app.get("/onboarding-curator", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=3600, max-age=3600, stale-while-revalidate=864000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(
        await onboardingCurator(
          reply.locals.theme,
          DOMPurify.sanitize(request.cookies.identity),
        ),
      );
  });
  app.get("/onboarding-submitter", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=3600, max-age=3600, stale-while-revalidate=864000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(
        await onboardingSubmitter(
          reply.locals.theme,
          DOMPurify.sanitize(request.cookies.identity),
        ),
      );
  });
  app.get("/welcome", async (request, reply) => {
    reply.header("Cache-Control", "public, must-revalidate");
    return reply
      .status(200)
      .type("text/html")
      .send(await join(reply.locals.theme));
  });
  app.get("/kiwipass", async (request, reply) => {
    reply.header("Cache-Control", "public, must-revalidate");
    return reply
      .status(200)
      .type("text/html")
      .send(await kiwipass(reply.locals.theme));
  });
  app.get("/shortcut", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await shortcut(reply.locals.theme));
  });

  async function getProfile(
    trie,
    theme,
    address,
    page,
    mode,
    enabledFrame = false,
  ) {
    let activeMode = "top";
    if (mode === "new") activeMode = "new";

    page = parseInt(page);
    if (isNaN(page) || page < 1) {
      page = 0;
    }
    const content = await upvotes(
      trie,
      theme,
      address,
      page,
      activeMode,
      enabledFrame,
    );
    return content;
  }
  app.get("/profile", async (request, reply) => {
    if (!utils.isAddress(request.cookies.identity)) {
      // NOTE: We redirect to community in case the user isn't logged in
      return reply.redirect(301, `/gateway`);
    }
    const profile = await resolve(request.cookies.identity);
    if (profile.ens) {
      return reply.redirect(301, `/${profile.ens}`);
    }
    return reply.redirect(301, `/upvotes?address=${request.cookies.identity}`);
  });
  app.get("/upvotes", async (request, reply) => {
    if (!utils.isAddress(request.query.address)) {
      return reply
        .status(404)
        .type("text/plain")
        .send("No valid Ethereum address");
    }
    const profile = await resolve(request.query.address);
    if (profile && profile.ens) {
      reply.header(
        "Cache-Control",
        "public, s-maxage=86400, max-age=86400, stale-while-revalidate=86400",
      );
      return reply.redirect(301, `/${profile.ens}`);
    }

    const content = await getProfile(
      trie,
      reply.locals.theme,
      request.query.address,
      DOMPurify.sanitize(request.query.page),
      DOMPurify.sanitize(request.query.mode),
      request.query.frame === "true",
    );

    if (request.query.mode === "new") {
      reply.header(
        "Cache-Control",
        "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
      );
    } else if (!request.query.mode || request.query.mode == "top") {
      reply.header(
        "Cache-Control",
        "public, s-maxage=86400, max-age=86400, stale-while-revalidate=86400",
      );
    } else {
      reply.header(
        "Cache-Control",
        "public, s-maxage=3600, max-age=3600, stale-while-revalidate=60",
      );
    }

    return reply.status(200).type("text/html").send(content);
  });

  app.get("/submit", async (request, reply) => {
    if (!utils.isAddress(request.cookies.identity)) {
      return reply.redirect(301, `/gateway`);
    }

    const { url, title } = request.query;
    const content = await submit(
      reply.locals.theme,
      DOMPurify.sanitize(url),
      DOMPurify.sanitize(title),
    );

    if (url || title) {
      reply.header(
        "Cache-Control",
        "public, s-maxage=18000, max-age=18000, must-revalidate",
      );
    } else {
      // NOTE: If url and title aren't present
      reply.header(
        "Cache-Control",
        "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
      );
    }

    return reply.status(200).type("text/html").send(content);
  });
  app.get("/*", async (request, reply, next) => {
    const name = request.params[0];
    if (!name.endsWith(".eth")) {
      return next();
    }
    let address;
    try {
      address = await toAddress(name);
    } catch (err) {
      if (err.toString().includes("Couldn't convert to address")) {
        return reply
          .status(404)
          .type("text/plain")
          .send("ENS address wasn't found.");
      }
      log(err.toString());
      return next(err);
    }
    let content;
    try {
      content = await getProfile(
        trie,
        reply.locals.theme,
        address,
        DOMPurify.sanitize(request.query.page),
        DOMPurify.sanitize(request.query.mode),
        request.query.frame === "true",
      );
    } catch (err) {
      return next(err);
    }

    reply.header(
      "Cache-Control",
      "public, s-maxage=86400, max-age=86400, stale-while-revalidate=600000",
    );
    return reply.status(200).type("text/html").send(content);
  });

  wss.on("connection", (ws) => {
    clients.add(ws);

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (socket) => {
      wss.emit("connection", socket, request);
    });
  });
  server.listen(env.HTTP_PORT, () =>
    log(`Launched HTTP server at port "${env.HTTP_PORT}"`),
  );
}
