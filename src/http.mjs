//@format
import { env } from "process";
import { readFile } from "fs/promises";
import { basename } from "path";

import morgan from "morgan";
import express from "express";
import cookieParser from "cookie-parser";
import { utils } from "ethers";
import htm from "htm";
import "express-async-errors";
import { sub } from "date-fns";

import * as registry from "./chainstate/registry.mjs";
import log from "./logger.mjs";
import { SCHEMATA } from "./constants.mjs";
import themes from "./themes.mjs";
import feed, { index } from "./views/feed.mjs";
import story, { generateStory } from "./views/story.mjs";
import newest, * as newAPI from "./views/new.mjs";
import best from "./views/best.mjs";
import privacy from "./views/privacy.mjs";
import guidelines from "./views/guidelines.mjs";
import onboarding from "./views/onboarding.mjs";
import join from "./views/join.mjs";
import kiwipass from "./views/kiwipass.mjs";
import kiwipassmint from "./views/kiwipass-mint.mjs";
import whattosubmit from "./views/whattosubmit.mjs";
import onboardingReader from "./views/onboarding-reader.mjs";
import onboardingCurator from "./views/onboarding-curator.mjs";
import onboardingSubmitter from "./views/onboarding-submitter.mjs";
import lists from "./views/lists.mjs";
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
import demonstration from "./views/demonstration.mjs";
import notifications from "./views/notifications.mjs";
import pwa from "./views/pwa.mjs";
import pwaandroid from "./views/pwaandroid.mjs";
import * as curation from "./views/curation.mjs";
import * as moderation from "./views/moderation.mjs";
import { parse, metadata } from "./parser.mjs";
import { toAddress, resolve } from "./ens.mjs";
import * as store from "./store.mjs";
import * as ens from "./ens.mjs";
import * as karma from "./karma.mjs";
import * as frame from "./frame.mjs";
import * as subscriptions from "./subscriptions.mjs";
import * as telegram from "./telegram.mjs";
import * as price from "./price.mjs";
import { getSubmission } from "./cache.mjs";

const app = express();

app.set("etag", "strong");
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
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  }),
);
app.use(express.json());
app.use(cookieParser());

function loadTheme(req, res, next) {
  const themeId = parseInt(req.cookies.currentTheme, 10);
  const savedTheme = themes.find((theme) => theme.id === themeId);

  const theme = savedTheme || {
    id: 14,
    emoji: "🥝",
    name: "Kiwi News",
    color: "limegreen",
  };

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
  app.use((err, req, res, next) => {
    log(`Express error: "${err.message}", "${err.stack}"`);
    res.status(500).send("Internal Server Error");
  });

  app.get("/kiwipass-mint", async (request, reply) => {
    reply.header(
      "Cache-Control",
      "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=86400",
    );
    return reply
      .status(200)
      .type("text/html")
      .send(await kiwipassmint(reply.locals.theme));
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
  app.post("/api/v1/writers/success", async (request, reply) => {
    const content = frame.callback(request.body?.untrustedData?.transactionId);
    const code = 200;
    reply.header("Cache-Control", "no-cache");
    return reply.status(code).type("text/html").send(content);
  });
  app.post("/api/v1/writers/:address", async (request, reply) => {
    let address;
    try {
      address = utils.getAddress(request.params.address);
    } catch (err) {
      const code = 400;
      const httpMessage = "Bad Request";
      const details = "Please only submit valid Ethereum addresses.";
      return sendError(reply, code, httpMessage, details);
    }

    const data = frame.tip(address);
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
      reply.header(
        "Cache-Control",
        "public, max-age=0, no-transform, must-revalidate",
      );
      return sendError(reply, code, httpMessage, details);
    }

    if (!isValidWebPushSubscription(request.body)) {
      const code = 400;
      const httpMessage = "Bad Request";
      const details = "Error storing subscription";
      reply.header(
        "Cache-Control",
        "public, max-age=0, no-transform, must-revalidate",
      );
      return sendError(reply, code, httpMessage, details);
    }

    try {
      subscriptions.store(address, request.body);
    } catch (err) {
      const code = 500;
      const httpMessage = "Internal Server Error";
      const details = "Error storing subscription";
      reply.header(
        "Cache-Control",
        "public, max-age=0, no-transform, must-revalidate",
      );
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
    const today = new Date();
    const firstDayInSchedule = sub(today, {
      months: 6,
    });
    const mints = await registry.mints();
    const value = await price.getPrice(mints, firstDayInSchedule, today);
    const code = 200;
    const httpMessage = "OK";
    const details = "Calculated current price";
    return sendStatus(reply, code, httpMessage, details, {
      price: value.toString(),
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
      reply.header(
        "Cache-Control",
        "public, max-age=0, no-transform, must-revalidate",
      );
      return sendError(reply, code, httpMessage, details);
    }

    const points = karma.resolve(address);
    const code = 200;
    const httpMessage = "OK";
    const details = `Karma`;
    reply.header(
      "Cache-Control",
      "public, max-age=300, no-transform, must-revalidate, stale-while-revalidate=300",
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
      const results = await index(trie, page);
      reply.header(
        "Cache-Control",
        "public, max-age=300, no-transform, must-revalidate, stale-while-revalidate=30",
      );
      stories = results.stories;
    } else if (request.params.name === "new") {
      reply.header("Cache-Control", "no-cache");
      stories = newAPI.getStories();
    } else if (request.params.name === "images") {
      reply.header("Cache-Control", "no-cache");
      stories = imagesAPI.getStories();
    } else {
      const code = 501;
      const httpMessage = "Not Implemented";
      const details =
        "We currently don't implement any other endpoint but 'hot' and 'new'";
      reply.header(
        "Cache-Control",
        "public, max-age=0, no-transform, must-revalidate",
      );
      return sendError(reply, code, httpMessage, details);
    }

    const code = 200;
    const httpMessage = "OK";
    const details = `${request.params.name} feed`;
    return sendStatus(reply, code, httpMessage, details, { stories });
  });

  app.get("/api/v1/stories", (request, reply) => {
    let submission;

    const index = request.query.index;
    try {
      submission = getSubmission(index);
    } catch (e) {
      reply.status(404).type('application/json').send({
        err: "Couldn't find the submission"
      })
    }

    reply.status(200).type('application/json').send(submission);
  });

  app.get("/", async (request, reply) => {
    let page = parseInt(request.query.page);
    if (isNaN(page) || page < 1) {
      page = 0;
    }
    const content = await feed(
      trie,
      reply.locals.theme,
      page,
      request.query.domain,
    );
    reply.header(
      "Cache-Control",
      "public, max-age=60, no-transform, must-revalidate, stale-while-revalidate=3600",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/stories", async (request, reply) => {
    let submission;
    try {
      submission = await generateStory(request.query.index);
    } catch (err) {
      return reply.status(404).type("text/plain").send(err.message);
    }

    const hexIndex = request.query.index.substring(2);
    const content = await story(trie, reply.locals.theme, hexIndex, submission);
    reply.header(
      "Cache-Control",
      "public, max-age=10, no-transform, must-revalidate, stale-while-revalidate=600",
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
    const content = await newest(trie, reply.locals.theme, request.query.index);
    let timestamp;
    try {
      timestamp = newAPI.getLatestTimestamp();
      reply.cookie("newTimestamp", timestamp, { maxAge: 1000 * 60 * 60 * 32 });
    } catch (err) {
      //noop
    }

    reply.header("Cache-Control", "no-cache");
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

    const periodValues = ["all", "month", "week", "day"];
    let { period } = request.query;
    if (!period || !periodValues.includes(period)) {
      period = "week";
    }

    const content = await best(
      trie,
      reply.locals.theme,
      page,
      period,
      request.query.domain,
    );

    reply.header(
      "Cache-Control",
      "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=86400",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/community", async (request, reply) => {
    const content = await community(
      trie,
      reply.locals.theme,
      request.query,
      request.cookies.identity,
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

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/passkeys", async (request, reply) => {
    const content = await passkeys(reply.locals.theme);

    reply.header("Cache-Control", "public, max-age=86400");
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

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/invite", async (request, reply) => {
    const content = await invite(reply.locals.theme);

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/indexing", async (request, reply) => {
    let address;
    try {
      address = utils.getAddress(request.query.address);
    } catch (err) {
      return reply
        .status(404)
        .type("text/plain")
        .send("No valid Ethereum address");
    }

    const content = await indexing(reply.locals.theme, address);

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/start", async (request, reply) => {
    const content = await start(reply.locals.theme, request.cookies.identity);

    reply.header("Cache-Control", "private, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/settings", async (request, reply) => {
    const content = await settings(
      reply.locals.theme,
      request.cookies.identity,
    );

    reply.header("Cache-Control", "private, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/why", async (request, reply) => {
    const content = await why(reply.locals.theme, request.cookies.identity);

    reply.header("Cache-Control", "public, max-age=86400");
    return reply.status(200).type("text/html").send(content);
  });
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
      "public, max-age=60, no-transform, must-revalidate, stale-while-revalidate=3600",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/api/v1/activity", async (request, reply) => {
    let data;

    try {
      data = await activity.data(
        trie,
        request.cookies.identity || request.query.address,
        request.cookies.lastUpdate,
      );
    } catch (err) {
      const code = 400;
      const httpMessage = "Bad Request";
      return sendError(reply, code, httpMessage, "Valid query parameters");
    }
    const code = 200;
    const httpMessage = "OK";
    const details = "Notifications feed";

    reply.header(
      "Cache-Control",
      "public, max-age=300, no-transform, must-revalidate",
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
        request.query.address,
        request.cookies.lastUpdate,
      );
    } catch (err) {
      return reply.status(400).type("text/plain").send(err.toString());
    }
    const content = await activity.page(
      reply.locals.theme,
      request.cookies.identity || request.query.address,
      data.notifications,
      request.cookies.lastUpdate,
    );
    if (data && data.lastUpdate) {
      reply.setHeader("X-LAST-UPDATE", data.lastUpdate);
      reply.cookie("lastUpdate", data.lastUpdate);
    }
    reply.header(
      "Cache-Control",
      "public, max-age=300, no-transform, must-revalidate",
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/subscribe", async (request, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(await subscribe(reply.locals.theme));
  });
  app.get("/privacy-policy", async (request, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(await privacy(reply.locals.theme));
  });
  app.get("/guidelines", async (request, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(await guidelines(reply.locals.theme));
  });
  app.get("/onboarding", async (request, reply) => {
    reply.header("Cache-Control", "private, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(await onboarding(reply.locals.theme, request.cookies.identity));
  });
  app.get("/whattosubmit", async (request, reply) => {
    reply.header("Cache-Control", "private, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(await whattosubmit(reply.locals.theme));
  });
  app.get("/onboarding-reader", async (request, reply) => {
    reply.header("Cache-Control", "private, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(
        await onboardingReader(reply.locals.theme, request.cookies.identity),
      );
  });
  app.get("/onboarding-curator", async (request, reply) => {
    reply.header("Cache-Control", "private, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(
        await onboardingCurator(reply.locals.theme, request.cookies.identity),
      );
  });
  app.get("/onboarding-submitter", async (request, reply) => {
    reply.header("Cache-Control", "private, max-age=86400");
    return reply
      .status(200)
      .type("text/html")
      .send(
        await onboardingSubmitter(reply.locals.theme, request.cookies.identity),
      );
  });

  app.get("/lists", async (request, reply) => {
    const content = await lists(reply.locals.theme);

    reply.header("Cache-Control", "public, max-age=60, must-revalidate");
    return reply.status(200).type("text/html").send(content);
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
    reply.header("Cache-Control", "public, max-age=86400");
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
  app.get("/upvotes", async (request, reply) => {
    if (!utils.isAddress(request.query.address)) {
      return reply
        .status(404)
        .type("text/plain")
        .send("No valid Ethereum address");
    }
    const profile = await resolve(request.query.address);
    if (profile && profile.ens) {
      return reply.redirect(301, `/${profile.ens}`);
    }

    const content = await getProfile(
      trie,
      reply.locals.theme,
      request.query.address,
      request.query.page,
      request.query.mode,
      request.query.frame === "true",
    );

    if (request.query.mode === "new") {
      reply.header(
        "Cache-Control",
        "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=86400",
      );
    } else if (!request.query.mode || request.query.mode == "top") {
      reply.header(
        "Cache-Control",
        "public, max-age=86400, no-transform, must-revalidate, stale-while-revalidate=86400",
      );
    } else {
      reply.header(
        "Cache-Control",
        "public, max-age=3600, no-transform, must-revalidate, stale-while-revalidate=60",
      );
    }

    return reply.status(200).type("text/html").send(content);
  });

  app.get("/submit", async (request, reply) => {
    const { url, title } = request.query;
    const content = await submit(reply.locals.theme, url, title);

    reply.header("Cache-Control", "public, max-age=18000, must-revalidate");
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
        request.query.page,
        request.query.mode,
        request.query.frame === "true",
      );
    } catch (err) {
      return next(err);
    }

    reply.header(
      "Cache-Control",
      "public, max-age=86400, no-transform, must-revalidate, stale-while-revalidate=3600",
    );
    return reply.status(200).type("text/html").send(content);
  });

  app.listen(env.HTTP_PORT, () =>
    log(`Launched HTTP server at port "${env.HTTP_PORT}"`),
  );
}
