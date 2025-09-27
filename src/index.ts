"use strict";
import { glob } from "glob";
import path from "node:path";
import nodeAssert from "node:assert";
import type { SuiteAPI, TestAPI } from "vitest";

namespace JsonSchemaTest {
  type Schema = Record<string, unknown> | boolean;
  type ValidationError = any;

  export interface Validator {
    validate(
      schema: Schema,
      data: unknown,
    ): boolean | Promise<boolean | unknown>;
    errors?: ValidationError[] | null;
  }

  export interface Options {
    description?: string;
    suites: Record<string, Suites>;
    async?: boolean;
    asyncValid?: "data";
    afterEach?: (res: TestResult) => void;
    afterError?: (res: TestResult) => void; // res.passed === false
    log?: boolean; // pass false to prevent logging
    only?: boolean | string[]; // names of TestSuite or filenames or true to perform only these tests
    skip?: boolean | string[]; // skip all or some tests
    cwd?: string; // working dir, pass __dirname or import.meta.dirname to use paths relative to the module
    hideFolder?: string;
    timeout?: number;
    assert?: Assert;
    Promise?: typeof Promise;
    describe: SuiteAPI;
    it: TestAPI;
  }

  export type Suites = SuitesPath | TestSuite[] | TestSuitePath[];

  type SuitesPath = string; // glob pattern

  export interface TestSuite {
    name: string;
    test: TestGroup[];
  }

  export interface TestSuitePath {
    name: string;
    path: string;
  }

  export interface TestGroup {
    description: string;
    schema?: Schema | string;
    schemas?: (Schema | string)[];
    tests: Test[];
  }

  interface Test {
    description: string;
    data: unknown;
    valid?: boolean;
    error?: string;
  }

  interface TestResult {
    validator: Validator;
    schema: Schema;
    data: unknown;
    valid: boolean;
    expected: boolean;
    errors: ValidationError[] | null; // validation errors if valid === false
    passed: boolean; // true if valid === expected
  }

  export interface Assert {
    (ok: boolean): void;
    equal: (x: unknown, y: unknown) => void;
  }
}

export default function jsonSchemaTest(
  validators: JsonSchemaTest.Validator | JsonSchemaTest.Validator[],
  opts: JsonSchemaTest.Options,
) {
  const assert = opts.assert || nodeAssert;
  let _Promise: typeof Promise;
  if (opts.async) {
    _Promise = opts.Promise || Promise;
    if (!_Promise) throw new Error("async mode requires Promise support");
  }

  skipOrOnly(opts, opts.describe)(
    opts.description || "JSON schema tests",
    () => {
      if (opts.timeout) this.timeout(opts.timeout);
      for (const suiteName in opts.suites)
        addTests(
          suiteName,
          opts.suites[suiteName],
          opts,
          assert,
          validators,
          _Promise,
        );
    },
  );
}

function addTests(
  suiteName: string,
  filesOrPath: JsonSchemaTest.Suites,
  opts: JsonSchemaTest.Options,
  assert: JsonSchemaTest.Assert,
  validators: JsonSchemaTest.Validator | JsonSchemaTest.Validator[],
  _Promise: typeof Promise,
) {
  opts.describe(suiteName, () => {
    const files = Array.isArray(filesOrPath)
      ? (filesOrPath as JsonSchemaTest.TestSuite[])
      : getTestFiles(filesOrPath, opts);

    for (const file of files) {
      const filter = {
        skip: getFileFilter(file, opts, "skip"),
        only: getFileFilter(file, opts, "only"),
      };

      skipOrOnly(filter, opts.describe)(file.name, async () => {
        let testSets: JsonSchemaTest.TestGroup[];
        let testDir: string;
        if ("test" in file) {
          testSets = file.test;
        } else if ("path" in file) {
          const testPath = file.path;
          testDir = path.dirname(testPath);
          testSets = (
            await import(testPath, {
              with: { type: "json" },
            })
          ).default as JsonSchemaTest.TestGroup[];
        }
        for (const testSet of testSets) {
          skipOrOnly(testSet, opts.describe)(testSet.description, async () => {
            if (Array.isArray(testSet.schemas))
              testSet.schemas.forEach((schema, i) => {
                const descr =
                  // @ts-expect-error
                  schema.description || schema.id || schema.$ref || "#" + i;
                opts.describe("schema " + descr, async () => {
                  await testSchema(
                    schema,
                    testSet,
                    testDir,
                    assert,
                    validators,
                    opts,
                    _Promise,
                  );
                });
              });
            else
              await testSchema(
                testSet.schema,
                testSet,
                testDir,
                assert,
                validators,
                opts,
                _Promise,
              );
          });
        }
      });
    }
  });
}

async function testSchema(
  schema,
  testSet,
  testDir,
  assert,
  validators,
  opts,
  _Promise,
) {
  testSet.tests.forEach((test) => {
    skipOrOnly(test, opts.it)(test.description, () => {
      if (Array.isArray(validators)) {
        if (opts.async)
          return _Promise.all(
            validators.map((validator) =>
              doTest(validator, test, testDir, schema, assert, opts),
            ),
          );
        else {
          for (const validator of validators) {
            doTest(validator, test, testDir, schema, assert, opts);
          }
        }
      } else {
        return doTest(validators, test, testDir, schema, assert, opts);
      }
    });
  });
}

async function doTest(validator, test, testDir, schema, assert, opts) {
  var data;
  if (test.dataFile) {
    var dataFile = path.resolve(testDir || "", test.dataFile);
    data = await import(dataFile);
  } else {
    data = test.data;
  }

  var valid = validator.validate(schema, data);
  if (
    opts.async &&
    typeof valid == "object" &&
    typeof valid.then == "function"
  ) {
    return valid.then(
      (_valid) => {
        testResults(_valid, null);
      },
      (err) => {
        if (err.errors) testResults(false, err.errors);
        else testException(err, assert, validator, test, schema, data, opts);
      },
    );
  } else {
    testResults(valid, validator.errors);
  }

  function testResults(valid, errors) {
    if (opts.asyncValid == "data" && test.valid === true)
      valid = valid === data;
    var passed = valid === test.valid;
    if (!passed && opts.log !== false)
      console.log(
        "result:",
        valid,
        "\nexpected: ",
        test.valid,
        "\nerrors:",
        validator.errors,
      );
    if (valid) assert(!errors || errors.length == 0);
    else assert(errors.length > 0);

    suiteHooks(passed, validator, schema, data, test, opts, valid, errors);
    assert.equal(valid, test.valid);
  }
}

function testException(err, assert, validator, test, schema, data, opts) {
  var passed = err.message == test.error;
  if (!passed && opts.log !== false)
    console.log(
      "error:",
      err.message,
      "\nexpected: ",
      test.valid
        ? "valid"
        : test.valid === false
          ? "invalid"
          : "error " + test.error,
    );

  suiteHooks(passed, validator, schema, data, test, opts);
  assert.equal(err.message, test.error);
}

function suiteHooks(
  passed,
  validator,
  schema,
  data,
  test,
  opts,
  valid?,
  errors?,
) {
  var result = {
    passed: passed,
    validator: validator,
    schema: schema,
    data: data,
    valid: valid,
    expected: test.valid,
    expectedError: test.error,
    errors: errors,
  };

  if (opts.afterEach) opts.afterEach(result);
  if (opts.afterError && !passed) opts.afterError(result);
}

function getTestFiles(testsPath: string, opts: JsonSchemaTest.Options) {
  var files = glob.sync(testsPath, { cwd: opts.cwd });
  return files.map((file) => {
    var match = file.match(/([\w\-_]+\/)[\w\-_]+\.json/);
    var folder = match ? match[1] : "";
    if (opts.hideFolder && folder == opts.hideFolder) folder = "";
    return {
      path: path.join(opts.cwd, file),
      name: folder + path.basename(file, ".json"),
    } as JsonSchemaTest.TestSuitePath;
  });
}

function getFileFilter(file, opts, property): boolean {
  var filter = opts[property];
  return Array.isArray(filter) && filter.indexOf(file.name) >= 0;
}

function skipOrOnly(filter: Partial<JsonSchemaTest.Options>, func: SuiteAPI) {
  return filter.only === true
    ? func.only
    : filter.skip === true
      ? func.skip
      : func;
}
