import { z } from "zod/v4";
import { PLATFORMS } from "./platform-schemas.js";

const MAX_QUESTIONS = 64;
const MAX_TEXT_LENGTH = 50_000;
const MAX_CUSTOM_ROUTE_STEPS = 64;

const questionTypeSchema = z.enum(["choice", "score", "noul"]);
const modelSchema = z.enum(["english", "multilingual", "typed-decisions"]);
const confidenceThresholdSchema = z.number().finite().min(0).max(1);

const choiceCriteriaSchema = z.union([
  z
    .record(z.string(), z.string().min(1))
    .refine(value => Object.keys(value).length > 0, "choice criteria must contain at least one label"),
  z
    .array(z.string().min(1))
    .min(1)
    .refine(labels => new Set(labels).size === labels.length, "choice labels must be unique"),
]);

const routeStepsSchema = z
  .record(z.string(), z.string().min(1).max(1_000))
  .refine(value => Object.keys(value).length > 0, "at least one custom route step is required")
  .refine(
    value => Object.keys(value).length <= MAX_CUSTOM_ROUTE_STEPS,
    `at most ${MAX_CUSTOM_ROUTE_STEPS} custom route steps are allowed`,
  )
  .refine(
    value => Object.keys(value).every(key => key.trim().length > 0 && !["__proto__", "prototype", "constructor"].includes(key)),
    "route step labels must be non-empty and cannot use reserved object property names",
  );

const scoreCriteriaSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(255, "a score question may contain at most 255 levels");

const noulCriteriaSchema = z
  .record(z.string(), z.string())
  .optional()
  .refine(
    value => value === undefined || Object.keys(value).every(key => key === "true" || key === "false"),
    "noul criteria may contain only true and false descriptions",
  );

const noulLabelsSchema = z
  .record(z.string(), z.string().min(1))
  .optional()
  .refine(value => {
    if (value === undefined) return true;
    const keys = Object.keys(value).sort();
    return (
      keys.length === 2 &&
      keys[0] === "false" &&
      keys[1] === "true" &&
      value.false.trim() !== value.true.trim()
    );
  }, "noul labels must contain exactly false and true with distinct descriptions");

const questionSchema = z
  .object({
    type: questionTypeSchema,
    instructions: z.string().min(1).max(4_000),
    criteria: z.unknown().optional(),
    labels: noulLabelsSchema,
  })
  .passthrough()
  .superRefine((question, ctx) => {
    if (question.type === "choice") {
      const parsed = choiceCriteriaSchema.safeParse(question.criteria);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["criteria"],
          message: "choice criteria must be a non-empty object or a non-empty array of labels",
        });
      }
      if (question.labels !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["labels"],
          message: "labels are only supported for noul questions",
        });
      }
    } else if (question.type === "score") {
      const parsed = scoreCriteriaSchema.safeParse(question.criteria);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["criteria"],
          message: "score criteria must be a non-empty ordered array of level descriptions",
        });
      }
      if (question.labels !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["labels"],
          message: "labels are only supported for noul questions",
        });
      }
    } else {
      const parsed = noulCriteriaSchema.safeParse(question.criteria);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["criteria"],
          message: "noul criteria must be an object with optional true/false descriptions",
        });
      }
    }
  });

export const decideInputSchema = z.object({
  state: z.json(),
  questions: z
    .record(z.string(), questionSchema)
    .refine(value => Object.keys(value).length > 0, "at least one question is required")
    .refine(value => Object.keys(value).length <= MAX_QUESTIONS, `at most ${MAX_QUESTIONS} questions are allowed`),
  model: modelSchema.optional(),
});

export const classifyInputSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  labels: z
    .array(z.string().min(1))
    .min(1)
    .max(255)
    .refine(labels => new Set(labels).size === labels.length, "labels must be unique"),
  instructions: z.string().max(4_000).optional(),
  model: modelSchema.optional(),
});

export const scoreInputSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  criteria: scoreCriteriaSchema,
  instructions: z.string().max(4_000).optional(),
  model: modelSchema.optional(),
});

export const checkInputSchema = z.object({
  state: z.string().min(1).max(MAX_TEXT_LENGTH),
  question: z.string().min(1).max(4_000),
  model: modelSchema.optional(),
});

export const judgeInputSchema = z.object({
  state: z.json(),
  platform: z.enum(PLATFORMS),
  threshold: confidenceThresholdSchema.optional(),
  model: modelSchema.optional(),
});

export const routeStepInputSchema = z.object({
  state: z.json(),
  platform: z.enum(PLATFORMS),
  steps: routeStepsSchema.optional(),
  instructions: z.string().min(1).max(4_000).optional(),
  threshold: confidenceThresholdSchema.optional(),
  model: modelSchema.optional(),
});

export type DecideInput = z.infer<typeof decideInputSchema>;
export type ClassifyInput = z.infer<typeof classifyInputSchema>;
export type ScoreInput = z.infer<typeof scoreInputSchema>;
export type CheckInput = z.infer<typeof checkInputSchema>;
export type JudgeInput = z.infer<typeof judgeInputSchema>;
export type RouteStepInput = z.infer<typeof routeStepInputSchema>;

export const TOOL_DESCRIPTIONS = {
  decide:
    "Make one or more typed Laya decisions about a JSON-compatible state. " +
    "Each question must use type choice, score, or noul. Choice criteria are a label-to-description object or label array; " +
    "score criteria are an ordered low-to-high array; noul is a yes/no question. " +
    "Returns answers with probabilities, confidence, routing metadata, and token usage.",
  classify:
    "Choose the best label for a piece of text. Returns the selected label, confidence, the probability distribution, routing metadata, and usage. " +
    "Use this for intent routing, tagging, moderation, or triage.",
  score:
    "Rate text on an ordered scale. Criteria must be ordered from the lowest level to the highest level. " +
    "Returns the probability-weighted score, level distribution, confidence, routing metadata, and usage.",
  check:
    "Answer a yes/no question about text and return P(yes) and P(no), confidence, routing metadata, and usage. " +
    "Use this for binary guardrails, escalation, or approval decisions.",
  judge:
    "Judge a Kubernetes or OpenShift operational request with fixed, platform-specific intent, risk, and verdict schemas. " +
    "The result is gated on calibrated answer_confidence. This tool is read-only and advisory: a passed gate does not " +
    "authorize destructive cluster actions. Use route_step after a successful judge to offload the next-step decision to Laya.",
  route_step:
    "Choose one immediate Kubernetes or OpenShift workflow step with Laya instead of deciding it in the LLM. " +
    "Uses built-in platform steps unless custom steps are supplied, and always returns escalate when calibrated " +
    "answer_confidence is below the threshold. This tool does not execute the returned step.",
} as const;
