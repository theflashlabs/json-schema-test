"use strict";

import jsonSchemaTest from "../dist/index.js";
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
  });

  afterEach(() => assert(hookCalled));
});

jsonSchemaTest(ajv, {
  description: "failing async tests",
  async: true,
  suites: { tests: "./tests/*.fail.async.json" },
  cwd: import.meta.dirname,
});
