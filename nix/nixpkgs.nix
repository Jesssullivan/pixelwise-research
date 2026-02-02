# Nixpkgs configuration for rules_nixpkgs
# This file is used by Bazel to configure the Nix toolchain
{ }:

let
  # Pin to the same nixpkgs as flake.nix
  nixpkgs = fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixos-unstable.tar.gz";
    # Update this hash when updating nixpkgs
    # sha256 = "sha256:0000000000000000000000000000000000000000000000000000";
  };
in
import nixpkgs { }
