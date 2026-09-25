import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import type { Platform, PlatformTool } from "./platform-schemas.js";
import type { LayaAnswer } from "./types.js";

export const CALIBRATION_FILE_VERSION = 1;
export const MIN_TEMPERATURE = 0.5;
export const MAX_TEMPERATURE = 5.0;
export const NEUTRAL_TEMPERATURE = 1.0;
export const DEFAULT_MIN_CALIBRATION_EXAMPLES = 20;

export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationError";
  }
}

export interface CalibrationEntry {
  model: string;
  platform: Platform;
  tool: PlatformTool;
  question: string;
  schemaHash: string;
  temperature: number;
  sampleCount: number;
  uncalibratedNegativeLogLikelihood: number;
  negativeLogLikelihood: number;
}

export interface CalibrationFile {
  version: typeof CALIBRATION_FILE_VERSION;
  generatedAt: string;
  entries: CalibrationEntry[];
}

export type CalibrationCatalog = ReadonlyMap<string, CalibrationEntry>;

export interface CalibrationObservation {
  model: string;
  platform: Platform;
  tool: PlatformTool;
  question: string;
  schemaHash: string;
  probabilities: Record<string, number>;
  label: string;
}

export interface CalibrationLookup {
  model: string;
  platform: Platform;
  tool: PlatformTool;
  question: string;
  expectedSchemaHash: string;
}

export type CalibrationStatus = "fitted" | "neutral" | "stale";

export interface CalibrationMetadata {
  status: CalibrationStatus;
  applied: boolean;
  temperature: number;
  model: string;
  platform: Platform;
  tool: PlatformTool;
  question: string;
  expected_schema_hash: string;
  fitted_schema_hash?: string;
  stored_temperature?: number;
  sample_count?: number;
}

export interface CalibratedAnswer {
  probabilities: Record<string, number>;
  answerConfidence: number;
  rawAnswerConfidence: number;
  reportedAnswerConfidence?: number;
  calibration: CalibrationMetadata;
}

export interface SkippedCalibration {
  model: string;
  platform: Platform;
  tool: PlatformTool;
  question: string;
  schemaHash: string;
  sampleCount: number;
  reason: string;
}

export interface CalibrationFitResult {
  file: CalibrationFile;
  skipped: SkippedCalibration[];
}

const calibrationEntrySchema = z
  .object({
    model: z.string().min(1),
    platform: z.enum(["kubernetes", "openshift"]),
    tool: z.enum(["judge", "route_step"]),
    question: z.string().min(1),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
    temperature: z.number().finite().min(MIN_TEMPERATURE).max(MAX_TEMPERATURE),
    sampleCount: z.number().int().positive(),
    uncalibratedNegativeLogLikelihood: z.number().finite().nonnegative(),
    negativeLogLikelihood: z.number().finite().nonnegative(),
  })
  .strict();

const calibrationFileSchema = z
  .object({
    version: z.literal(CALIBRATION_FILE_VERSION),
    generatedAt: z.string().min(1),
    entries: z.array(calibrationEntrySchema).max(10_000),
  })
  .strict();

function requireObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CalibrationError(`${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function schemaFingerprint(schema: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch (error) {
    throw new CalibrationError(
      `Unable to serialize calibration schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (serialized === undefined) {
    throw new CalibrationError("Unable to serialize calibration schema");
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function baseKey(model: string, platform: Platform, tool: PlatformTool, question: string): string {
  return JSON.stringify([model, platform, tool, question]);
}

export function calibrationKey(
  model: string,
  platform: Platform,
  tool: PlatformTool,
  question: string,
  schemaHash: string,
): string {
  return JSON.stringify([model, platform, tool, question, schemaHash]);
}

function normalizeDistribution(
  probabilities: Record<string, number>,
  context: string,
): { values: number[]; labels: string[]; total: number } {
  const labels = Object.keys(probabilities);
  if (labels.length < 2) {
    throw new CalibrationError(`${context} must contain at least two probability labels`);
  }
  const values: number[] = [];
  let total = 0;
  for (const label of labels) {
    const probability = probabilities[label];
    if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0) {
      throw new CalibrationError(`${context}.${label} must be a finite non-negative number`);
    }
    values.push(probability);
    total += probability;
  }
  if (!(total > 0)) {
    throw new CalibrationError(`${context} probabilities must have a positive sum`);
  }
  return { values: values.map(value => value / total), labels, total };
}

function negativeLogLikelihood(rows: CalibrationObservation[], temperature: number): number {
  if (!(temperature >= MIN_TEMPERATURE && temperature <= MAX_TEMPERATURE)) {
    throw new CalibrationError(
      `temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}, got ${temperature}`,
    );
  }

  let loss = 0;
  for (const row of rows) {
    const { values, labels } = normalizeDistribution(
      row.probabilities,
      `${row.platform}.${row.tool}.${row.question}`,
    );
    const labelIndex = labels.indexOf(row.label);
    if (labelIndex < 0) {
      throw new CalibrationError(
        `${row.platform}.${row.tool}.${row.question} label ${JSON.stringify(row.label)} is absent from probabilities`,
      );
    }
    const logValues = values.map(value => (value > 0 ? Math.log(value) : Number.NEGATIVE_INFINITY));
    const maximum = Math.max(...logValues.map(value => value / temperature));
    const denominator = logValues.reduce((sum, value) => {
      const scaled = value / temperature;
      return sum + Math.exp(scaled - maximum);
    }, 0);
    const labelLogValue = logValues[labelIndex] / temperature;
    loss += maximum + Math.log(denominator) - labelLogValue;
  }
  return loss / rows.length;
}

function goldenSectionMinimum(
  evaluate: (temperature: number) => number,
  lower: number,
  upper: number,
): number {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let left = lower;
  let right = upper;
  let c = right - ratio * (right - left);
  let d = left + ratio * (right - left);
  let fc = evaluate(c);
  let fd = evaluate(d);

  for (let iteration = 0; iteration < 80; iteration += 1) {
    if (fc <= fd) {
      right = d;
      d = c;
      fd = fc;
      c = right - ratio * (right - left);
      fc = evaluate(c);
    } else {
      left = c;
      c = d;
      fc = fd;
      d = left + ratio * (right - left);
      fd = evaluate(d);
    }
  }
  return (left + right) / 2;
}

export function fitTemperature(rows: CalibrationObservation[]): number {
  if (rows.length === 0) {
    throw new CalibrationError("Cannot fit temperature without observations");
  }

  let bestTemperature = NEUTRAL_TEMPERATURE;
  let bestLoss = negativeLogLikelihood(rows, bestTemperature);
  const gridPoints = 451;
  const step = (MAX_TEMPERATURE - MIN_TEMPERATURE) / (gridPoints - 1);
  let bestIndex = Math.round((bestTemperature - MIN_TEMPERATURE) / step);

  for (let index = 0; index < gridPoints; index += 1) {
    const temperature = MIN_TEMPERATURE + index * step;
    const loss = negativeLogLikelihood(rows, temperature);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestTemperature = temperature;
      bestIndex = index;
    }
  }

  if (bestIndex === 0 || bestIndex === gridPoints - 1) {
    return bestTemperature;
  }

  const lower = MIN_TEMPERATURE + (bestIndex - 1) * step;
  const upper = MIN_TEMPERATURE + (bestIndex + 1) * step;
  return goldenSectionMinimum(candidate => negativeLogLikelihood(rows, candidate), lower, upper);
}

export function fitCalibrations(
  observations: CalibrationObservation[],
  minExamples = DEFAULT_MIN_CALIBRATION_EXAMPLES,
): CalibrationFitResult {
  if (!Number.isSafeInteger(minExamples) || minExamples <= 0) {
    throw new CalibrationError(`minExamples must be a positive integer, got ${minExamples}`);
  }

  const groups = new Map<string, CalibrationObservation[]>();
  for (const observation of observations) {
    if (!observation.model.trim()) {
      throw new CalibrationError("Every calibration observation requires a non-empty model");
    }
    if (!observation.question.trim()) {
      throw new CalibrationError("Every calibration observation requires a non-empty question id");
    }
    if (!/^[a-f0-9]{64}$/.test(observation.schemaHash)) {
      throw new CalibrationError(`Invalid schema hash for question ${observation.question}`);
    }
    const key = calibrationKey(
      observation.model,
      observation.platform,
      observation.tool,
      observation.question,
      observation.schemaHash,
    );
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [observation]);
    else group.push(observation);
  }

  const entries: CalibrationEntry[] = [];
  const skipped: SkippedCalibration[] = [];
  for (const [key, rows] of groups) {
    const first = rows[0]!;
    if (rows.length < minExamples) {
      skipped.push({
        model: first.model,
        platform: first.platform,
        tool: first.tool,
        question: first.question,
        schemaHash: first.schemaHash,
        sampleCount: rows.length,
        reason: `requires at least ${minExamples} held-out examples`,
      });
      continue;
    }

    const temperature = fitTemperature(rows);
    entries.push({
      model: first.model,
      platform: first.platform,
      tool: first.tool,
      question: first.question,
      schemaHash: first.schemaHash,
      temperature,
      sampleCount: rows.length,
      uncalibratedNegativeLogLikelihood: negativeLogLikelihood(rows, NEUTRAL_TEMPERATURE),
      negativeLogLikelihood: negativeLogLikelihood(rows, temperature),
    });
    // Ensure the generated key is consumed even though sorting below uses its fields.
    void key;
  }

  entries.sort((left, right) => {
    const leftKey = calibrationKey(left.model, left.platform, left.tool, left.question, left.schemaHash);
    const rightKey = calibrationKey(right.model, right.platform, right.tool, right.question, right.schemaHash);
    return leftKey.localeCompare(rightKey);
  });
  skipped.sort((left, right) => {
    const leftKey = calibrationKey(left.model, left.platform, left.tool, left.question, left.schemaHash);
    const rightKey = calibrationKey(right.model, right.platform, right.tool, right.question, right.schemaHash);
    return leftKey.localeCompare(rightKey);
  });

  return {
    file: {
      version: CALIBRATION_FILE_VERSION,
      generatedAt: new Date().toISOString(),
      entries,
    },
    skipped,
  };
}

export function emptyCalibrationCatalog(): CalibrationCatalog {
  return new Map<string, CalibrationEntry>();
}

export function parseCalibrationCatalog(value: unknown, source = "calibration data"): CalibrationCatalog {
  const parsed = calibrationFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new CalibrationError(`${source} is invalid: ${parsed.error.message}`);
  }
  const catalog = new Map<string, CalibrationEntry>();
  for (const entry of parsed.data.entries) {
    const key = calibrationKey(entry.model, entry.platform, entry.tool, entry.question, entry.schemaHash);
    if (catalog.has(key)) {
      throw new CalibrationError(`${source} contains a duplicate calibration entry for ${entry.question}`);
    }
    catalog.set(key, entry);
  }
  return catalog;
}

export async function loadCalibrationCatalog(path?: string): Promise<CalibrationCatalog> {
  if (path === undefined) return emptyCalibrationCatalog();
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new CalibrationError(
      `Unable to read calibration file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new CalibrationError(
      `Calibration file ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseCalibrationCatalog(requireObject(value, `Calibration file ${path}`), `Calibration file ${path}`);
}

function lookupCalibration(
  catalog: CalibrationCatalog,
  request: CalibrationLookup,
): { status: CalibrationStatus; entry?: CalibrationEntry } {
  const exact = catalog.get(
    calibrationKey(request.model, request.platform, request.tool, request.question, request.expectedSchemaHash),
  );
  if (exact !== undefined) return { status: "fitted", entry: exact };

  const base = baseKey(request.model, request.platform, request.tool, request.question);
  for (const [key, entry] of catalog) {
    if (baseKey(entry.model, entry.platform, entry.tool, entry.question) === base) {
      return { status: "stale", entry };
    }
  }
  return { status: "neutral" };
}

function applyTemperature(
  probabilities: Record<string, number>,
  temperature: number,
): Record<string, number> {
  const { values, labels } = normalizeDistribution(probabilities, "answer probabilities");
  const logValues = values.map(value => (value > 0 ? Math.log(value) : Number.NEGATIVE_INFINITY));
  const maximum = Math.max(...logValues.map(value => value / temperature));
  const exponentials = logValues.map(value => Math.exp(value / temperature - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(labels.map((label, index) => [label, exponentials[index]! / total]));
}

function probabilityMaximum(probabilities: Record<string, number>): number {
  const { values } = normalizeDistribution(probabilities, "answer probabilities");
  return Math.max(...values);
}

function reportedAnswerConfidence(answer: LayaAnswer): number | undefined {
  const value = answer.answer_confidence;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined;
  return value;
}

export function calibrateChoiceAnswer(
  answer: LayaAnswer,
  catalog: CalibrationCatalog,
  request: CalibrationLookup,
): CalibratedAnswer {
  const rawProbabilities = answer.probabilities;
  if (rawProbabilities === undefined) {
    throw new CalibrationError(`Laya answer for ${request.question} is missing probabilities`);
  }
  const rawMaximum = probabilityMaximum(rawProbabilities);
  const reported = reportedAnswerConfidence(answer);
  const rawAnswerConfidence = reported ?? rawMaximum;
  const { status, entry } = lookupCalibration(catalog, request);
  const fitted = status === "fitted" && entry !== undefined;

  const calibration: CalibrationMetadata = {
    status,
    applied: fitted,
    temperature: fitted ? entry.temperature : NEUTRAL_TEMPERATURE,
    model: request.model,
    platform: request.platform,
    tool: request.tool,
    question: request.question,
    expected_schema_hash: request.expectedSchemaHash,
    ...(entry === undefined
      ? {}
      : {
          fitted_schema_hash: entry.schemaHash,
          stored_temperature: entry.temperature,
          ...(fitted ? { sample_count: entry.sampleCount } : {}),
        }),
  };

  if (!fitted) {
    return {
      probabilities: rawProbabilities,
      answerConfidence: rawAnswerConfidence,
      rawAnswerConfidence,
      ...(reported === undefined ? {} : { reportedAnswerConfidence: reported }),
      calibration,
    };
  }

  const probabilities = applyTemperature(rawProbabilities, entry.temperature);
  return {
    probabilities,
    answerConfidence: probabilityMaximum(probabilities),
    rawAnswerConfidence,
    ...(reported === undefined ? {} : { reportedAnswerConfidence: reported }),
    calibration,
  };
}
