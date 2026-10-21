import test from "node:test";
import assert from "node:assert/strict";
import { assertContractMatches } from "./check-codex-contract.mjs";

const contract = `
export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";
export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";
`;
const generated = {
  TurnStatus: `export type TurnStatus =
    | "inProgress"
    | "failed"
    | "interrupted"
    | "completed";`,
  ThreadActiveFlag: `export type ThreadActiveFlag = "waitingOnUserInput" | "waitingOnApproval";`,
};

test("contract accepts reordered multiline unions with a leading pipe", () => {
  assert.doesNotThrow(() => assertContractMatches(contract, generated));
});

test("contract rejects added or removed discriminants in either consumed type", () => {
  for (const name of ["TurnStatus", "ThreadActiveFlag"]) {
    const firstMember = generated[name].match(/"[^"]+"/)[0];
    const removed = generated[name].replace(firstMember, "");
    const added = generated[name].replace(";", ' | "newStatus";');
    for (const replacement of [removed, added]) {
      assert.throws(
        () => assertContractMatches(contract, { ...generated, [name]: replacement }),
        new RegExp(`Codex contract changed: ${name}`),
      );
    }
  }
});

test("contract fails closed on missing declarations or non-string unions", () => {
  for (const source of ["", "export type TurnStatus = string;", "export type TurnStatus = ;"]) {
    assert.throws(
      () => assertContractMatches(contract, { ...generated, TurnStatus: source }),
      /Codex contract changed: TurnStatus/,
    );
    assert.throws(() => assertContractMatches(source, generated), /Codex contract changed: TurnStatus/);
  }
});
