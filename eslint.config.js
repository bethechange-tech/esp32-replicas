import js from "@eslint/js";
import tseslint from "typescript-eslint";

const MAX_PARAMETERS = 2;

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "third_party/**", "test/goldens/**", "build/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "max-params": ["error", MAX_PARAMETERS],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSInterfaceDeclaration[id.name=/^I[A-Z]/]",
          message: "No I prefix on interfaces: the port takes the plain name.",
        },
      ],
    },
  },
);
