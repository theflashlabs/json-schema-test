import jsonSchemaTest from "../src/index.ts";
import assert from "assert";
import { Ajv } from "ajv";
import { describe, beforeEach, afterEach, it } from "vitest";
const ajv = new Ajv();

describe("passing tests", () => {
  let hookCalled: unknown;

  beforeEach(() => (hookCalled = undefined));

  jsonSchemaTest(ajv, {
    description: "passing tests",
    suites: { tests: "./tests/*.pass.json" },
    cwd: import.meta.dirname,
    afterEach: () => (hookCalled = true),
    describe,
    it,
  });

  jsonSchemaTest([ajv, ajv], {
    description: "passing tests, two validators",
    suites: { tests: "./tests/*.json" },
    cwd: import.meta.dirname,
    skip: ["standard.fail", "standard.fail.async", "standard.pass.async"],
    afterEach: () => (hookCalled = true),
    describe,
    it,
  });

  afterEach(() => assert(hookCalled));
});

jsonSchemaTest(ajv, {
  description: "passing async tests",
  async: true,
  suites: { tests: "./tests/*.pass.async.json" },
  cwd: import.meta.dirname,
  describe,
  it,
});

jsonSchemaTest([ajv, ajv], {
  description: "passing async tests, two validators",
  async: true,
  suites: { tests: "./tests/*.pass.async.json" },
  cwd: import.meta.dirname,
  describe,
  it,
});
