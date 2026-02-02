"""Bzlmod extension for nix2container images.

This extension allows declaring nix2container images in MODULE.bazel and
exposes them as external repositories that can be used as base images
in rules_oci builds.

Example usage in MODULE.bazel:

    nix_oci = use_extension("//build:nix_oci_extension.bzl", "nix_oci_extension")

    nix_oci.image(
        name = "nix2container_dev",
        flake_output = "container-dev",
    )

    use_repo(nix_oci, "nix2container_dev")

Then reference in BUILD files:

    oci_image(
        name = "my_image",
        base = "@nix2container_dev//:image",
        ...
    )
"""

load(":nix_oci.bzl", "nix_oci_image")

def _nix_oci_extension_impl(mctx):
    """Implementation of the nix_oci module extension.

    Iterates over all modules using this extension and creates
    nix_oci_image repositories for each declared image.
    """
    for mod in mctx.modules:
        for image in mod.tags.image:
            nix_oci_image(
                name = image.name,
                flake_ref = image.flake_ref if image.flake_ref else ".",
                flake_output = image.flake_output,
            )

_image_tag = tag_class(
    attrs = {
        "name": attr.string(
            mandatory = True,
            doc = "Repository name for this image (e.g., 'nix2container_dev')",
        ),
        "flake_ref": attr.string(
            default = ".",
            doc = "Flake reference (default: current directory)",
        ),
        "flake_output": attr.string(
            mandatory = True,
            doc = "Flake output name (e.g., 'container-dev')",
        ),
    },
    doc = "Declares a nix2container image to be built and exposed as a Bazel repository.",
)

nix_oci_extension = module_extension(
    implementation = _nix_oci_extension_impl,
    tag_classes = {
        "image": _image_tag,
    },
    doc = """Module extension for building nix2container images.

This extension bridges nix2container's declarative container definitions
to Bazel's build system, enabling unified container builds through:

    just → bazel → nix2container

Images are built lazily when first referenced, and outputs are cached
by both Nix (via Attic) and Bazel (via remote cache).
""",
)
