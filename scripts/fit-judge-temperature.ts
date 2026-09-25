import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod/v4";
import {
  DEFAULT_MIN_CALIBRATION_EXAMPLES,
  fitCalibrations,
  schemaFingerprint,
  type CalibrationObservation,
} from "../src/calibration.js";
import { loadConfig } from "../src/config.js";
import { answerFor, LayaClient } from "../src/laya-client.js";
import {
  JUDGE_QUESTION_IDS,
  judgeQuestions,
  PLATFORMS,
  routeStepQuestion,
  type Platform,
  type PlatformTool,
} from "../src/platform-schemas.js";
import type { LayaQuestion, LayaResult, Logger } from "../src/types.js";

const modelSchema = z.enum(["english", "multilingual", "typed-decisions"]);
const customStepsSchema = z
  .record(z.string(), z.string().min(1).max(1_000))
  .refine(value => Object.keys(value).length > 0)
  .refine(value => Object.keys(value).length <= 64)
  .refine(
    value => Object.keys(value).every(key => key.trim().length > 0 && !["__proto__", "prototype", "constructor"].includes(key)),
  );

const fitCaseSchema = z.discriminatedUnion("tool", [
  z
    .object({
      tool: z.literal("judge"),
      platform: z.enum(PLATFORMS),
      state: z.json(),
      labels: z.record(z.string(), z.string().min(1)),
      model: modelSchema.optional(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("route_step"),
      platform: z.enum(PLATFORMS),
      state: z.json(),
      label: z.string().min(1),
      steps: customStepsSchema.optional(),
      instructions: z.string().min(1).max(4_000).optional(),
      model: modelSchema.optional(),
    })
    .strict(),
]);

type FitCase = z.infer<typeof fitCaseSchema>;

interface CliOptions {
  input: string;
  output: string;
  minExamples: number;
}

const logger: Logger = {
  debug(message, ...args) {
    console.error(`[laya-calibrate] ${message}`, ...args);
  },
  error(message, ...args) {
    console.error(`[laya-calibrate] ${message}`, ...args);
  },
};

function usage(): string {
  return [
    "Usage:",
    "  npm run calibrate -- --input calibration.jsonl [--output laya-calibration.json] [--min-examples 20]",
    "",
    "Each JSONL row is either:",
    '  {"tool":"judge","platform":"kubernetes","state":{},"labels":{"intent":"deploy","risk":"low","verdict":"proceed"}}',
    '  {"tool":"route_step","platform":"openshift","state":{},"label":"inspect_project"}',
  ].join("\n");
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  if (args.includes("--help") || args.includes("-h")) throw new Error(usage());
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined || !argument.startsWith("--")) {
      throw new Error(`Unexpected argument ${JSON.stringify(argument)}\n${usage()}`);
    }
    const equals = argument.indexOf("=");
    const name = equals >= 0 ? argument.slice(2, equals) : argument.slice(2);
    const value = equals >= 0 ? argument.slice(equals + 1) : args[++index];
    if (value === undefined || value.length === 0) {
      throw new Error(`Missing value for --${name}\n${usage()}`);
    }
    values.set(name, value);
  }
  const input = values.get("input");
  if (input === undefined) throw new Error(`--input is required\n${usage()}`);
  const allowed = new Set(["input", "output", "min-examples"]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown option --${name}\n${usage()}`);
  }
  return {
    input: resolve(input),
    output: resolve(values.get("output") ?? "laya-calibration.json"),
    minExamples: positiveInteger(values.get("min-examples") ?? String(DEFAULT_MIN_CALIBRATION_EXAMPLES), "--min-examples"),
  };
}

function routedModel(result: LayaResult, requestedModel?: string): string {
  const routing = result.routing;
  if (
    typeof routing === "object" &&
    routing !== null &&
    !Array.isArray(routing) &&
    typeof (routing as Record<string, unknown>).model === "string" &&
    (routing as Record<string, unknown>).model
  ) {
    return (routing as Record<string, unknown>).model as string;
  }
  return requestedModel ?? (typeof result.model === "string" ? result.model : "unknown");
}

function questionsForCase(fitCase: FitCase): Record<string, LayaQuestion> {
  if (fitCase.tool === "judge") return judgeQuestions(fitCase.platform);
  return {
    next_step: routeStepQuestion(fitCase.platform, fitCase.steps, fitCase.instructions),
  };
}

function labelsForCase(fitCase: FitCase): Record<string, string> {
  if (fitCase.tool === "route_step") return { next_step: fitCase.label };
  const expected = new Set<string>(JUDGE_QUESTION_IDS);
  const supplied = Object.keys(fitCase.labels);
  const missing = [...expected].filter(question => !supplied.includes(question));
  const extra = supplied.filter(question => !expected.has(question));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `judge labels must contain exactly ${JUDGE_QUESTION_IDS.join(", ")}; ` +
        `missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`,
    );
  }
  return fitCase.labels;
}

function parseCase(line: string, lineNumber: number): FitCase | undefined {
  if (line.trim().length === 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Line ${lineNumber} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = fitCaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Line ${lineNumber} is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function collectObservations(
  client: LayaClient,
  inputPath: string,
): Promise<CalibrationObservation[]> {
  const lines = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
  const observations: CalibrationObservation[] = [];
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const fitCase = parseCase(line, lineNumber);
      if (fitCase === undefined) continue;
      const questions = questionsForCase(fitCase);
      const labels = labelsForCase(fitCase);
      const result = await client.predict(fitCase.state, questions, fitCase.model);
      const model = routedModel(result, fitCase.model);
      const fingerprint = schemaFingerprint(questions);

      for (const [question, label] of Object.entries(labels)) {
        const answer = answerFor(result, question);
        if (answer.probabilities === undefined) {
          throw new Error(`Line ${lineNumber}: Laya answer for ${question} has no probabilities`);
        }
        if (!Object.prototype.hasOwnProperty.call(answer.probabilities, label)) {
          throw new Error(
            `Line ${lineNumber}: expected label ${JSON.stringify(label)} is absent from ${question} probabilities`,
          );
        }
        observations.push({
          model,
          platform: fitCase.platform as Platform,
          tool: fitCase.tool as PlatformTool,
          question,
          schemaHash: fingerprint,
          probabilities: answer.probabilities,
          label,
        });
      }
    }
  } finally {
    lines.close();
  }

  return observations;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }
  const options = parseArgs(args);
  const config = loadConfig();
  const client = new LayaClient(config, logger);
  let observations: CalibrationObservation[];
  try {
    observations = await collectObservations(client, options.input);
  } finally {
    await client.close();
  }

  if (observations.length === 0) {
    throw new Error(`No calibration cases found in ${options.input}`);
  }
  const result = fitCalibrations(observations, options.minExamples);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(result.file, null, 2)}\n`, "utf8");

  logger.debug(
    `Wrote ${result.file.entries.length} calibration entries to ${options.output} from ${observations.length} labeled answers`,
  );
  for (const skipped of result.skipped) {
    logger.error(
      `Skipped ${skipped.platform}.${skipped.tool}.${skipped.question} (${skipped.model}): ` +
        `${skipped.sampleCount} examples; ${skipped.reason}`,
    );
  }
}

main().catch(error => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
