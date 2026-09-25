import { McpServer } from "@modelcontextprotocol/server";
import {
  calibrateChoiceAnswer,
  emptyCalibrationCatalog,
  schemaFingerprint,
  type CalibrationCatalog,
} from "./calibration.js";
import { answerFor, LayaClient, LayaClientError, modelLabel } from "./laya-client.js";
import {
  JUDGE_QUESTION_IDS,
  judgeQuestions,
  routeStepQuestion,
  type JudgeQuestionId,
} from "./platform-schemas.js";
import {
  checkInputSchema,
  classifyInputSchema,
  decideInputSchema,
  judgeInputSchema,
  routeStepInputSchema,
  scoreInputSchema,
  TOOL_DESCRIPTIONS,
} from "./schemas.js";
import { serializeToolResult } from "./serialization.js";
import type { LayaAnswer, LayaQuestion, LayaResult } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function requiredNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LayaClientError(`Laya response for ${context} is missing a finite numeric ${key}`);
  }
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new LayaClientError(`Laya response for ${context} is missing a string ${key}`);
  }
  return value;
}

function requiredChoice(
  answer: LayaAnswer,
  probabilities: Record<string, number>,
  context: string,
): string {
  const choice = requiredString(answer, "choice", context);
  if (!Object.prototype.hasOwnProperty.call(probabilities, choice)) {
    throw new LayaClientError(`Laya response for ${context} selected ${JSON.stringify(choice)} without a probability`);
  }
  return choice;
}

function probabilityMap(answer: LayaAnswer): Record<string, number> {
  if (!isRecord(answer.probabilities)) return {};
  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(answer.probabilities)) {
    if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
  }
  return output;
}

function confidenceFor(answer: LayaAnswer, probabilities: Record<string, number>): number {
  return optionalNumber(answer, "confidence") ?? Math.max(0, ...Object.values(probabilities));
}

function resultCheckpoint(result: LayaResult, requestedModel?: string): string {
  if (isRecord(result.routing) && typeof result.routing.model === "string" && result.routing.model.length > 0) {
    return result.routing.model;
  }
  return requestedModel ?? modelLabel(result) ?? "unknown";
}

function metadata(result: LayaResult, requestedModel?: string): Record<string, unknown> {
  return compact({
    model: resultCheckpoint(result, requestedModel),
    routing: isRecord(result.routing) ? result.routing : undefined,
    usage: isRecord(result.usage) ? result.usage : undefined,
  });
}

export interface McpServerOptions {
  calibrationCatalog?: CalibrationCatalog;
  confidenceThreshold?: number;
}

function asQuestions(value: unknown): Record<string, LayaQuestion> {
  return value as Record<string, LayaQuestion>;
}

export function createMcpServer(client: LayaClient, options: McpServerOptions = {}): McpServer {
  const calibrationCatalog = options.calibrationCatalog ?? emptyCalibrationCatalog();
  const defaultConfidenceThreshold = options.confidenceThreshold ?? 0.8;
  if (!Number.isFinite(defaultConfidenceThreshold) || defaultConfidenceThreshold < 0 || defaultConfidenceThreshold > 1) {
    throw new TypeError("confidenceThreshold must be a finite number between 0 and 1");
  }

  const server = new McpServer({
    name: "laya",
    version: "0.1.0",
  });

  const readOnly = { readOnlyHint: true };

  server.registerTool(
    "decide",
    {
      title: "Laya typed decision",
      description: TOOL_DESCRIPTIONS.decide,
      inputSchema: decideInputSchema,
      annotations: readOnly,
    },
    async ({ state, questions, model }) => {
      const result = await client.predict(state, asQuestions(questions), model);
      return serializeToolResult(result as Record<string, unknown>);
    },
  );

  server.registerTool(
    "classify",
    {
      title: "Laya classification",
      description: TOOL_DESCRIPTIONS.classify,
      inputSchema: classifyInputSchema,
      annotations: readOnly,
    },
    async ({ text, labels, instructions, model }) => {
      const criteria = Object.fromEntries(labels.map(label => [label, label]));
      const result = await client.predict(
        text,
        {
          label: {
            type: "choice",
            instructions: instructions || "Pick the single best label for this text.",
            criteria,
          },
        },
        model,
      );
      const answer = answerFor(result, "label");
      const probabilities = probabilityMap(answer);
      return serializeToolResult(
        compact({
          label: requiredString(answer, "choice", "classify"),
          confidence: confidenceFor(answer, probabilities),
          answer_confidence: optionalNumber(answer, "answer_confidence"),
          scores: probabilities,
          probabilities,
          ...metadata(result, model),
        }),
      );
    },
  );

  server.registerTool(
    "score",
    {
      title: "Laya ordinal score",
      description: TOOL_DESCRIPTIONS.score,
      inputSchema: scoreInputSchema,
      annotations: readOnly,
    },
    async ({ text, criteria, instructions, model }) => {
      const result = await client.predict(
        text,
        {
          score: {
            type: "score",
            instructions: instructions || "Rate this text on the given ordered scale.",
            criteria,
          },
        },
        model,
      );
      const answer = answerFor(result, "score");
      const probabilities = probabilityMap(answer);
      return serializeToolResult(
        compact({
          type: "score",
          score: requiredNumber(answer, "score", "score"),
          legend: isRecord(answer.legend) ? answer.legend : {},
          probabilities,
          confidence: confidenceFor(answer, probabilities),
          answer_confidence: optionalNumber(answer, "answer_confidence"),
          ...metadata(result, model),
        }),
      );
    },
  );

  server.registerTool(
    "check",
    {
      title: "Laya yes/no check",
      description: TOOL_DESCRIPTIONS.check,
      inputSchema: checkInputSchema,
      annotations: readOnly,
    },
    async ({ state, question, model }) => {
      const result = await client.predict(
        state,
        {
          check: {
            type: "noul",
            instructions: question,
          },
        },
        model,
      );
      const answer = answerFor(result, "check");
      let yes = optionalNumber(answer, "noul");
      if (yes === undefined && typeof answer.choice === "string") {
        yes = answer.choice.toLowerCase() === "true" ? 1 : 0;
      }
      if (yes === undefined) {
        throw new LayaClientError("Laya response for check is missing a yes probability");
      }
      yes = Math.min(1, Math.max(0, yes));
      return serializeToolResult(
        compact({
          yes,
          no: 1 - yes,
          confidence: optionalNumber(answer, "confidence") ?? Math.max(yes, 1 - yes),
          answer_confidence: optionalNumber(answer, "answer_confidence"),
          ...metadata(result, model),
        }),
      );
    },
  );

  server.registerTool(
    "judge",
    {
      title: "Laya Kubernetes/OpenShift judge",
      description: TOOL_DESCRIPTIONS.judge,
      inputSchema: judgeInputSchema,
      annotations: readOnly,
    },
    async ({ state, platform, threshold, model }) => {
      const questions = judgeQuestions(platform);
      const fingerprint = schemaFingerprint(questions);
      const result = await client.predict(state, questions, model);
      const checkpoint = resultCheckpoint(result, model);
      const gateThreshold = threshold ?? defaultConfidenceThreshold;

      const decisions = {} as Record<
        JudgeQuestionId,
        {
          value: string;
          confidence: number;
          raw_confidence: number;
          reported_confidence?: number;
          entropy_confidence?: number;
          probabilities: Record<string, number>;
          calibration: ReturnType<typeof calibrateChoiceAnswer>["calibration"];
        }
      >;

      for (const questionId of JUDGE_QUESTION_IDS) {
        const answer = answerFor(result, questionId);
        const probabilities = probabilityMap(answer);
        const choice = requiredChoice(answer, probabilities, `judge.${questionId}`);
        const calibrated = calibrateChoiceAnswer(
          { ...answer, probabilities },
          calibrationCatalog,
          {
            model: checkpoint,
            platform,
            tool: "judge",
            question: questionId,
            expectedSchemaHash: fingerprint,
          },
        );
        decisions[questionId] = {
          value: choice,
          confidence: calibrated.answerConfidence,
          raw_confidence: calibrated.rawAnswerConfidence,
          ...(calibrated.reportedAnswerConfidence === undefined
            ? {}
            : { reported_confidence: calibrated.reportedAnswerConfidence }),
          ...(optionalNumber(answer, "confidence") === undefined
            ? {}
            : { entropy_confidence: optionalNumber(answer, "confidence") }),
          probabilities: calibrated.probabilities,
          calibration: calibrated.calibration,
        };
      }

      const confidence = Math.min(...JUDGE_QUESTION_IDS.map(questionId => decisions[questionId].confidence));
      const belowThreshold = JUDGE_QUESTION_IDS.filter(
        questionId => decisions[questionId].confidence < gateThreshold,
      );
      return serializeToolResult({
        platform,
        intent: decisions.intent.value,
        risk: decisions.risk.value,
        verdict: decisions.verdict.value,
        confidence,
        gate: {
          passed: belowThreshold.length === 0,
          threshold: gateThreshold,
          confidence,
          basis: "minimum_answer_confidence",
          below_threshold: belowThreshold,
        },
        decisions,
        raw_answers: result.answers,
        ...metadata(result, model),
      });
    },
  );

  server.registerTool(
    "route_step",
    {
      title: "Laya Kubernetes/OpenShift route step",
      description: TOOL_DESCRIPTIONS.route_step,
      inputSchema: routeStepInputSchema,
      annotations: readOnly,
    },
    async ({ state, platform, steps, instructions, threshold, model }) => {
      const question = routeStepQuestion(platform, steps, instructions);
      const questions = { next_step: question };
      const fingerprint = schemaFingerprint(questions);
      const result = await client.predict(state, questions, model);
      const checkpoint = resultCheckpoint(result, model);
      const answer = answerFor(result, "next_step");
      const probabilities = probabilityMap(answer);
      const suggestedStep = requiredChoice(answer, probabilities, "route_step");
      const calibrated = calibrateChoiceAnswer(
        { ...answer, probabilities },
        calibrationCatalog,
        {
          model: checkpoint,
          platform,
          tool: "route_step",
          question: "next_step",
          expectedSchemaHash: fingerprint,
        },
      );
      const gateThreshold = threshold ?? defaultConfidenceThreshold;
      const passed = calibrated.answerConfidence >= gateThreshold;
      const nextStep = passed ? suggestedStep : "escalate";
      const criteria = question.criteria;
      const instruction = typeof criteria === "object" && criteria !== null && !Array.isArray(criteria)
        ? (criteria as Record<string, unknown>)[nextStep]
        : undefined;

      return serializeToolResult(
        compact({
          platform,
          next_step: nextStep,
          suggested_step: suggestedStep,
          instruction: typeof instruction === "string" ? instruction : undefined,
          confidence: calibrated.answerConfidence,
          raw_confidence: calibrated.rawAnswerConfidence,
          ...(calibrated.reportedAnswerConfidence === undefined
            ? {}
            : { reported_confidence: calibrated.reportedAnswerConfidence }),
          ...(optionalNumber(answer, "confidence") === undefined
            ? {}
            : { entropy_confidence: optionalNumber(answer, "confidence") }),
          probabilities: calibrated.probabilities,
          gate: {
            passed,
            threshold: gateThreshold,
            confidence: calibrated.answerConfidence,
            basis: "answer_confidence",
          },
          calibration: calibrated.calibration,
          raw_answer: answer,
          ...metadata(result, model),
        }),
      );
    },
  );

  return server;
}
