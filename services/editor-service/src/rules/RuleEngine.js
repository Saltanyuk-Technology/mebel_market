export class RuleEngine {
  constructor(rules = []) {
    this.rules = [...rules];
  }

  register(rule) {
    if (!rule?.id || typeof rule.evaluate !== "function") throw new Error("invalid_rule");
    this.rules.push(rule);
    return this;
  }

  validate(context) {
    const violations = this.rules.flatMap((rule) => {
      if (rule.operations && !rule.operations.includes(context.operation)) return [];
      return (rule.evaluate(context) ?? []).map((item) => ({
        ruleId: rule.id, severity: "error", entityIds: [], ...item,
      }));
    });
    const errors = violations.filter((item) => item.severity === "error");
    const warnings = violations.filter((item) => item.severity === "warning");
    return { valid: errors.length === 0, violations, errors, warnings };
  }
}
