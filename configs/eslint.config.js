import { defineConfig } from "eslint/config";
import tseslint from "@electron-toolkit/eslint-config-ts";
import eslintPluginSvelte from "eslint-plugin-svelte";
import stylistic from "@stylistic/eslint-plugin";
import css from "@eslint/css";
import json from "@eslint/json";
import yml from "eslint-plugin-yml";
import local from "./css.js";

export default defineConfig(
    { ignores: ["**/node_modules", "**/dist", "pnpm-lock.yaml"] },
    {
        files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,svelte}"],
        extends: [
            tseslint.configs.recommended,
            eslintPluginSvelte.configs["flat/recommended"]
        ],
        plugins: { "@stylistic": stylistic },
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "@stylistic/quotes": ["warn", "double", { avoidEscape: false, allowTemplateLiterals: "always" }],
            "@stylistic/semi": ["warn", "always"],
            "@stylistic/comma-dangle": ["warn", "never"],
            "@stylistic/arrow-spacing": ["warn", { before: true, after: true }],
            "@stylistic/brace-style": ["warn", "stroustrup"]
        }
    },
    {
        files: ["**/*.{js,mjs,cjs,jsx}"],
        rules: {
            "@typescript-eslint/explicit-function-return-type": "off"
        }
    },
    {
        files: ["**/*.svelte"],
        rules: {
            "svelte/indent": ["warn", { indent: 4 }]
        },
        languageOptions: {
            parserOptions: { parser: tseslint.parser }
        }
    },
    {
        files: ["**/*.svelte.ts"],
        languageOptions: { parser: tseslint.parser }
    },
    {
        files: ["**/*.{tsx,svelte}"],
        rules: {
            "svelte/no-unused-svelte-ignore": "off"
        }
    },
    {
        files: ["**/*.css"],
        plugins: { css },
        language: "css/css"
    },
    {
        files: ["**/*.{css,svelte}"],
        plugins: { local },
        rules: {
            "local/css-quotes": "warn",
            "local/css-semi": "warn"
        }
    },
    {
        files: ["**/*.json"],
        plugins: { json },
        language: "json/json",
        extends: ["json/recommended"]
    },
    {
        files: ["**/*.jsonc", "**/tsconfig*.json", ".vscode/*.json"],
        plugins: { json },
        language: "json/jsonc",
        languageOptions: { allowTrailingCommas: false },
        extends: ["json/recommended"]
    },
    yml.configs["flat/recommended"],
    {
        files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,svelte,css,json,jsonc,yaml,yml}"],
        plugins: { "@stylistic": stylistic },
        rules: {
            "@stylistic/eol-last": ["warn", "never"],
            "@stylistic/no-trailing-spaces": "warn"
        }
    }
);