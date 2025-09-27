import { describe, beforeEach, afterEach, it } from "vitest";
import jsonSchemaTest from "../src/index.ts";
import assert from "assert";
import { Ajv } from "ajv";
const ajv = new Ajv();

describe("failing tests", () => {
  let hookCalled: unknown;

  beforeEach(() => (hookCalled = undefined));

  jsonSchemaTest(ajv, {
    description: "failing tests",
    suites: { tests: "./tests/*.fail.json" },
    cwd: import.meta.dirname,
    afterError: () => (hookCalled = true),
    describe,
    it,
  });

  afterEach(() => assert(hookCalled));
});

jsonSchemaTest(ajv, {
  description: "failing async tests",
  async: true,
  suites: { tests: "./tests/*.fail.async.json" },
  cwd: import.meta.dirname,
  describe,
  it,
});
