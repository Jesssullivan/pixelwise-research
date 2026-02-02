# Pixelwise Unit Tests

## Test Coverage Summary

### CSSColorCorrector.test.ts

Comprehensive unit tests for the CSS-based WCAG color correction system.

**Total Tests: 60**

#### Test Categories

1. **Constructor (6 tests)**
   - Default initialization
   - Custom options: useCSSVariables, strategy, variablePrefix, perCharacterClass
   - Multiple custom options

2. **Conservative Correction (5 tests)**
   - Applies correction to element
   - Tracks element in Set
   - CSS variables mode
   - Direct color mode

3. **Average Correction (3 tests)**
   - Applies correction
   - Tracks element in Set
   - Correctly averages multiple character colors

4. **Per-Character Correction (4 tests)**
   - Applies correction
   - Tracks element in Set
   - Wraps characters in spans with custom class
   - Preserves text content

5. **clearAll() - THE BUG FIX (6 tests)**
   - Iterates over all corrected elements
   - Calls clearCorrections for each element
   - Clears the correctedElementsSet
   - Works correctly (not just logging a warning)
   - Handles empty state gracefully
   - Clears all correction types (conservative, average, per-character)

6. **clearCorrections() (6 tests)**
   - Restores original styles for direct method
   - Restores original styles for CSS variable method
   - Restores original text for per-character method
   - Removes element from WeakMap
   - Removes element from Set
   - Handles elements not in cache

7. **correctedCount getter (4 tests)**
   - Returns 0 initially
   - Increments when corrections applied
   - Decrements when corrections cleared
   - Returns 0 after clearAll()

8. **WeakMap + Set Hybrid Integration (3 tests)**
   - Keeps WeakMap and Set in sync when applying corrections
   - Keeps WeakMap and Set in sync when clearing corrections
   - Handles multiple elements in both structures

9. **Utility Functions (23 tests)**
   - `calculateConservativeCorrection`: Empty array, single color, max deviation, similar colors
   - `needsCorrection`: Identical colors, different colors, array length mismatch, empty arrays
   - `calculateRelativeLuminance`: Black, white, middle gray, red channel, sRGB threshold
   - `calculateContrastRatio`: Black/white, same colors, symmetry, ratio range, WCAG AA compliance
   - `parseColorString`: rgb(), rgba(), hex, named colors, shorthand hex, invalid color

## Key Testing Focus

### The WeakMap + Set Hybrid Fix

The original implementation used only a `WeakMap` which prevented iteration over all corrected elements, making `clearAll()` impossible. The fix adds a `Set<HTMLElement>` alongside the `WeakMap`:

```typescript
private correctedElements = new WeakMap<HTMLElement, CorrectionMetadata>();
private correctedElementsSet = new Set<HTMLElement>(); // Enables clearAll() iteration
```

**Tests verify:**
1. Both structures stay in sync during apply/clear operations
2. `clearAll()` successfully iterates and clears all elements
3. `correctedCount` getter correctly reflects Set size
4. No memory leaks (elements properly removed from both structures)

## Running Tests

```bash
# Run all pixelwise tests
pnpm vitest tests/unit/pixelwise/

# Run only CSSColorCorrector tests
pnpm vitest tests/unit/pixelwise/CSSColorCorrector.test.ts

# Watch mode
pnpm vitest tests/unit/pixelwise/CSSColorCorrector.test.ts --watch

# Coverage report
pnpm vitest tests/unit/pixelwise/CSSColorCorrector.test.ts --coverage
```

## Test Environment

- **Framework**: Vitest
- **DOM**: jsdom (provides browser environment)
- **Mocking**: vi from Vitest
- **Browser APIs**: window, document, getComputedStyle

## Important Notes

1. **DOM Cleanup**: All tests clean up created elements to prevent test pollution
2. **Real Computed Styles**: Elements are appended to document.body to get real computed styles
3. **Console Logs**: Tests verify behavior, console logs are visible for debugging
4. **Type Safety**: Full TypeScript types for all test helpers and assertions
