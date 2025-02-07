// @format
import { rm } from "fs/promises";

import test from "ava";
import { encode, decode } from "cbor-x";
import { Wallet } from "ethers";

import { sign, create } from "../../src/id.mjs";
import { handlers, name } from "../../src/topics/messages.mjs";
import * as store from "../../src/store.mjs";
import { toDigest } from "../../src/id.mjs";
import { EIP712_MESSAGE } from "../../src/constants.mjs";

test("return upon false topic name", async (t) => {
  const evt = {
    detail: {
      topic: "false topic",
    },
  };
  const trie = await store.create();
  const result = await handlers.message(trie)(evt);
  t.false(result);
  t.pass();
});

test("return upon unparsable uint8 array", async (t) => {
  const evt = {
    detail: {
      topic: name,
      data: "unparsable uint8",
    },
  };
  const trie = await store.create();
  const emptyRoot = trie.root();
  const result = await handlers.message(trie)(evt);
  t.false(result);
  // NOTE: The message must not end up as a leaf in the trie and so if the trie
  // still has the empty root as a root, then that means the message was
  // dropped.
  t.deepEqual(emptyRoot, trie.root());
});

test("return upon unparsable json", async (t) => {
  const evt = {
    detail: {
      topic: name,
      data: encode("unparsable json"),
    },
  };
  const trie = await store.create();
  const emptyRoot = trie.root();
  const result = await handlers.message(trie)(evt);
  t.false(result);
  // NOTE: The message must not end up as a leaf in the trie and so if the trie
  // still has the empty root as a root, then that means the message was
  // dropped.
  t.deepEqual(emptyRoot, trie.root());
});

test("adding invalid-json message to trie", async (t) => {
  const obj = { hello: "world" };
  const text = JSON.stringify(obj);
  const evt = {
    detail: {
      topic: name,
      data: encode(text),
    },
  };
  const trie = await store.create();
  const emptyRoot = trie.root();
  const result = await handlers.message(trie)(evt);
  t.false(result);
  // NOTE: The message must not end up as a leaf in the trie and so if the trie
  // still has the empty root as a root, then that means the message was
  // dropped.
  t.deepEqual(emptyRoot, trie.root());
});

test.serial("adding valid message to trie", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const localhost = "127.0.0.1";
  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = create(text, href, type, timestamp);
  const signedMessage = await sign(signer, message, EIP712_MESSAGE);
  t.deepEqual(signedMessage, {
    ...message,
    signature:
      "0x1df128dfe1f86df4e20ecc6ebbd586e0ab56e3fc8d0db9210422c3c765633ad8793af68aa232cf39cc3f75ea18f03260258f7276c2e0d555f98e1cf16672dd201c",
  });
  const { canonical, index } = toDigest(signedMessage);
  const evt = {
    detail: {
      topic: name,
      data: canonical,
    },
  };
  process.env.DATA_DIR = "dbtestA";
  const trie = await store.create();
  const emptyRoot = trie.root();
  const allowlistFn = async () => new Set([address]);
  const result = await handlers.message(trie, allowlistFn)(evt);
  t.true(result);
  await rm("dbtestA", { recursive: true });
});
test.serial(
  "adding valid message to trie with the signer being a delegated address",
  async (t) => {
    const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
    const privateKey =
      "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
    const signer = new Wallet(privateKey);
    t.is(signer.address, address);

    const localhost = "127.0.0.1";
    const text = "hello world";
    const href = "https://example.com";
    const type = "amplify";
    const timestamp = 1676559616;
    const message = create(text, href, type, timestamp);
    const signedMessage = await sign(signer, message, EIP712_MESSAGE);
    t.deepEqual(signedMessage, {
      ...message,
      signature:
        "0x1df128dfe1f86df4e20ecc6ebbd586e0ab56e3fc8d0db9210422c3c765633ad8793af68aa232cf39cc3f75ea18f03260258f7276c2e0d555f98e1cf16672dd201c",
    });
    const { canonical, index } = toDigest(signedMessage);
    const evt = {
      detail: {
        topic: name,
        data: canonical,
      },
    };
    process.env.DATA_DIR = "dbtestA";
    const trie = await store.create();
    const emptyRoot = trie.root();

    const custodian = "0xee324c588ceF1BF1c1360883E4318834af66366d";
    const allowlistFn = async () => new Set([custodian]);
    const delegationsFn = async () => ({
      [address]: custodian,
    });
    const result = await handlers.message(
      trie,
      allowlistFn,
      delegationsFn,
    )(evt);
    t.true(result);
    await rm("dbtestA", { recursive: true });
  },);