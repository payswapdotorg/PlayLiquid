import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asBranchName,
  asCommitSha,
  asTagName,
  canonicalRepositorySlug,
  gitRefCommit,
  isCommitShaText,
  isForkPoint,
  isGameLineage,
  isGitRef,
  isGitRepositoryCoordinates,
  lineageContainsCommit,
} from "./git.ts";
import type { BranchName, CommitSha, GameLineage, GitRef } from "./git.ts";

const HEAD = "b88e814755e9bd1efed6cb6f8e26f316bada1247";
const PARENT = "1111111111111111111111111111111111111111";
const FORK = "2222222222222222222222222222222222222222";

test("git: commit shas must be lowercase 40-hex", () => {
  assert.ok(isCommitShaText(HEAD));
  assert.equal(isCommitShaText(PARENT), true);
  assert.notEqual(asCommitSha(HEAD), undefined);
  assert.equal(asCommitSha(HEAD.toUpperCase()), undefined);
  assert.equal(isCommitShaText("z".repeat(40)), false);
  assert.equal(isCommitShaText(HEAD.slice(0, 39)), false);
});

test("git: branch/tag name rules", () => {
  assert.notEqual(asBranchName("main"), undefined);
  assert.notEqual(asBranchName("work/PL-001"), undefined);
  assert.equal(asBranchName("HEAD"), undefined);
  assert.equal(asBranchName("-leading"), undefined);
  assert.equal(asBranchName("double..dot"), undefined);
  assert.equal(asBranchName("trailing.lock"), undefined);
  assert.notEqual(asTagName("v1.0.0"), undefined);
});

test("git: refs pin commits across all variants", () => {
  const branch: GitRef = { kind: "branch", name: asBranchName("main")!, commit: asCommitSha(HEAD)! };
  const tag: GitRef = { kind: "tag", name: asTagName("v1.0.0")!, commit: asCommitSha(HEAD)! };
  const commit: GitRef = { kind: "commit", commit: asCommitSha(HEAD)! };
  assert.equal(gitRefCommit(branch), HEAD);
  assert.equal(gitRefCommit(tag), HEAD);
  assert.equal(gitRefCommit(commit), HEAD);
  assert.ok(isGitRef(branch));
  assert.ok(isGitRef(tag));
  assert.ok(isGitRef(commit));
  assert.equal(isGitRef({ kind: "wat" }), false);
  assert.equal(isGitRef(null), false);
});

test("git: repository coordinates guard and slug", () => {
  const coords = { host: "github.com", owner: "payswapdotorg", repository: "game-alpha" };
  assert.ok(isGitRepositoryCoordinates(coords));
  assert.equal(canonicalRepositorySlug(coords), "payswapdotorg/game-alpha");
  assert.equal(isGitRepositoryCoordinates({ host: "", owner: "a", repository: "b" }), false);
  assert.equal(isGitRepositoryCoordinates({ host: "github.com", owner: "", repository: "b" }), false);
  assert.equal(isGitRepositoryCoordinates("github.com"), false);
});

test("git: lineage contains head, ancestors and fork point (R1/lock 34)", () => {
  const head = asCommitSha(HEAD)!;
  const parent = asCommitSha(PARENT)!;
  const fork = asCommitSha(FORK)!;
  const lineage: GameLineage = {
    head,
    ancestors: [parent],
    forkPoint: { repository: { host: "github.com", owner: "upstream", repository: "game-base" }, commit: fork },
  };
  assert.ok(isGameLineage(lineage));
  assert.ok(lineageContainsCommit(lineage, head));
  assert.ok(lineageContainsCommit(lineage, parent));
  assert.ok(lineageContainsCommit(lineage, fork));
  const outsider = asCommitSha("3333333333333333333333333333333333333333")!;
  assert.equal(lineageContainsCommit(lineage, outsider), false);
  assert.ok(isForkPoint(lineage.forkPoint));
});

test("git: lineage guard rejects malformed input", () => {
  assert.equal(isGameLineage({ head: "short", ancestors: [] }), false);
  assert.equal(isGameLineage({ head: HEAD, ancestors: [PARENT], forkPoint: { commit: FORK } }), false);
  assert.equal(isGameLineage(null), false);
});

test("git: commit sha is not a branch name slot (compile-time misuse)", () => {
  const sha: CommitSha = asCommitSha(HEAD)!;
  // @ts-expect-error — CommitSha is not a BranchName
  const name: BranchName = sha;
  assert.equal(typeof name, "string");
});
