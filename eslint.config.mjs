import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import globals from "globals";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

const IGNORES = [
  "node_modules/**",
  ".next/**",
  "out/**",
  "build/**",
  "coverage/**",
  "playwright-report/**",
  "test-results/**",
  ".playwright-browsers/**",
  "blob-report/**",
  "playwright/.cache/**",
  "*.tsbuildinfo",
  "_probe*.mjs",
];

export default [
  { ignores: IGNORES, name: "velora/ignores" },

  {
    ...js.configs.recommended,
    name: "velora/js",
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
  },

  ...compat.config({
    extends: [
      "plugin:@typescript-eslint/recommended",
      "plugin:react/recommended",
      "plugin:react/jsx-runtime",
      "plugin:react-hooks/recommended",
      "plugin:jsx-a11y/recommended",
      "plugin:import/recommended",
      "plugin:import/typescript",
    ],
    settings: {
      react: { version: "19.2" },
      "import/resolver": {
        node: true,
        typescript: true,
      },
      "import/parsers": {
        espree: [".js", ".cjs", ".mjs", ".jsx"],
        "@typescript-eslint/parser": [".ts", ".mts", ".cts", ".tsx"],
      },
    },
    rules: {
      "import/no-unresolved": "off",
      "import/namespace": "off",
      "import/default": "off",
      "import/no-named-as-default-member": "off",
      "import/no-named-as-default": "off",
    },
  }),

  {
    name: "@next/eslint-plugin-next/recommended",
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    ...nextPlugin.configs.recommended,
  },

  {
    name: "@next/eslint-plugin-next/core-web-vitals",
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    ...nextPlugin.configs["core-web-vitals"],
  },

  {
    name: "velora/global-rules",
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/require-default-props": "off",
      "react/no-unused-prop-types": "off",
    },
  },

  {
    name: "velora/prettier",
    plugins: { prettier },
    rules: {
      "prettier/prettier": "error",
    },
  },

  prettierConfig,
];
