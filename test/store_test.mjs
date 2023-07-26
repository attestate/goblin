// @format
import { env } from "process";
import { rm } from "fs/promises";
import { randomBytes } from "crypto";
import { resolve } from "path";

import test from "ava";
import { Wallet, utils } from "ethers";
import { BranchNode, ExtensionNode, LeafNode } from "@ethereumjs/trie";
import rlp from "@ethereumjs/rlp";
import { encode } from "cbor-x";

import * as id from "../src/id.mjs";
import config from "../src/config.mjs";
import { EIP712_MESSAGE } from "../src/constants.mjs";
import * as store from "../src/store.mjs";

test("if message passes constraint", async (t) => {
  env.DATA_DIR = "dbtestA";
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const message = {
    href: "https://example.com",
    signature:
      "0x1df128dfe1f86df4e20ecc6ebbd586e0ab56e3fc8d0db9210422c3c765633ad8793af68aa232cf39cc3f75ea18f03260258f7276c2e0d555f98e1cf16672dd201c",
    timestamp: 1676559616,
    title: "hello world",
    type: "amplify",
  };
  const metadb = store.metadata();
  const result0 = await store.passes(metadb, message, address);
  t.true(result0);
  const result1 = await store.passes(metadb, message, address);
  t.false(result1);

  const result2 = await store.passes(metadb, message, address);
  t.false(result2);

  await rm("dbtestA", { recursive: true });
});

test("amount limiting factor", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0101", "hex"), encode({ num: 0 }));
  await trieA.put(Buffer.from("1010", "hex"), encode({ num: 1 }));
  await trieA.put(Buffer.from("1100", "hex"), encode({ num: 2 }));

  const from = 0;
  const amount = 2;
  const leaves = await store.leaves(trieA, from, amount);
  t.is(leaves.length, 2);
  t.deepEqual([{ num: 0 }, { num: 1 }], leaves);

  await rm("dbtestA", { recursive: true });
});

test("getting more paginated leaves than exist but only return existing", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0101", "hex"), encode({ num: 0 }));
  await trieA.put(Buffer.from("1010", "hex"), encode({ num: 1 }));
  await trieA.put(Buffer.from("1100", "hex"), encode({ num: 2 }));

  const from = 1;
  const amount = 50;
  const leaves = await store.leaves(trieA, from, amount);
  t.is(leaves.length, 2);
  t.deepEqual([{ num: 1 }, { num: 2 }], leaves);

  await rm("dbtestA", { recursive: true });
});

test("getting paginated leaves", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0101", "hex"), encode({ num: 0 }));
  await trieA.put(Buffer.from("1010", "hex"), encode({ num: 1 }));
  await trieA.put(Buffer.from("1100", "hex"), encode({ num: 2 }));

  const from = 1;
  const amount = 2;
  const leaves = await store.leaves(trieA, from, amount);
  t.is(leaves.length, amount);
  t.deepEqual([{ num: 1 }, { num: 2 }], leaves);

  await rm("dbtestA", { recursive: true });
});

test("getting leaves", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const title = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(title, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);
  t.deepEqual(signedMessage, {
    ...message,
    signature:
      "0x1df128dfe1f86df4e20ecc6ebbd586e0ab56e3fc8d0db9210422c3c765633ad8793af68aa232cf39cc3f75ea18f03260258f7276c2e0d555f98e1cf16672dd201c",
  });

  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  const libp2p = null;
  const allowlist = [address];
  await store.add(trieA, signedMessage, libp2p, allowlist);

  const from = null;
  const amount = null;
  const parser = JSON.parse;
  const leaves = await store.leaves(trieA, from, amount, parser);
  t.is(leaves.length, 1);
  t.truthy(leaves[0]);

  await rm("dbtestA", { recursive: true });
});

test("descend levels with actual data ", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);
  t.deepEqual(signedMessage, {
    ...message,
    signature:
      "0x1df128dfe1f86df4e20ecc6ebbd586e0ab56e3fc8d0db9210422c3c765633ad8793af68aa232cf39cc3f75ea18f03260258f7276c2e0d555f98e1cf16672dd201c",
  });

  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  const libp2p = null;
  const allowlist = [address];
  await store.add(trieA, signedMessage, libp2p, allowlist);

  const [root] = await store.descend(trieA, 0);
  t.is(root.key.length, 0);
  t.is(root.level, 0);
  t.not(root.hash.length, 0);
  t.true(root.node instanceof LeafNode);
  t.truthy(root.node);

  await rm("dbtestA", { recursive: true });
});

test("filtering out marked nodes on descend", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0100", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("0101", "hex"), Buffer.from("C", "utf8"));
  await trieA.put(Buffer.from("0200", "hex"), Buffer.from("D", "utf8"));

  const original = await store.descend(trieA, 2);
  t.is(original.length, 2);
  const [ext, leaf] = original;

  const marked = [ext.hash];
  const filtered = await store.descend(trieA, 2, marked);
  t.is(filtered.length, 1);
  t.notDeepEqual(filtered[0], ext);

  await rm("dbtestA", { recursive: true });
});

test("lookup nodes", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0100", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("0101", "hex"), Buffer.from("C", "utf8"));
  await trieA.put(Buffer.from("0200", "hex"), Buffer.from("D", "utf8"));

  const [branch] = await store.descend(trieA, 1);
  t.true(rlp.encode(branch.node.raw()).length > 32);

  const actual0 = await store.lookup(trieA, branch.hash, branch.key);
  t.is(actual0.type, "match");
  t.deepEqual(actual0.node, branch.node);

  const [ext, leaf] = await store.descend(trieA, 2);
  t.true(rlp.encode(ext.node.raw()).length < 32);
  t.true(rlp.encode(leaf.node.raw()).length < 32);

  const actual1 = await store.lookup(trieA, ext.hash, ext.key);
  t.is(actual1.type, "missing");
  t.deepEqual(actual1.node, ext.node);

  const actual2 = await store.lookup(trieA, leaf.hash, leaf.key);
  t.is(actual2.type, "missing");
  t.deepEqual(actual2.node, leaf.node);

  await rm("dbtestA", { recursive: true });
});

test("comparing nodes with each other", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0100", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("0101", "hex"), Buffer.from("C", "utf8"));
  await trieA.put(Buffer.from("0200", "hex"), Buffer.from("D", "utf8"));

  const [branch] = await store.descend(trieA, 1);
  t.true(rlp.encode(branch.node.raw()).length > 32);
  t.true(store.isEqual(branch.hash, branch.hash));
  t.false(store.isEqual(branch.hash, Buffer.from("abc", "hex")));

  const [ext, leaf] = await store.descend(trieA, 2);
  t.true(rlp.encode(ext.node.raw()).length < 32);
  t.true(rlp.encode(leaf.node.raw()).length < 32);
  t.false(store.isEqual(ext.hash, leaf.hash));
  t.true(store.isEqual(ext.hash, ext.hash));
  t.true(store.isEqual(leaf.hash, leaf.hash));

  t.false(store.isEqual(branch.hash, leaf.hash));
  t.false(store.isEqual(leaf.hash, branch.hash));

  await rm("dbtestA", { recursive: true });
});

test("descend on level 1 with an empty trie", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();

  const nodes = await store.descend(trieA, 1);
  t.deepEqual(nodes, []);
  await rm("dbtestA", { recursive: true });
});

test("store.descend function should correctly handle high branching factor", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();

  // Manually create a trie with a high branching factor
  await trieA.put(Buffer.from("0100", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("0101", "hex"), Buffer.from("B", "utf8"));
  await trieA.put(Buffer.from("0102", "hex"), Buffer.from("C", "utf8"));
  await trieA.put(Buffer.from("0103", "hex"), Buffer.from("D", "utf8"));
  await trieA.put(Buffer.from("0104", "hex"), Buffer.from("E", "utf8"));
  await trieA.put(Buffer.from("0200", "hex"), Buffer.from("F", "utf8"));

  const level = 4;
  const nodes = await store.descend(trieA, level);

  // Check that all nodes are included in the result
  t.is(nodes.length, 5);

  await rm("dbtestA", { recursive: true });
});

test("hashing on all nodes", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0100", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("0101", "hex"), Buffer.from("C", "utf8"));
  await trieA.put(Buffer.from("0200", "hex"), Buffer.from("D", "utf8"));

  const throwIfMissing = true;
  const [root] = await store.descend(trieA, 0);
  t.true(
    (await store.lookup(trieA, root.hash, root.key)).node instanceof
      ExtensionNode
  );

  const [branch] = await store.descend(trieA, 1);
  t.true(rlp.encode(branch.node.raw()).length > 32);
  t.true(
    (await store.lookup(trieA, branch.hash, branch.key)).node instanceof
      BranchNode
  );

  const [ext, leaf] = await store.descend(trieA, 2);
  t.true(rlp.encode(ext.node.raw()).length < 32);
  t.true(
    (await store.lookup(trieA, ext.hash, ext.key)).node instanceof ExtensionNode
  );
  t.true(rlp.encode(leaf.node.raw()).length < 32);
  t.true(
    (await store.lookup(trieA, leaf.hash, leaf.key)).node instanceof LeafNode
  );

  env.DATA_DIR = "dbtestB";
  const trieB = await store.create();
  const b32 = "6fd43e7cffc31bb581d7421c8698e29aa2bd8e7186a394b85299908b4eb9";
  await trieB.put(Buffer.from("6fd4", "hex"), Buffer.from("A", "utf8"));
  await trieB.put(Buffer.from(b32, "hex"), Buffer.from("B", "utf8"));
  await trieB.put(Buffer.from(b32 + "1234", "hex"), Buffer.from("C", "utf8"));

  const [branchB] = await store.descend(trieB, 1);
  t.true(
    (await store.lookup(trieB, branchB.hash, branchB.key)).node instanceof
      BranchNode
  );

  const [extB] = await store.descend(trieB, 2);
  t.true(rlp.encode(extB.node.raw()).length > 32);
  t.true(
    (await store.lookup(trieB, extB.hash, extB.key)).node instanceof
      ExtensionNode
  );

  await rm("dbtestA", { recursive: true });
  await rm("dbtestB", { recursive: true });
});

test("leaf node key algorithm", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("0100", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("0200", "hex"), Buffer.from("B", "utf8"));

  env.DATA_DIR = "dbtestB";
  const trieB = await store.create();
  await trieB.put(Buffer.from("0100", "hex"), Buffer.from("A", "utf8"));
  await trieB.put(Buffer.from("0101", "hex"), Buffer.from("C", "utf8"));
  await trieB.put(Buffer.from("0200", "hex"), Buffer.from("D", "utf8"));

  const nodes0 = await store.descend(trieB, 2);
  t.is(nodes0.length, 2);
  t.is(Buffer.compare(nodes0[1].key, Buffer.from("0200", "hex")), 0);
  t.is(Buffer.compare(nodes0[0].key, Buffer.from("01", "hex")), 0);

  const nodes1 = await store.descend(trieB, 4);
  t.is(Buffer.compare(nodes1[0].key, Buffer.from("0100", "hex")), 0);
  t.is(Buffer.compare(nodes1[1].key, Buffer.from("0101", "hex")), 0);

  await rm("dbtestA", { recursive: true });
  await rm("dbtestB", { recursive: true });
});

// NOTE: I skipped this test when transitioning to signed messages and the
// adjustments in the descend and compare algorithms. This function is still
// useful as a test and should be eventually fixed.
// TODO: Unskip and fix.
test.skip("comparing level zero", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("000100", "hex"), Buffer.from("B", "utf8"));

  env.DATA_DIR = "dbtestB";
  const trieB = await store.create();
  await trieB.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trieB.put(Buffer.from("000100", "hex"), Buffer.from("B", "utf8"));
  await trieB.put(Buffer.from("000101", "hex"), Buffer.from("C", "utf8"));

  const remotes = await store.descend(trieB, 0);
  const results = await store.compare(trieA, remotes);
  t.deepEqual(results.mismatch, remotes);

  await rm(resolve("dbtestA"), { recursive: true });
  await rm(resolve("dbtestB"), { recursive: true });
});

test("comparing level one", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("000100", "hex"), Buffer.from("B", "utf8"));

  env.DATA_DIR = "dbtestB";
  const trieB = await store.create();
  await trieB.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trieB.put(Buffer.from("000100", "hex"), Buffer.from("B", "utf8"));
  await trieB.put(Buffer.from("000101", "hex"), Buffer.from("C", "utf8"));

  const remotes = await store.descend(trieB, 1);
  const results = await store.compare(trieA, remotes);
  t.is(results.missing.length, 1);
  t.is(results.mismatch.length, 0);
  t.is(Buffer.compare(results.missing[0].key, Buffer.from("00", "hex")), 0);

  await rm("dbtestA", { recursive: true });
  await rm("dbtestB", { recursive: true });
});

test("comparing level two", async (t) => {
  env.DATA_DIR = "dbtestA";
  const trieA = await store.create();
  await trieA.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trieA.put(Buffer.from("000100", "hex"), Buffer.from("B", "utf8"));

  env.DATA_DIR = "dbtestB";
  const trieB = await store.create();
  await trieB.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trieB.put(Buffer.from("000100", "hex"), Buffer.from("B", "utf8"));
  await trieB.put(Buffer.from("000101", "hex"), Buffer.from("C", "utf8"));

  const remotes = await store.descend(trieB, 2);
  const results = await store.compare(trieA, remotes);
  // NOTE: The results here match, because the ethereumjs/trie doesn't hash
  // values that are below 32 bytes in their RLP encoded form.
  t.is(results.missing.length, 2);

  await rm("dbtestA", { recursive: true });
  await rm("dbtestB", { recursive: true });
});

test("efficient trie retrieval of zero-th level", async (t) => {
  env.DATA_DIR = "dbtest";
  const trie = await store.create();
  const level = 0;
  const nodes = await store.descend(trie, level);
  t.is(nodes.length, 1);
  t.true(nodes[0].key instanceof Buffer);
  t.is(nodes[0].key.length, level);
  t.is(nodes[0].level, level);

  await rm(env.DATA_DIR, { recursive: true });
});

test("efficient trie retrieval of first level", async (t) => {
  env.DATA_DIR = "dbtest";
  const trie = await store.create();
  await trie.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trie.put(Buffer.from("000001", "hex"), Buffer.from("B", "utf8"));
  await trie.put(Buffer.from("000002", "hex"), Buffer.from("C", "utf8"));
  await trie.put(Buffer.from("000004", "hex"), Buffer.from("D", "utf8"));
  const level = 1;
  const nodes = await store.descend(trie, level);
  t.is(nodes.length, 1);
  t.is(Buffer.compare(nodes[0].key, Buffer.from("0000", "hex")), 0);
  t.is(nodes[0].level, level);

  await rm(env.DATA_DIR, { recursive: true });
});

test("efficient trie retrieval of second level", async (t) => {
  env.DATA_DIR = "dbtest";
  const trie = await store.create();
  await trie.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trie.put(Buffer.from("000001", "hex"), Buffer.from("B", "utf8"));
  await trie.put(Buffer.from("000002", "hex"), Buffer.from("C", "utf8"));
  await trie.put(Buffer.from("000003", "hex"), Buffer.from("D", "utf8"));
  await trie.put(Buffer.from("00000400", "hex"), Buffer.from("E", "utf8"));
  await trie.put(Buffer.from("00000401", "hex"), Buffer.from("F", "utf8"));
  const level = 2;
  const nodes = await store.descend(trie, level);

  t.is(nodes.length, 5);
  t.is(Buffer.compare(nodes[0].key, Buffer.from("000000", "hex")), 0);
  t.is(Buffer.compare(nodes[1].key, Buffer.from("000001", "hex")), 0);
  t.is(Buffer.compare(nodes[2].key, Buffer.from("000002", "hex")), 0);
  t.is(Buffer.compare(nodes[3].key, Buffer.from("000003", "hex")), 0);
  t.is(Buffer.compare(nodes[4].key, Buffer.from("000004", "hex")), 0);
  t.is(nodes[0].level, level);
  t.is(nodes[1].level, level);
  t.is(nodes[2].level, level);
  t.is(nodes[3].level, level);
  t.is(nodes[4].level, level);

  await rm(env.DATA_DIR, { recursive: true });
});

test("efficient trie retrieval of third level", async (t) => {
  env.DATA_DIR = "dbtest";
  const trie = await store.create();
  await trie.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trie.put(Buffer.from("000001", "hex"), Buffer.from("B", "utf8"));
  await trie.put(Buffer.from("000002", "hex"), Buffer.from("C", "utf8"));
  await trie.put(Buffer.from("000003", "hex"), Buffer.from("D", "utf8"));
  await trie.put(Buffer.from("00000400", "hex"), Buffer.from("E", "utf8"));
  await trie.put(Buffer.from("00000401", "hex"), Buffer.from("F", "utf8"));
  const level = 3;
  const nodes = await store.descend(trie, level);

  t.is(nodes.length, 1);
  t.is(Buffer.compare(nodes[0].key, Buffer.from("000004", "hex")), 0);
  t.is(nodes[0].level, level);

  await rm(env.DATA_DIR, { recursive: true });
});

test("efficient trie retrieval of fourth level", async (t) => {
  env.DATA_DIR = "dbtest";
  const trie = await store.create();
  await trie.put(Buffer.from("000000", "hex"), Buffer.from("A", "utf8"));
  await trie.put(Buffer.from("000001", "hex"), Buffer.from("B", "utf8"));
  await trie.put(Buffer.from("000002", "hex"), Buffer.from("C", "utf8"));
  await trie.put(Buffer.from("000003", "hex"), Buffer.from("D", "utf8"));
  await trie.put(Buffer.from("00000400", "hex"), Buffer.from("E", "utf8"));
  await trie.put(Buffer.from("00000401", "hex"), Buffer.from("F", "utf8"));
  const level = 4;
  const nodes = await store.descend(trie, level);

  t.is(nodes.length, 2);
  t.is(Buffer.compare(nodes[0].key, Buffer.from("00000400", "hex")), 0);
  t.is(Buffer.compare(nodes[1].key, Buffer.from("00000401", "hex")), 0);
  t.is(nodes[0].level, level);
  t.is(nodes[1].level, level);

  await rm(env.DATA_DIR, { recursive: true });
});

test("try adding message with invalid href", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "this isn't a link";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.fail();
    },
    root: () => {},
  };
  const libp2p = {
    pubsub: {
      publish: (name, message) => {
        t.fail();
      },
    },
  };
  const allowlist = [address];
  await t.throwsAsync(
    async () => await store.add(trie, signedMessage, libp2p, allowlist)
  );
});

test("try to add invalidly formatted message to store", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  message.extra = "bla";
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.fail();
    },
    root: () => {},
  };
  const libp2p = {
    pubsub: {
      publish: (name, message) => {
        t.fail();
      },
    },
  };
  const allowlist = [address];
  await t.throwsAsync(
    async () => await store.add(trie, signedMessage, libp2p, allowlist)
  );
});

test("try to add invalidly signed message to store", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  message.signature = "0xbeef";

  const trie = {
    put: (key, value) => {
      t.fail();
    },
    root: () => {},
  };
  const libp2p = {
    pubsub: {
      publish: (name, message) => {
        t.fail();
      },
    },
  };
  const allowlist = [address];
  await t.throwsAsync(
    async () => await store.add(trie, message, libp2p, allowlist)
  );
});

test("add with delegated address but from isn't on allow list", async (t) => {
  env.DATA_DIR = "dbtestA";
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.truthy(key);
      t.truthy(value);
    },
    root: () => Buffer.from("abc", "hex"),
    hasCheckpoints: () => false,
  };
  const libp2p = null;
  const allowlist = [];
  const delegations = {
    [address]: allowlist[0],
  };

  await t.throwsAsync(
    async () =>
      await store.add(trie, signedMessage, libp2p, allowlist, delegations)
  );
  await rm("dbtestA", { recursive: true });
});

test("attempting to upvote twice, once with custody and delegate address", async (t) => {
  env.DATA_DIR = "dbtestA";
  const address0 = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey0 =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer0 = new Wallet(privateKey0);
  t.is(signer0.address, address0);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message0 = id.create(text, href, type, timestamp);
  const signedMessage0 = await id.sign(signer0, message0, EIP712_MESSAGE);

  const address1 = "0x82e6F643A7613458E18fa1E80624d0C33ed753Cc";
  const privateKey1 =
    "0xc9c0da9974ac1278e4896f2590ad6766f07dd1ce1d19f14d71302da37b490434";
  const signer1 = new Wallet(privateKey1);
  t.is(signer1.address, address1);

  const signedMessage1 = await id.sign(signer1, message0, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.truthy(key);
      t.truthy(value);
    },
    root: () => Buffer.from("abc", "hex"),
    hasCheckpoints: () => false,
  };
  const libp2p = null;
  const allowlist = [address0];
  const delegations = {
    [address1]: address0,
  };
  await store.add(trie, signedMessage0, libp2p, allowlist, delegations);
  await t.throwsAsync(
    async () =>
      await store.add(trie, signedMessage1, libp2p, allowlist, delegations)
  );
  await rm("dbtestA", { recursive: true });
});

test("trying to add a message to store that isn't on allowlist but was delegated", async (t) => {
  env.DATA_DIR = "dbtestA";
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.truthy(key);
      t.truthy(value);
    },
    root: () => Buffer.from("abc", "hex"),
    hasCheckpoints: () => false,
  };
  const libp2p = null;
  const allowlist = [
    utils.getAddress("0xee324c588cef1bf1c1360883e4318834af66366d"),
  ];
  const delegations = {
    [address]: allowlist[0],
  };
  await store.add(trie, signedMessage, libp2p, allowlist, delegations);
  await rm("dbtestA", { recursive: true });
});

test("trying to add message to store that isn't on allowlist", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.fail();
    },
    root: () => {},
  };
  const libp2p = {
    pubsub: {
      publish: (name, message) => {
        t.fail();
      },
    },
  };
  const allowlist = [];
  await t.throwsAsync(
    async () => await store.add(trie, signedMessage, libp2p, allowlist)
  );
});

test("adding message from too far into the future", async (t) => {
  env.MAX_TIMESTAMP_DELTA_SECS = 60;
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = Math.floor(Date.now() / 1000) + 61;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.fail();
    },
    root: () => Buffer.from("abc", "hex"),
  };
  const libp2p = {
    pubsub: {
      publish: (name, message) => {
        t.fail();
      },
    },
  };
  const allowlist = [address];
  await t.throwsAsync(
    async () => await store.add(trie, signedMessage, libp2p, allowlist)
  );
});

test("adding message from before minimum timestamp", async (t) => {
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 0;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.fail();
    },
    root: () => Buffer.from("abc", "hex"),
  };
  const libp2p = {
    pubsub: {
      publish: (name, message) => {
        t.fail();
      },
    },
  };
  const allowlist = [address];
  env.MIN_TIMESTAMP_SECS = 1;
  await t.throwsAsync(
    async () => await store.add(trie, signedMessage, libp2p, allowlist)
  );
});

test.serial("adding message to the store", async (t) => {
  env.DATA_DIR = "dbtestA";
  t.plan(5);
  const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
  const privateKey =
    "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
  const signer = new Wallet(privateKey);
  t.is(signer.address, address);

  const text = "hello world";
  const href = "https://example.com";
  const type = "amplify";
  const timestamp = 1676559616;
  const message = id.create(text, href, type, timestamp);
  const signedMessage = await id.sign(signer, message, EIP712_MESSAGE);

  const trie = {
    put: (key, value) => {
      t.truthy(key);
      t.truthy(value);
    },
    root: () => Buffer.from("abc", "hex"),
    hasCheckpoints: () => false,
  };
  const libp2p = {
    pubsub: {
      publish: (name, message) => {
        t.truthy(name);
        t.truthy(message);
      },
    },
  };
  const allowlist = [address];
  await store.add(trie, signedMessage, libp2p, allowlist);
  await rm("dbtestA", { recursive: true });
});

test.serial(
  "adding message twice to the store (e.g. with slightly different timestamp)",
  async (t) => {
    env.DATA_DIR = "dbtestA";
    const address = "0x0f6A79A579658E401E0B81c6dde1F2cd51d97176";
    const privateKey =
      "0xad54bdeade5537fb0a553190159783e45d02d316a992db05cbed606d3ca36b39";
    const signer = new Wallet(privateKey);
    t.is(signer.address, address);

    const text = "hello world";
    const href = "https://example.com";
    const type = "amplify";
    const timestamp0 = 1676559616;
    const message = id.create(text, href, type, timestamp0);
    const signedMessage0 = await id.sign(signer, message, EIP712_MESSAGE);

    const trie = {
      put: (key, value) => {
        t.truthy(key);
        t.truthy(value);
      },
      root: () => Buffer.from("abc", "hex"),
      hasCheckpoints: () => false,
    };
    const libp2p = {
      pubsub: {
        publish: (name, message) => {
          t.truthy(name);
          t.truthy(message);
        },
      },
    };
    const allowlist = [address];
    await store.add(trie, signedMessage0, libp2p, allowlist);

    const timestamp1 = timestamp0 + 1;
    const message1 = id.create(text, href, type, timestamp1);
    const signedMessage1 = await id.sign(signer, message1, EIP712_MESSAGE);

    await t.throwsAsync(
      async () => await store.add(trie, signedMessage1, libp2p, allowlist)
    );
    await rm("dbtestA", { recursive: true });
  }
);
