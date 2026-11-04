# Test Naming Convention

## Rule

All new test files MUST use the `.test.ts` (or `.test.tsx` for React components) suffix. Existing `.spec.ts` / `.spec.tsx` files remain supported.

## Rationale

- **Consistency**: A unified naming convention reduces cognitive overhead when navigating the codebase
- **Vitest Default**: `.test.ts` aligns with Vitest's default file matching pattern
- **Precedent**: The majority of existing test files already use `.test.ts`

## Migration

Existing `.spec.ts` files are grandfathered in. New test files MUST follow this convention. Existing `.spec.ts` files may be renamed opportunistically when adjacent files are modified.

## Enforcement

Vitest's default discovery supports both suffixes. Configurations that override `include` must retain the existing tests, for example:

```typescript
include: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"]
```

Review new filenames against this convention. The current Code QA workflow does not have a separate filename-enforcement job; do not treat the convention itself as an automated check.

## Examples

### Correct

- `src/core/task/__tests__/Task.verificationSummary.test.ts`
- `webview-ui/src/components/chat/rows/__tests__/VerificationCard.test.tsx`

### Incorrect (deprecated)

- `src/core/tools/__tests__/BaseTool.spec.ts`
- `ExampleComponent.spec.tsx` (a new file with the deprecated suffix)
