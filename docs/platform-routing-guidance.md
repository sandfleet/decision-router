# Platform routing guidance

Use the Laya `judge` and `route_step` MCP tools to select the next Kubernetes or OpenShift workflow step from bounded deployment evidence.

## Workflow

1. Establish the platform explicitly as `kubernetes` or `openshift`. Do not infer it from incidental wording.
2. Build a concise state object from the request and known context. Exclude tokens, credentials, kubeconfig data, and secrets. Include only evidence needed for intent, risk, and the immediate next step.
3. Call `judge` before proposing or performing an operational step.
4. If `gate.passed` is false, stop the workflow, identify the decisions below threshold, gather missing evidence, or escalate for review.
5. If the judge passes, call `route_step` with the same platform and state. Omit `steps` unless an approved workflow provides explicit custom labels.
6. Follow `next_step`. If it is `escalate`, stop and request review.
7. Treat `suggested_step` as diagnostic only when the route gate fails.

## Safety controls

- The routing tools are read-only. They do not run `kubectl`, `oc`, builds, or mutations.
- A passed confidence gate is not authorization for destructive or privileged actions.
- `verdict: proceed` means the request is understood enough to route its next step; normal cluster checks still apply.
- Use read-only inspection and verification before scaling, rollback, apply, or exposure operations.
- Require confirmation for destructive actions, privilege changes, production-wide changes, and irreversible deletion.
- Do not place credentials or sensitive kubeconfig data in the state object.
- Use custom `steps` only when their labels and meanings are already approved.

## `judge` contract

Input:

```json
{
  "state": {},
  "platform": "kubernetes | openshift",
  "threshold": 0.8,
  "model": "english | multilingual | typed-decisions"
}
```

Only `state` and `platform` are required. Leaving `model` unset preserves automatic checkpoint routing.

The tool returns platform-specific `intent`, `risk`, and `verdict` decisions. The `gate.passed` value is true only when each required decision meets the threshold. `gate.confidence` is the minimum calibrated `answer_confidence`; `gate.below_threshold` identifies decisions that failed. Entropy confidence is diagnostic only.

## `route_step` contract

Input:

```json
{
  "state": {},
  "platform": "kubernetes | openshift",
  "steps": {
    "approved_label": "Approved description of one immediate step"
  },
  "instructions": "Optional question guidance",
  "threshold": 0.8,
  "model": "english | multilingual | typed-decisions"
}
```

Without `steps`, the tool uses its platform preset. With `steps`, the supplied labels replace the preset and `escalate` is added if absent.

`next_step` is actionable only when the confidence gate passes. `suggested_step` is the selected label regardless of the gate. The response also includes the selected instruction, calibrated confidence, probability distribution, gate state, and calibration metadata.

Kubernetes presets are `inspect`, `build`, `apply`, `wait_for_rollout`, `verify`, `diagnose`, `scale`, `rollback`, and `escalate`. OpenShift presets are `inspect_project`, `start_build`, `apply`, `wait_for_rollout`, `verify_route`, `diagnose`, `scale`, `rollback`, and `escalate`.

## Confidence and calibration

The automation gate uses calibrated `answer_confidence`, the probability mass assigned to the reported answer. The entropy-based `confidence` value varies with the option count and is diagnostic only.

If no calibration file is configured, no matching entry exists, or the schema fingerprint is stale, the multiplier remains `T=1`, returned probabilities are preserved, the calibration status is `neutral` or `stale`, and the ordinary confidence threshold remains enforced.

Fit calibration on held-out JSONL cases rather than training cases. The fitter records the routed checkpoint, platform, tool, question, and schema fingerprint, then fits a bounded multiplier from 0.5 to 5 using categorical negative log-likelihood. Measurements must use the target workload; thresholds do not necessarily transfer between languages, option counts, checkpoints, or risk classes. Keep escalation and human review for destructive, privileged, production-wide, or ambiguous work.
