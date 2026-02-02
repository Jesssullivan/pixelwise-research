"""Common build definitions for Pixelwise."""

load("//build:futhark.bzl", _futhark_library = "futhark_library", _futhark_test = "futhark_test", _futhark_wasm = "futhark_wasm")

# Re-export Futhark rules
futhark_wasm = _futhark_wasm
futhark_test = _futhark_test
futhark_library = _futhark_library

def pixelwise_wasm_library(name, srcs, deps = [], **kwargs):
    """Create a WASM library with standard Pixelwise configuration.

    This macro sets up common defaults for WASM modules in the project.

    Args:
        name: Target name
        srcs: Source files
        deps: Dependencies
        **kwargs: Additional arguments passed to underlying rules
    """
    # This is a placeholder for future enhancements
    # Currently just wraps the standard rules
    native.filegroup(
        name = name,
        srcs = srcs,
        **kwargs
    )

def pixelwise_test_suite(name, tests, tags = [], **kwargs):
    """Create a test suite with standard configuration.

    Args:
        name: Suite name
        tests: List of test targets
        tags: Additional tags
        **kwargs: Additional arguments
    """
    native.test_suite(
        name = name,
        tests = tests,
        tags = tags,
        **kwargs
    )
