/**
 * Which hosts count as "this computer" for the policy placeholder (web/src/data/legal.ts), and what
 * the swap does to a page. Public hosts must keep their links.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCAL_POLICIES_TEXT, isLoopbackHost, showLocalPolicies } from "../web/src/data/legal.ts";

test("loopback names and addresses are recognised", () => {
  for (const host of ["localhost", "LOCALHOST", "studio.localhost", "127.0.0.1", "127.12.0.255", "[::1]", "::1"]) {
    assert.equal(isLoopbackHost(host), true, host);
  }
});

test("public hosts, private LAN addresses and look-alikes are not loopback", () => {
  for (const host of ["kinemi.app", "www.kinemi.app", "192.168.1.20", "10.0.0.5", "0.0.0.0", "localhost.example.com", "127.0.0.1.example.com", "127.0.0.256", "1127.0.0.1", "", "example.localhost.org"]) {
    assert.equal(isLoopbackHost(host), false, host);
  }
});

/** A DOM stand-in with just what showLocalPolicies touches. */
function fakeDom() {
  const nav = { children: ["links"], replaceChildren(...next) { this.children = next; } };
  globalThis.document = { createElement: () => ({ className: "", textContent: "" }) };
  return { nav, root: { querySelectorAll: (selector) => (selector === "[data-policies]" ? [nav] : []) } };
}

test("on a loopback host the policy links are replaced by the placeholder", () => {
  const { nav, root } = fakeDom();
  showLocalPolicies("localhost", root);
  assert.equal(nav.children.length, 1);
  assert.equal(nav.children[0].textContent, "Your policies here");
  assert.equal(LOCAL_POLICIES_TEXT, "Your policies here");
});

test("on a public host the policy links stay", () => {
  const { nav, root } = fakeDom();
  showLocalPolicies("kinemi.app", root);
  assert.deepEqual(nav.children, ["links"]);
});
