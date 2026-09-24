#!/bin/sh
# Installs Team Onboarding on a bb server and puts your team's manifest where
# the plugin reads it. Run as the user bb runs as. Pass the manifest's path.
set -eu

manifest="${1:?usage: bootstrap.sh /path/to/onboarding.yaml}"

bb plugin install git:https://github.com/gperezmz/bb-plugins.git@main --plugin team-onboarding --yes
# Validates the file, then writes it atomically to
# <bb data dir>/team-onboarding/onboarding.yaml (see `bb team-onboarding manifest path`).
bb team-onboarding manifest install "$manifest"
