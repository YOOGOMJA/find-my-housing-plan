module.exports = {
  extends: ["@commitlint/config-conventional"],
  parserPreset: {
    parserOpts: {
      headerPattern: /^(\w+)\((#\d+)\): (.+)$/,
      headerCorrespondence: ["type", "scope", "subject"],
    },
  },
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "test",
        "chore",
        "ci",
        "build",
        "perf",
        "revert",
      ],
    ],
    "scope-empty": [2, "never"],
    "scope-case": [0],
    "subject-empty": [2, "never"],
    "subject-case": [0],
  },
};
