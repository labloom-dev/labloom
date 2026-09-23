import { markInputRule as originalMarkInputRule } from "@tiptap/core";

export function markInputRule(
    config: Parameters<typeof originalMarkInputRule>[0]
): ReturnType<typeof originalMarkInputRule> {
    const rule = originalMarkInputRule(config);
    const handler = rule.handler;

    rule.handler = props => {
        const tr = props.state.tr;
        // Preserve the typing state before conversion can expose an inner mark.
        const marks = config.type.removeFromSet(tr.storedMarks ?? tr.selection.$from.marks());
        const stepCount = tr.steps.length;
        const result = handler(props);
        if (result !== null && tr.steps.length > stepCount) tr.setStoredMarks(marks);
        return result;
    };

    return rule;
}