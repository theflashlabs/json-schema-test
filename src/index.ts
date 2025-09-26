"use strict";
import { glob } from "glob";
import path from "node:path";
import nodeAssert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
    only?: true | string[]; // names of TestSuite or filenames or true to perform only these tests
    skip?: true | string[]; // skip all or some tests
    cwd?: string; // working dir, pass __dirname or import.meta.dirname to use paths relative to the module
    hideFolder?: string;
    timeout?: number;
    assert?: Assert;
    Promise?: typeof Promise;
  }

  type Suites = SuitesPath | TestSuite[] | TestSuitePath[];

  type SuitesPath = string; // glob pattern

  interface TestSuite {
    name: string;
    test: TestGroup[];
  }

  interface TestSuitePath {
    name: string;
    path: string;
  }

  interface TestGroup {
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

  interface Assert {
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

  skipOrOnly(opts, describe)(
    opts.description || "JSON schema tests",
    function () {
      if (opts.timeout) this.timeout(opts.timeout);
      for (var suiteName in opts.suites)
        addTests(suiteName, opts.suites[suiteName]);
    },
  );

  function addTests(suiteName, filesOrPath) {
    describe(suiteName, function () {
      var files = Array.isArray(filesOrPath)
        ? filesOrPath
        : getTestFiles(filesOrPath);

      files.forEach(function (file) {
        var filter = {
          skip: getFileFilter(file, "skip"),
          only: getFileFilter(file, "only"),
        };

        skipOrOnly(filter, describe)(file.name, function () {
          if (file.test) {
            var testSets = file.test;
          } else if (file.path) {
            var testPath = file.path,
              testDir = path.dirname(testPath);
            var testSets = require(testPath);
          }
          testSets.forEach(function (testSet) {
            skipOrOnly(testSet, describe)(testSet.description, function () {
              if (Array.isArray(testSet.schemas))
                testSet.schemas.forEach(function (schema, i) {
                  var descr =
                    schema.description || schema.id || schema.$ref || "#" + i;
                  describe("schema " + descr, function () {
                    testSchema(schema);
                  });
                });
              else testSchema(testSet.schema);

              function testSchema(schema) {
                testSet.tests.forEach(function (test) {
                  skipOrOnly(test, it)(test.description, function () {
                    if (Array.isArray(validators)) {
                      if (opts.async)
                        return _Promise.all(validators.map(doTest));
                      else validators.forEach(doTest);
                    } else {
                      return doTest(validators);
                    }
                  });

                  function doTest(validator) {
                    var data;
                    if (test.dataFile) {
                      var dataFile = path.resolve(testDir || "", test.dataFile);
                      data = require(dataFile);
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
                        function (_valid) {
                          testResults(_valid, null);
                        },
                        function (err) {
                          if (err.errors) testResults(false, err.errors);
                          else testException(err);
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

                      suiteHooks(passed, valid, errors);
                      assert.equal(valid, test.valid);
                    }

                    function testException(err) {
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

                      suiteHooks(passed);
                      assert.equal(err.message, test.error);
                    }

                    function suiteHooks(passed, valid?, errors?) {
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
                  }
                });
              }
            });
          });
        });
      });
    });

    function getFileFilter(file, property) {
      var filter = opts[property];
      return Array.isArray(filter) && filter.indexOf(file.name) >= 0;
    }
  }

  function skipOrOnly(filter, func) {
    return filter.only === true
      ? func.only
      : filter.skip === true
        ? func.skip
        : func;
  }

  function getTestFiles(testsPath) {
    var files = glob.sync(testsPath, { cwd: opts.cwd });
    return files.map(function (file) {
      var match = file.match(/([\w\-_]+\/)[\w\-_]+\.json/);
      var folder = match ? match[1] : "";
      if (opts.hideFolder && folder == opts.hideFolder) folder = "";
      return {
        path: path.join(opts.cwd, file),
        name: folder + path.basename(file, ".json"),
      };
    });
  }
}
