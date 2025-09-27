import { glob } from "glob";
import path from "node:path";
import nodeAssert from "node:assert";

type Schema = Record<string, unknown> | boolean;
type ValidationError = any;

export interface Validator {
  validate(schema: Schema, data: unknown): boolean | Promise<boolean | unknown>;
  errors?: ValidationError[] | null;
}

type testFunc = {
  (description: string, cb: () => void, timeout?: number): void;
  skip: (description: string, cb: () => void) => void;
  only: (description: string, cb: () => void) => void;
};

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
  describe: testFunc;
  it: testFunc;
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

export interface TestResult {
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

export default function jsonSchemaTest(
  validators: Validator | Validator[],
  opts: Options,
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
      for (const suiteName in opts.suites)
        addTests(
          suiteName,
          opts.suites[suiteName] as Suites,
          opts,
          assert,
          validators,
          _Promise,
        );
    },
    opts.timeout,
  );
}

function addTests(
  suiteName: string,
  filesOrPath: Suites,
  opts: Options,
  assert: Assert,
  validators: Validator | Validator[],
  _Promise: typeof Promise,
) {
  opts.describe(suiteName, () => {
    const files = Array.isArray(filesOrPath)
      ? (filesOrPath as TestSuite[])
      : getTestFiles(filesOrPath, opts);

    for (const file of files) {
      const filter = {
        skip: getFileFilter(file, opts, "skip"),
        only: getFileFilter(file, opts, "only"),
      };

      skipOrOnly(filter, opts.describe)(file.name, async () => {
        let testSets: TestGroup[] = [];
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
          ).default as TestGroup[];
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
                testSet.schema as Schema,
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
  schema: string | Schema,
  testSet: TestGroup,
  testDir: string,
  assert: Assert,
  validators: Validator | Validator[],
  opts: Options,
  _Promise: typeof Promise,
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

async function doTest(
  validator: Validator,
  test: Test,
  testDir: string,
  schema: string | Schema,
  assert: Assert,
  opts: Options,
) {
  var data: unknown;
  if ("dataFile" in test) {
    // @ts-expect-error
    var dataFile = path.resolve(testDir || "", test.dataFile);
    data = (await import(dataFile)).default;
  } else {
    data = test.data;
  }

  var valid = validator.validate(schema as Schema, data);
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
    testResults(valid, validator.errors as any[]);
  }

  function testResults(valid: unknown, errors: string | any[] | null) {
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
    else assert(errors != null && errors?.length > 0);

    suiteHooks(
      passed,
      validator,
      schema,
      data,
      test,
      opts,
      valid,
      errors as string | any[],
    );
    assert.equal(valid, test.valid);
  }
}

function testException(
  err: { message: unknown },
  assert: Assert,
  validator: Validator,
  test: Test,
  schema: string | Schema,
  data: unknown,
  opts: Options,
) {
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
  passed: boolean,
  validator: Validator,
  schema: string | Schema,
  data: unknown,
  test: Test,
  opts: Options,
  valid?: unknown,
  errors?: string | any[],
) {
  var result = {
    passed: passed,
    validator: validator,
    schema: schema as Schema,
    data: data,
    valid: valid as boolean,
    expected: test.valid as boolean,
    expectedError: test.error,
    errors: errors as any[],
  };

  if (opts.afterEach) opts.afterEach(result);
  if (opts.afterError && !passed) opts.afterError(result);
}

function getTestFiles(testsPath: string, opts: Options) {
  var files = glob.sync(testsPath, { cwd: opts.cwd as string });
  return files.map((file) => {
    var match = file.match(/([\w\-_]+\/)[\w\-_]+\.json/);
    var folder = match ? match[1] : "";
    if (opts.hideFolder && folder == opts.hideFolder) folder = "";
    return {
      path: path.join(opts.cwd as string, file),
      name: folder + path.basename(file, ".json"),
    } as TestSuitePath;
  });
}

function getFileFilter(
  file: TestSuite | TestSuitePath,
  opts: Options,
  property: keyof Options,
): boolean {
  var filter = opts[property];
  return Array.isArray(filter) && filter.indexOf(file.name) >= 0;
}

function skipOrOnly(filter: Partial<Options>, func: testFunc) {
  return filter.only === true
    ? func.only
    : filter.skip === true
      ? func.skip
      : func;
}
