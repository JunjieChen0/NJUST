# Test Naming Convention

## Rule

All test files MUST use the `.test.ts` (or `.test.tsx` for React components) suffix. The `.spec.ts` suffix is deprecated.

## Rationale

- **Consistency**: A unified naming convention reduces cognitive overhead when navigating the codebase
- **Vitest Default**: `.test.ts` aligns with Vitest's default file matching pattern
- **Precedent**: The majority of existing test files already use `.test.ts`

## Migration

Existing `.spec.ts` files are grandfathered in. New test files MUST follow this convention. Existing `.spec.ts` files may be renamed opportunistically when adjacent files are modified.

## Enforcement

All Vitest config files (`vitest.config.ts`) should include both patterns in their `include` to remain compatible during migration:

```typescript
include: ["**/*.test.ts", "**/*.test.tsx"]
```

CI will enforce this convention via lint check for new files.

## Examples

### Correct

- `src/core/tools/__tests__/BaseTool.test.ts`
- `webview-ui/src/components/ChatView.test.tsx`

### Incorrect (deprecated)

- `src/core/tools/__tests__/BaseTool.spec.ts`
- `webview-ui/src/components/ChatView.spec.tsx`
