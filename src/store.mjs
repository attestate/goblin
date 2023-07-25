// @format
import { env } from "process";
import { resolve } from "path";

import { utils } from "ethers";
import normalizeUrl from "normalize-url";
import {
  Trie,
  BranchNode,
  ExtensionNode,
  LeafNode,
  decodeNode,
} from "@ethereumjs/trie";
import rlp from "@ethereumjs/rlp";
import { keccak256 } from "ethereum-cryptography/keccak.js";
import { encode, decode } from "cbor-x";
import { open } from "lmdb";
import { eligible } from "@attestate/delegator2";

import log from "./logger.mjs";
import LMDB from "./lmdb.mjs";
import { verify, ecrecover, toDigest } from "./id.mjs";
import { EIP712_MESSAGE } from "./constants.mjs";
import { elog } from "./utils.mjs";
import * as messages from "./topics/messages.mjs";
import { newWalk } from "./WalkController.mjs";

const maxReaders = 500;
export async function create(options) {
  return await Trie.create({
    // TODO: Understand if this should this use "resolve"? The metadata db uses
    // resolve.
    db: new LMDB({ path: env.DATA_DIR, maxReaders }),
    useRootPersistence: true,
    // NOTE: We enable nodePruning so that the ethereumjs/trie library reliably
    // deletes content in the database for us (it doesn't by default).
    useNodePruning: true,
    ...options,
  });
}

export function metadata(options) {
  return open({
    compression: true,
    name: "constraints",
    encoding: "cbor",
    keyEncoding: "ordered-binary",
    path: resolve(env.DATA_DIR),
    maxReaders,
    ...options,
  });
}

// NOTE: https://ethereum.github.io/execution-specs/diffs/frontier_homestead/trie/index.html#ethereum.frontier.trie.encode_internal_node
export function hash(node) {
  if (
    node instanceof BranchNode ||
    node instanceof LeafNode ||
    node instanceof ExtensionNode
  ) {
    const encoded = rlp.encode(node.raw());
    if (encoded.length < 32) return node.serialize();
    return Buffer.from(keccak256(encoded));
  } else {
    throw new Error("Must be BranchNode, LeafNode or ExtensionNode");
  }
}

// NOTE: Function not tested because we took it from the ethereumjs/trie code
// base.
export function nibblesToBuffer(arr) {
  const buf = Buffer.alloc(arr.length / 2);
  for (let i = 0; i < buf.length; i++) {
    let q = i * 2;
    buf[i] = (arr[q] << 4) + arr[++q];
  }
  return buf;
}

export function isEqual(buf1, buf2) {
  // NOTE: Ethereum doesn't hash nodes that are smaller than 32 bytes encoded,
  // so it formats them into an array of buffers. And in this case, it could be
  // that those data structures get compared to hashes. But we want to avoid
  // that at all costs and so we're throwing if we're ever coming across such.
  if (Array.isArray(buf1) || Array.isArray(buf2)) {
    throw new Error("Can only compare buffers");
  }
  if (Buffer.isBuffer(buf1) && Buffer.isBuffer(buf2)) {
    return Buffer.compare(buf1, buf2) === 0;
  }
  return false;
}

export async function lookup(trie, hash, key) {
  const result = {
    node: null,
    type: null,
  };
  // NOTE: We're serializing nodes smaller than 32 bytes as Ethereum does.
  // And so, we have to decode them here to do a proper database lookup.
  try {
    result.node = decodeNode(hash);
    // NOTE: We report every < 32 bytes long hash as "missing" because any node
    // will always be able to decode them straight from the hash.
    result.type = "missing";
    return result;
  } catch (err) {
    // noop, we'll just continue below.
  }

  // NOTE: There are several ways we can look for matches in the database.
  // But most important is that we differentiate between nodes that are
  // missing and nodes that are hash-mismatches. That is because in cases of
  // hash mismatches, we know that the local node has the same subtree
  // available and that we'll have to descend deeper into the tree until we
  // find missing nodes. Whereas for missing nodes, we're well-served by
  // requesting them from the paired node.
  try {
    result.node = await trie.lookupNode(hash);
    result.type = "match";
  } catch (err) {
    if (err.toString().includes("Missing node in DB")) {
      // TODO: The empty buffer as a key is not recognized or leads to results.
      const path = await trie.findPath(key);
      result.node = path.node;
      result.type = "mismatch";
    } else {
      log(`Throwing error for looking up: "${hash.toString()}"`);
      throw err;
    }
  }
  return result;
}

export async function compare(localTrie, remotes) {
  const match = [];
  const missing = [];
  const mismatch = [];
  for (let remoteNode of remotes) {
    // NOTE: In case the level:0 is being compared and we're having to deal
    // with the root node.
    if (remoteNode.level === 0 && isEqual(localTrie.root(), remoteNode.hash)) {
      match.push(remoteNode);
      break;
    }

    const { node, type } = await lookup(
      localTrie,
      remoteNode.hash,
      remoteNode.key
    );
    if (type === "match" && node) {
      match.push(remoteNode);
    } else if (type === "mismatch" && node) {
      mismatch.push(remoteNode);
    } else {
      missing.push(remoteNode);
    }
  }
  return {
    missing,
    mismatch,
    match,
  };
}

export async function descend(trie, level, exclude = []) {
  const emptyRoot = Buffer.from(
    "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    "hex"
  );
  if (level === 0 && isEqual(emptyRoot, trie.root())) {
    return [
      {
        level: 0,
        key: Buffer.alloc(0),
        hash: trie.root(),
        node: null,
      },
    ];
  }

  let nodes = [];
  const onFound = (_, node, key, walkController, currentLevel) => {
    const nodeHash = hash(node);
    // TODO: Would be better if this was a set where all the hashes are included
    // e.g. as strings? It seems very slow to look up something using find.
    const match = exclude.find((markedNode) => isEqual(markedNode, nodeHash));
    // NOTE: The idea of the "exclude" array is that it contains nodes that
    // have matched on the remote trie, and so we don't have to send them along
    // in a future comparison. Hence, if we have a match, we simply return.
    if (match) return;

    if (currentLevel === 0) {
      if (level !== 0 && node instanceof LeafNode) {
        const fragments = [key, node.key()].map(nibblesToBuffer);
        key = Buffer.concat(fragments);
      } else {
        key = nibblesToBuffer(key);
      }

      nodes.push({
        level,
        key,
        hash: nodeHash,
        node,
      });
    } else if (node instanceof BranchNode || node instanceof ExtensionNode) {
      currentLevel -= 1;
      walkController.allChildren(node, key, currentLevel);
    }
  };
  try {
    await newWalk(onFound, trie, trie.root(), level);
  } catch (err) {
    if (err.toString().includes("Missing node in DB")) {
      elog(err, "descend: Didn't find any nodes");
      return nodes;
    } else {
      throw err;
    }
  }
  return nodes;
}

// TODO: The current synchronization algorithm makes use of checkpoints,
// commits and reverts, but this function is used in sync.put and store.add,
// but it isn't checkpointing or reverting, it just writes directly - even upon
// soft writes into the trie. This is an issue as we e.g. could do a sync where
// most writes are soft-written, the sync fails, but the actual constraints are
// then written to the database.
export async function passes(db, message, identity) {
  // TODO: We should/must consider adding normalizeUrl here as otherwise a user
  // might be able to sneakily upvote twice by manipulating the URLs in such
  // way that the frontend normalizes them into two URLs.
  // NOTE: We use `utils.getAddress` from ethers here to make sure we hash a
  // canonical key into the database.
  const key = `${utils.getAddress(identity)}:${message.href}:${message.type}`;
  const seenBefore = await db.doesExist(key);
  await db.put(key);
  return !seenBefore;
}

export async function add(
  trie,
  message,
  libp2p,
  allowlist,
  delegations,
  synching = false,
  metadb = metadata()
) {
  const address = verify(message);
  const identity = eligible(allowlist, delegations, address);
  if (!identity) {
    const err = `Address "${address}" wasn't found in the allow list or delegations list. Dropping message "${JSON.stringify(
      message
    )}".`;
    log(err);
    throw new Error("You must mint the Kiwi NFT to upvote and submit!");
  }

  const minTimestampSecs = parseInt(env.MIN_TIMESTAMP_SECS, 10);
  if (message.timestamp < minTimestampSecs) {
    const err = `Message timestamp is from before the year 2023 and so message is dropped: "${message.timestamp}"`;
    log(err);
    throw new Error(err);
  }

  const nowSecs = Date.now() / 1000;
  const toleranceSecs = parseInt(env.MAX_TIMESTAMP_DELTA_SECS, 10);
  const maxTimestampSecs = nowSecs + toleranceSecs;
  if (!synching && message.timestamp >= maxTimestampSecs) {
    const err = `Message timestamp is more than "${toleranceSecs}" seconds in the future and so message is dropped: "${message.timestamp}"`;
    log(err);
    throw new Error(err);
  }

  const legit = await passes(metadb, message, identity);
  if (!legit) {
    const err = `Message "${JSON.stringify(
      message
    )}" with address "${identity}" doesn't pass legitimacy criteria (duplicate). It was probably submitted and accepted before.`;
    log(err);
    throw new Error(err);
  }

  const { canonical, index } = toDigest(message);
  // TODO: We should check if checkpointing is off here.
  await trie.put(Buffer.from(index, "hex"), canonical);
  log(`During storage, has checkpoints ${trie.hasCheckpoints()}`);
  log(`Stored message with index "${index}" and message: "${canonical}"`);
  log(`New root: "${trie.root().toString("hex")}"`);

  if (!libp2p) {
    log(
      "Didn't distribute message after ingestion because libp2p instance isn't defined"
    );
    return;
  }

  log(`Sending message to peers: "${messages.name}" and index: "${index}"`);
  libp2p.pubsub.publish(messages.name, canonical);
}

export async function posts(
  trie,
  from,
  amount,
  parser,
  startDateTime,
  allowlist,
  delegations
) {
  const nodes = await leaves(trie, from, amount, parser, startDateTime);

  const cacheEnabled = true;
  return nodes.map((node) => {
    const signer = ecrecover(node, EIP712_MESSAGE, cacheEnabled);
    const identity = eligible(allowlist, delegations, signer);
    if (!identity) throw new Error("Found in-eligible message in storage");
    return {
      ...node,
      signer,
      identity,
    };
  });
}

export async function leaves(trie, from, amount, parser, startDatetime) {
  let pointer = 0;
  const nodes = [];
  const onFound = (_, node, key, walkController) => {
    if (Number.isInteger(amount) && nodes.length >= amount) return;

    if (node instanceof LeafNode) {
      pointer += 1;

      const fragments = [key, node.key()].map(nibblesToBuffer);
      key = Buffer.concat(fragments);
      const value = decode(node.value());

      if (Number.isInteger(from) && pointer <= from) return;
      if (parser) {
        const parsed = parser(value);
        if (parsed.timestamp < startDatetime) return;

        nodes.push(parsed);
      } else {
        nodes.push(value);
      }
    } else if (node instanceof BranchNode || node instanceof ExtensionNode) {
      walkController.allChildren(node, key);
    }
  };

  try {
    await trie.walkTrie(trie.root(), onFound);
  } catch (err) {
    if (err.toString().includes("Missing node in DB")) {
      log("leaves: Didn't find any nodes");
      return nodes;
    } else {
      throw err;
    }
  }
  return nodes;
}
