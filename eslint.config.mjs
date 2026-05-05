import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Tehnadzor lint configuration for client, server, functions, scripts, and smoke tests.
const tsFiles = ["src/**/*.ts", "server/src/**/*.ts", "functions/src/**/*.ts"];
const jsFiles = ["scripts/**/*.mjs", "tests/**/*.mjs", "eslint.config.mjs"];

export default [
  {
    ignores: [
      "dist/**",
      "server/dist/**",
      "functions/dist/**",
      "node_modules/**",
      "tools/**",
      "sw.js"
    ]
  },
  {
    ...js.configs.recommended,
    files: jsFiles,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-console": "off"
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: tsFiles
  })),
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022
      }
    },
    rules: {
      "no-console": "off",
      "prefer-const": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-vars": "off"
    }
  },
  {
    files: ["server/src/**/*.ts", "functions/src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    rules: {
      "no-console": "off",
      "prefer-const": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off"
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-console": "off"
    }
  }
];
