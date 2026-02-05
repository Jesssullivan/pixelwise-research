"""Custom Bazel rules for Futhark WASM compilation."""

def _futhark_wasm_impl(ctx):
    """Compile Futhark source to WASM using wasm-multicore backend.

    This produces both a .wasm file and a .class.js file that provides
    the JavaScript bindings for the WASM module.
    """
    # Determine the main source file
    main_src = ctx.file.main if ctx.attr.main else ctx.files.srcs[0]

    # Output files
    basename = ctx.attr.name
    out_wasm = ctx.actions.declare_file(basename + ".wasm")
    out_js = ctx.actions.declare_file(basename + ".class.js")

    # Build the arguments
    args = ctx.actions.args()
    args.add("wasm-multicore")
    args.add(main_src)
    args.add("-o", out_wasm.path.replace(".wasm", ""))

    # Add any additional flags
    if ctx.attr.futhark_flags:
        args.add_all(ctx.attr.futhark_flags)

    # Run the Futhark compiler
    ctx.actions.run(
        inputs = ctx.files.srcs,
        outputs = [out_wasm, out_js],
        executable = ctx.executable._futhark,
        arguments = [args],
        env = {
            "HOME": "/tmp",  # Emscripten cache directory
            "EM_CACHE": "/tmp/.emscripten_cache",
        },
        mnemonic = "FutharkWasm",
        progress_message = "Compiling Futhark to WASM: %s" % main_src.short_path,
    )

    return [
        DefaultInfo(
            files = depset([out_wasm, out_js]),
            runfiles = ctx.runfiles(files = [out_wasm, out_js]),
        ),
        OutputGroupInfo(
            wasm = depset([out_wasm]),
            js = depset([out_js]),
        ),
    ]

futhark_wasm = rule(
    implementation = _futhark_wasm_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = [".fut"],
            mandatory = True,
            doc = "Futhark source files",
        ),
        "main": attr.label(
            allow_single_file = [".fut"],
            doc = "Main Futhark source file (if different from first in srcs)",
        ),
        "futhark_flags": attr.string_list(
            doc = "Additional flags to pass to futhark compiler",
        ),
        "_futhark": attr.label(
            default = "@nixpkgs//:futhark",
            executable = True,
            cfg = "exec",
            doc = "Futhark compiler executable",
        ),
    },
    doc = "Compile Futhark source to WASM using wasm-multicore backend",
)

def _futhark_test_impl(ctx):
    """Run Futhark tests using the specified backend."""
    src = ctx.file.src

    # Create a test script
    test_script = ctx.actions.declare_file(ctx.attr.name + "_test.sh")

    script_content = """#!/bin/bash
set -e
export HOME=/tmp
export EM_CACHE=/tmp/.emscripten_cache
{futhark} test --backend={backend} {src}
""".format(
        futhark = ctx.executable._futhark.short_path,
        backend = ctx.attr.backend,
        src = src.short_path,
    )

    ctx.actions.write(
        output = test_script,
        content = script_content,
        is_executable = True,
    )

    # Collect runfiles
    runfiles = ctx.runfiles(
        files = [src, ctx.executable._futhark] + ctx.files.deps,
    )

    return [
        DefaultInfo(
            executable = test_script,
            runfiles = runfiles,
        ),
    ]

futhark_test = rule(
    implementation = _futhark_test_impl,
    attrs = {
        "src": attr.label(
            allow_single_file = [".fut"],
            mandatory = True,
            doc = "Futhark source file containing tests",
        ),
        "backend": attr.string(
            default = "c",
            values = ["c", "opencl", "cuda", "multicore", "wasm", "wasm-multicore"],
            doc = "Backend to use for testing",
        ),
        "deps": attr.label_list(
            allow_files = True,
            doc = "Additional dependencies (other .fut files)",
        ),
        "_futhark": attr.label(
            default = "@nixpkgs//:futhark",
            executable = True,
            cfg = "exec",
            doc = "Futhark compiler executable",
        ),
    },
    test = True,
    doc = "Run Futhark test cases using futhark test command",
)

def _futhark_library_impl(ctx):
    """Create a Futhark library that can be imported by other Futhark files."""
    return [
        DefaultInfo(
            files = depset(ctx.files.srcs),
            runfiles = ctx.runfiles(files = ctx.files.srcs),
        ),
    ]

futhark_library = rule(
    implementation = _futhark_library_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = [".fut"],
            mandatory = True,
            doc = "Futhark source files",
        ),
    },
    doc = "A collection of Futhark source files that can be used as dependencies",
)

# ============================================================
# WebGPU Backend (Experimental - Futhark PR #2140)
# ============================================================

def _futhark_webgpu_impl(ctx):
    """Compile Futhark source to WebGPU using the experimental webgpu backend.

    This produces a .js file (Futhark runtime with embedded WGSL) and a .wasm file
    (host code for buffer management). The generated code uses WebGPU compute shaders
    instead of hand-written WGSL.

    Requires custom Futhark build from PR #2140:
    https://github.com/diku-dk/futhark/pull/2140
    """
    # Determine the main source file
    main_src = ctx.file.main if ctx.attr.main else ctx.files.srcs[0]

    # Output files
    basename = ctx.attr.name
    out_js = ctx.actions.declare_file(basename + ".js")
    out_wasm = ctx.actions.declare_file(basename + ".wasm")

    # Build the arguments
    args = ctx.actions.args()
    args.add("webgpu")
    args.add("--library")
    args.add(main_src)
    args.add("-o", out_js.path.replace(".js", ""))

    # Add any additional flags
    if ctx.attr.futhark_flags:
        args.add_all(ctx.attr.futhark_flags)

    # Run the Futhark WebGPU compiler
    ctx.actions.run(
        inputs = ctx.files.srcs,
        outputs = [out_js, out_wasm],
        executable = ctx.executable._futhark_webgpu,
        arguments = [args],
        env = {
            "HOME": "/tmp",
        },
        mnemonic = "FutharkWebGPU",
        progress_message = "Compiling Futhark to WebGPU: %s" % main_src.short_path,
    )

    return [
        DefaultInfo(
            files = depset([out_js, out_wasm]),
            runfiles = ctx.runfiles(files = [out_js, out_wasm]),
        ),
        OutputGroupInfo(
            js = depset([out_js]),
            wasm = depset([out_wasm]),
        ),
    ]

futhark_webgpu = rule(
    implementation = _futhark_webgpu_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = [".fut"],
            mandatory = True,
            doc = "Futhark source files",
        ),
        "main": attr.label(
            allow_single_file = [".fut"],
            doc = "Main Futhark source file (if different from first in srcs)",
        ),
        "futhark_flags": attr.string_list(
            doc = "Additional flags to pass to futhark compiler",
        ),
        "_futhark_webgpu": attr.label(
            # NOTE: This requires a custom Futhark build with WebGPU support (PR #2140)
            # The default path assumes: cabal install --installdir=$HOME/.local/futhark-webgpu/bin
            # For Bazel, you may need to register a custom toolchain or use a repository rule
            default = "@futhark_webgpu//:bin/futhark",
            executable = True,
            cfg = "exec",
            doc = "Futhark compiler with WebGPU backend (from PR #2140)",
        ),
    },
    doc = """Compile Futhark source to WebGPU using the experimental webgpu backend.

This rule requires a custom Futhark build from PR #2140:
https://github.com/diku-dk/futhark/pull/2140

Build instructions:
  1. git clone https://github.com/diku-dk/futhark.git ~/git/futhark-webgpu
  2. cd ~/git/futhark-webgpu
  3. git fetch origin pull/2140/head:webgpu-pr2140 && git checkout webgpu-pr2140
  4. cabal build && cabal install --installdir=$HOME/.local/futhark-webgpu/bin

For Bazel integration, register the custom Futhark as a repository in WORKSPACE.
""",
)
