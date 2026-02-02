#!/bin/bash

# Pixelwise Testing Script - Phase 5
# Runs all pixelwise unit tests and integration tests

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Pixelwise Testing - Phases 1-5${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test categories
TEST_CATEGORIES=(
    "Phase 1: Temporal Batching"
    "Phase 2: Delta Detection"
    "Phase 3: Frame Caching"
    "Phase 4: Parameter Exposure"
    "Integration: Phases 1-5"
)

# Test files
PHASE1_TESTS="tests/unit/pixelwise/temporal-batching.test.ts"
PHASE2_TESTS="tests/unit/pixelwise/delta-detection.test.ts"
PHASE3_TESTS="tests/unit/pixelwise/frame-cache.test.ts"
PHASE4_TESTS="tests/unit/pixelwise/configurable-processor.test.ts tests/unit/pixelwise/kernel-variations.test.ts"
INTEGRATION_TESTS="tests/integration/pixelwise/*.test.ts"

# Function to run tests
run_tests() {
    local category=$1
    local tests=$2

    echo -e "${YELLOW}Testing: ${category}${NC}"
    echo -e "${YELLOW}----------------------------------------${NC}"

    if [ -z "$tests" ]; then
        echo -e "${RED}No tests defined for ${category}${NC}"
        return 1
    fi

    # Run tests
    if pnpm exec vitest run --reporter=verbose $tests; then
        echo -e "${GREEN}✓ ${category} PASSED${NC}"
        echo ""
        return 0
    else
        echo -e "${RED}✗ ${category} FAILED${NC}"
        echo ""
        return 1
    fi
}

# Function to run all tests
run_all_tests() {
    local failed=0

    # Run Phase 1 tests
    if ! run_tests "${TEST_CATEGORIES[0]}" "$PHASE1_TESTS"; then
        failed=$((failed + 1))
    fi

    # Run Phase 2 tests
    if ! run_tests "${TEST_CATEGORIES[1]}" "$PHASE2_TESTS"; then
        failed=$((failed + 1))
    fi

    # Run Phase 3 tests
    if ! run_tests "${TEST_CATEGORIES[2]}" "$PHASE3_TESTS"; then
        failed=$((failed + 1))
    fi

    # Run Phase 4 tests
    if ! run_tests "${TEST_CATEGORIES[3]}" "$PHASE4_TESTS"; then
        failed=$((failed + 1))
    fi

    # Run Integration tests
    if ! run_tests "${TEST_CATEGORIES[4]}" "$INTEGRATION_TESTS"; then
        failed=$((failed + 1))
    fi

    return $failed
}

# Function to run coverage
run_coverage() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Running Coverage Analysis${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    pnpm exec vitest run --coverage
}

# Main script
case "${1:-all}" in
    "phase1")
        run_tests "${TEST_CATEGORIES[0]}" "$PHASE1_TESTS"
        ;;
    "phase2")
        run_tests "${TEST_CATEGORIES[1]}" "$PHASE2_TESTS"
        ;;
    "phase3")
        run_tests "${TEST_CATEGORIES[2]}" "$PHASE3_TESTS"
        ;;
    "phase4")
        run_tests "${TEST_CATEGORIES[3]}" "$PHASE4_TESTS"
        ;;
    "integration")
        run_tests "${TEST_CATEGORIES[4]}" "$INTEGRATION_TESTS"
        ;;
    "coverage")
        run_coverage
        ;;
    "all")
        if run_all_tests; then
            echo -e "${GREEN}========================================${NC}"
            echo -e "${GREEN}ALL TESTS PASSED${NC}"
            echo -e "${GREEN}========================================${NC}"
            exit 0
        else
            echo -e "${RED}========================================${NC}"
            echo -e "${RED}SOME TESTS FAILED${NC}"
            echo -e "${RED}========================================${NC}"
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {phase1|phase2|phase3|phase4|integration|coverage|all}"
        echo ""
        echo "Examples:"
        echo "  $0 phase1        # Run Phase 1 tests"
        echo "  $0 phase2        # Run Phase 2 tests"
        echo "  $0 phase3        # Run Phase 3 tests"
        echo "  $0 phase4        # Run Phase 4 tests"
        echo "  $0 integration   # Run integration tests"
        echo "  $0 coverage       # Run coverage analysis"
        echo "  $0 all           # Run all tests (default)"
        exit 1
        ;;
esac
