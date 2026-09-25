import type { LayaQuestion } from "./types.js";

export const PLATFORMS = ["kubernetes", "openshift"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_TOOLS = ["judge", "route_step"] as const;
export type PlatformTool = (typeof PLATFORM_TOOLS)[number];

export const JUDGE_QUESTION_IDS = ["intent", "risk", "verdict"] as const;
export const ROUTE_QUESTION_ID = "next_step";

export type JudgeQuestionId = (typeof JUDGE_QUESTION_IDS)[number];

export interface PlatformDefinition {
  judge: Record<string, LayaQuestion>;
  routeCriteria: Record<string, string>;
  routeInstructions: string;
}

const riskCriteria: Record<string, string> = {
  none: "Read-only inspection or a request with no cluster impact",
  low: "A small, reversible change with limited blast radius",
  medium: "A production-impacting or multi-resource change",
  high: "A privileged, availability-sensitive, or broadly disruptive change",
  destructive: "Data loss, irreversible mutation, privilege escalation, or explicit deletion",
};

const verdictCriteria: Record<string, string> = {
  proceed: "The request is sufficiently scoped, uses the selected platform correctly, and is safe for its next step",
  review: "The request is plausible but ambiguous, production-impacting, privileged, or otherwise needs human review",
  block: "The request is unsafe, destructive, incompatible with the selected platform, or must not proceed as stated",
};

function choiceQuestion(instructions: string, criteria: Record<string, string>): LayaQuestion {
  return { type: "choice", instructions, criteria };
}

/**
 * Fixed, domain-specific decision schemas. They are intentionally kept as Laya
 * questions rather than JSON Schema: every field is a finite choice, which makes
 * the result directly routable and lets every field be temperature-calibrated and
 * confidence-gated with the same contract.
 */
export const PLATFORM_DEFINITIONS: Record<Platform, PlatformDefinition> = {
  kubernetes: {
    judge: {
      intent: choiceQuestion(
        "What operational intent does the state describe for Kubernetes?",
        {
          inspect: "Read-only inspection of cluster context, resources, events, logs, or manifests",
          deploy: "Create or apply Kubernetes workloads and related resources",
          update: "Change an image, configuration, resource definition, or other workload setting",
          scale: "Increase or decrease workload replicas",
          diagnose: "Investigate a failing rollout, pod, service, node, or application",
          expose: "Create or change Service, Ingress, Gateway, or other network exposure",
          rollback: "Revert a Deployment, StatefulSet, DaemonSet, release, or related change",
        },
      ),
      risk: choiceQuestion("What is the operational risk of the requested action?", riskCriteria),
      verdict: choiceQuestion(
        "Given the intent and risk, should the request proceed, receive review, or be blocked?",
        verdictCriteria,
      ),
    },
    routeCriteria: {
      inspect: "Inspect cluster context and read-only resource state before changing anything",
      build: "Build and make the intended container image available to the cluster",
      apply: "Apply reviewed Kubernetes manifests or Kustomize output",
      wait_for_rollout: "Wait for the Deployment rollout and inspect its result",
      verify: "Verify the workload and Service or Gateway behavior after rollout",
      diagnose: "Inspect events, logs, pod status, and related evidence for the failure",
      scale: "Perform the requested replica scaling after confirming the target workload",
      rollback: "Revert to the known-good revision or release after confirming the target",
      escalate: "Pause and ask a human operator to resolve missing, risky, or contradictory context",
    },
    routeInstructions:
      "Choose the single safest and most immediate next step for this Kubernetes request. " +
      "Prefer inspection and verification before mutation, and choose escalate when context is missing or unsafe.",
  },
  openshift: {
    judge: {
      intent: choiceQuestion(
        "What operational intent does the state describe for OpenShift?",
        {
          inspect_project: "Read-only inspection of a Project, quota, permissions, Builds, Images, Routes, or workloads",
          build: "Create, configure, or run an OpenShift BuildConfig or source-to-image build",
          deploy: "Create or apply OpenShift workloads and related resources",
          update: "Change an image, configuration, resource definition, or other workload setting",
          scale: "Increase or decrease workload replicas",
          diagnose: "Investigate a failed build, rollout, pod, Route, admission, quota, or application",
          expose_route: "Create or change an OpenShift Route, Service, or other external exposure",
          rollback: "Revert a Deployment, release, application, or related OpenShift change",
        },
      ),
      risk: choiceQuestion("What is the operational risk of the requested OpenShift action?", riskCriteria),
      verdict: choiceQuestion(
        "Given the intent and risk, should the OpenShift request proceed, receive review, or be blocked?",
        verdictCriteria,
      ),
    },
    routeCriteria: {
      inspect_project: "Inspect the OpenShift Project, permissions, quota, BuildConfig, and current workload state",
      start_build: "Start or verify the configured OpenShift build and image stream",
      apply: "Apply reviewed OpenShift manifests after project and permission checks",
      wait_for_rollout: "Wait for the Deployment rollout and inspect its result",
      verify_route: "Verify the workload health and OpenShift Route or Service behavior after rollout",
      diagnose: "Inspect build logs, events, admission failures, quota, pods, Routes, and related evidence",
      scale: "Perform the requested replica scaling after confirming the target workload",
      rollback: "Revert to the known-good revision or release after confirming the target",
      escalate: "Pause and ask a human operator to resolve missing, risky, or contradictory context",
    },
    routeInstructions:
      "Choose the single safest and most immediate next step for this OpenShift request. " +
      "Account for Projects, quota, SCC, BuildConfigs, ImageStreams, and Routes. Prefer inspection and verification " +
      "before mutation, and choose escalate when context is missing or unsafe.",
  },
};

export function judgeQuestions(platform: Platform): Record<string, LayaQuestion> {
  return PLATFORM_DEFINITIONS[platform].judge;
}

export function routeStepCriteria(
  platform: Platform,
  customSteps?: Record<string, string>,
): Record<string, string> {
  const source = customSteps ?? PLATFORM_DEFINITIONS[platform].routeCriteria;
  const criteria = Object.fromEntries(Object.entries(source));
  if (criteria.escalate === undefined) {
    criteria.escalate = PLATFORM_DEFINITIONS[platform].routeCriteria.escalate;
  }
  return criteria;
}

export function routeStepQuestion(
  platform: Platform,
  customSteps?: Record<string, string>,
  instructions?: string,
): LayaQuestion {
  return {
    type: "choice",
    instructions: instructions?.trim() || PLATFORM_DEFINITIONS[platform].routeInstructions,
    criteria: routeStepCriteria(platform, customSteps),
  };
}
