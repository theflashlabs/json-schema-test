"use strict";

import jsonSchemaTest from "../dist/index.js";
import Ajv from "ajv";
const ajv = new Ajv();
import assert from "assert";

describe("failing tests", () => {
  var hookCalled;

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
