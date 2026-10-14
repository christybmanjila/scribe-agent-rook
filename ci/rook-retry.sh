#!/usr/bin/env bash
# Sourced by rook-prepare-suite.yml. rook_retry runs one rook command and runs it again (up to
# ROOK_RETRIES times, default 3) when it fails or when Rook's own servers answered "service
# unavailable" — explore, generate and judging have all hit that mid-run, and some rook commands
# exit 0 when it happens. The output is echoed and kept in $ROOK_LAST_OUTPUT for the caller.
rook_retry() {
  local tries=${ROOK_RETRIES:-3} attempt=1 code
  ROOK_LAST_OUTPUT="$RUNNER_TEMP/rook-last-output.txt"
  while :; do
    code=0
    # errexit is off inside a `|| true` list, so a failing rook still reaches the assignment.
    { "$@" 2>&1 | tee "$ROOK_LAST_OUTPUT"; code=${PIPESTATUS[0]}; } || true
    if [ "$code" -eq 0 ] && ! grep -qiE 'service unavailable|bad gateway|gateway time-?out' "$ROOK_LAST_OUTPUT"; then
      return 0
    fi
    if [ "$attempt" -ge "$tries" ]; then
      echo "::warning title=Rook retry::gave up after $attempt attempts: $*"
      return "$(( code == 0 ? 1 : code ))"
    fi
    echo "::warning title=Rook retry::attempt $attempt failed (exit $code or a Rook server error); retrying in $((attempt * 30))s"
    sleep $((attempt * 30))
    attempt=$((attempt + 1))
  done
}

# Prints one line per scenario file in $1: "<id><TAB>valid" or "<id><TAB>invalid<TAB><reason>".
# Invalid means rook's own checker marked it `executable: false` when generating it (a check
# that cannot prove its claim, a reversed check, an unseedable fixture). `rook run` still runs
# some of those, so the workflow drops them itself.
scenario_validity() {
  local f id reason
  for f in "$1"/*.yaml; do
    [ -e "$f" ] || continue
    id=$(basename "$f" .yaml)
    if grep -q '^executable:[[:space:]]*false' "$f"; then
      reason=$(awk '/^skip_reason:/{sub(/^skip_reason:[[:space:]]*(>-|\|-|>|\|)?[[:space:]]*/,""); r=$0; on=1; next}
        on && /^[[:space:]]/{sub(/^[[:space:]]+/,""); r=r" "$0; next} on{exit}
        END{sub(/^[[:space:]]+/,"",r); print r}' "$f")
      printf '%s\tinvalid\t%s\n' "$id" "${reason:-not executable}"
    else
      printf '%s\tvalid\n' "$id"
    fi
  done
}
