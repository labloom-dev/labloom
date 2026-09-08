import css from "@eslint/css";

function cssVisitor(context, check) {
    const sourceCode = context.sourceCode;
    if (sourceCode.lexer) {
        return {
            StyleSheet() {
                check(sourceCode, 0);
            }
        };
    }
    return {
        SvelteStyleElement(node) {
            const lang = node.startTag.attributes.find(attribute => attribute.key?.name === "lang");
            if (lang && lang.value?.[0]?.value !== "css") {
                return;
            }
            const offset = node.startTag.range[1];
            const file = {
                path: context.filename,
                body: sourceCode.text.slice(offset, node.endTag.range[0])
            };
            const result = css.languages.css.parse(file);
            if (result.ok) {
                check(css.languages.css.createSourceCode(file, result), offset);
            }
        }
    };
}

const quotes = {
    meta: {
        type: "layout",
        fixable: "code",
        schema: [],
        messages: { double: "CSS strings must use double quotes." }
    },
    create(context) {
        return cssVisitor(context, (source, offset) => {
            source.lexer.syntax.tokenize(source.text, (_type, start, end) => {
                const raw = source.text.slice(start, end);
                if (!raw.startsWith("'")) {
                    return;
                }
                // Preserve CSS escapes and escaped line breaks while changing delimiters.
                const body = raw.slice(1, -1).replace(/\\(?:\r\n|[^])|"/gu, token => {
                    if (token === "\\'") {
                        return "'";
                    }
                    return token === "\"" ? "\\\"" : token;
                });
                const range = [offset + start, offset + end];
                context.report({
                    loc: {
                        start: context.sourceCode.getLocFromIndex(range[0]),
                        end: context.sourceCode.getLocFromIndex(range[1])
                    },
                    messageId: "double",
                    fix: fixer => fixer.replaceTextRange(range, `"${body}"`)
                });
            });
        });
    }
};

const semi = {
    meta: {
        type: "layout",
        fixable: "code",
        schema: [],
        messages: { missing: "Missing semicolon after CSS declaration." }
    },
    create(context) {
        return cssVisitor(context, (source, offset) => {
            source.lexer.syntax.walk(source.ast, node => {
                if (node.type !== "Declaration") {
                    return;
                }
                const after = source.text.slice(node.loc.end.offset);
                if (/^(?:\s|\/\*[^]*?\*\/)*;/u.test(after)) {
                    return;
                }
                let end = node.loc.start.offset;
                const text = source.text.slice(end, node.loc.end.offset);
                source.lexer.syntax.tokenize(text, (_type, start, tokenEnd) => {
                    const raw = text.slice(start, tokenEnd);
                    if (raw.trim() && !raw.startsWith("/*")) {
                        end = node.loc.start.offset + tokenEnd;
                    }
                });
                const index = offset + end;
                context.report({
                    loc: context.sourceCode.getLocFromIndex(index),
                    messageId: "missing",
                    fix: fixer => fixer.insertTextAfterRange([index, index], ";")
                });
            });
        });
    }
};

export default {
    rules: {
        "css-quotes": quotes,
        "css-semi": semi
    }
};